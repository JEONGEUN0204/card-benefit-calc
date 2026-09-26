import type { SpendingPattern, Transaction, Won } from './types.js';

/**
 * 사용내역에서 소비 패턴을 뽑는다 — 기능 2(필요 사용액)를 내 명세서로 돌리기 위한 입력.
 *
 * 비중은 카테고리별 결제액을 그대로 쓴다. `requiredSpendFor`가 알아서 정규화하므로
 * 여기서 나눗셈을 해 소수를 만들 이유가 없다. 실적에서 빠지는 카테고리(세금·상품권)도
 * 남긴다 — 그걸 빼면 "그만큼 더 써야 한다"는 사실이 답에서 사라진다.
 */
export function patternFromTransactions(transactions: readonly Transaction[]): SpendingPattern {
  const sums: Record<string, Won> = {};
  const counts: Record<string, number> = {};
  let total = 0;

  for (const tx of transactions) {
    sums[tx.category] = (sums[tx.category] ?? 0) + tx.amount;
    counts[tx.category] = (counts[tx.category] ?? 0) + 1;
    total += tx.amount;
  }

  if (transactions.length === 0) return { weights: {} };

  // 할인액이 아니라 가상 거래의 건단가 추정이라 roundDiscount 대신 반올림한다.
  const average = (sum: Won, count: number): Won => Math.round(sum / count);

  const ticketSize: Record<string, Won> = {};
  for (const [category, sum] of Object.entries(sums)) {
    ticketSize[category] = average(sum, counts[category] ?? 1);
  }

  return {
    weights: sums,
    ticketSize,
    defaultTicket: average(total, transactions.length),
  };
}
