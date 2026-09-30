import { assertResolved } from './choice.js';
import { benefitCapFor, rebateFor, totalCapFor } from './tier.js';
import type { CardRule, TierMaxDiscount, Won } from './types.js';

/**
 * 거래 없이 규칙만으로 구간별 월 최대 할인액을 뽑는다 (기능 1).
 *
 * 한도는 세 층으로 겹친다: 혜택별 한도 → 같은 그룹의 혜택들이 나눠 쓰는 한도 → 카드 전체
 * 통합 한도. 혜택별 한도를 합치면 3만원인데 통합 한도가 2만원인 카드가 흔하고, 카드사
 * 안내문은 보통 앞의 숫자를 보여준다. 그래서 단순 합과 실제 상한을 함께 돌려주고, 어느
 * 층에서 잘렸는지도 남긴다.
 *
 * 여기서 나오는 값은 어디까지나 한도의 상한이고, 그만큼 받으려면 실제로 그만큼 써야 한다.
 *
 * 월정액 할인은 한도 층 밖에서 그대로 더한다. 한도 없는 혜택(`monthlyCapByTier`의 `null`)은
 * 그룹이나 통합 한도가 묶어 주지 않는 한 최대치가 없으므로, 그 혜택을 뺀 몫만 `maxDiscount`에
 * 담고 id를 `unboundedBenefits`로 알린다. 무한대를 숫자로 돌려주면 화면이 그대로 찍는다.
 */
export function maxDiscountByTier(rule: CardRule): TierMaxDiscount[] {
  assertResolved(rule);
  return [...rule.tiers]
    .sort((a, b) => a.min - b.min)
    .map((tier) => {
      const byBenefit: Record<string, Won | null> = {};
      let sumOfBenefitCaps = 0;
      /** 그룹 밖 혜택의 한도 합. 그룹 한도에 눌리지 않는 몫이다. 한도 없는 혜택은 뺀다. */
      let ungrouped = 0;
      /** 그룹 밖에 있고 이 구간에서 한도가 없는 혜택. */
      const uncapped: string[] = [];
      /** capGroup id → 그 그룹에 속한 혜택 한도의 합. */
      const wantedByGroup: Record<string, Won> = {};

      for (const benefit of rule.benefits) {
        const cap = benefitCapFor(benefit, tier);
        const finite = Number.isFinite(cap);
        byBenefit[benefit.id] = finite ? cap : null;
        if (finite) sumOfBenefitCaps += cap;

        if (benefit.capGroup !== undefined) {
          wantedByGroup[benefit.capGroup] = (wantedByGroup[benefit.capGroup] ?? 0) + cap;
        } else if (finite) {
          ungrouped += cap;
        } else {
          uncapped.push(benefit.id);
        }
      }

      const byGroup: Record<string, Won> = {};
      let afterGroups = ungrouped;
      for (const group of rule.capGroups ?? []) {
        const cap = tier === null ? 0 : (group.monthlyCapByTier[String(tier.min)] ?? 0);
        byGroup[group.id] = cap;
        afterGroups += Math.min(wantedByGroup[group.id] ?? 0, cap);
      }

      const totalCap = totalCapFor(rule, tier);
      // 한도 없는 혜택이 있으면 그룹 층을 지난 합도 끝이 없다. 통합 한도만이 그걸 묶는다.
      const reach = uncapped.length > 0 ? Number.POSITIVE_INFINITY : afterGroups;
      const bounded = Number.isFinite(totalCap) || uncapped.length === 0;
      const rebate = rebateFor(rule, tier);

      return {
        tier,
        sumOfBenefitCaps: sumOfBenefitCaps + rebate,
        maxDiscount: (bounded ? Math.min(reach, totalCap) : afterGroups) + rebate,
        rebate,
        unboundedBenefits: bounded ? [] : uncapped,
        cappedByGroup: afterGroups < sumOfBenefitCaps,
        cappedByTotal: totalCap < reach,
        byBenefit,
        byGroup,
      };
    });
}
