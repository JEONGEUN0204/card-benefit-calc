import type { MonthDiscountResult, TxDiscount } from './discount.js';
import type { CardRule, Transaction, Won } from './types.js';

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

/**
 * 카드의 기본 실적 제외 항목(상품권·세금·공과금·무이자할부 등)에 해당하는지 본다.
 *
 * 이 제외는 할인 여부와 무관하게 먼저 적용된다. 세금을 카드로 냈다면 할인을 받든 안 받든
 * 실적에 들어가지 않는다.
 */
export function isExcludedFromSpending(tx: Transaction, rule: CardRule): boolean {
  return rule.spendingExclusions.some((ex) => {
    switch (ex.kind) {
      case 'category':
        return ex.values.includes(tx.category);
      case 'merchant': {
        const m = normalize(tx.merchant);
        return ex.values.some((v) => m.includes(normalize(v)));
      }
      case 'paymentType':
        // 결제유형을 적지 않은 명세서 줄은 일시불로 본다.
        return ex.values.includes(tx.paymentType ?? 'lump');
    }
  });
}

/**
 * 거래 한 건이 실적에 기여하는 금액.
 *
 * 이 서비스의 존재 이유가 여기 있다. 많은 카드가 "할인받은 결제 건 전액"을 실적에서
 * 빼기 때문에, 혜택을 챙길수록 다음 달 구간이 내려간다. 그 상호작용을 계산하지 않으면
 * 예상 할인액이 실제와 크게 어긋난다.
 */
export function countedSpendingOf(
  tx: Transaction,
  discount: TxDiscount | undefined,
  rule: CardRule,
): Won {
  if (isExcludedFromSpending(tx, rule)) return 0;

  // 할인을 실제로 받지 못했다면 제외 방식과 무관하게 전액이 실적이다.
  if (discount === undefined || discount.discount <= 0 || discount.appliedBenefitId === null) {
    return tx.amount;
  }

  const benefit = rule.benefits.find((b) => b.id === discount.appliedBenefitId);
  if (benefit === undefined) return tx.amount;

  switch (benefit.excludeFromSpending) {
    case 'full':
      return 0;
    case 'discountOnly':
      return tx.amount - discount.discount;
    case 'none':
      return tx.amount;
  }
}

export interface SpendingResult {
  total: Won;
  byTxId: Record<string, Won>;
}

/** 한 달치 거래의 실적을 산정한다. 이 결과가 다음 달 구간을 정한다. */
export function calcSpending(
  rule: CardRule,
  transactions: readonly Transaction[],
  discounts: MonthDiscountResult,
): SpendingResult {
  const byTxId: Record<string, Won> = {};
  let total = 0;

  for (const tx of transactions) {
    const counted = countedSpendingOf(tx, discounts.byTxId[tx.id], rule);
    byTxId[tx.id] = counted;
    total += counted;
  }

  return { total, byTxId };
}
