import { describe, expect, it } from 'vitest';
import { applyDiscounts } from '../discount.js';
import { calcSpending, isExcludedFromSpending } from '../spending.js';
import { benefit, card, must, tx } from './helpers.js';

const T0 = { min: 0 };

/** 할인을 적용한 뒤 그 건의 실적 기여액을 꺼낸다. */
function spendingOf(rule: Parameters<typeof applyDiscounts>[0], t: ReturnType<typeof tx>) {
  const d = applyDiscounts(rule, T0, [t]);
  return must(calcSpending(rule, [t], d).byTxId[t.id], t.id);
}

describe('isExcludedFromSpending — 기본 제외 항목', () => {
  it('카테고리로 제외한다', () => {
    const rule = card({ id: 'c', spendingExclusions: [{ kind: 'category', values: ['tax', 'giftCard'] }] });
    expect(isExcludedFromSpending(tx({ id: 't1', category: 'tax' }), rule)).toBe(true);
    expect(isExcludedFromSpending(tx({ id: 't2', category: 'cafe' }), rule)).toBe(false);
  });

  it('가맹점명 부분일치로 제외한다', () => {
    const rule = card({ id: 'c', spendingExclusions: [{ kind: 'merchant', values: ['상품권'] }] });
    expect(isExcludedFromSpending(tx({ id: 't1', merchant: '한국상품권판매점' }), rule)).toBe(true);
    expect(isExcludedFromSpending(tx({ id: 't2', merchant: '편의점' }), rule)).toBe(false);
  });

  it('결제유형으로 제외한다', () => {
    const rule = card({
      id: 'c',
      spendingExclusions: [{ kind: 'paymentType', values: ['interestFreeInstallment'] }],
    });
    expect(isExcludedFromSpending(tx({ id: 't1', paymentType: 'interestFreeInstallment' }), rule)).toBe(true);
    expect(isExcludedFromSpending(tx({ id: 't2', paymentType: 'lump' }), rule)).toBe(false);
  });

  it('결제유형을 적지 않은 거래는 일시불로 본다', () => {
    const rule = card({ id: 'c', spendingExclusions: [{ kind: 'paymentType', values: ['lump'] }] });
    expect(isExcludedFromSpending(tx({ id: 't1' }), rule)).toBe(true);
  });

  it('제외 규칙이 없으면 아무것도 빠지지 않는다', () => {
    expect(isExcludedFromSpending(tx({ id: 't1', category: 'tax' }), card({ id: 'c' }))).toBe(false);
  });
});

describe('calcSpending — 할인받은 건의 실적 처리', () => {
  function ruleWithMode(mode: 'full' | 'discountOnly' | 'none') {
    return card({
      id: 'c',
      benefits: [
        benefit({
          id: 'b',
          discount: { type: 'rate', rate: 0.1 },
          excludeFromSpending: mode,
          monthlyCapByTier: { '0': 100_000 },
        }),
      ],
    });
  }

  it("full은 할인받은 건의 결제액 전체를 실적에서 뺀다", () => {
    expect(spendingOf(ruleWithMode('full'), tx({ id: 't1', amount: 10_000 }))).toBe(0);
  });

  it('discountOnly는 할인액만 뺀다', () => {
    // 10000원 결제, 10% 할인 1000원 → 실적 9000원
    expect(spendingOf(ruleWithMode('discountOnly'), tx({ id: 't1', amount: 10_000 }))).toBe(9_000);
  });

  it('none은 할인을 받아도 결제액 전체가 실적이다', () => {
    expect(spendingOf(ruleWithMode('none'), tx({ id: 't1', amount: 10_000 }))).toBe(10_000);
  });

  it('할인을 못 받은 건은 제외 방식과 무관하게 전액 실적이다', () => {
    const rule = card({
      id: 'c',
      benefits: [
        benefit({
          id: 'b',
          match: { categories: ['cafe'] },
          excludeFromSpending: 'full',
          monthlyCapByTier: { '0': 100_000 },
        }),
      ],
    });
    expect(spendingOf(rule, tx({ id: 't1', category: 'mart', amount: 10_000 }))).toBe(10_000);
  });

  it('한도에 걸려 할인이 0원이 된 건도 실적에 전액 들어간다', () => {
    const rule = card({
      id: 'c',
      benefits: [
        benefit({
          id: 'b',
          discount: { type: 'rate', rate: 0.5 },
          excludeFromSpending: 'full',
          monthlyCapByTier: { '0': 1_000 },
        }),
      ],
    });
    const txs = [
      tx({ id: 't1', date: '2026-01-01', amount: 10_000 }), // 한도 1000 소진
      tx({ id: 't2', date: '2026-01-02', amount: 10_000 }), // 할인 0원
    ];
    const s = calcSpending(rule, txs, applyDiscounts(rule, T0, txs));
    expect(s.byTxId['t1']).toBe(0);
    expect(s.byTxId['t2']).toBe(10_000);
    expect(s.total).toBe(10_000);
  });

  it('기본 제외 항목은 할인 여부보다 우선한다', () => {
    const rule = card({
      id: 'c',
      spendingExclusions: [{ kind: 'category', values: ['tax'] }],
      benefits: [
        benefit({ id: 'b', excludeFromSpending: 'none', monthlyCapByTier: { '0': 100_000 } }),
      ],
    });
    expect(spendingOf(rule, tx({ id: 't1', category: 'tax', amount: 10_000 }))).toBe(0);
  });

  it('여러 건의 실적을 합산한다', () => {
    const rule = card({
      id: 'c',
      spendingExclusions: [{ kind: 'category', values: ['tax'] }],
      benefits: [
        benefit({
          id: 'b',
          match: { categories: ['cafe'] },
          discount: { type: 'rate', rate: 0.1 },
          excludeFromSpending: 'full',
          monthlyCapByTier: { '0': 100_000 },
        }),
      ],
    });
    const txs = [
      tx({ id: 'cafe', category: 'cafe', amount: 10_000 }), // 할인받음 → 0
      tx({ id: 'tax', category: 'tax', amount: 50_000 }), // 기본 제외 → 0
      tx({ id: 'mart', category: 'mart', amount: 30_000 }), // 전액
    ];
    expect(calcSpending(rule, txs, applyDiscounts(rule, T0, txs)).total).toBe(30_000);
  });
});
