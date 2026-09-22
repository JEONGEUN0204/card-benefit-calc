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
