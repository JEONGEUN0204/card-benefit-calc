import { assertResolved } from './choice.js';
import { applyDiscounts } from './discount.js';
import { calcSpending } from './spending.js';
import { synthesizeMonth } from './synthesize.js';
import { rebateFor } from './tier.js';
import type { CardRule, RequiredSpendResult, SpendingPattern, Tier, Won } from './types.js';

const DEFAULT_MAX_SPEND: Won = 100_000_000;

export interface RequiredSpendOptions {
  /**
   * 지금 적용 중인 구간. 생략하면 목표 구간을 그대로 쓴다(= 유지하는 상황).
   *
   * 이번 달 받는 할인은 이번 달 구간이 정하고, 그 할인 때문에 빠지는 실적이
   * 다음 달 구간을 정한다. 그래서 "올라가려면"과 "유지하려면"의 답이 다르다.
   */
  currentTier?: Tier | null;
  /** 이분탐색 상한. */
  maxSpend?: Won;
}

interface Evaluated {
  spending: Won;
  discount: Won;
  breakdown: Record<string, Won>;
}

function evaluate(
  rule: CardRule,
  tier: Tier | null,
  pattern: SpendingPattern,
  total: Won,
): Evaluated {
  const { txs, breakdown } = synthesizeMonth(total, pattern);
  const discounts = applyDiscounts(rule, tier, txs);
  const spending = calcSpending(rule, txs, discounts);
  // 월정액은 결제액과 무관하게 구간이 정한다. 실적에 영향이 없어 탐색에는 끼지 않는다.
  const discount = discounts.totalDiscount + rebateFor(rule, tier);
  return { spending: spending.total, discount, breakdown };
}

/**
 * 목표 구간을 채우려면 실제로 얼마를 써야 하는지 역산한다.
 *
 * 단순히 "목표 실적만큼 쓰면 된다"가 답이 아니다. 할인받은 건이 실적에서 빠지고
 * 상품권·세금 같은 항목도 빠지므로, 실제 필요액은 목표보다 크다. 게다가 얼마나
 * 빠지는지는 얼마를 쓰느냐에 달려 있어(한도가 차면 더는 안 빠진다) 닫힌 식이 없다.
 *
 * 그래서 이분탐색으로 푼다. 총 결제액 X에 대한 실적 f(X)는 비감소 함수다 —
 * X가 늘면 할인은 한도까지만 늘고 그 뒤로는 늘어난 결제액이 고스란히 실적이 된다.
 */
export function requiredSpendFor(
  rule: CardRule,
  targetTier: Tier,
  pattern: SpendingPattern,
  options: RequiredSpendOptions = {},
): RequiredSpendResult {
  assertResolved(rule);
  const tier = options.currentTier === undefined ? targetTier : options.currentTier;
  const target = targetTier.min;
  const upper = options.maxSpend ?? Math.max(target * 10, DEFAULT_MAX_SPEND);

  const run = (total: Won): Evaluated => evaluate(rule, tier, pattern, total);

  if (run(upper).spending < target) {
    // 상한까지 써도 못 채운다. 결제액 전부가 실적에서 빠지는 조합이면 실제로 그렇다.
    const at = run(upper);
    return {
      targetTier,
      requiredTotalSpend: null,
      resultingSpending: at.spending,
      excludedAmount: upper - at.spending,
      expectedDiscount: at.discount,
      breakdown: at.breakdown,
    };
  }

  let lo = 0;
  let hi = upper;
  let answer = upper;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (run(mid).spending >= target) {
      answer = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  const final = run(answer);
  return {
    targetTier,
    requiredTotalSpend: answer,
    resultingSpending: final.spending,
    excludedAmount: answer - final.spending,
    expectedDiscount: final.discount,
    breakdown: final.breakdown,
  };
}
