import { describe, expect, it } from 'vitest';
import { resolveChoices } from '../choice.js';
import { applyDiscounts } from '../discount.js';
import { maxDiscountByTier } from '../maxDiscount.js';
import { parseCardRule } from '../parseCardRule.js';
import { requiredSpendFor } from '../requiredSpend.js';
import { simulate } from '../simulate.js';
import { countedSpendingOf } from '../spending.js';
import type { CardRule } from '../types.js';
import { benefit, card, must, tx } from './helpers.js';

/*
 * 택1 선택지와 중복 적용.
 *
 * KB국민 NEED Pay 카드가 둘 다 쓴다. "KB Pay 15% / 네이버페이·카카오페이·토스페이 10% 중
 * 택1"이라 네 혜택을 다 켜면 월 최대가 부풀고, "온라인 패션몰 5%는 간편결제 할인(KB Pay)과
 * 중복 적용 가능"이라 한 거래에 할인이 둘 붙는다.
 *
 * 기대값은 전부 손으로 계산했다.
 */

const T0 = { min: 0 };

/** 간편결제 택1(kb 15% 한도 3,000 / naver 10% 한도 2,000) + 패션몰 5%(중복, 한도 1,000). */
function needPay(over: Partial<CardRule> = {}): CardRule {
  return card({
    id: 'need',
    rounding: 'floor1',
    choices: [
      {
        id: 'pay',
        label: '간편결제',
        options: [
          { id: 'kb', label: 'KB Pay' },
          { id: 'naver', label: '네이버페이' },
        ],
      },
    ],
    benefits: [
      benefit({
        id: 'kb',
        match: { merchants: ['KB Pay'] },
        discount: { type: 'rate', rate: 0.15 },
        monthlyCapByTier: { '0': 3_000 },
        choice: { group: 'pay', option: 'kb' },
        excludeFromSpending: 'full',
      }),
      benefit({
        id: 'naver',
        match: { merchants: ['네이버페이'] },
        discount: { type: 'rate', rate: 0.1 },
        monthlyCapByTier: { '0': 2_000 },
        choice: { group: 'pay', option: 'naver' },
        excludeFromSpending: 'full',
      }),
      benefit({
        id: 'fashion',
        match: { merchants: ['무신사'] },
        discount: { type: 'rate', rate: 0.05 },
        monthlyCapByTier: { '0': 1_000 },
        stackable: true,
        excludeFromSpending: 'full',
      }),
    ],
    ...over,
  });
}

describe('resolveChoices', () => {
  it('고른 선택지의 혜택만 남기고 선택지 표를 지운다', () => {
    const got = resolveChoices(needPay(), { pay: 'naver' });
    expect(got.benefits.map((b) => b.id)).toEqual(['naver', 'fashion']);
    expect(got.choices).toBeUndefined();
  });

  it('고르지 않은 그룹은 첫 선택지를 쓴다', () => {
    expect(resolveChoices(needPay(), {}).benefits.map((b) => b.id)).toEqual(['kb', 'fashion']);
  });

  it('없는 선택지를 고르면 첫 선택지로 돌아간다. 저장해 둔 값이 낡았을 때다', () => {
    expect(resolveChoices(needPay(), { pay: 'toss' }).benefits.map((b) => b.id)).toEqual([
      'kb',
      'fashion',
    ]);
  });

  it('선택지가 없는 카드는 그대로다', () => {
    const plain = card({ id: 'p', benefits: [benefit({ id: 'a' })] });
    expect(resolveChoices(plain, {})).toEqual(plain);
  });
});

describe('선택지를 고르지 않은 규칙은 계산하지 않는다', () => {
  // 네 혜택이 다 켜진 채 계산되면 오류 없이 부푼 숫자가 나온다. 그보다 멈추는 편이 낫다.
  it('applyDiscounts·simulate·maxDiscountByTier·requiredSpendFor가 모두 멈춘다', () => {
    const rule = needPay();
    expect(() => applyDiscounts(rule, T0, [])).toThrow(/선택지/);
    expect(() => simulate(rule, [tx({ id: 'a' })])).toThrow(/선택지/);
    expect(() => maxDiscountByTier(rule)).toThrow(/선택지/);
    expect(() => requiredSpendFor(rule, T0, { weights: { etc: 1 } })).toThrow(/선택지/);
  });
});

describe('maxDiscountByTier — 택1', () => {
  it('고른 선택지의 한도만 더한다', () => {
    // kb 3,000 + fashion 1,000 / naver 2,000 + fashion 1,000
    expect(must(maxDiscountByTier(resolveChoices(needPay(), { pay: 'kb' }))[0], 'kb').maxDiscount).toBe(4_000);
    expect(must(maxDiscountByTier(resolveChoices(needPay(), { pay: 'naver' }))[0], 'nv').maxDiscount).toBe(3_000);
  });
});

describe('applyDiscounts — 중복 적용', () => {
  // 가맹점명 "KB Pay 무신사"는 KB Pay와 패션몰에 모두 매칭된다.
  const rule = resolveChoices(needPay(), { pay: 'kb' });

  it('일반 혜택 하나에 중복 혜택이 함께 붙는다', () => {
    // 10,000 × 15% = 1,500 (kb) + 10,000 × 5% = 500 (fashion) → 2,000
    const got = applyDiscounts(rule, T0, [tx({ id: 'a', merchant: 'KB Pay 무신사', amount: 10_000 })]);
    expect(must(got.byTxId['a'], 'a')).toEqual({
      txId: 'a',
      appliedBenefitId: 'kb',
      discount: 2_000,
      reason: 'ok',
      stacked: [{ benefitId: 'fashion', discount: 500 }],
    });
    expect(got.capUsage).toEqual({ kb: 1_500, fashion: 500 });
    expect(got.totalDiscount).toBe(2_000);
  });

  it('한도는 혜택마다 따로 깎이고, 잘린 쪽이 cappedBy를 남긴다', () => {
    // a: kb 1,500 + fashion 500 / b: 30,000 → kb 4,500이지만 남은 1,500 (benefit), fashion 1,500이지만 남은 500 (benefit)
    const got = applyDiscounts(rule, T0, [
      tx({ id: 'a', date: '2026-01-02', merchant: 'KB Pay 무신사', amount: 10_000 }),
      tx({ id: 'b', date: '2026-01-03', merchant: 'KB Pay 무신사', amount: 30_000 }),
    ]);
    expect(must(got.byTxId['b'], 'b')).toEqual({
      txId: 'b',
      appliedBenefitId: 'kb',
      discount: 2_000,
      reason: 'ok',
      cappedBy: 'benefit',
      stacked: [{ benefitId: 'fashion', discount: 500, cappedBy: 'benefit' }],
    });
    expect(got.totalDiscount).toBe(4_000);
  });

  it('일반 혜택이 막혀도 중복 혜택만으로 할인이 붙는다. 그때는 중복 혜택이 대표가 된다', () => {
    // kb 한도를 먼저 다 쓴 뒤: 무신사 10,000 → kb benefitCapReached, fashion 500
    const got = applyDiscounts(rule, T0, [
      tx({ id: 'a', date: '2026-01-02', merchant: 'KB Pay', amount: 20_000 }),
      tx({ id: 'b', date: '2026-01-03', merchant: 'KB Pay 무신사', amount: 10_000 }),
    ]);
    expect(must(got.byTxId['b'], 'b')).toEqual({
      txId: 'b',
      appliedBenefitId: 'fashion',
      discount: 500,
      reason: 'ok',
    });
  });

  it('중복 혜택만 매칭되면 평소처럼 하나로 붙는다', () => {
    const got = applyDiscounts(rule, T0, [tx({ id: 'a', merchant: '무신사', amount: 10_000 })]);
    expect(must(got.byTxId['a'], 'a')).toEqual({
      txId: 'a',
      appliedBenefitId: 'fashion',
      discount: 500,
      reason: 'ok',
    });
  });

  it('할인 합이 결제액을 넘지 않는다', () => {
    // 90% + 50%: 1,000원 결제에 900 + 500이 아니라 900 + 100
    const greedy = card({
      id: 'g',
      rounding: 'floor1',
      benefits: [
        benefit({ id: 'x', discount: { type: 'rate', rate: 0.9 }, monthlyCapByTier: { '0': 100_000 } }),
        benefit({ id: 'y', discount: { type: 'rate', rate: 0.5 }, monthlyCapByTier: { '0': 100_000 }, stackable: true }),
      ],
    });
    const got = applyDiscounts(greedy, T0, [tx({ id: 'a', amount: 1_000 })]);
    expect(must(got.byTxId['a'], 'a')).toMatchObject({ discount: 1_000, stacked: [{ benefitId: 'y', discount: 100 }] });
  });

  it('통합 한도는 둘이 함께 쓴다', () => {
    // 통합 1,800: kb 1,500 먼저, fashion 500이지만 남은 300 (total)
    const capped = { ...rule, totalMonthlyCapByTier: { '0': 1_800 } };
    const got = applyDiscounts(capped, T0, [tx({ id: 'a', merchant: 'KB Pay 무신사', amount: 10_000 })]);
    expect(must(got.byTxId['a'], 'a')).toMatchObject({
      discount: 1_800,
      stacked: [{ benefitId: 'fashion', discount: 300, cappedBy: 'total' }],
    });
    expect(got.totalCapUsed).toBe(1_800);
  });
});

describe('countedSpendingOf — 중복 적용', () => {
  it('어느 한쪽이라도 전액 제외면 전액이 빠진다', () => {
    const rule = resolveChoices(needPay(), { pay: 'kb' });
    const t = tx({ id: 'a', merchant: 'KB Pay 무신사', amount: 10_000 });
    const got = applyDiscounts(rule, T0, [t]);
    expect(countedSpendingOf(t, got.byTxId['a'], rule)).toBe(0);
  });

  it('할인액만 제외라면 두 할인을 모두 뺀다', () => {
    const rule = card({
      id: 'd',
      rounding: 'floor1',
      benefits: [
        benefit({ id: 'x', excludeFromSpending: 'discountOnly', monthlyCapByTier: { '0': 100_000 } }),
        benefit({ id: 'y', excludeFromSpending: 'discountOnly', stackable: true, discount: { type: 'rate', rate: 0.05 }, monthlyCapByTier: { '0': 100_000 } }),
      ],
    });
    const t = tx({ id: 'a', amount: 10_000 });
    // 10,000 − (1,000 + 500)
    expect(countedSpendingOf(t, applyDiscounts(rule, T0, [t]).byTxId['a'], rule)).toBe(8_500);
  });
});

describe('parseCardRule — 선택지·중복', () => {
  function raw(over: Record<string, unknown> = {}, benefitOver: Record<string, unknown> = {}) {
    return {
      id: 'need',
      name: 'NEED',
      issuer: 'KB국민카드',
      annualFee: 19_000,
      rounding: 'floor1',
      tiers: [{ min: 0 }],
      spendingExclusions: [],
      choices: [
        { id: 'pay', label: '간편결제', options: [{ id: 'kb', label: 'KB Pay' }, { id: 'naver', label: '네이버페이' }] },
      ],
      benefits: [
        {
          id: 'kb',
          label: 'KB Pay 15%',
          match: { merchants: ['KB Pay'] },
          discount: { type: 'rate', rate: 0.15 },
          monthlyCapByTier: { '0': 3_000 },
          excludeFromSpending: 'full',
          choice: { group: 'pay', option: 'kb' },
          ...benefitOver,
        },
        {
          id: 'naver',
          label: '네이버페이 10%',
          match: { merchants: ['네이버페이'] },
          discount: { type: 'rate', rate: 0.1 },
          monthlyCapByTier: { '0': 2_000 },
          excludeFromSpending: 'full',
          choice: { group: 'pay', option: 'naver' },
          stackable: false,
        },
      ],
      ...over,
    };
  }
  const issues = (value: unknown) => {
    const result = parseCardRule(value);
    return result.ok ? [] : result.issues.map((i) => i.path);
  };

  it('선택지와 stackable을 받는다', () => {
    const result = parseCardRule(raw({}, { stackable: true }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.card.choices?.[0]?.options.map((o) => o.id)).toEqual(['kb', 'naver']);
    expect(result.card.benefits[0]).toMatchObject({ choice: { group: 'pay', option: 'kb' }, stackable: true });
    expect(result.card.benefits[1]?.stackable).toBe(false);
  });

  it('없는 그룹이나 선택지를 가리키면 막는다 — 그 혜택은 어떤 선택으로도 켜지지 않는다', () => {
    expect(issues(raw({}, { choice: { group: 'pays', option: 'kb' } }))).toEqual(['benefits[0].choice']);
    expect(issues(raw({}, { choice: { group: 'pay', option: 'kakao' } }))).toEqual(['benefits[0].choice']);
  });

  it('선택지가 하나뿐인 그룹은 막는다', () => {
    const one = [{ id: 'pay', label: '간편결제', options: [{ id: 'kb', label: 'KB Pay' }] }];
    expect(issues(raw({ choices: one }, {}))).toContain('choices[0].options');
  });

  it('stackable은 참·거짓이어야 한다', () => {
    expect(issues(raw({}, { stackable: 'yes' }))).toEqual(['benefits[0].stackable']);
  });
});
