import { applyDiscounts } from './discount.js';
import { calcSpending } from './spending.js';
import type { CardRule, RequiredSpendResult, SpendingPattern, Tier, Transaction, Won } from './types.js';

const DEFAULT_TICKET: Won = 20_000;
/** 가상 거래를 흩뿌릴 날짜 수. 일 단위 횟수 제한이 현실적으로 걸리게 한다. */
const SPREAD_DAYS = 28;
const BASE_MONTH = '2026-01';
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

/** 비중을 합이 1이 되도록 정규화한다. 0 이하 비중은 버린다. */
function normalizeWeights(weights: Record<string, number>): Array<[string, number]> {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const sum = entries.reduce((acc, [, w]) => acc + w, 0);
  return sum <= 0 ? [] : entries.map(([category, w]) => [category, w / sum]);
}

interface Synthetic {
  txs: Transaction[];
  breakdown: Record<string, Won>;
}

/**
 * 총 결제액을 카테고리 비중과 건단가에 따라 가상 거래로 쪼갠다.
 *
 * 건단가가 필요한 이유는 건당 최소금액·건당 한도·횟수 제한이 전부 "건" 단위이기
 * 때문이다. 총액만으로는 이 조건들을 흉내 낼 수 없다.
 * 마지막 카테고리가 반올림 오차를 흡수해 합계가 정확히 총액과 맞는다.
 */
function buildTransactions(total: Won, pattern: SpendingPattern): Synthetic {
  const parts = normalizeWeights(pattern.weights);
  const breakdown: Record<string, Won> = {};
  const txs: Transaction[] = [];
  let assigned = 0;
  let seq = 0;

  parts.forEach(([category, weight], index) => {
    // 할인액이 아니라 예산 배분이라 절사가 아닌 반올림을 쓴다. roundDiscount는 할인액 전용이다.
    const isLast = index === parts.length - 1;
    const categoryTotal = isLast ? total - assigned : Math.round(total * weight);
    assigned += categoryTotal;
    breakdown[category] = categoryTotal;
    if (categoryTotal <= 0) return;

    const ticket = pattern.ticketSize?.[category] ?? pattern.defaultTicket ?? DEFAULT_TICKET;
    const count = Math.max(1, Math.ceil(categoryTotal / ticket));
    let remaining = categoryTotal;

    for (let i = 0; i < count; i += 1) {
      const amount = i === count - 1 ? remaining : Math.min(ticket, remaining);
      remaining -= amount;
      const day = String((seq % SPREAD_DAYS) + 1).padStart(2, '0');
      txs.push({
        id: `${category}-${String(i).padStart(6, '0')}`,
        date: `${BASE_MONTH}-${day}`,
        amount,
        merchant: category,
        category,
      });
      seq += 1;
    }
  });

  return { txs, breakdown };
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
  const { txs, breakdown } = buildTransactions(total, pattern);
  const discounts = applyDiscounts(rule, tier, txs);
  const spending = calcSpending(rule, txs, discounts);
  return { spending: spending.total, discount: discounts.totalDiscount, breakdown };
}

/**
 * 목표 구간을 채우려면 실제로 얼마를 써야 하는지 역산한다 (기능 2).
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
