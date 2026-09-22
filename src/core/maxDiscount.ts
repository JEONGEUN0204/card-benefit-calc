import { benefitCapFor, totalCapFor } from './tier.js';
import type { CardRule, TierMaxDiscount, Won } from './types.js';

/**
 * 거래 없이 규칙만으로 구간별 월 최대 할인액을 뽑는다 (기능 1).
 *
 * 혜택별 한도를 합치면 3만원인데 통합 한도가 2만원인 카드가 흔하다. 카드사 안내문은
 * 보통 앞의 숫자를 보여주므로, 실제 상한과 "통합 한도에 잘렸다"는 사실을 같이 돌려준다.
 * 여기서 나오는 값은 어디까지나 한도의 상한이고, 그만큼 받으려면 실제로 그만큼 써야 한다.
 */
export function maxDiscountByTier(rule: CardRule): TierMaxDiscount[] {
  return [...rule.tiers]
    .sort((a, b) => a.min - b.min)
    .map((tier) => {
      const byBenefit: Record<string, Won> = {};
      let sumOfBenefitCaps = 0;

      for (const benefit of rule.benefits) {
        const cap = benefitCapFor(benefit, tier);
        byBenefit[benefit.id] = cap;
        sumOfBenefitCaps += cap;
      }

      const totalCap = totalCapFor(rule, tier);
      const maxDiscount = Math.min(sumOfBenefitCaps, totalCap);

      return {
        tier,
        sumOfBenefitCaps,
        maxDiscount,
        cappedByTotal: totalCap < sumOfBenefitCaps,
        byBenefit,
      };
    });
}
