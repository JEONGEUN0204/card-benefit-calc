import { attainableAtTier, effectiveRateOf } from './attainable.js';
import { ALL_SCOPE, REST_POOL, scopeGroups, scopeKeyOf, spendPools } from './scope.js';
import { benefitCapFor } from './tier.js';
import type { ScopeGroup } from './scope.js';
import type { Benefit, CardRule, Tier, Won } from './types.js';

/** 중요도를 재는 기준 예산. 사용자가 월 예산을 적으면 그 값을 넘긴다. */
const DEFAULT_BUDGET: Won = 1_000_000;

/** 이 항목의 돈을 쓰는 혜택. 화면이 "왜 묻는가"를 적을 때 쓴다. */
export interface QuestionUser {
  cardId: string;
  benefitId: string;
  /** 규칙 JSON에 적힌 혜택 이름. 약관에서 옮겨 온 말이라 화면이 그대로 쓴다. */
  label: string;
  rate: number;
  /** 최상위 구간의 월 한도. `null`이면 한도 없음. */
  nominalCap: Won | null;
}

/**
 * 사용자에게 물어야 할 지출 항목 하나.
 *
 * core는 **구조**만 낸다. 한국어 이름("온라인몰"이라 부를지 "쇼핑"이라 부를지)은 화면이
 * 붙인다 — 상식적인 이름 짓기는 계산이 아니다.
 */
export interface SpendQuestion {
  /** 지출 풀 키. 답을 `SpendCeilings.byKey`에 이 키로 넣는다. */
  pool: string;
  kind: 'category' | 'merchant' | 'overseas' | 'rest';
  categories: string[];
  merchants: string[];
  /**
   * 이 항목에서 받을 수 있는 최대 할인. 질문 순서를 정하는 값이다.
   *
   * 월정액은 넣지 않는다 — 어느 항목에 써도 받는 돈이라 이 질문의 무게와 무관하다.
   */
  impact: Won;
  /**
   * 한도 없는 혜택이 이 항목을 쓰는가.
   *
   * 한도가 없으면 `impact`가 기준 예산에 비례해 커지므로 다른 항목과 견줄 수 없다.
   * 팟 카드의 놀이공원 50%가 그렇다 — 월 한도가 안내에 없어 `null`인데, 액수로만 재면
   * 50만원이 되어 첫 질문이 된다. 대부분 0원을 쓰는 항목이다. 화면은 이런 항목을
   * 뒤로 보낸다.
   */
  unbounded: boolean;
  usedBy: QuestionUser[];
  /** 이 항목의 혜택 중 가장 낮은 건당 최소금액. 화면이 "1만원 이상 결제만"을 적는다. */
  minTransaction?: Won;
  /**
   * 이 항목의 혜택이 모두 승인시간 조건을 달고 있는가.
   *
   * 그렇다면 처방에 들어가지 못한다 — 가상 거래에는 시간이 없고, 명세서에도 승인시간
   * 컬럼이 없다. 짐작으로 붙이면 밤에 쓰지 않은 결제가 할인으로 잡힌다. 물어도 쓸 데가
   * 없으므로 화면이 그 사실을 적는다.
   */
  timeGatedOnly: boolean;
}

export interface SpendQuestionOptions {
  /** 중요도를 재는 기준 예산. */
  budget?: Won;
}

/** 최상위 구간. 혜택이 가장 넓게 열린 상태로 중요도를 잰다. */
function topTier(card: CardRule): Tier | null {
  return [...card.tiers].sort((a, b) => b.min - a.min)[0] ?? null;
}

function kindOf(pool: string, group: ScopeGroup | undefined): SpendQuestion['kind'] {
  if (pool === REST_POOL) return 'rest';
  if (group === undefined) return 'category';
  if (group.merchants.length > 0) return 'merchant';
  if (group.categories.length > 0) return 'category';
  return group.overseas ? 'overseas' : 'category';
}

/**
 * 고른 카드의 규칙에서 "무엇을 물어야 하는가"를 뽑는다.
 *
 * 질문 하나가 지출 풀 하나다. 풀은 서로 겹치지 않으므로 같은 돈을 두 번 묻는 일이 없고,
 * 여러 카드가 같은 항목을 쓰면 질문도 하나로 합쳐진다.
 *
 * 돌려주는 순서는 한도가 있는 항목을 액수 내림차순으로, 그 뒤에 한도 없는 항목을 둔다.
 * 화면은 앞쪽 몇 개만 펼치고 나머지를 접어도 되며, 답하지 않은 항목은 0으로 본다 —
 * 보수적으로 안전하다(처방이 실제보다 작게 나온다).
 */
export function spendQuestions(
  cards: readonly CardRule[],
  options: SpendQuestionOptions = {},
): SpendQuestion[] {
  const budget = Math.max(0, options.budget ?? DEFAULT_BUDGET);
  const groups = scopeGroups(cards);
  const pools = spendPools(groups);

  const questions = pools.map((pool): SpendQuestion => {
    const group = groups.find((g) => g.key === pool);
    // 나머지 결제의 돈을 쓰는 것은 조건 없는 전 가맹점 혜택이다.
    const targetKey = pool === REST_POOL ? ALL_SCOPE : pool;

    const usedBy: QuestionUser[] = [];
    let minTransaction: Won | undefined;
    let timeGated = 0;
    let unbounded = false;

    for (const card of cards) {
      const tier = topTier(card);
      for (const b of card.benefits) {
        if (scopeKeyOf(groups, card.id, b.id) !== targetKey) continue;
        const cap = benefitCapFor(b, tier);
        const finite = Number.isFinite(cap);
        if (!finite) unbounded = true;
        usedBy.push({
          cardId: card.id,
          benefitId: b.id,
          label: b.label,
          rate: effectiveRateOf(b),
          nominalCap: finite ? cap : null,
        });
        if (b.minTransaction !== undefined) {
          minTransaction =
            minTransaction === undefined ? b.minTransaction : Math.min(minTransaction, b.minTransaction);
        }
        if (b.match.hours !== undefined) timeGated += 1;
      }
    }

    /*
     * 중요도 — 이 항목만 예산만큼 쓸 수 있다고 보고 각 카드에서 받을 수 있는 최대를 재서
     * 가장 큰 값을 쓴다. `attainableByTier`를 그대로 쓰므로 횟수·건당 조건과 공동·통합
     * 한도가 모두 반영된다. 이 항목에 걸린 혜택의 몫만 더해 월정액과 다른 항목의 몫을
     * 뺀다 — 그래야 "이 질문의 무게"가 된다.
     */
    let impact = 0;
    for (const card of cards) {
      const tier = topTier(card);
      if (tier === null) continue;
      const byKey = pool === REST_POOL ? {} : { [pool]: budget };
      const row = attainableAtTier(card, groups, tier, { byKey, monthlyBudget: budget });
      const mine = row.byBenefit
        .filter((b) => b.scopeKey === targetKey)
        .reduce((sum, b) => sum + b.attainable, 0);
      impact = Math.max(impact, mine);
    }

    const timeGatedOnly = usedBy.length > 0 && timeGated === usedBy.length;
    return {
      pool,
      kind: kindOf(pool, group),
      categories: group?.categories ?? [],
      merchants: group?.merchants ?? [],
      // 처방에 들어가지 못하는 항목은 물어도 쓸 데가 없으니 무게를 0으로 둔다.
      impact: timeGatedOnly ? 0 : impact,
      unbounded,
      usedBy,
      ...(minTransaction === undefined ? {} : { minTransaction }),
      timeGatedOnly,
    };
  });

  /*
   * 한도 있는 항목을 먼저, 그 안에서 액수가 큰 것을 먼저. 한도 없는 항목은 기준 예산에
   * 비례해 커져 다른 항목과 견줄 수 없으므로 뒤로 보낸다. 동률은 풀 키 순으로 고정해
   * 같은 입력이 항상 같은 순서를 내게 한다.
   */
  return questions.sort((a, b) => {
    if (a.unbounded !== b.unbounded) return a.unbounded ? 1 : -1;
    return b.impact - a.impact || (a.pool < b.pool ? -1 : a.pool > b.pool ? 1 : 0);
  });
}
