import { matchBenefits } from './match.js';
import { roundDiscount } from './rounding.js';
import { benefitCapFor, totalCapFor } from './tier.js';
import type { Benefit, CardRule, DiscountReason, Tier, Transaction, Won } from './types.js';

/** 한 건의 할인 처리 결과. 실적 기여액은 `spending.ts`가 따로 채운다. */
export interface TxDiscount {
  txId: string;
  appliedBenefitId: string | null;
  discount: Won;
  reason: DiscountReason;
  cappedBy?: 'benefit' | 'total' | 'perTransaction';
}

export interface MonthDiscountResult {
  /** 실제 처리 순서(날짜순)대로 담긴다. */
  discounts: TxDiscount[];
  byTxId: Record<string, TxDiscount>;
  /** benefitId → 소진한 월 한도. */
  capUsage: Record<string, Won>;
  totalCapUsed: Won;
  totalDiscount: Won;
}

interface Ledger {
  capUsage: Record<string, Won>;
  totalCapUsed: Won;
  /** `${benefitId}` 또는 `${benefitId}|${date}` → 할인 적용 건수. */
  counts: Record<string, number>;
}

function countKey(benefit: Benefit, date: string): string {
  return benefit.countLimit?.period === 'day' ? `${benefit.id}|${date}` : benefit.id;
}

/**
 * 한도를 고려하기 전, 이 건에서 나올 수 있는 할인액.
 *
 * 할인액이 결제액을 넘지 못하게 먼저 막는다. 정액 할인 1,000원짜리 혜택으로
 * 500원을 결제하면 500원만 할인되지, 500원을 돌려받지는 않는다.
 */
function potentialDiscount(
  tx: Transaction,
  benefit: Benefit,
  rule: CardRule,
): { amount: Won; cappedBy?: 'perTransaction' } {
  const spec = benefit.discount;
  let raw = spec.type === 'rate' ? tx.amount * spec.rate : spec.amount;
  raw = Math.min(raw, tx.amount);

  let cappedBy: 'perTransaction' | undefined;
  const perTx = benefit.perTransactionCap;
  if (perTx !== undefined && raw > perTx) {
    raw = perTx;
    cappedBy = 'perTransaction';
  }

  const amount = roundDiscount(raw, rule.rounding);
  return cappedBy === undefined ? { amount } : { amount, cappedBy };
}

function blocked(txId: string, reason: DiscountReason): TxDiscount {
  return { txId, appliedBenefitId: null, discount: 0, reason };
}

/**
 * 한 건에 한 혜택을 적용해 본다. 어디서 막혔는지가 결과에 남는다.
 *
 * 검사 순서는 "약관을 읽는 순서"와 같다: 구간 → 건당 최소금액 → 횟수 → 금액 산출 →
 * 혜택 한도 → 통합 한도. 앞 단계에서 막히면 뒤 단계의 한도는 건드리지 않는다.
 */
function evaluate(
  tx: Transaction,
  benefit: Benefit,
  rule: CardRule,
  tier: Tier | null,
  ledger: Ledger,
): TxDiscount {
  if (benefitCapFor(benefit, tier) <= 0) return blocked(tx.id, 'tierLocked');

  const min = benefit.minTransaction;
  // 약관의 "N원 이상"은 경계를 포함한다.
  if (min !== undefined && tx.amount < min) return blocked(tx.id, 'belowMin');

  const limit = benefit.countLimit;
  if (limit !== undefined && (ledger.counts[countKey(benefit, tx.date)] ?? 0) >= limit.max) {
    return blocked(tx.id, 'countLimit');
  }

  const potential = potentialDiscount(tx, benefit, rule);
  if (potential.amount <= 0) return blocked(tx.id, 'roundedToZero');

  const remainingBenefit = benefitCapFor(benefit, tier) - (ledger.capUsage[benefit.id] ?? 0);
  if (remainingBenefit <= 0) return blocked(tx.id, 'benefitCapReached');

  const remainingTotal = totalCapFor(rule, tier) - ledger.totalCapUsed;
  if (remainingTotal <= 0) return blocked(tx.id, 'totalCapReached');

  let discount = potential.amount;
  // 'perTransaction'으로 좁혀지지 않게 명시한다. 아래에서 한도 종류가 바뀔 수 있다.
  let cappedBy: TxDiscount['cappedBy'] = potential.cappedBy;
  if (discount > remainingBenefit) {
    discount = remainingBenefit;
    cappedBy = 'benefit';
  }
  // 통합 한도가 더 빡빡하면 그쪽이 최종 사유가 된다.
  if (discount > remainingTotal) {
    discount = remainingTotal;
    cappedBy = 'total';
  }

  const result: TxDiscount = { txId: tx.id, appliedBenefitId: benefit.id, discount, reason: 'ok' };
  return cappedBy === undefined ? result : { ...result, cappedBy };
}

/**
 * 한 달치 거래에 할인을 배정한다.
 *
 * 거래를 날짜순(FIFO)으로 처리한다. 실제 카드사가 승인 순서대로 한도를 소진하므로,
 * 이것이 현실과 맞는 기본값이다. "어떻게 쓰면 최대로 받나"라는 최적화는 성격이 다른
 * 문제이므로 이 경로에 섞지 않는다.
 */
export function applyDiscounts(
  rule: CardRule,
  tier: Tier | null,
  transactions: readonly Transaction[],
): MonthDiscountResult {
  const ordered = [...transactions].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );

  const ledger: Ledger = { capUsage: {}, totalCapUsed: 0, counts: {} };
  const discounts: TxDiscount[] = [];
  const byTxId: Record<string, TxDiscount> = {};

  for (const tx of ordered) {
    const candidates = matchBenefits(tx, rule.benefits);

    let chosen: TxDiscount | null = null;
    if (candidates.length === 0) {
      chosen = blocked(tx.id, 'noMatch');
    } else {
      // 우선순위가 같으면 실제로 더 많이 깎아주는 혜택을 먼저 본다.
      const ranked = candidates
        .map((b, index) => ({ b, index, potential: potentialDiscount(tx, b, rule).amount }))
        .sort((x, y) => y.potential - x.potential || x.index - y.index)
        .sort((x, y) => (y.b.priority ?? 0) - (x.b.priority ?? 0));

      let firstBlocked: TxDiscount | null = null;
      for (const { b } of ranked) {
        const outcome = evaluate(tx, b, rule, tier, ledger);
        if (outcome.discount > 0) {
          chosen = outcome;
          break;
        }
        firstBlocked ??= outcome;
      }
      // 전부 막혔다면 우선순위가 가장 높은 혜택의 사유가 사용자에게 가장 쓸모 있다.
      chosen ??= firstBlocked ?? blocked(tx.id, 'noMatch');
    }

    if (chosen.discount > 0 && chosen.appliedBenefitId !== null) {
      const benefit = rule.benefits.find((b) => b.id === chosen.appliedBenefitId);
      ledger.capUsage[chosen.appliedBenefitId] =
        (ledger.capUsage[chosen.appliedBenefitId] ?? 0) + chosen.discount;
      ledger.totalCapUsed += chosen.discount;
      if (benefit !== undefined) {
        const key = countKey(benefit, tx.date);
        ledger.counts[key] = (ledger.counts[key] ?? 0) + 1;
      }
    }

    discounts.push(chosen);
    byTxId[tx.id] = chosen;
  }

  return {
    discounts,
    byTxId,
    capUsage: ledger.capUsage,
    totalCapUsed: ledger.totalCapUsed,
    totalDiscount: ledger.totalCapUsed,
  };
}
