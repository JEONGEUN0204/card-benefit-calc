import { attainableAtTier, effectiveRateOf, benefitPlanFor } from './attainable.js';
import { assertResolved } from './choice.js';
import { REST_POOL, poolsForBenefit, scopeGroups, spendPools } from './scope.js';
import { steadyStateFor } from './steady.js';
import { synthesizeSlices } from './synthesize.js';
import { benefitCapFor } from './tier.js';
import type { SpendCeilings } from './attainable.js';
import type { ScopeGroup } from './scope.js';
import type { SpendSlice } from './synthesize.js';
import type { CardRule, Tier, Won } from './types.js';

/** 카드 약관이 아니라 **이 사용자의 사정**이다. 적금 우대 조건 같은 것. */
export interface CardConstraint {
  cardId: string;
  /** 다른 조건 때문에 반드시 이 카드로 써야 하는 월 최소 결제액. */
  minMonthlySpend?: Won;
  maxMonthlySpend?: Won;
}

export interface AllocateInput {
  /** `resolveChoices`를 거친 규칙. */
  cards: readonly CardRule[];
  ceilings: SpendCeilings;
  constraints?: readonly CardConstraint[];
  /** 옮기지 않는 지출. K-패스 교통비처럼 특정 카드에 묶인 것. */
  pinned?: readonly { pool: string; cardId: string }[];
}

export interface PoolAssignment {
  amount: Won;
  txCount: number;
}

export interface CardPlan {
  cardId: string;
  /** 이 카드를 쓰지 않기로 했으면 null. */
  tier: Tier | null;
  used: boolean;
  /** 지출 풀 키 → 배정 금액·건수. */
  byKey: Record<string, PoolAssignment>;
  monthlySpend: Won;
  /** FIFO로 재현한 월 혜택(월정액 포함). 진동하면 사이클 평균이다. */
  monthlyDiscount: Won;
  monthlySpending: Won;
  oscillates: boolean;
  /** 할인 때문에 실적에서 빠진 금액. "순할인" 예시의 재료다. */
  excludedFromSpending: Won;
}

export type AllocationWarningKind =
  | 'tooManyCards'
  | 'oscillating'
  | 'leftover'
  | 'noFeasiblePlan'
  | 'notProvenOptimal';

export interface AllocationWarning {
  kind: AllocationWarningKind;
  cardId?: string;
  message: string;
}

export interface Allocation {
  plans: CardPlan[];
  /** 쓰는 카드들의 FIFO 월 혜택 합. */
  monthlyDiscount: Won;
  /** 쓰는 카드의 연회비 합. 안 쓰는 카드는 빠진다. */
  annualFeeTotal: Won;
  /** 월 혜택 × 12 − 연회비 합. 구성을 견주는 단위다. */
  annualNet: Won;
  /** 어느 카드에도 배정하지 않은 예산. */
  leftover: Won;
  /** 열거한 구간 조합의 해석 점수 최댓값. 실제 혜택의 상한이다. */
  upperBound: Won;
  /** `upperBound − monthlyDiscount`. 0이면 더 나은 배분이 없음이 증명된다. */
  gap: Won;
  warnings: AllocationWarning[];
}

/** 구간 조합 열거의 상한. 넘으면 카드 수를 줄이라고 알린다. */
const MAX_VECTORS = 4096;
/** 한계 배정의 반복 횟수 상한. 덩어리 크기를 여기서 거꾸로 정한다. */
const GREEDY_STEPS = 40;
const MIN_STEP: Won = 5_000;
/** 혜택이 붙지 않는 지출을 흩뿌릴 건단가. 일 단위 횟수 제한과 무관한 돈이다. */
const PADDING_TICKET: Won = 100_000;

/** "이 카드를 쓰지 않는다"를 뜻하는 정의역 원소. 구간 0과는 다르다. */
const UNUSED = 'unused';
type Slot = Tier | typeof UNUSED;

function slotTier(slot: Slot): Tier | null {
  return slot === UNUSED ? null : slot;
}

interface PoolShape {
  key: string;
  category: string;
  merchant: string;
  overseas?: boolean;
}

/**
 * 풀의 돈이 거래가 될 때 쓸 업종·가맹점명.
 *
 * 그룹에 적힌 첫 값을 쓴다. 가맹점명으로 맞추는 혜택은 그 이름이 있어야 걸리고, 업종으로
 * 맞추는 혜택은 업종이 있어야 걸린다. 나머지 풀은 어떤 혜택에도 걸리지 않아야 하므로
 * 중성적인 값을 쓴다 — 전 가맹점 혜택만 이 돈에 붙는다.
 */
function poolShapes(groups: readonly ScopeGroup[]): Map<string, PoolShape> {
  const out = new Map<string, PoolShape>();
  for (const key of spendPools(groups)) {
    if (key === REST_POOL) {
      out.set(key, { key, category: 'etc', merchant: '일반가맹점' });
      continue;
    }
    const group = groups.find((g) => g.key === key);
    const shape: PoolShape = {
      key,
      category: group?.categories[0] ?? 'etc',
      merchant: group?.merchants[0] ?? (group?.categories[0] ?? 'etc'),
    };
    if (group?.overseas === true) shape.overseas = true;
    out.set(key, shape);
  }
  return out;
}

/** 데카르트 곱. 상한을 넘으면 null. */
function vectors(domains: readonly Slot[][]): Slot[][] | null {
  let total = 1;
  for (const d of domains) total *= d.length;
  if (total > MAX_VECTORS) return null;

  let out: Slot[][] = [[]];
  for (const domain of domains) {
    const next: Slot[][] = [];
    for (const prefix of out) for (const slot of domain) next.push([...prefix, slot]);
    out = next;
  }
  return out;
}

/**
 * 이 카드가 이 풀에서 얻을 수 있는 가장 높은 할인율. 구간이 열어 주지 않는 혜택은 뺀다.
 *
 * 하한을 어느 풀의 돈으로 채울지 정하는 데 쓴다. 정확한 값이 아니라 **순서**를 정하는
 * 값이므로 한도 소진은 보지 않는다.
 */
function bestRateTable(
  cards: readonly CardRule[],
  groups: readonly ScopeGroup[],
  slots: readonly Slot[],
  pools: readonly string[],
): number[][] {
  return cards.map((card, index) => {
    const tier = slotTier(slots[index] ?? UNUSED);
    const unused = slots[index] === UNUSED;
    return pools.map((pool) => {
      if (unused || tier === null) return 0;
      let best = 0;
      for (const benefit of card.benefits) {
        if (!poolsForBenefit(groups, card.id, benefit.id).includes(pool)) continue;
        if (benefitCapFor(benefit, tier) <= 0) continue;
        best = Math.max(best, effectiveRateOf(benefit));
      }
      return best;
    });
  });
}

interface Draft {
  slots: readonly Slot[];
  /** 카드 index → 풀 키 → 금액. */
  assigned: Map<number, Map<string, Won>>;
  spend: Won[];
  /** 해석 모델이 본 카드별 월 혜택. FIFO 평가 전의 추정이다. */
  analytic: Won[];
  leftover: Won;
}

/**
 * 한 카드에 이 풀 금액을 줬을 때 해석 모델이 보는 월 혜택.
 *
 * `attainableByTier`를 그대로 쓴다 — 혜택별·공동·통합 한도와 횟수·건당 조건을 모두 보는
 * 같은 산술이 필요하고, 두 곳에 따로 쓰면 어긋난다. 전 가맹점 혜택은 `monthlyBudget`에서
 * 끌어오므로 나머지 풀의 돈도 닿는다.
 */
function analyticDiscount(
  card: CardRule,
  groups: readonly ScopeGroup[],
  tier: Tier | null,
  pools: ReadonlyMap<string, Won>,
  total: Won,
): Won {
  if (tier === null || total <= 0) return 0;
  const byKey: Record<string, Won> = {};
  for (const [key, amount] of pools) if (amount > 0) byKey[key] = amount;
  return attainableAtTier(card, groups, tier, { byKey, monthlyBudget: total }).attainable;
}

function buildDraft(
  input: AllocateInput,
  groups: readonly ScopeGroup[],
  pools: readonly string[],
  slots: readonly Slot[],
): Draft | null {
  const { cards, ceilings } = input;
  const poolLeft = new Map<string, Won>(
    pools.map((key) => [key, Math.max(0, ceilings.byKey[key] ?? 0)]),
  );
  const assigned = new Map<number, Map<string, Won>>(cards.map((_, i) => [i, new Map()]));
  const spend: Won[] = cards.map(() => 0);
  let budgetLeft = Math.max(0, ceilings.monthlyBudget);

  const constraintFor = (cardId: string): CardConstraint | undefined =>
    input.constraints?.find((c) => c.cardId === cardId);
  const maxRoom = (index: number): Won => {
    const card = cards[index];
    if (card === undefined) return 0;
    if (slots[index] === UNUSED) return 0;
    const max = constraintFor(card.id)?.maxMonthlySpend;
    return max === undefined ? Number.POSITIVE_INFINITY : Math.max(0, max - (spend[index] ?? 0));
  };
  const give = (index: number, pool: string, amount: Won): void => {
    if (amount <= 0) return;
    const bucket = assigned.get(index);
    if (bucket === undefined) return;
    bucket.set(pool, (bucket.get(pool) ?? 0) + amount);
    poolLeft.set(pool, (poolLeft.get(pool) ?? 0) - amount);
    spend[index] = (spend[index] ?? 0) + amount;
    budgetLeft -= amount;
  };

  const rates = bestRateTable(cards, groups, slots, pools);

  // 고정된 지출을 먼저 배정한다. 옮길 수 없는 돈이므로 다른 선택의 여지가 없다.
  for (const pin of input.pinned ?? []) {
    const index = cards.findIndex((c) => c.id === pin.cardId);
    if (index < 0 || slots[index] === UNUSED) continue;
    give(index, pin.pool, Math.min(poolLeft.get(pin.pool) ?? 0, budgetLeft, maxRoom(index)));
  }

  /*
   * 하한 채우기 — 구간을 열려면 실적이 그만큼 있어야 한다.
   *
   * 어느 풀의 돈으로 채우느냐가 중요하다. 기회비용이 낮은 풀부터 쓴다. 기회비용은
   * "다른 카드가 이 풀에서 얻는 최고 할인율 − 내가 얻는 할인율"이다. 음수면 내가 이 풀의
   * 가장 좋은 주인이라는 뜻이라 먼저 가져간다.
   *
   * 이 순서가 없으면 전 가맹점 1% 카드가 구독 30% 풀을 먼저 집어삼킨다 — 자기 하한을
   * 채우기만 하면 되므로 어느 풀이든 상관없기 때문이다.
   *
   * 구간이 높은 카드부터 채운다. 하한이 큰 쪽이 선택의 여지가 적다.
   */
  const order = cards
    .map((_, index) => index)
    .filter((index) => slots[index] !== UNUSED && slotTier(slots[index] ?? UNUSED) !== null)
    .sort((a, b) => {
      const ta = slotTier(slots[a] ?? UNUSED)?.min ?? 0;
      const tb = slotTier(slots[b] ?? UNUSED)?.min ?? 0;
      return tb - ta || a - b;
    });

  for (const index of order) {
    const tier = slotTier(slots[index] ?? UNUSED);
    const card = cards[index];
    if (tier === null || card === undefined) continue;
    const floor = Math.max(tier.min, constraintFor(card.id)?.minMonthlySpend ?? 0);
    let need = floor - (spend[index] ?? 0);
    if (need <= 0) continue;

    const mine = rates[index] ?? [];
    const ranked = [...pools]
      .map((pool, at) => {
        let bestOther = 0;
        for (let other = 0; other < cards.length; other += 1) {
          if (other === index) continue;
          bestOther = Math.max(bestOther, rates[other]?.[at] ?? 0);
        }
        return { pool, cost: bestOther - (mine[at] ?? 0) };
      })
      .sort((x, y) => x.cost - y.cost || (x.pool < y.pool ? -1 : x.pool > y.pool ? 1 : 0));

    for (const { pool } of ranked) {
      if (need <= 0) break;
      const take = Math.min(need, poolLeft.get(pool) ?? 0, budgetLeft, maxRoom(index));
      if (take <= 0) continue;
      give(index, pool, take);
      need -= take;
    }
    // 하한을 못 채우면 이 조합은 실현할 수 없다.
    if (need > 0) return null;
  }

  /*
   * 남은 예산을 한계 가치가 가장 높은 곳에 붓는다.
   *
   * 한계 가치는 "이 돈을 이 카드에 주면 해석 모델의 혜택이 얼마 늘어나는가"다. 할인율이
   * 아니라 **늘어난 혜택**으로 재야 한다 — 한도가 이미 찬 혜택은 할인율이 높아도 더
   * 주지 않기 때문이다.
   */
  const step = Math.max(MIN_STEP, Math.ceil(budgetLeft / GREEDY_STEPS));
  for (let guard = 0; guard < GREEDY_STEPS * 2 && budgetLeft > 0; guard += 1) {
    let best: { index: number; pool: string; chunk: Won; gain: Won } | null = null;
    for (let index = 0; index < cards.length; index += 1) {
      const card = cards[index];
      const tier = slotTier(slots[index] ?? UNUSED);
      if (card === undefined || tier === null || slots[index] === UNUSED) continue;
      const bucket = assigned.get(index);
      if (bucket === undefined) continue;
      const now = analyticDiscount(card, groups, tier, bucket, spend[index] ?? 0);
      for (const pool of pools) {
        const chunk = Math.min(step, poolLeft.get(pool) ?? 0, budgetLeft, maxRoom(index));
        if (chunk <= 0) continue;
        const probe = new Map(bucket);
        probe.set(pool, (probe.get(pool) ?? 0) + chunk);
        const gain =
          analyticDiscount(card, groups, tier, probe, (spend[index] ?? 0) + chunk) - now;
        if (gain <= 0) continue;
        if (best === null || gain * best.chunk > best.gain * chunk) {
          best = { index, pool, chunk, gain };
        }
      }
    }
    if (best === null) break;
    give(best.index, best.pool, best.chunk);
  }

  const analytic = cards.map((card, index) => {
    const tier = slotTier(slots[index] ?? UNUSED);
    const bucket = assigned.get(index);
    if (bucket === undefined) return 0;
    return analyticDiscount(card, groups, tier, bucket, spend[index] ?? 0);
  });

  return { slots, assigned, spend, analytic, leftover: budgetLeft };
}

/**
 * 배정안을 거래로 바꿔 FIFO로 돌린다. **화면에 뜨는 금액은 모두 여기서 나온다.**
 *
 * 최적화기는 배분안만 제안하고 금액을 만들지 않는다(불변규칙 4). 그래서 최적화기의 근사
 * 오차는 "덜 좋은 배분을 골랐다"로만 나타나고, 틀린 숫자가 화면에 뜨는 일은 구조적으로
 * 일어나지 않는다.
 */
function evaluate(
  input: AllocateInput,
  groups: readonly ScopeGroup[],
  shapes: ReadonlyMap<string, PoolShape>,
  draft: Draft,
): { plans: CardPlan[]; monthlyDiscount: Won; feasible: boolean } | null {
  const plans: CardPlan[] = [];
  let monthlyDiscount = 0;
  let feasible = true;

  for (let index = 0; index < input.cards.length; index += 1) {
    const card = input.cards[index];
    if (card === undefined) continue;
    const slot = draft.slots[index] ?? UNUSED;
    const tier = slotTier(slot);
    const bucket = draft.assigned.get(index) ?? new Map<string, Won>();
    const monthlySpend = draft.spend[index] ?? 0;

    if (slot === UNUSED || monthlySpend <= 0) {
      // 쓰지 않는 카드. 구간을 따지지 않고 연회비도 세지 않는다.
      plans.push({
        cardId: card.id,
        tier: null,
        used: false,
        byKey: {},
        monthlySpend: 0,
        monthlyDiscount: 0,
        monthlySpending: 0,
        oscillates: false,
        excludedFromSpending: 0,
      });
      // 구간을 열어 두고 한 푼도 안 쓰는 조합은 쓰지 않는 조합과 같다. 중복이라 버린다.
      if (slot !== UNUSED) feasible = false;
      continue;
    }

    const slices: SpendSlice[] = [];
    const byKey: Record<string, PoolAssignment> = {};
    for (const [pool, amount] of [...bucket].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (amount <= 0) continue;
      const shape = shapes.get(pool);
      if (shape === undefined) continue;

      // 이 풀에서 가장 잘 버는 혜택이 건단가와 건수를 정한다. 없으면 흩뿌린다.
      let chosen: { txCount: number } | null = null;
      let bestRate = 0;
      for (const benefit of card.benefits) {
        if (!poolsForBenefit(groups, card.id, benefit.id).includes(pool)) continue;
        if (tier === null || benefitCapFor(benefit, tier) <= 0) continue;
        const rate = effectiveRateOf(benefit);
        if (rate <= bestRate) continue;
        bestRate = rate;
        const plan = benefitPlanFor(benefit, card, amount, Number.POSITIVE_INFINITY);
        chosen = { txCount: Math.max(1, plan.txCount) };
      }
      const txCount = chosen?.txCount ?? Math.max(1, Math.ceil(amount / PADDING_TICKET));
      byKey[pool] = { amount, txCount };
      const slice: SpendSlice = {
        key: pool,
        category: shape.category,
        merchant: shape.merchant,
        amount,
        txCount,
      };
      if (shape.overseas !== undefined) slice.overseas = shape.overseas;
      slices.push(slice);
    }

    const txs = synthesizeSlices(slices);
    const steady = steadyStateFor(card, txs);
    const realized = steady.oscillates ? steady.cycle : [steady.cycle[0] ?? null];
    // 가정한 구간이 실제로 지켜지는지 본다. 지켜지지 않으면 다른 조합에서 다시 나온다.
    const holds = realized.some((t) => (t?.min ?? null) === (tier?.min ?? null));
    if (!holds) feasible = false;

    monthlyDiscount += steady.monthlyDiscount;
    plans.push({
      cardId: card.id,
      tier,
      used: true,
      byKey,
      monthlySpend,
      monthlyDiscount: steady.monthlyDiscount,
      monthlySpending: steady.monthlySpending,
      oscillates: steady.oscillates,
      excludedFromSpending: Math.max(0, monthlySpend - steady.monthlySpending),
    });
  }

  return { plans, monthlyDiscount, feasible };
}

/**
 * 월 지출을 카드 여러 장에 나눠 쓰는 배분을 찾는다.
 *
 * 구간 조합을 열거한다. 혜택 함수는 구간 문턱에서 위로 점프하므로 매끄럽지 않고, 한계
 * 할인율만 보는 탐욕은 **구간을 여는 돈의 가치를 보지 못한다** — 팟 카드로 쓰는 40만원 중
 * 20만원은 할인을 한 푼도 만들지 않지만, 그 돈이 없으면 2만원 한도가 열리지 않는다.
 * 조합을 고정하면 한도가 고정되어 그 안에서는 한계 가치 탐욕이 통한다.
 *
 * 금액은 전부 `evaluate`의 FIFO 경로에서 나온다. 해석 모델은 조합을 **고르는** 데만 쓴다.
 */
export function allocate(input: AllocateInput): Allocation {
  for (const card of input.cards) assertResolved(card);

  const warnings: AllocationWarning[] = [];
  const groups = scopeGroups(input.cards);
  const pools = spendPools(groups);
  const shapes = poolShapes(groups);

  const empty = (): Allocation => ({
    plans: input.cards.map((card) => ({
      cardId: card.id,
      tier: null,
      used: false,
      byKey: {},
      monthlySpend: 0,
      monthlyDiscount: 0,
      monthlySpending: 0,
      oscillates: false,
      excludedFromSpending: 0,
    })),
    monthlyDiscount: 0,
    annualFeeTotal: 0,
    annualNet: 0,
    leftover: Math.max(0, input.ceilings.monthlyBudget),
    upperBound: 0,
    gap: 0,
    warnings,
  });

  if (input.cards.length === 0) return empty();

  const domains: Slot[][] = input.cards.map((card) => {
    const tiers = [...card.tiers].sort((a, b) => a.min - b.min);
    /*
     * 최소 사용액 제약이 걸린 카드는 "안 쓰는 카드"가 될 수 없다. 적금 우대 조건처럼
     * 카드 혜택과 무관한 이유로 반드시 써야 하는 돈이기 때문이다. 정의역에 UNUSED를
     * 남겨 두면 최적화기가 그 카드를 빼는 쪽을 골라 제약이 조용히 사라진다.
     */
    const required = (input.constraints?.find((c) => c.cardId === card.id)?.minMonthlySpend ?? 0) > 0;
    return required ? tiers : [UNUSED, ...tiers];
  });
  const all = vectors(domains);
  if (all === null) {
    warnings.push({
      kind: 'tooManyCards',
      message: `카드가 ${input.cards.length}장이라 구간 조합이 너무 많습니다. 세 장까지 고르세요.`,
    });
    return empty();
  }

  let upperBound = 0;
  let best: { allocation: Allocation; usedCount: number } | null = null;

  for (const slots of all) {
    const draft = buildDraft(input, groups, pools, slots);
    if (draft === null) continue;

    const analyticTotal = draft.analytic.reduce((sum, v) => sum + v, 0);
    const result = evaluate(input, groups, shapes, draft);
    if (result === null || !result.feasible) continue;

    // 해석 점수는 그 조합에서 받을 수 있는 혜택의 상한이다 — 거래 순서를 보지 않기 때문이다.
    upperBound = Math.max(upperBound, analyticTotal);

    const annualFeeTotal = result.plans
      .filter((p) => p.used)
      .reduce((sum, p) => sum + (input.cards.find((c) => c.id === p.cardId)?.annualFee ?? 0), 0);
    const annualNet = result.monthlyDiscount * 12 - annualFeeTotal;
    const usedCount = result.plans.filter((p) => p.used).length;

    const candidate: Allocation = {
      plans: result.plans,
      monthlyDiscount: result.monthlyDiscount,
      annualFeeTotal,
      annualNet,
      leftover: draft.leftover,
      upperBound: 0,
      gap: 0,
      warnings: [],
    };

    // 같은 연 순이익이면 카드가 적은 쪽이 낫다 — 매달 실적을 맞추는 수고가 줄어든다.
    if (
      best === null ||
      annualNet > best.allocation.annualNet ||
      (annualNet === best.allocation.annualNet && usedCount < best.usedCount)
    ) {
      best = { allocation: candidate, usedCount };
    }
  }

  if (best === null) {
    warnings.push({
      kind: 'noFeasiblePlan',
      message: '이 예산과 지출 상한으로는 어느 구간도 채울 수 없습니다.',
    });
    return empty();
  }

  const chosen = best.allocation;
  for (const plan of chosen.plans) {
    if (!plan.oscillates) continue;
    warnings.push({
      kind: 'oscillating',
      cardId: plan.cardId,
      message:
        '이 카드는 할인받은 결제가 실적에서 빠져 달마다 구간이 왕복합니다. 표시한 혜택은 사이클 평균입니다.',
    });
  }
  if (chosen.leftover > 0) {
    warnings.push({
      kind: 'leftover',
      message: `예산 ${chosen.leftover.toLocaleString('ko-KR')}원은 쓸 곳이 없어 남겼습니다. 항목별 상한을 늘리면 달라집니다.`,
    });
  }
  const gap = Math.max(0, upperBound - chosen.monthlyDiscount);
  if (gap > 0) {
    warnings.push({
      kind: 'notProvenOptimal',
      message: `이론 상한 ${upperBound.toLocaleString('ko-KR')}원과 ${gap.toLocaleString('ko-KR')}원 차이가 있습니다. 구간 문턱 때문에 닿을 수 없는 몫일 수도 있습니다.`,
    });
  }

  return { ...chosen, upperBound, gap, warnings };
}

/** 카드 조합 하나와 그 조합의 최적 배분. */
export interface PortfolioOption {
  /** 쓰는 카드. 입력 순서를 지킨다. */
  cardIds: string[];
  allocation: Allocation;
}

/** 부분집합을 다 훑기에 너무 많으면 멈추는 선. 카드 다섯 장이면 31개다. */
const MAX_PORTFOLIOS = 31;

/**
 * 카드 조합마다 최적 배분을 구해 연 순이익 내림차순으로 돌려준다.
 *
 * `allocate`는 이미 "안 쓰는 카드"를 정의역에 두어 가장 좋은 조합을 찾는다. 이 함수는
 * 그 결론만 보여 주는 대신 **대안을 나란히 세우는** 데 쓴다 — "둘 다 vs EVERY 1만 vs
 * 팟만"을 견주어야 카드를 새로 발급할지 정할 수 있기 때문이다.
 *
 * 반드시 써야 하는 카드(최소 사용액 제약)가 빠진 조합은 내놓지 않는다. 적금 우대 조건은
 * 카드 혜택과 무관한 이유로 그 카드를 쓰게 하므로, 그 카드를 뺀 구성은 선택지가 아니다.
 */
export function comparePortfolios(input: AllocateInput): PortfolioOption[] {
  const n = input.cards.length;
  if (n === 0) return [];
  const total = 2 ** n - 1;
  if (total > MAX_PORTFOLIOS) {
    // 조합이 너무 많다. 전체와 한 장씩만 견준다.
    const subsets = [input.cards.map((c) => c.id), ...input.cards.map((c) => [c.id])];
    return rank(input, subsets);
  }

  const subsets: string[][] = [];
  for (let mask = 1; mask <= total; mask += 1) {
    const ids = input.cards.filter((_, i) => (mask & (1 << i)) !== 0).map((c) => c.id);
    subsets.push(ids);
  }
  return rank(input, subsets);
}

function rank(input: AllocateInput, subsets: readonly string[][]): PortfolioOption[] {
  const required = (input.constraints ?? [])
    .filter((c) => (c.minMonthlySpend ?? 0) > 0)
    .map((c) => c.cardId);

  const out: PortfolioOption[] = [];
  for (const cardIds of subsets) {
    if (!required.every((id) => cardIds.includes(id))) continue;
    const cards = input.cards.filter((c) => cardIds.includes(c.id));
    const constraints = (input.constraints ?? []).filter((c) => cardIds.includes(c.cardId));
    const pinned = (input.pinned ?? []).filter((p) => cardIds.includes(p.cardId));
    out.push({
      cardIds,
      allocation: allocate({
        cards,
        ceilings: input.ceilings,
        ...(constraints.length > 0 ? { constraints } : {}),
        ...(pinned.length > 0 ? { pinned } : {}),
      }),
    });
  }

  // 연 순이익이 같으면 카드가 적은 쪽을 앞에 둔다 — 매달 실적을 맞추는 수고가 적다.
  return out.sort(
    (a, b) =>
      b.allocation.annualNet - a.allocation.annualNet ||
      a.cardIds.length - b.cardIds.length ||
      (a.cardIds.join() < b.cardIds.join() ? -1 : 1),
  );
}
