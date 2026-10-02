import { assertResolved } from './choice.js';
import { applyDiscounts } from './discount.js';
import { roundDiscount } from './rounding.js';
import { calcSpending } from './spending.js';
import { rebateFor, selectTier } from './tier.js';
import type { CardRule, Tier, Transaction, Won } from './types.js';

/** 구간 하나를 전월실적으로 가정해 한 달을 돌린 결과. */
export interface SteadyTierRow {
  tier: Tier | null;
  /** 거래 할인 + 월정액. */
  discount: Won;
  spending: Won;
  /** 이 달 실적이 정하는 다음 달 구간. */
  next: Tier | null;
}

/**
 * 매달 같은 배분을 반복했을 때 전월실적이 스스로를 재생산하는 상태.
 *
 * 고정점 반복으로 풀지 않는다. 할인을 많이 받는 구간일수록 `excludeFromSpending: 'full'`
 * 때문에 실적이 줄어들어 구간 자기사상이 **비증가**가 되고, 비증가 사상은 고정점이 아예
 * 없을 수 있다. 그러면 "몇 번 반복하고 끊을까"를 정하는 순간 둘 중 아무 값이나 찍게 되는데,
 * 20,000원과 32,000원 중 어느 쪽을 찍어도 둘 다 그럴듯하게 틀린 숫자다.
 *
 * 대신 구간마다 한 번씩만 돌려 자기사상을 만들고 사이클을 찾는다. 정의역이 유한하므로
 * 반드시 사이클로 끝나고, 평가 횟수는 구간 수 + 1로 고정된다.
 */
export interface SteadyState {
  /** 사이클을 이루는 구간들. 길이 1이면 수렴, 2 이상이면 달마다 왕복한다. */
  cycle: (Tier | null)[];
  /** 사이클 평균 월 할인(월정액 포함). */
  monthlyDiscount: Won;
  /** 사이클 평균 월 실적. */
  monthlySpending: Won;
  /** 구간별 1회 평가 결과. "이 구간은 자기를 못 지킨다"를 화면에 적을 때 쓴다. */
  byTier: SteadyTierRow[];
  oscillates: boolean;
  /** 사이클에 들기 전에 지나는 구간들. 첫 달·두 달째가 다르다는 것을 보일 때 쓴다. */
  approach: (Tier | null)[];
}

export interface SteadyOptions {
  /**
   * 출발 구간. 생략하면 최상위 구간에서 출발한다 — "매달 이렇게 써 왔다면"을 가정한
   * 가장 유리한 출발점이고, 그 구간을 지킬 수 없으면 사이클이 그 사실을 드러낸다.
   * 새로 발급해 실적이 없는 상황은 `null`을 넘긴다.
   */
  startTier?: Tier | null;
}

/** 구간을 맵 키로. `null`(실적 미달)도 정의역의 한 원소다. */
function keyOf(tier: Tier | null): string {
  return tier === null ? 'null' : String(tier.min);
}

export function steadyStateFor(
  rule: CardRule,
  transactions: readonly Transaction[],
  options: SteadyOptions = {},
): SteadyState {
  assertResolved(rule);

  const ascending = [...rule.tiers].sort((a, b) => a.min - b.min);
  const domain: (Tier | null)[] = [null, ...ascending];

  const byTier: SteadyTierRow[] = domain.map((tier) => {
    const discounts = applyDiscounts(rule, tier, transactions);
    const spending = calcSpending(rule, transactions, discounts);
    return {
      tier,
      // 월정액은 거래와 무관하게 구간이 정하고 실적을 건드리지 않는다.
      discount: discounts.totalDiscount + rebateFor(rule, tier),
      spending: spending.total,
      next: selectTier(spending.total, rule.tiers),
    };
  });

  const rows = new Map(byTier.map((row) => [keyOf(row.tier), row]));

  const start =
    options.startTier !== undefined ? options.startTier : (ascending[ascending.length - 1] ?? null);

  /** 방문 순서. 같은 구간을 두 번 만나면 그 사이가 사이클이다. */
  const order: (Tier | null)[] = [];
  const seen = new Map<string, number>();
  let at = start;
  for (;;) {
    const key = keyOf(at);
    const before = seen.get(key);
    if (before !== undefined) {
      const cycle = order.slice(before);
      const approach = order.slice(0, before);
      const sumDiscount = cycle.reduce((sum, t) => sum + (rows.get(keyOf(t))?.discount ?? 0), 0);
      const sumSpending = cycle.reduce((sum, t) => sum + (rows.get(keyOf(t))?.spending ?? 0), 0);
      return {
        cycle,
        // 할인액을 나누는 자리라 반드시 roundDiscount를 거친다(불변규칙 3).
        monthlyDiscount: roundDiscount(sumDiscount / cycle.length, 'floor1'),
        // 실적은 할인액이 아니라 결제액의 합이므로 절사 규칙 밖이다. 평균이라 내림으로 둔다.
        monthlySpending: Math.floor(sumSpending / cycle.length),
        byTier,
        oscillates: cycle.length > 1,
        approach,
      };
    }
    seen.set(key, order.length);
    order.push(at);
    at = rows.get(key)?.next ?? null;
  }
}
