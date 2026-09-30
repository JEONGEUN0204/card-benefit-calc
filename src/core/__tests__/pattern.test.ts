import { describe, expect, it } from 'vitest';
import { patternFromTransactions } from '../pattern.js';
import { requiredSpendFor } from '../requiredSpend.js';
import { benefit, card, tx } from './helpers.js';

describe('patternFromTransactions — 사용내역에서 소비 패턴 뽑기', () => {
  it('카테고리별 결제액이 비중이 되고 평균 결제액이 건단가가 된다', () => {
    const got = patternFromTransactions([
      tx({ id: 'a', category: 'cafe', amount: 5_000 }),
      tx({ id: 'b', category: 'mart', amount: 90_000 }),
      tx({ id: 'c', category: 'cafe', amount: 7_000 }),
    ]);
    expect(got.weights).toEqual({ cafe: 12_000, mart: 90_000 });
    expect(got.ticketSize).toEqual({ cafe: 6_000, mart: 90_000 });
    // 전체 102,000원 / 3건 = 34,000원
    expect(got.defaultTicket).toBe(34_000);
  });

  it('평균 건단가는 정수 원으로 반올림한다', () => {
    // 15,002 / 3 = 5,000.67 → 5,001
    const got = patternFromTransactions([
      tx({ id: 'a', category: 'cafe', amount: 5_000 }),
      tx({ id: 'b', category: 'cafe', amount: 5_001 }),
      tx({ id: 'c', category: 'cafe', amount: 5_001 }),
    ]);
    expect(got.ticketSize).toEqual({ cafe: 5_001 });
    expect(got.defaultTicket).toBe(5_001);
  });

  it('실적에서 빠지는 카테고리도 비중에 남긴다', () => {
    // 세금을 빼버리면 "세금 낸 만큼 더 써야 한다"는 사실이 필요 사용액에서 사라진다.
    const got = patternFromTransactions([
      tx({ id: 'a', category: 'tax', amount: 100_000 }),
      tx({ id: 'b', category: 'mart', amount: 100_000 }),
    ]);
    expect(got.weights).toEqual({ tax: 100_000, mart: 100_000 });
  });

  it('거래가 없으면 비중도 없다', () => {
    expect(patternFromTransactions([])).toEqual({ weights: {} });
  });

  it('뽑은 패턴을 requiredSpendFor에 그대로 넣을 수 있다', () => {
    // 카페 5,000원 건만 쓰는 사람. 10% 할인·월 1만원 한도·할인 건 전액 제외라면
    // 20건(10만원)이 실적에서 빠지므로 30만원 구간을 채우려면 40만원을 써야 한다.
    const rule = card({
      id: 'c',
      tiers: [{ min: 0 }, { min: 300_000 }],
      benefits: [
        benefit({
          id: 'cafe',
          match: { categories: ['cafe'] },
          discount: { type: 'rate', rate: 0.1 },
          excludeFromSpending: 'full',
          monthlyCapByTier: { '0': 10_000, '300000': 10_000 },
        }),
      ],
    });
    const pattern = patternFromTransactions([
      tx({ id: 'a', category: 'cafe', amount: 5_000 }),
      tx({ id: 'b', category: 'cafe', amount: 5_000 }),
    ]);
    const got = requiredSpendFor(rule, { min: 300_000 }, pattern);
    expect(got.requiredTotalSpend).toBe(400_000);
  });
});

describe('patternFromTransactions — 거래 표본', () => {
  it('가맹점명·해외·결제유형을 표본에 남긴다', () => {
    // 혜택이 가맹점명·해외 여부로 붙는 카드가 많아 업종 합계만으로는 할인을 흉내 낼 수 없다.
    const got = patternFromTransactions([
      tx({ id: 'a', category: 'cafe', merchant: '스타벅스', amount: 5_000 }),
      tx({ id: 'b', category: 'shopping', merchant: 'AMAZON', amount: 30_000, overseas: true }),
      tx({ id: 'c', category: 'mart', merchant: '가전', amount: 90_000, paymentType: 'interestFreeInstallment' }),
    ]);
    expect(got.samples).toEqual([
      { merchant: '스타벅스', category: 'cafe', amount: 5_000 },
      { merchant: 'AMAZON', category: 'shopping', amount: 30_000, overseas: true },
      { merchant: '가전', category: 'mart', amount: 90_000, paymentType: 'interestFreeInstallment' },
    ]);
  });

  it('내 명세서로 돌리면 가맹점명 혜택의 실적 제외가 필요 결제액에 잡힌다', () => {
    const rule = card({
      id: 'c',
      tiers: [{ min: 0 }, { min: 300_000 }],
      benefits: [
        benefit({
          id: 'sb',
          match: { merchants: ['스타벅스'] },
          discount: { type: 'rate', rate: 0.1 },
          excludeFromSpending: 'full',
          monthlyCapByTier: { '0': 10_000, '300000': 10_000 },
        }),
      ],
    });
    const pattern = patternFromTransactions([
      tx({ id: 'a', category: 'cafe', merchant: '스타벅스', amount: 5_000 }),
      tx({ id: 'b', category: 'cafe', merchant: '스타벅스', amount: 5_000 }),
    ]);
    const got = requiredSpendFor(rule, { min: 300_000 }, pattern);
    expect(got.requiredTotalSpend).toBe(400_000);
    expect(got.excludedAmount).toBe(100_000);
  });
});
