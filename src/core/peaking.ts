import { steadyStateFor } from './steady.js';
import { synthesizeMonth } from './synthesize.js';
import type { CardRule, SpendingPattern, Tier, Won } from './types.js';

/**
 * 한 달에 얼마를 쓰면 얼마를 받는지, 그리고 **다음 1원이 얼마를 받는지**.
 *
 * 카드를 갈아타는 지점을 정하는 것은 평균 피킹률이 아니라 한계 피킹률이다. 카드의정석
 * EVERY 1은 50만원에서 평균 2%지만 그 다음 1원은 1%만 받는다 — 그래서 50만원만 채우고
 * 나머지는 한계율이 더 높은 카드로 옮기는 것이 이득이다. 평균만 보면 이 사실이 보이지 않는다.
 */
export interface PeakingPoint {
  spend: Won;
  /** 정상상태 월 혜택(월정액 포함). 진동하면 사이클 평균이다. */
  discount: Won;
  /** 사이클이 한 구간에 머물 때 그 구간. 진동하면 null이다. */
  tier: Tier | null;
  oscillates: boolean;
  /** 평균 피킹률 = 혜택 / 지출. 비율이라 정수로 만들지 않는다. */
  rate: number;
  /**
   * 한계 피킹률 = 앞 점에서 이 점까지 늘어난 혜택 / 늘어난 지출.
   * 첫 점은 원점에서 본 값이라 평균과 같다.
   */
  marginalRate: number;
  /** 연회비를 월로 나눠 뺀 순 피킹률. */
  netRate: number;
}

/**
 * 지출을 늘려 가며 피킹률 곡선을 그린다.
 *
 * 매달 같은 금액을 같은 비중으로 쓴다고 보고 각 점을 정상상태로 평가한다. 전월실적 →
 * 구간 → 할인 → 실적의 고리가 닫히는 자리를 `steadyStateFor`가 찾으므로, "전월실적이
 * 얼마일 때"를 따로 가정하지 않아도 된다.
 *
 * `pattern`이 필요한 이유는 같은 금액이라도 어디에 쓰느냐에 따라 혜택이 다르기 때문이다.
 * 전 가맹점 혜택만 있는 카드는 비중이 결과를 바꾸지 않지만, 가맹점·업종으로 맞추는 카드는
 * 비중이 곧 답이다. 내 명세서가 있으면 `patternFromTransactions`로 만든 패턴을 넘긴다.
 */
export function peakingCurve(
  rule: CardRule,
  pattern: SpendingPattern,
  spends: readonly Won[],
): PeakingPoint[] {
  // 한계율은 앞 점과의 차이라서 오름차순이어야 하고, 같은 값이 두 번 오면 0으로 나눈다.
  const ordered = [...new Set(spends)].sort((a, b) => a - b);
  const monthlyFee = rule.annualFee / 12;

  const out: PeakingPoint[] = [];
  for (const spend of ordered) {
    const { txs } = synthesizeMonth(spend, pattern);
    const steady = steadyStateFor(rule, txs);
    const discount = steady.monthlyDiscount;
    const previous = out[out.length - 1];

    const rate = spend > 0 ? discount / spend : 0;
    const marginalRate =
      previous === undefined
        ? rate
        : spend > previous.spend
          ? (discount - previous.discount) / (spend - previous.spend)
          : 0;

    out.push({
      spend,
      discount,
      tier: steady.oscillates ? null : (steady.cycle[0] ?? null),
      oscillates: steady.oscillates,
      rate,
      marginalRate,
      netRate: spend > 0 ? (discount - monthlyFee) / spend : 0,
    });
  }
  return out;
}
