import type { Benefit, CardRule, Tier, Won } from './types.js';

/**
 * 전월실적으로 적용 구간을 고른다.
 *
 * 약관의 구간 표기는 "30만원 이상"처럼 하한 포함이다. 경계 금액을 정확히 썼을 때
 * 상위 구간으로 올라가는지가 사용자 신뢰를 좌우하므로 `>=`로 비교한다.
 * 어느 구간에도 못 미치면 null — 혜택이 전혀 없는 상태다.
 */
export function selectTier(spending: Won, tiers: readonly Tier[]): Tier | null {
  let best: Tier | null = null;
  for (const t of tiers) {
    if (spending >= t.min && (best === null || t.min > best.min)) {
      best = t;
    }
  }
  return best;
}

/**
 * 해당 구간에서 이 혜택의 월 한도.
 *
 * 표에 없는 구간은 0으로 본다. 카드사가 혜택을 주는 구간만 표에 적기 때문이다.
 * 값이 `null`이면 그 구간에서 한도가 없다("할인 한도 없음") — 무한대를 돌려준다.
 * 구간이 null이면 실적 미달이라 어떤 혜택도 열리지 않는다.
 */
export function benefitCapFor(benefit: Benefit, tier: Tier | null): Won {
  if (tier === null) return 0;
  const cap = benefit.monthlyCapByTier[String(tier.min)];
  if (cap === null) return Number.POSITIVE_INFINITY;
  return cap ?? 0;
}

/**
 * 해당 구간의 월정액 할인. 거래와 무관하게 구간만으로 정해진다.
 *
 * 표가 없는 카드는 0이다. 표에 없는 구간도 0 — 구간 키 누락은 `parseCardRule`이 막는다.
 */
export function rebateFor(rule: CardRule, tier: Tier | null): Won {
  if (tier === null) return 0;
  return rule.monthlyRebateByTier?.[String(tier.min)] ?? 0;
}

/**
 * 해당 구간의 통합 할인 한도.
 *
 * 통합 한도 표 자체가 없는 카드는 혜택별 한도만으로 움직이므로 무한대를 돌려준다.
 * 표는 있는데 해당 구간 키가 없으면 0 — 그 구간엔 통합 한도가 0이라는 뜻이고,
 * 데이터 누락이라면 골든 테스트에서 할인액 0으로 크게 드러난다.
 */
export function totalCapFor(rule: CardRule, tier: Tier | null): Won {
  if (tier === null) return 0;
  const table = rule.totalMonthlyCapByTier;
  if (table === undefined) return Number.POSITIVE_INFINITY;
  return table[String(tier.min)] ?? 0;
}

/**
 * 이 혜택이 속한 그룹의 해당 구간 월 한도.
 *
 * 그룹에 들어 있지 않으면 무한대를 돌려준다 — 대부분의 혜택이 그렇고, 그래야 호출부가
 * 그룹 유무를 따로 분기하지 않는다. 그룹을 가리키는데 그 그룹이 없는 경우도 무한대다.
 * 그 상황은 `parseCardRule`이 규칙을 받을 때 이미 막으므로 여기까지 오지 않는다.
 */
export function groupCapFor(rule: CardRule, benefit: Benefit, tier: Tier | null): Won {
  const id = benefit.capGroup;
  if (id === undefined) return Number.POSITIVE_INFINITY;
  if (tier === null) return 0;

  const group = rule.capGroups?.find((g) => g.id === id);
  if (group === undefined) return Number.POSITIVE_INFINITY;
  return group.monthlyCapByTier[String(tier.min)] ?? 0;
}
