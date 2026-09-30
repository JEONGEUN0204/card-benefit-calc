import { describe, expect, it } from 'vitest';
import { applyDiscounts } from '../discount.js';
import { maxDiscountByTier } from '../maxDiscount.js';
import { parseCardRule } from '../parseCardRule.js';
import { simulate } from '../simulate.js';
import type { CardRule } from '../types.js';
import { benefit, card, must, tx } from './helpers.js';

/*
 * 그룹 통합한도 — 혜택 여럿이 하나의 월 한도를 나눠 쓰는 구조.
 *
 * 토스 삼성카드의 "토스페이/토스쇼핑 15%"와 "온라인 영역 10%"가 이렇게 묶여 있다. 할인율이
 * 달라 혜택을 둘로 나눠야 하는데 한도는 하나다. 각 혜택에 같은 한도를 따로 주면 월 최대가
 * 두 배로 부풀고, 오류 없이 그럴듯한 숫자가 나온다.
 *
 * 기대값은 전부 손으로 계산했다.
 */

const TIER = { min: 300_000 };

/**
 * 한도 10,000원짜리 그룹 `g`를 혜택 A(카페 20%)·B(온라인 10%)가 나눠 쓰고,
 * 혜택 C(마트 5%)는 그룹 밖에 있는 카드.
 */
function groupCard(): CardRule {
  return card({
    id: 'grouped',
    rounding: 'floor1',
    tiers: [{ min: 0 }, TIER],
    capGroups: [{ id: 'g', label: '온라인 통합', monthlyCapByTier: { '0': 0, '300000': 10_000 } }],
    benefits: [
      benefit({
        id: 'a',
        match: { categories: ['cafe'] },
        discount: { type: 'rate', rate: 0.2 },
        monthlyCapByTier: { '0': 0, '300000': 10_000 },
        capGroup: 'g',
      }),
      benefit({
        id: 'b',
        match: { categories: ['online'] },
        discount: { type: 'rate', rate: 0.1 },
        monthlyCapByTier: { '0': 0, '300000': 10_000 },
        capGroup: 'g',
      }),
      benefit({
        id: 'c',
        match: { categories: ['mart'] },
        discount: { type: 'rate', rate: 0.05 },
        monthlyCapByTier: { '0': 0, '300000': 5_000 },
      }),
    ],
  });
}

describe('applyDiscounts — 그룹 통합한도', () => {
  it('같은 그룹의 혜택이 한 한도를 나눠 쓴다', () => {
    // 카페 40,000 × 20% = 8,000 (그룹 10,000 중 8,000 소진)
    // 온라인 50,000 × 10% = 5,000 이지만 그룹에 2,000만 남아 2,000
    const got = applyDiscounts(groupCard(), TIER, [
      tx({ id: 't1', date: '2026-01-02', amount: 40_000, category: 'cafe' }),
      tx({ id: 't2', date: '2026-01-03', amount: 50_000, category: 'online' }),
    ]);

    expect(must(got.byTxId['t1'], 't1').discount).toBe(8_000);
    expect(must(got.byTxId['t2'], 't2').discount).toBe(2_000);
    expect(got.totalDiscount).toBe(10_000);
  });

  it('그룹 한도에 잘린 건은 cappedBy가 group이다', () => {
    const got = applyDiscounts(groupCard(), TIER, [
      tx({ id: 't1', date: '2026-01-02', amount: 40_000, category: 'cafe' }),
      tx({ id: 't2', date: '2026-01-03', amount: 50_000, category: 'online' }),
    ]);

    expect(must(got.byTxId['t2'], 't2').cappedBy).toBe('group');
  });

  it('그룹 한도가 바닥나면 그 그룹의 혜택은 groupCapReached가 된다', () => {
    // 카페 60,000 × 20% = 12,000 → 혜택 한도 10,000에 잘림 (그룹도 정확히 소진)
    const got = applyDiscounts(groupCard(), TIER, [
      tx({ id: 't1', date: '2026-01-02', amount: 60_000, category: 'cafe' }),
      tx({ id: 't2', date: '2026-01-03', amount: 50_000, category: 'online' }),
    ]);

    const first = must(got.byTxId['t1'], 't1');
    expect(first.discount).toBe(10_000);
    expect(first.cappedBy).toBe('benefit');

    const second = must(got.byTxId['t2'], 't2');
    expect(second.discount).toBe(0);
    expect(second.reason).toBe('groupCapReached');
  });

  it('그룹 밖 혜택은 그룹 한도가 바닥나도 그대로 받는다', () => {
    // 마트 40,000 × 5% = 2,000. 그룹과 무관하다.
    const got = applyDiscounts(groupCard(), TIER, [
      tx({ id: 't1', date: '2026-01-02', amount: 60_000, category: 'cafe' }),
      tx({ id: 't2', date: '2026-01-03', amount: 50_000, category: 'online' }),
      tx({ id: 't3', date: '2026-01-04', amount: 40_000, category: 'mart' }),
    ]);

    expect(must(got.byTxId['t3'], 't3').discount).toBe(2_000);
    expect(got.totalDiscount).toBe(12_000);
  });

  it('그룹 한도를 정확히 채운 건은 잘렸다고 표시하지 않는다', () => {
    // 카페 40,000 × 20% = 8,000, 온라인 20,000 × 10% = 2,000 → 합이 정확히 10,000.
    // 경계에서 한 푼도 깎이지 않았으므로 cappedBy가 붙으면 안 된다.
    const got = applyDiscounts(groupCard(), TIER, [
      tx({ id: 't1', date: '2026-01-02', amount: 40_000, category: 'cafe' }),
      tx({ id: 't2', date: '2026-01-03', amount: 20_000, category: 'online' }),
    ]);

    const second = must(got.byTxId['t2'], 't2');
    expect(second.discount).toBe(2_000);
    expect(second.cappedBy).toBeUndefined();
    expect(got.groupUsage['g']).toBe(10_000);
  });

  it('그룹 소진량을 따로 돌려준다', () => {
    const got = applyDiscounts(groupCard(), TIER, [
      tx({ id: 't1', date: '2026-01-02', amount: 40_000, category: 'cafe' }),
      tx({ id: 't2', date: '2026-01-03', amount: 50_000, category: 'online' }),
      tx({ id: 't3', date: '2026-01-04', amount: 40_000, category: 'mart' }),
    ]);

    expect(got.groupUsage['g']).toBe(10_000);
  });
});

describe('maxDiscountByTier — 그룹 통합한도', () => {
  it('혜택별 한도의 단순 합이 아니라 그룹 한도까지 적용한 값을 낸다', () => {
    // 혜택 한도 합 10,000 + 10,000 + 5,000 = 25,000
    // 그룹 g는 20,000을 요구하지만 한도가 10,000 → 10,000
    // 그룹 밖 c는 5,000 → 실제 월 최대 15,000
    const row = must(
      maxDiscountByTier(groupCard()).find((r) => r.tier.min === TIER.min),
      '300000 구간',
    );

    expect(row.sumOfBenefitCaps).toBe(25_000);
    expect(row.maxDiscount).toBe(15_000);
    expect(row.cappedByGroup).toBe(true);
    expect(row.cappedByTotal).toBe(false);
  });

  it('구간별 그룹 한도를 돌려줘 화면이 표에 적을 수 있다', () => {
    const row = must(
      maxDiscountByTier(groupCard()).find((r) => r.tier.min === TIER.min),
      '300000 구간',
    );

    expect(row.byGroup['g']).toBe(10_000);
  });

  it('실적 미달 구간에서는 그룹 한도도 0이다', () => {
    const row = must(maxDiscountByTier(groupCard()).find((r) => r.tier.min === 0), '0 구간');

    expect(row.maxDiscount).toBe(0);
    expect(row.cappedByGroup).toBe(false);
  });
});

describe('parseCardRule — 그룹 통합한도', () => {
  const base = {
    id: 'x',
    name: 'X',
    issuer: 'T',
    annualFee: 0,
    tiers: [{ min: 0 }, { min: 300_000 }],
    rounding: 'floor1',
    spendingExclusions: [],
  };

  const aBenefit = (over: Record<string, unknown> = {}) => ({
    id: 'a',
    label: 'A',
    match: {},
    discount: { type: 'rate', rate: 0.1 },
    monthlyCapByTier: { '0': 0, '300000': 10_000 },
    excludeFromSpending: 'none',
    ...over,
  });

  it('없는 그룹을 가리키는 혜택을 받지 않는다', () => {
    // 오타 하나로 한도가 통째로 사라지면 할인액만 조용히 늘어난다.
    const got = parseCardRule({ ...base, benefits: [aBenefit({ capGroup: 'nope' })] });

    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.issues.some((i) => i.path === 'benefits[0].capGroup')).toBe(true);
  });

  it('그룹 한도표의 구간 키 누락을 막는다', () => {
    const got = parseCardRule({
      ...base,
      capGroups: [{ id: 'g', label: 'G', monthlyCapByTier: { '300000': 10_000 } }],
      benefits: [aBenefit({ capGroup: 'g' })],
    });

    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.issues.some((i) => i.path === 'capGroups[0].monthlyCapByTier')).toBe(true);
  });

  it('같은 id를 가진 그룹이 둘이면 받지 않는다', () => {
    const got = parseCardRule({
      ...base,
      capGroups: [
        { id: 'g', label: 'G', monthlyCapByTier: { '0': 0, '300000': 10_000 } },
        { id: 'g', label: 'G2', monthlyCapByTier: { '0': 0, '300000': 20_000 } },
      ],
      benefits: [aBenefit({ capGroup: 'g' })],
    });

    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.issues.some((i) => i.path === 'capGroups')).toBe(true);
  });

  it('제대로 적힌 그룹은 그대로 통과한다', () => {
    const got = parseCardRule({
      ...base,
      capGroups: [{ id: 'g', label: 'G', monthlyCapByTier: { '0': 0, '300000': 10_000 } }],
      benefits: [aBenefit({ capGroup: 'g' })],
    });

    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.card.capGroups?.[0]?.monthlyCapByTier['300000']).toBe(10_000);
    expect(got.card.benefits[0]?.capGroup).toBe('g');
  });
});

describe('simulate — 그룹 한도의 월 이월', () => {
  it('그룹 한도는 달이 바뀌면 다시 찬다', () => {
    /*
     * 1월: 카페 60,000 × 20% = 12,000이지만 혜택 한도 10,000 → 10,000. 그룹이 여기서
     * 바닥나 온라인 50,000은 0원. 이 카드는 실적 제외가 none이라 1월 실적은 결제액 그대로
     * 310,000원이고, 그래서 2월도 300,000 구간에 머문다.
     * 2월: 그룹 한도가 다시 차 있으므로 카페 40,000 × 20% = 8,000을 온전히 받는다.
     */
    const months = simulate(
      groupCard(),
      [
        tx({ id: 't1', date: '2026-01-02', amount: 60_000, category: 'cafe' }),
        tx({ id: 't2', date: '2026-01-03', amount: 50_000, category: 'online' }),
        tx({ id: 't3', date: '2026-01-04', amount: 200_000, category: 'restaurant' }),
        tx({ id: 'f1', date: '2026-02-02', amount: 40_000, category: 'cafe' }),
      ],
      { initialPrevSpending: 300_000 },
    );

    const january = must(months[0], '1월');
    expect(january.totalDiscount).toBe(10_000);
    expect(january.groupUsage['g']).toBe(10_000);
    expect(january.countedSpending).toBe(310_000);

    const february = must(months[1], '2월');
    expect(february.prevSpending).toBe(310_000);
    expect(february.totalDiscount).toBe(8_000);
    expect(february.groupUsage['g']).toBe(8_000);
  });
});
