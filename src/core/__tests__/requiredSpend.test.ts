import { describe, expect, it } from 'vitest';
import { requiredSpendFor } from '../requiredSpend.js';
import { benefit, card } from './helpers.js';

const TIERS = [{ min: 0 }, { min: 300_000 }];
const TARGET = { min: 300_000 };

describe('requiredSpendFor — 필요 사용액 역산 (기능 2)', () => {
  it('제외되는 것이 없으면 필요 사용액은 목표 실적과 같다', () => {
    const rule = card({ id: 'c', tiers: TIERS });
    const got = requiredSpendFor(rule, TARGET, { weights: { mart: 1 }, defaultTicket: 10_000 });
    expect(got.requiredTotalSpend).toBe(300_000);
    expect(got.excludedAmount).toBe(0);
  });

  it('할인받은 건이 실적에서 빠지면 그만큼 더 써야 한다', () => {
    const rule = card({
      id: 'c',
      tiers: TIERS,
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
    // 건당 5,000원 → 할인 500원. 한도 10,000원이면 20건까지 할인되고
    // 그 20건(100,000원)이 통째로 실적에서 빠진다. 따라서 30만 + 10만 = 40만원.
    const got = requiredSpendFor(rule, TARGET, { weights: { cafe: 1 }, defaultTicket: 5_000 });
    expect(got.requiredTotalSpend).toBe(400_000);
    expect(got.resultingSpending).toBe(300_000);
    expect(got.excludedAmount).toBe(100_000);
    expect(got.expectedDiscount).toBe(10_000);
  });

  it('기본 제외 항목도 필요 사용액을 늘린다', () => {
    const rule = card({
      id: 'c',
      tiers: TIERS,
      spendingExclusions: [{ kind: 'category', values: ['tax'] }],
    });
    // 절반이 세금이면 실적에 잡히는 건 절반뿐이라 두 배를 써야 한다.
    const got = requiredSpendFor(rule, TARGET, {
      weights: { tax: 1, mart: 1 },
      defaultTicket: 10_000,
    });
    expect(got.requiredTotalSpend).toBe(600_000);
    expect(got.excludedAmount).toBe(300_000);
  });

  it('모든 결제가 실적에서 빠지면 도달할 수 없다', () => {
    const rule = card({
      id: 'c',
      tiers: TIERS,
      spendingExclusions: [{ kind: 'category', values: ['tax'] }],
    });
    const got = requiredSpendFor(rule, TARGET, { weights: { tax: 1 }, defaultTicket: 10_000 });
    expect(got.requiredTotalSpend).toBeNull();
  });

  it('카테고리 비중대로 결제액을 나눈다', () => {
    const rule = card({ id: 'c', tiers: TIERS });
    const got = requiredSpendFor(rule, TARGET, {
      weights: { cafe: 1, mart: 3 },
      defaultTicket: 10_000,
    });
    expect(got.breakdown['cafe']).toBe(75_000);
    expect(got.breakdown['mart']).toBe(225_000);
  });

  it('비중 합이 1이 아니어도 정규화해서 쓴다', () => {
    const rule = card({ id: 'c', tiers: TIERS });
    const got = requiredSpendFor(rule, TARGET, {
      weights: { cafe: 20, mart: 60 },
      defaultTicket: 10_000,
    });
    expect(got.breakdown['cafe']).toBe(75_000);
    expect(got.breakdown['mart']).toBe(225_000);
  });

  it('카테고리별 건단가를 따로 줄 수 있다', () => {
    const rule = card({ id: 'c', tiers: TIERS });
    const got = requiredSpendFor(rule, TARGET, {
      weights: { cafe: 1 },
      ticketSize: { cafe: 4_500 },
    });
    expect(got.requiredTotalSpend).toBe(300_000);
  });

  it('목표 구간이 0원이면 아무것도 쓰지 않아도 된다', () => {
    const rule = card({ id: 'c', tiers: TIERS });
    const got = requiredSpendFor(rule, { min: 0 }, { weights: { mart: 1 } });
    expect(got.requiredTotalSpend).toBe(0);
  });

  it('현재 구간에서 혜택이 잠겨 있으면 실적이 빠지지 않아 덜 써도 된다', () => {
    const rule = card({
      id: 'c',
      tiers: TIERS,
      benefits: [
        benefit({
          id: 'cafe',
          match: { categories: ['cafe'] },
          discount: { type: 'rate', rate: 0.1 },
          excludeFromSpending: 'full',
          monthlyCapByTier: { '0': 0, '300000': 10_000 },
        }),
      ],
    });
    const pattern = { weights: { cafe: 1 }, defaultTicket: 5_000 };
    // 지금 0원 구간이라 혜택이 잠겨 있으면 제외될 것도 없다.
    const locked = requiredSpendFor(rule, TARGET, pattern, { currentTier: { min: 0 } });
    expect(locked.requiredTotalSpend).toBe(300_000);

    // 이미 30만원 구간이라 혜택이 열려 있으면 그만큼 더 써야 유지된다.
    const open = requiredSpendFor(rule, TARGET, pattern, { currentTier: TARGET });
    expect(open.requiredTotalSpend).toBe(400_000);
  });
});

describe('requiredSpendFor — 실제 거래 표본을 늘려 쓰기', () => {
  it('가맹점명으로 맞추는 혜택도 걸린다', () => {
    // 업종 비중만으로는 가맹점명이 사라져 "스타벅스" 혜택이 한 건도 붙지 않았다.
    // 표본 5,000원 건을 되풀이하면 10% 할인·한도 1만원 → 20건(10만원)이 빠져 40만원.
    const rule = card({
      id: 'c',
      tiers: TIERS,
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
    const got = requiredSpendFor(rule, TARGET, {
      weights: { cafe: 1 },
      samples: [{ merchant: '스타벅스 강남점', category: 'cafe', amount: 5_000 }],
    });
    expect(got.requiredTotalSpend).toBe(400_000);
    expect(got.resultingSpending).toBe(300_000);
    expect(got.excludedAmount).toBe(100_000);
    expect(got.expectedDiscount).toBe(10_000);
    expect(got.breakdown['cafe']).toBe(400_000);
  });

  it('해외 표시를 그대로 옮기고 표본 순서대로 되풀이한다', () => {
    // 해외 10,000원 → 2% = 200원, 한도 2,000원이면 해외 10건(10만원)이 빠진다.
    // 해외·마트가 번갈아 오므로 40만원이면 실적 30만원이고, 1원 모자라면 마지막 마트 건이
    // 9,999원이 되어 실적이 299,999원이다.
    const rule = card({
      id: 'c',
      tiers: TIERS,
      benefits: [
        benefit({
          id: 'ov',
          match: { overseas: true },
          discount: { type: 'rate', rate: 0.02 },
          excludeFromSpending: 'full',
          monthlyCapByTier: { '0': 2_000, '300000': 2_000 },
        }),
      ],
    });
    const got = requiredSpendFor(rule, TARGET, {
      weights: { shopping: 1, mart: 1 },
      samples: [
        { merchant: 'AMAZON', category: 'shopping', amount: 10_000, overseas: true },
        { merchant: '동네마트', category: 'mart', amount: 10_000 },
      ],
    });
    expect(got.requiredTotalSpend).toBe(400_000);
    expect(got.excludedAmount).toBe(100_000);
    expect(got.expectedDiscount).toBe(2_000);
    expect(got.breakdown).toEqual({ shopping: 200_000, mart: 200_000 });
  });

  it('결제유형을 그대로 옮긴다', () => {
    // 무이자할부가 실적에서 빠지는 카드. 표본의 절반이 무이자할부면 두 배를 써야 한다.
    const rule = card({
      id: 'c',
      tiers: TIERS,
      spendingExclusions: [{ kind: 'paymentType', values: ['interestFreeInstallment'] }],
    });
    const got = requiredSpendFor(rule, TARGET, {
      weights: { mart: 1 },
      samples: [
        { merchant: '가전', category: 'mart', amount: 10_000, paymentType: 'interestFreeInstallment' },
        { merchant: '마트', category: 'mart', amount: 10_000 },
      ],
    });
    expect(got.requiredTotalSpend).toBe(600_000);
    expect(got.excludedAmount).toBe(300_000);
  });
});
