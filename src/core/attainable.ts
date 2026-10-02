import { assertResolved } from './choice.js';
import { maxDiscountByTier } from './maxDiscount.js';
import { roundDiscount } from './rounding.js';
import { ALL_SCOPE, scopeKeyOf } from './scope.js';
import { SPREAD_DAYS } from './synthesize.js';
import { benefitCapFor, groupCapFor, rebateFor, totalCapFor } from './tier.js';
import type { ScopeGroup } from './scope.js';
import type { Benefit, CardRule, CountLimit, Tier, Won } from './types.js';

/**
 * 내가 각 지출 풀에 한 달에 쓸 수 있는 최대 금액.
 *
 * 카드사 한도가 아니라 **내 소비**의 상한이다. 카드사 안내문이 말하는 월 최대 할인은
 * 한도의 상한일 뿐이고, 그만큼 받으려면 해당 항목에 그만큼 써야 한다.
 */
export interface SpendCeilings {
  /** `ScopeGroup.key` → 그 항목에 쓸 수 있는 월 최대 금액. 적지 않은 항목은 0으로 본다. */
  byKey: Record<string, Won>;
  /** 월 총예산. 전 가맹점 혜택의 상한이자 모든 항목 합계의 상한이다. */
  monthlyBudget: Won;
}

/**
 * 달성 가능액을 묶은 것.
 *
 * `perTx`가 없는 이유: 횟수 제한이 없으면 건당 한도만으로는 월 합계가 줄지 않는다.
 * 건당 상한에 꼭 맞는 금액으로 건을 늘리면 되기 때문이다. 건당 한도의 영향은
 * `txCount`에 드러난다.
 */
export type AttainableLimit =
  | 'cap'
  | 'group'
  | 'total'
  | 'count'
  | 'ceiling'
  | 'minTransaction'
  | 'tierLocked'
  | 'timeGated';

export interface AttainableBenefit {
  benefitId: string;
  /** 이 혜택이 돈을 끌어오는 지출 풀. */
  scopeKey: string;
  /** 혜택별 월 한도. `null`이면 한도 없음. */
  nominalCap: Won | null;
  /** 내 지출 상한 아래에서 실제로 받을 수 있는 최대. 세 층의 한도까지 반영한 값이다. */
  attainable: Won;
  limitedBy: AttainableLimit;
  /** 그만큼 받으려면 이 항목에 써야 하는 금액. */
  spendNeeded: Won;
  txCount: number;
  /** 권장 건단가. 0건이면 0. */
  ticket: Won;
}

export interface TierAttainable {
  tier: Tier;
  /** 규칙에 적힌 순서대로. */
  byBenefit: AttainableBenefit[];
  /** 이 구간에서 실제로 받을 수 있는 월 할인 합계 + 월정액. */
  attainable: Won;
  /** 카드사 안내문이 말하는 월 최대 (`maxDiscountByTier`의 `maxDiscount`). */
  nominal: Won;
  rebate: Won;
  unboundedBenefits: string[];
}

/** 제한 하나를 적든 여럿을 적든 같은 자리에서 본다. `discount.ts`와 같은 기준이다. */
function countLimitsOf(benefit: Benefit): readonly CountLimit[] {
  const limit = benefit.countLimit;
  if (limit === undefined) return [];
  return Array.isArray(limit) ? limit : [limit];
}

/**
 * 한 달에 이 혜택이 붙을 수 있는 날의 수.
 *
 * 28일은 정확히 4주라 어느 요일이든 4번씩 들어 있다. 요일 조건이 있으면 그만큼 줄어든다.
 * 요일 제한이 지출 상한까지 줄이지는 않는다 — 처방은 "주말에 장을 보라"고 말할 수 있다.
 */
function qualifyingDays(benefit: Benefit): number {
  const weekdays = benefit.match.weekdays;
  if (weekdays === undefined || weekdays.length === 0) return SPREAD_DAYS;
  return weekdays.length * (SPREAD_DAYS / 7);
}

/** 월 환산 횟수 제한. 제한이 없으면 무한대다. */
function effectiveCount(benefit: Benefit): number {
  let month = Number.POSITIVE_INFINITY;
  let day = Number.POSITIVE_INFINITY;
  for (const limit of countLimitsOf(benefit)) {
    if (limit.period === 'month') month = Math.min(month, limit.max);
    else day = Math.min(day, limit.max);
  }
  const fromDay = day === Number.POSITIVE_INFINITY ? day : day * qualifyingDays(benefit);
  return Math.min(month, fromDay);
}

/**
 * 할인율로 환산한 "1원당 받는 액수". 공동 한도를 누가 먼저 가져갈지 정하는 기준이다.
 *
 * 정액 할인은 건당 최소금액이 분모다 — 2,000원 할인에 1만원 이상 결제 조건이면 0.2다.
 * 조건이 없으면 결제액이 할인액과 같을 때가 가장 효율적이라 1.0이 된다.
 */
function effectiveRate(benefit: Benefit): number {
  const spec = benefit.discount;
  if (spec.type === 'rate') return spec.rate;
  const amount = Math.min(spec.amount, benefit.perTransactionCap ?? Number.POSITIVE_INFINITY);
  const ticket = Math.max(benefit.minTransaction ?? 0, amount, 1);
  return amount / ticket;
}

interface Plan {
  discount: Won;
  spend: Won;
  txCount: number;
  ticket: Won;
  /** 횟수가 먼저 떨어졌는가. 한도가 먼저 찼으면 호출부가 사유를 덮어쓴다. */
  countBound: boolean;
}

const EMPTY: Plan = { discount: 0, spend: 0, txCount: 0, ticket: 0, countBound: false };

/**
 * 쓸 수 있는 돈 `avail`과 받을 수 있는 할인 상한 `maxDiscount` 아래에서 가장 많이 받는 방법.
 *
 * 닫힌 식으로 푼다 — 건당 상한이 작고 횟수 제한이 없으면 건수가 수만 건까지 늘 수 있어
 * 건별로 돌리면 느려진다. 절사는 건별로 일어나므로 `roundDiscount`를 건당 할인액에 건다.
 */
function planFor(benefit: Benefit, rule: CardRule, avail: Won, maxDiscount: Won): Plan {
  if (avail <= 0 || maxDiscount <= 0) return EMPTY;

  const min = benefit.minTransaction ?? 0;
  const spec = benefit.discount;
  const perTxCap = benefit.perTransactionCap ?? Number.POSITIVE_INFINITY;
  const count = effectiveCount(benefit);

  if (spec.type === 'amount') {
    const amount = roundDiscount(Math.min(spec.amount, perTxCap), rule.rounding);
    if (amount <= 0) return EMPTY;
    // 할인액은 결제액을 넘지 못하므로 전액을 받으려면 적어도 할인액만큼은 써야 한다.
    const ticket = Math.max(min, amount, 1);
    const byMoney = Math.floor(avail / ticket);
    const byMax = Math.floor(maxDiscount / amount);
    const n = Math.min(byMoney, count, byMax);
    if (n <= 0) return EMPTY;
    return {
      discount: n * amount,
      spend: n * ticket,
      txCount: n,
      ticket,
      countBound: n === count && count < byMoney,
    };
  }

  const rate = spec.rate;
  if (rate <= 0) return EMPTY;

  // 건당 한도가 없으면 한 건에 다 담는 것이 가장 적은 건수로 가장 많이 받는 길이다.
  if (perTxCap === Number.POSITIVE_INFINITY) {
    const whole = roundDiscount(avail * rate, rule.rounding);
    const discount = Math.min(whole, maxDiscount);
    if (discount <= 0) return EMPTY;
    // 한도가 먼저 찼다면 그 한도를 채울 만큼만 쓰면 된다.
    const spend = Math.min(avail, Math.max(min, Math.ceil(discount / rate)));
    return { discount, spend, txCount: 1, ticket: spend, countBound: false };
  }

  // 건당 할인을 꽉 채우는 최소 결제액. 건당 최소금액이 더 크면 그쪽을 쓴다.
  const ticket = Math.max(min, Math.ceil(perTxCap / rate), 1);
  const perTx = roundDiscount(Math.min(ticket * rate, perTxCap), rule.rounding);
  if (perTx <= 0) return EMPTY;

  const byMoney = Math.floor(avail / ticket);
  const byMax = Math.floor(maxDiscount / perTx);
  const full = Math.min(byMoney, count, byMax);

  let discount = full * perTx;
  let spend = full * ticket;
  let txCount = full;

  // 꽉 찬 건을 쌓고 남은 돈으로 한 건을 더 얹을 수 있는지 본다.
  const leftoverMoney = avail - spend;
  const leftoverMax = maxDiscount - discount;
  if (full < count && leftoverMoney >= Math.max(min, 1) && leftoverMax > 0) {
    const partial = roundDiscount(
      Math.min(leftoverMoney * rate, perTxCap, leftoverMax),
      rule.rounding,
    );
    if (partial > 0) {
      discount += partial;
      spend += Math.min(leftoverMoney, Math.max(min, Math.ceil(partial / rate)));
      txCount += 1;
    }
  }

  if (txCount <= 0) return EMPTY;
  return { discount, spend, txCount, ticket, countBound: txCount >= count };
}

/**
 * 구간별로, 내 지출 상한 아래에서 실제로 받을 수 있는 최대 할인을 뽑는다.
 *
 * `maxDiscountByTier`는 한도만 보기 때문에 횟수 제한·건당 최소금액·건당 상한 때문에
 * 도달할 수 없는 숫자도 월 최대로 찍는다. "전월실적 80만원이면 월 4만원"이라고 적힌
 * 카드를 실제로는 2만원밖에 못 채우는 일이 여기서 드러난다.
 *
 * 혜택을 할인율 내림차순으로 보는 이유는 두 가지다. 한 거래에는 혜택 하나만 붙으므로
 * 같은 지출 풀을 나눠 쓰는 혜택 중 할인율이 높은 쪽에 돈을 주는 것이 최적이고, 공동·통합
 * 한도도 같은 한도를 더 적은 돈으로 채우는 혜택이 먼저 가져가는 것이 낫다.
 *
 * 돌려주는 값은 상한의 추정이다. 절사는 건별로 반영하지만 거래가 실제로 어떤 순서로
 * 들어오는지는 보지 않으므로, 정확한 값은 `applyDiscounts`로 재현해 확인해야 한다
 * (불변규칙 4).
 */
export function attainableByTier(
  rule: CardRule,
  groups: readonly ScopeGroup[],
  ceilings: SpendCeilings,
): TierAttainable[] {
  assertResolved(rule);
  const nominalRows = maxDiscountByTier(rule);

  // 할인율 내림차순. 동률이면 규칙에 적힌 순서를 지켜 같은 입력이 같은 답을 내게 한다.
  const order = rule.benefits
    .map((benefit, index) => ({ benefit, index }))
    .sort((x, y) => effectiveRate(y.benefit) - effectiveRate(x.benefit) || x.index - y.index);

  return [...rule.tiers]
    .sort((a, b) => a.min - b.min)
    .map((tier) => {
      const nominalRow = nominalRows.find((r) => r.tier.min === tier.min);
      const scopeLeft = new Map<string, Won>();
      const groupLeft = new Map<string, Won>();
      let budgetLeft = ceilings.monthlyBudget;
      let sum = 0;
      const rows = new Map<string, AttainableBenefit>();

      const availFor = (key: string): Won => {
        if (key === ALL_SCOPE) return budgetLeft;
        const seen = scopeLeft.get(key);
        const pool = seen ?? ceilings.byKey[key] ?? 0;
        if (seen === undefined) scopeLeft.set(key, pool);
        return Math.min(pool, budgetLeft);
      };

      for (const { benefit } of order) {
        const cap = benefitCapFor(benefit, tier);
        const key = scopeKeyOf(groups, rule.id, benefit.id) ?? ALL_SCOPE;
        const nominalCap = Number.isFinite(cap) ? cap : null;

        const blocked = (limitedBy: AttainableLimit): void => {
          rows.set(benefit.id, {
            benefitId: benefit.id,
            scopeKey: key,
            nominalCap,
            attainable: 0,
            limitedBy,
            spendNeeded: 0,
            txCount: 0,
            ticket: 0,
          });
        };

        if (cap <= 0) {
          blocked('tierLocked');
          continue;
        }
        /*
         * 승인시간 조건이 걸린 혜택은 처방에 넣지 않는다. 가상 거래에는 시간이 없고,
         * 지금 지원하는 명세서에도 승인시간 컬럼이 없다. 짐작으로 붙이면 밤에 쓰지 않은
         * 결제가 할인으로 잡혀 오류 없이 할인액만 늘어난다.
         */
        if (benefit.match.hours !== undefined) {
          blocked('timeGated');
          continue;
        }

        const avail = availFor(key);
        const min = benefit.minTransaction ?? 0;
        if (min > 0 && avail < min) {
          blocked('minTransaction');
          continue;
        }

        // 좁은 한도부터 겹쳐 적용하고, 더 빡빡한 쪽이 최종 사유가 된다 — `discount.ts`와 같다.
        let ceilingOfDiscount = cap;
        let cappedBy: AttainableLimit = 'cap';
        const groupId = benefit.capGroup;
        if (groupId !== undefined) {
          const seen = groupLeft.get(groupId);
          const left = seen ?? groupCapFor(rule, benefit, tier);
          if (seen === undefined) groupLeft.set(groupId, left);
          if (left < ceilingOfDiscount) {
            ceilingOfDiscount = left;
            cappedBy = 'group';
          }
        }
        const totalLeft = totalCapFor(rule, tier) - sum;
        if (totalLeft < ceilingOfDiscount) {
          ceilingOfDiscount = totalLeft;
          cappedBy = 'total';
        }

        const plan = planFor(benefit, rule, avail, ceilingOfDiscount);
        /*
         * 한도가 이미 0으로 소진됐다면 그 한도가 사유다. 여기까지 왔다는 것은 혜택별 한도가
         * 0이 아니라는 뜻이므로(위에서 tierLocked로 걸렀다), 0인 쪽은 공동·통합 한도다.
         */
        const limitedBy: AttainableLimit =
          ceilingOfDiscount <= 0 || plan.discount >= ceilingOfDiscount
            ? cappedBy
            : plan.countBound
              ? 'count'
              : 'ceiling';

        rows.set(benefit.id, {
          benefitId: benefit.id,
          scopeKey: key,
          nominalCap,
          attainable: plan.discount,
          limitedBy,
          spendNeeded: plan.spend,
          txCount: plan.txCount,
          ticket: plan.ticket,
        });

        if (plan.discount > 0) {
          sum += plan.discount;
          budgetLeft -= plan.spend;
          if (key !== ALL_SCOPE) {
            scopeLeft.set(key, (scopeLeft.get(key) ?? 0) - plan.spend);
          }
          if (groupId !== undefined) {
            groupLeft.set(groupId, (groupLeft.get(groupId) ?? 0) - plan.discount);
          }
        }
      }

      const rebate = rebateFor(rule, tier);
      return {
        tier,
        byBenefit: rule.benefits.map(
          (b) =>
            rows.get(b.id) ?? {
              benefitId: b.id,
              scopeKey: ALL_SCOPE,
              nominalCap: null,
              attainable: 0,
              limitedBy: 'tierLocked' as AttainableLimit,
              spendNeeded: 0,
              txCount: 0,
              ticket: 0,
            },
        ),
        attainable: sum + rebate,
        nominal: nominalRow?.maxDiscount ?? 0,
        rebate,
        unboundedBenefits: nominalRow?.unboundedBenefits ?? [],
      };
    });
}
