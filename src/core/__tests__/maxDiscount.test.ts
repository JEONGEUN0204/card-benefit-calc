import { describe, expect, it } from 'vitest';
import { maxDiscountByTier } from '../maxDiscount.js';
import { benefit, card, must } from './helpers.js';

describe('maxDiscountByTier — 구간별 월 최대 할인 (기능 1)', () => {
  it('혜택별 월 한도를 구간별로 합산한다', () => {
    const rule = card({
      id: 'c',
      tiers: [{ min: 0 }, { min: 300_000 }],
      benefits: [
        benefit({ id: 'cafe', monthlyCapByTier: { '0': 0, '300000': 5_000 } }),
        benefit({ id: 'mart', monthlyCapByTier: { '0': 1_000, '300000': 8_000 } }),
      ],
    });
    const rows = maxDiscountByTier(rule);

    const t0 = must(rows[0], '0원 구간');
    expect(t0.tier.min).toBe(0);
    expect(t0.sumOfBenefitCaps).toBe(1_000);
    expect(t0.maxDiscount).toBe(1_000);
    expect(t0.byBenefit).toEqual({ cafe: 0, mart: 1_000 });

    const t1 = must(rows[1], '30만원 구간');
    expect(t1.sumOfBenefitCaps).toBe(13_000);
    expect(t1.maxDiscount).toBe(13_000);
  });

  it('통합 한도가 혜택 한도 합보다 작으면 거기서 잘린다', () => {
    const rule = card({
      id: 'c',
      tiers: [{ min: 300_000 }],
      totalMonthlyCapByTier: { '300000': 10_000 },
      benefits: [
        benefit({ id: 'cafe', monthlyCapByTier: { '300000': 5_000 } }),
        benefit({ id: 'mart', monthlyCapByTier: { '300000': 8_000 } }),
      ],
    });
    const row = must(maxDiscountByTier(rule)[0], '30만원 구간');
    // 한도 합은 13,000원이지만 통합 한도 때문에 실제 최대는 10,000원이다.
    expect(row.sumOfBenefitCaps).toBe(13_000);
    expect(row.maxDiscount).toBe(10_000);
    expect(row.cappedByTotal).toBe(true);
  });

  it('통합 한도가 더 크면 잘리지 않는다', () => {
    const rule = card({
      id: 'c',
      tiers: [{ min: 0 }],
      totalMonthlyCapByTier: { '0': 100_000 },
      benefits: [benefit({ id: 'cafe', monthlyCapByTier: { '0': 5_000 } })],
    });
    const row = must(maxDiscountByTier(rule)[0], '0원 구간');
    expect(row.maxDiscount).toBe(5_000);
    expect(row.cappedByTotal).toBe(false);
  });

  it('통합 한도 표가 없는 카드는 혜택 한도 합이 그대로 최대다', () => {
    const rule = card({
      id: 'c',
      tiers: [{ min: 0 }],
      benefits: [benefit({ id: 'cafe', monthlyCapByTier: { '0': 5_000 } })],
    });
    const row = must(maxDiscountByTier(rule)[0], '0원 구간');
    expect(row.maxDiscount).toBe(5_000);
    expect(row.cappedByTotal).toBe(false);
  });

  it('구간을 오름차순으로 돌려준다', () => {
    const rule = card({
      id: 'c',
      tiers: [{ min: 700_000 }, { min: 0 }, { min: 300_000 }],
      benefits: [],
    });
    expect(maxDiscountByTier(rule).map((r) => r.tier.min)).toEqual([0, 300_000, 700_000]);
  });
});
