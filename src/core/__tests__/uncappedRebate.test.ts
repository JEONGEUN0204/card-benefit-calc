import { describe, expect, it } from 'vitest';
import { applyDiscounts } from '../discount.js';
import { matchesBenefit } from '../match.js';
import { maxDiscountByTier } from '../maxDiscount.js';
import { parseCardRule } from '../parseCardRule.js';
import { requiredSpendFor } from '../requiredSpend.js';
import { simulate } from '../simulate.js';
import { benefitCapFor, rebateFor } from '../tier.js';
import type { CardRule } from '../types.js';
import { benefit, card, must, tx } from './helpers.js';

/*
 * 한도 없는 혜택과 전월실적별 월정액 할인.
 *
 * 카드의정석 EVERY 1이 둘 다 쓴다: "국내외 가맹점 1% 청구할인, 할인 한도 없음"과
 * "전월실적 50만/100만/150만/200만원 이상이면 매월 5천/1만/1.5만/2만원 청구할인".
 * 앞의 것은 구간별 한도 자리에 `null`을, 뒤의 것은 거래에 붙지 않으므로 카드에
 * `monthlyRebateByTier`를 둔다.
 *
 * 기대값은 전부 손으로 계산했다.
 */

const T0 = { min: 0 };
const T50 = { min: 500_000 };
const T100 = { min: 1_000_000 };

function everyCard(over: Partial<CardRule> = {}): CardRule {
  return card({
    id: 'every',
    rounding: 'floor10',
    tiers: [T0, T50, T100],
    monthlyRebateByTier: { '0': 0, '500000': 5_000, '1000000': 10_000 },
    benefits: [
      benefit({
        id: 'base',
        discount: { type: 'rate', rate: 0.01 },
        match: { excludeCategories: ['tax'], excludePaymentTypes: ['interestFreeInstallment'] },
        monthlyCapByTier: { '0': null, '500000': null, '1000000': null },
      }),
    ],
    ...over,
  });
}

describe('MatchRule — 할인 대상 제외', () => {
  const b = benefit({
    id: 'b',
    match: { excludeCategories: ['tax', 'utility'], excludePaymentTypes: ['interestFreeInstallment'] },
  });

  it('제외 카테고리는 매칭되지 않는다', () => {
    expect(matchesBenefit(tx({ id: 'a', category: 'tax' }), b)).toBe(false);
    expect(matchesBenefit(tx({ id: 'b', category: 'utility' }), b)).toBe(false);
    expect(matchesBenefit(tx({ id: 'c', category: 'cafe' }), b)).toBe(true);
  });

  it('제외 결제유형은 매칭되지 않는다. 결제유형이 없으면 일시불로 본다', () => {
    expect(matchesBenefit(tx({ id: 'a', paymentType: 'interestFreeInstallment' }), b)).toBe(false);
    expect(matchesBenefit(tx({ id: 'b', paymentType: 'installment' }), b)).toBe(true);
    expect(matchesBenefit(tx({ id: 'c' }), b)).toBe(true);
  });
});

describe('한도 없는 혜택', () => {
  it('구간 한도가 null이면 무한대다. 키가 없으면 여전히 0이다', () => {
    const b = benefit({ id: 'b', monthlyCapByTier: { '0': null } });
    expect(benefitCapFor(b, T0)).toBe(Number.POSITIVE_INFINITY);
    expect(benefitCapFor(b, T50)).toBe(0);
    expect(benefitCapFor(b, null)).toBe(0);
  });

  it('얼마를 써도 한도에 잘리지 않는다', () => {
    // 3,000,000 × 1% = 30,000 / 2,000,000 × 1% = 20,000 → 50,000, 잘림 없음
    const got = applyDiscounts(everyCard(), T0, [
      tx({ id: 'a', date: '2026-01-02', amount: 3_000_000 }),
      tx({ id: 'b', date: '2026-01-03', amount: 2_000_000 }),
    ]);
    expect(got.totalDiscount).toBe(50_000);
    expect(must(got.byTxId['b'], 'b')).toEqual({
      txId: 'b',
      appliedBenefitId: 'base',
      discount: 20_000,
      reason: 'ok',
    });
  });

  it('절사는 그대로 적용된다', () => {
    // 12,345 × 1% = 123.45 → floor10 = 120
    const got = applyDiscounts(everyCard(), T0, [tx({ id: 'a', amount: 12_345 })]);
    expect(got.totalDiscount).toBe(120);
  });

  it('제외 대상은 할인을 받지 못하고 noMatch로 남는다', () => {
    const got = applyDiscounts(everyCard(), T0, [
      tx({ id: 'tax', category: 'tax', amount: 100_000 }),
      tx({ id: 'nfi', paymentType: 'interestFreeInstallment', amount: 100_000 }),
    ]);
    expect(got.totalDiscount).toBe(0);
    expect(must(got.byTxId['tax'], 'tax').reason).toBe('noMatch');
    expect(must(got.byTxId['nfi'], 'nfi').reason).toBe('noMatch');
  });

  it('통합 한도가 있으면 그 아래로 잘린다', () => {
    // 1,000,000 × 1% = 10,000 이지만 통합 한도 3,000
    const rule = everyCard({ totalMonthlyCapByTier: { '0': 3_000, '500000': 3_000, '1000000': 3_000 } });
    const got = applyDiscounts(rule, T0, [tx({ id: 'a', amount: 1_000_000 })]);
    expect(must(got.byTxId['a'], 'a')).toMatchObject({ discount: 3_000, cappedBy: 'total' });
  });
});

describe('전월실적별 월정액 할인', () => {
  it('구간에 맞는 금액을 돌려준다. 표가 없거나 구간이 null이면 0이다', () => {
    expect(rebateFor(everyCard(), T0)).toBe(0);
    expect(rebateFor(everyCard(), T50)).toBe(5_000);
    expect(rebateFor(everyCard(), T100)).toBe(10_000);
    expect(rebateFor(everyCard(), null)).toBe(0);
    expect(rebateFor(card({ id: 'x' }), T0)).toBe(0);
  });

  it('simulate가 달마다 더하고, 실적은 건드리지 않는다', () => {
    // 1월: 전월 1,000,000 → 100만 구간. 월정액 10,000 + 200,000 × 1% = 2,000 → 12,000
    //      실적: 1% 할인 건은 excludeFromSpending none이라 200,000 그대로
    // 2월: 전월 200,000 → 0 구간. 월정액 0 + 100,000 × 1% = 1,000
    const months = simulate(
      everyCard(),
      [
        tx({ id: 'j', date: '2026-01-10', amount: 200_000 }),
        tx({ id: 'f', date: '2026-02-10', amount: 100_000 }),
      ],
      { initialPrevSpending: 1_000_000 },
    );
    const [jan, feb] = months;
    expect(must(jan, 'jan')).toMatchObject({ rebate: 10_000, totalDiscount: 12_000, countedSpending: 200_000 });
    expect(must(feb, 'feb')).toMatchObject({ rebate: 0, totalDiscount: 1_000, countedSpending: 100_000 });
  });

  it('거래가 없는 빈 달에도 구간이 열려 있으면 들어온다', () => {
    // 1월 600,000 사용 → 2월은 50만 구간. 2월에 결제가 없어도 5,000원. 3월 거래가 있어 2월이 채워진다.
    const months = simulate(everyCard(), [
      tx({ id: 'j', date: '2026-01-10', amount: 600_000 }),
      tx({ id: 'm', date: '2026-03-10', amount: 10_000 }),
    ]);
    expect(months.map((m) => [m.month, m.rebate])).toEqual([
      ['2026-01', 0],
      ['2026-02', 5_000],
      ['2026-03', 0],
    ]);
  });

  it('통합 한도에 잡히지 않는다', () => {
    const rule = everyCard({ totalMonthlyCapByTier: { '0': 0, '500000': 0, '1000000': 0 } });
    const [jan] = simulate(rule, [tx({ id: 'j', date: '2026-01-10', amount: 10_000 })], {
      initialPrevSpending: 500_000,
    });
    expect(must(jan, 'jan')).toMatchObject({ rebate: 5_000, totalDiscount: 5_000, totalCapUsed: 0 });
  });

  it('필요 사용액의 예상 할인에 들어간다', () => {
    // 목표 50만 구간 유지: 1% 할인 건이 실적에서 빠지지 않으므로 필요액 = 500,000
    // 예상 할인: 500,000 × 1% = 5,000 (etc 20,000원 25건, 건당 200) + 월정액 5,000 = 10,000
    const got = requiredSpendFor(everyCard(), T50, { weights: { etc: 1 }, defaultTicket: 20_000 });
    expect(got.requiredTotalSpend).toBe(500_000);
    expect(got.expectedDiscount).toBe(10_000);
  });
});

describe('maxDiscountByTier — 한도 없음과 월정액', () => {
  it('월정액은 최대치에 더하고, 한도 없는 혜택은 따로 알린다', () => {
    const rows = maxDiscountByTier(everyCard());
    expect(rows.map((r) => [r.tier.min, r.maxDiscount, r.rebate, r.unboundedBenefits])).toEqual([
      [0, 0, 0, ['base']],
      [500_000, 5_000, 5_000, ['base']],
      [1_000_000, 10_000, 10_000, ['base']],
    ]);
    const top = must(rows[2], 'top');
    expect(top.sumOfBenefitCaps).toBe(10_000);
    expect(top.byBenefit['base']).toBeNull();
    expect(top.cappedByTotal).toBe(false);
  });

  it('구간 한도가 0인 구간에서는 한도 없는 혜택도 열리지 않는다', () => {
    const rule = everyCard();
    rule.benefits[0] = { ...must(rule.benefits[0], 'b'), monthlyCapByTier: { '0': 0, '500000': null, '1000000': null } };
    expect(maxDiscountByTier(rule).map((r) => r.unboundedBenefits)).toEqual([[], ['base'], ['base']]);
  });

  it('통합 한도가 있으면 상한이 생긴다', () => {
    // 100만 구간: 한도 없는 1%가 통합 한도 3,000에 묶인다 → 3,000 + 월정액 10,000
    const rule = everyCard({ totalMonthlyCapByTier: { '0': 3_000, '500000': 3_000, '1000000': 3_000 } });
    const top = must(maxDiscountByTier(rule)[2], 'top');
    expect(top.unboundedBenefits).toEqual([]);
    expect(top.maxDiscount).toBe(13_000);
    expect(top.cappedByTotal).toBe(true);
  });
});

describe('parseCardRule — 한도 없음·월정액·할인 제외', () => {
  function raw(over: Record<string, unknown> = {}, benefitOver: Record<string, unknown> = {}) {
    return {
      id: 'every',
      name: 'EVERY',
      issuer: '우리카드',
      annualFee: 12_000,
      rounding: 'floor10',
      tiers: [{ min: 0 }, { min: 500_000 }],
      spendingExclusions: [],
      monthlyRebateByTier: { '0': 0, '500000': 5_000 },
      benefits: [
        {
          id: 'base',
          label: '1%',
          match: { excludeCategories: ['tax'], excludePaymentTypes: ['interestFreeInstallment'] },
          discount: { type: 'rate', rate: 0.01 },
          monthlyCapByTier: { '0': null, '500000': null },
          excludeFromSpending: 'none',
          ...benefitOver,
        },
      ],
      ...over,
    };
  }

  const issues = (value: unknown) => {
    const result = parseCardRule(value);
    return result.ok ? [] : result.issues.map((i) => i.path);
  };

  it('혜택 한도의 null, 월정액 표, 할인 제외를 받는다', () => {
    const result = parseCardRule(raw());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.card.monthlyRebateByTier).toEqual({ '0': 0, '500000': 5_000 });
    expect(result.card.benefits[0]?.monthlyCapByTier).toEqual({ '0': null, '500000': null });
    expect(result.card.benefits[0]?.match).toEqual({
      excludeCategories: ['tax'],
      excludePaymentTypes: ['interestFreeInstallment'],
    });
  });

  it('월정액 표도 구간 키가 빠지면 막는다', () => {
    expect(issues(raw({ monthlyRebateByTier: { '500000': 5_000 } }))).toEqual(['monthlyRebateByTier']);
  });

  it('공동·통합 한도에는 null을 받지 않는다', () => {
    expect(issues(raw({ totalMonthlyCapByTier: { '0': null, '500000': 0 } }))).toEqual([
      'totalMonthlyCapByTier.0',
    ]);
  });

  it('공동 한도에 든 혜택은 개별 한도를 비울 수 없다', () => {
    const value = raw(
      { capGroups: [{ id: 'g', label: 'G', monthlyCapByTier: { '0': 0, '500000': 1_000 } }] },
      { capGroup: 'g' },
    );
    expect(issues(value)).toEqual(['benefits[0].monthlyCapByTier']);
  });

  it('모르는 결제유형은 막는다', () => {
    expect(issues(raw({}, { match: { excludePaymentTypes: ['무이자'] } }))).toEqual([
      'benefits[0].match.excludePaymentTypes[0]',
    ]);
  });
});

/*
 * 해외 결제 조건. "해외 온·오프라인 가맹점 2%"와 "국내 가맹점 이용 시 제공"을 가른다.
 * 해외 여부는 명세서가 알려 줄 때만 붙는다(`Transaction.overseas`). 표시가 없으면 국내로 본다.
 */
describe('MatchRule — 해외 결제', () => {
  const abroad = benefit({ id: 'abroad', match: { overseas: true } });
  const domestic = benefit({ id: 'domestic', match: { overseas: false } });
  const any = benefit({ id: 'any' });

  it('overseas: true는 해외 결제에만 붙는다', () => {
    expect(matchesBenefit(tx({ id: 'a', overseas: true }), abroad)).toBe(true);
    expect(matchesBenefit(tx({ id: 'b' }), abroad)).toBe(false);
  });

  it('overseas: false는 국내 결제에만 붙는다. 표시가 없으면 국내다', () => {
    expect(matchesBenefit(tx({ id: 'a', overseas: true }), domestic)).toBe(false);
    expect(matchesBenefit(tx({ id: 'b' }), domestic)).toBe(true);
  });

  it('조건이 없으면 둘 다 붙는다', () => {
    expect(matchesBenefit(tx({ id: 'a', overseas: true }), any)).toBe(true);
    expect(matchesBenefit(tx({ id: 'b' }), any)).toBe(true);
  });

  it('parseCardRule이 참·거짓만 받는다', () => {
    const base = {
      id: 'x', name: 'X', issuer: 'I', annualFee: 0, rounding: 'floor1', tiers: [{ min: 0 }], spendingExclusions: [],
      benefits: [{ id: 'b', label: 'B', discount: { type: 'rate', rate: 0.02 }, monthlyCapByTier: { '0': null }, excludeFromSpending: 'full', match: { overseas: true } }],
    };
    const ok = parseCardRule(base);
    expect(ok.ok && ok.card.benefits[0]?.match.overseas).toBe(true);
    const bad = parseCardRule({ ...base, benefits: [{ ...base.benefits[0], match: { overseas: 'yes' } }] });
    expect(bad.ok ? [] : bad.issues.map((i) => i.path)).toEqual(['benefits[0].match.overseas']);
  });
});
