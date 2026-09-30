import { assertResolved } from './choice.js';
import { applyDiscounts } from './discount.js';
import { calcSpending } from './spending.js';
import { rebateFor, selectTier } from './tier.js';
import type { CardRule, MonthResult, Transaction, TxResult, Won } from './types.js';

export interface SimulateOptions {
  /**
   * 첫 달의 전월실적.
   *
   * 명세서 3개월치만 올리면 첫 달의 전월 데이터는 알 수 없다. 사용자가 값을 알면
   * 넣고, 모르면 생략한다. 생략하면 실적 0을 가정하고 `tierAssumed`로 표시한다.
   */
  initialPrevSpending?: Won;
}

/** 'YYYY-MM-DD' → 'YYYY-MM' */
function monthKey(date: string): string {
  return date.slice(0, 7);
}

/** 'YYYY-MM' → 다음 달. 연말을 넘어간다. */
function nextMonth(key: string): string {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  return month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, '0')}`;
}

/**
 * 거래를 달별로 묶는다. 중간에 거래가 없는 달이 있으면 빈 달로 채운다.
 *
 * 빈 달을 건너뛰면 "2월에 안 썼으니 3월 실적은 0"이라는 사실이 사라져서, 3월 구간이
 * 실제보다 높게 나온다. 사용자가 보기에도 빈 달이 결과에 드러나는 편이 낫다.
 */
function groupByMonth(transactions: readonly Transaction[]): Map<string, Transaction[]> {
  const groups = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    const key = monthKey(tx.date);
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [tx]);
    else bucket.push(tx);
  }

  const keys = [...groups.keys()].sort();
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (first === undefined || last === undefined) return new Map();

  const filled = new Map<string, Transaction[]>();
  for (let key = first; ; key = nextMonth(key)) {
    filled.set(key, groups.get(key) ?? []);
    if (key === last) break;
  }
  return filled;
}

/**
 * 월별로 이어 달리는 시뮬레이션 (기능 3).
 *
 * 한 달의 흐름: 전월실적 → 구간 결정 → 건별 할인 배정 → 한도 차감 → 이번 달 실적 산정.
 * 이번 달 실적이 다음 달 구간이 되므로, 할인을 많이 받은 달일수록 다음 달 구간이
 * 내려가는 상호작용이 자연스럽게 드러난다.
 */
export function simulate(
  rule: CardRule,
  transactions: readonly Transaction[],
  options: SimulateOptions = {},
): MonthResult[] {
  assertResolved(rule);
  const months = groupByMonth(transactions);
  const results: MonthResult[] = [];

  let prevSpending: Won | null = options.initialPrevSpending ?? null;
  let assumed = prevSpending === null;

  for (const [month, txs] of months) {
    const tier = selectTier(prevSpending ?? 0, rule.tiers);
    const discounts = applyDiscounts(rule, tier, txs);
    // 월정액은 거래가 아니라 구간에 붙는다. 결제가 없는 달에도 구간이 열려 있으면 들어온다.
    const rebate = rebateFor(rule, tier);
    const spending = calcSpending(rule, txs, discounts);

    const txResults: TxResult[] = discounts.discounts.map((d) => {
      const base = {
        txId: d.txId,
        appliedBenefitId: d.appliedBenefitId,
        discount: d.discount,
        reason: d.reason,
        countedSpending: spending.byTxId[d.txId] ?? 0,
      };
      return {
        ...base,
        ...(d.cappedBy === undefined ? {} : { cappedBy: d.cappedBy }),
        ...(d.stacked === undefined ? {} : { stacked: d.stacked }),
      };
    });

    results.push({
      month,
      tier,
      prevSpending,
      tierAssumed: assumed,
      transactions: txResults,
      totalDiscount: discounts.totalDiscount + rebate,
      rebate,
      capUsage: discounts.capUsage,
      groupUsage: discounts.groupUsage,
      totalCapUsed: discounts.totalCapUsed,
      countedSpending: spending.total,
    });

    prevSpending = spending.total;
    assumed = false;
  }

  return results;
}
