/**
 * 화면 맨 위에 세울 요약 숫자.
 *
 * 여기서 하는 일은 `simulate`가 이미 낸 결과를 더하고 나누는 집계뿐이다. 어떤 거래가
 * 어떤 혜택에 걸리는지, 실적에서 얼마가 빠지는지는 전부 `src/core/`가 정한다
 * (CLAUDE.md 규칙 1). 할인액을 나누는 단 한 곳(월평균)도 `roundDiscount`를 거친다
 * (규칙 3) — 이 모듈은 `Math.floor`/`Math.round`를 직접 쓰지 않는다.
 */
import { maxDiscountByTier, roundDiscount } from '../core/index.js';
import type { CardRule, MonthResult, TierMaxDiscount, Transaction, Won } from '../core/index.js';

/** 이 달에 한도 없는 혜택으로 받은 할인. 그 혜택의 한도 소진액이 곧 받은 할인이다. */
function unboundedDiscount(rows: readonly TierMaxDiscount[], month: MonthResult): Won {
  if (month.tier === null) return 0;
  const row = rows.find((r) => r.tier.min === month.tier?.min);
  return (row?.unboundedBenefits ?? []).reduce((sum, id) => sum + (month.capUsage[id] ?? 0), 0);
}

/**
 * 이 달에 받을 수 있었던 상한.
 *
 * 적용 구간의 월 최대에, 한도 없는 혜택은 실제로 받은 만큼을 더한다. 끝이 없는 몫을 상한에
 * 넣을 방법이 없으니 받은 만큼을 상한으로 본다 — 그 몫에는 "못 쓴 한도"가 생기지 않는다.
 */
export function monthCeiling(rows: readonly TierMaxDiscount[], month: MonthResult): Won {
  if (month.tier === null) return 0;
  const row = rows.find((r) => r.tier.min === month.tier?.min);
  return (row?.maxDiscount ?? 0) + unboundedDiscount(rows, month);
}

export interface BenefitSummary {
  /** 거래가 있는 달 수. 중간에 빈 달이 있어도 `simulate`가 채워 세므로 기간과 같다. */
  months: number;
  firstMonth: string | null;
  lastMonth: string | null;
  txCount: number;
  totalSpend: Won;
  totalDiscount: Won;
  monthlyAverage: Won;
  /** 월평균이 12달 이어진다고 봤을 때의 연 할인액. 어디까지나 추정이다. */
  annualizedDiscount: Won;
  /** 연환산 할인에서 연회비를 뺀 값. 음수면 연회비가 더 크다는 뜻이다. */
  annualNet: Won;
  /** 달마다 적용된 구간의 월 최대 할인을 더한 상한. */
  capCeiling: Won;
  /** 상한에서 실제 할인을 뺀 값. 못 쓴 한도다. */
  unusedCap: Won;
  /**
   * 달마다 최상위 구간이 열렸다고 볼 때의 상한. 카드사 안내문의 "월 최대"를 기간만큼
   * 이은 값이다. 여기서 `tierShortfall`과 `unusedCap`을 빼면 정확히 `totalDiscount`가 된다.
   * 한도 없는 혜택이 있는 카드는 그 몫을 실제로 받은 만큼 더한다(`monthCeiling`).
   */
  advertisedCeiling: Won;
  /** 전월실적이 모자라 최상위보다 낮은 구간이 열린 달에 잃은 한도의 합. */
  tierShortfall: Won;
  /** 결제액 대비 할인 비율. 금액이 아니라 비율이라 정수로 만들지 않는다. */
  discountRate: number;
}

export function summarize(
  card: CardRule,
  months: readonly MonthResult[],
  transactions: readonly Transaction[],
): BenefitSummary {
  const totalDiscount = months.reduce((sum, m) => sum + m.totalDiscount, 0);
  const totalSpend = transactions.reduce((sum, t) => sum + t.amount, 0);

  const tierMax = maxDiscountByTier(card);
  const capCeiling = months.reduce((sum, m) => sum + monthCeiling(tierMax, m), 0);
  const topMonthly = tierMax.reduce((top, r) => Math.max(top, r.maxDiscount), 0);
  const unboundedTotal = months.reduce((sum, m) => sum + unboundedDiscount(tierMax, m), 0);
  const advertisedCeiling = topMonthly * months.length + unboundedTotal;

  const monthlyAverage =
    months.length === 0 ? 0 : roundDiscount(totalDiscount / months.length, 'floor1');
  const annualizedDiscount = monthlyAverage * 12;

  return {
    months: months.length,
    firstMonth: months[0]?.month ?? null,
    lastMonth: months[months.length - 1]?.month ?? null,
    txCount: transactions.length,
    totalSpend,
    totalDiscount,
    monthlyAverage,
    annualizedDiscount,
    annualNet: annualizedDiscount - card.annualFee,
    capCeiling,
    unusedCap: Math.max(0, capCeiling - totalDiscount),
    advertisedCeiling,
    tierShortfall: advertisedCeiling - capCeiling,
    discountRate: totalSpend === 0 ? 0 : totalDiscount / totalSpend,
  };
}
