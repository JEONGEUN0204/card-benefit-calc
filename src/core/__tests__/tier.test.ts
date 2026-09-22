import { describe, expect, it } from 'vitest';
import { benefitCapFor, selectTier, totalCapFor } from '../tier.js';
import { benefit, card } from './helpers.js';

const TIERS = [{ min: 0 }, { min: 300_000 }, { min: 700_000 }];

describe('selectTier', () => {
  it('실적에 해당하는 가장 높은 구간을 고른다', () => {
    expect(selectTier(0, TIERS)?.min).toBe(0);
    expect(selectTier(299_999, TIERS)?.min).toBe(0);
    expect(selectTier(500_000, TIERS)?.min).toBe(300_000);
    expect(selectTier(1_000_000, TIERS)?.min).toBe(700_000);
  });

  it('구간 경계는 "이상"이므로 딱 맞으면 상위 구간이다', () => {
    expect(selectTier(300_000, TIERS)?.min).toBe(300_000);
    expect(selectTier(700_000, TIERS)?.min).toBe(700_000);
  });

  it('구간 정의가 오름차순이 아니어도 올바르게 고른다', () => {
    const shuffled = [{ min: 700_000 }, { min: 0 }, { min: 300_000 }];
    expect(selectTier(400_000, shuffled)?.min).toBe(300_000);
  });

  it('어느 구간에도 못 미치면 null이다', () => {
    expect(selectTier(100_000, [{ min: 300_000 }])).toBeNull();
  });
});

describe('benefitCapFor', () => {
  const b = benefit({ id: 'cafe', monthlyCapByTier: { '0': 0, '300000': 5_000 } });

  it('구간에 해당하는 월 한도를 돌려준다', () => {
    expect(benefitCapFor(b, { min: 300_000 })).toBe(5_000);
  });

  it('한도가 0인 구간은 혜택이 없다는 뜻이다', () => {
    expect(benefitCapFor(b, { min: 0 })).toBe(0);
  });

  it('구간이 null이면 한도가 없다', () => {
    expect(benefitCapFor(b, null)).toBe(0);
  });

  it('표에 없는 구간은 0으로 본다', () => {
    expect(benefitCapFor(b, { min: 700_000 })).toBe(0);
  });
});

describe('totalCapFor', () => {
  it('통합 한도가 정의되지 않은 카드는 무한대다', () => {
    const c = card({ id: 'x' });
    expect(totalCapFor(c, { min: 0 })).toBe(Number.POSITIVE_INFINITY);
  });

  it('통합 한도가 있으면 구간별 값을 돌려준다', () => {
    const c = card({ id: 'x', totalMonthlyCapByTier: { '0': 0, '300000': 10_000 } });
    expect(totalCapFor(c, { min: 300_000 })).toBe(10_000);
    expect(totalCapFor(c, { min: 0 })).toBe(0);
  });

  it('구간이 null이면 0이다', () => {
    expect(totalCapFor(card({ id: 'x' }), null)).toBe(0);
  });
});
