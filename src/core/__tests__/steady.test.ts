import { describe, expect, it } from 'vitest';
import { steadyStateFor } from '../steady.js';
import type { Transaction } from '../types.js';
import { benefit, card, must, tx } from './helpers.js';

/*
 * 정상상태 — 매달 같은 배분을 반복했을 때 전월실적이 스스로를 재생산하는 상태.
 *
 * 고정점 반복으로 풀지 않는다. 할인을 많이 받는 구간일수록 `excludeFromSpending: 'full'`
 * 때문에 실적이 줄어들어, 구간 자기사상이 **비증가**가 된다. 비증가 사상은 고정점이 아예
 * 없을 수 있고, 그러면 "몇 번 반복하고 끊을까"를 정하는 순간 둘 중 아무 값이나 찍는다.
 *
 * 대신 구간마다 한 번씩만 평가해 자기사상을 만들고(카드당 구간 수 + 1회) 사이클을 찾는다.
 * 유한하고 정확하며 발산이 없다.
 */
describe('steadyStateFor', () => {
  it('수렴하는 카드는 사이클 길이가 1이다', () => {
    // 전 가맹점 1%, 한도 없음, 실적 제외 없음 → 실적이 결제액과 같아 구간이 흔들리지 않는다.
    const rule = card({
      id: 'A',
      tiers: [{ min: 0 }, { min: 500_000 }],
      benefits: [
        benefit({
          id: 'every',
          match: {},
          discount: { type: 'rate', rate: 0.01 },
          monthlyCapByTier: { '0': 0, '500000': null },
          excludeFromSpending: 'none',
        }),
      ],
      rounding: 'floor1',
    });
    const txs: Transaction[] = [tx({ id: 't1', amount: 600_000 })];
    const steady = steadyStateFor(rule, txs);
    expect(steady.cycle).toHaveLength(1);
    expect(steady.oscillates).toBe(false);
    expect(must(steady.cycle[0], 'tier')?.min).toBe(500_000);
    // 600,000 × 1% = 6,000
    expect(steady.monthlyDiscount).toBe(6_000);
    expect(steady.monthlySpending).toBe(600_000);
  });

  it('실적이 모자라 구간이 안 열리면 사이클이 0 구간에 머문다', () => {
    const rule = card({
      id: 'A',
      tiers: [{ min: 0 }, { min: 500_000 }],
      benefits: [
        benefit({
          id: 'every',
          match: {},
          discount: { type: 'rate', rate: 0.01 },
          monthlyCapByTier: { '0': 0, '500000': null },
          excludeFromSpending: 'none',
        }),
      ],
      rounding: 'floor1',
    });
    const steady = steadyStateFor(rule, [tx({ id: 't1', amount: 100_000 })]);
    expect(steady.cycle).toHaveLength(1);
    expect(must(steady.cycle[0], 'tier')?.min).toBe(0);
    expect(steady.monthlyDiscount).toBe(0);
  });

  it('할인받은 건이 실적에서 빠져 구간이 왕복하면 사이클 길이가 2다', () => {
    /*
     * 손으로 만든 진동. 구간 0에서는 혜택이 잠겨 할인 0 → 실적 600,000 → 다음 달 500,000 구간.
     * 구간 500,000에서는 전액 할인 대상이 되어 그 건이 실적에서 통째로 빠진다
     * → 실적 100,000 → 다음 달 0 구간. 0 ↔ 500,000을 영원히 왕복한다.
     */
    const rule = card({
      id: 'A',
      tiers: [{ min: 0 }, { min: 500_000 }],
      benefits: [
        benefit({
          id: 'shop',
          match: { categories: ['online'] },
          discount: { type: 'rate', rate: 0.1 },
          monthlyCapByTier: { '0': 0, '500000': 50_000 },
          excludeFromSpending: 'full',
        }),
      ],
      rounding: 'floor1',
    });
    const txs: Transaction[] = [
      tx({ id: 'big', amount: 500_000, category: 'online', merchant: '쿠팡' }),
      tx({ id: 'etc', amount: 100_000, category: 'etc' }),
    ];
    const steady = steadyStateFor(rule, txs);
    expect(steady.oscillates).toBe(true);
    expect(steady.cycle).toHaveLength(2);
    expect(steady.cycle.map((t) => t?.min ?? null).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
      0, 500_000,
    ]);
    // 한 달은 0원, 한 달은 500,000 × 10% = 50,000 → 사이클 평균 25,000
    expect(steady.monthlyDiscount).toBe(25_000);
    // 실적은 600,000과 100,000을 왕복 → 평균 350,000
    expect(steady.monthlySpending).toBe(350_000);
  });

  it('구간마다 한 번씩만 평가한 자기사상을 함께 돌려준다', () => {
    const rule = card({
      id: 'A',
      tiers: [{ min: 0 }, { min: 500_000 }],
      benefits: [
        benefit({
          id: 'shop',
          match: { categories: ['online'] },
          discount: { type: 'rate', rate: 0.1 },
          monthlyCapByTier: { '0': 0, '500000': 50_000 },
          excludeFromSpending: 'full',
        }),
      ],
      rounding: 'floor1',
    });
    const txs: Transaction[] = [
      tx({ id: 'big', amount: 500_000, category: 'online', merchant: '쿠팡' }),
      tx({ id: 'etc', amount: 100_000, category: 'etc' }),
    ];
    const steady = steadyStateFor(rule, txs);
    // null(실적 미달) + 구간 2개
    expect(steady.byTier).toHaveLength(3);
    const at0 = must(
      steady.byTier.find((r) => r.tier?.min === 0),
      '0 구간',
    );
    expect(at0.discount).toBe(0);
    expect(at0.spending).toBe(600_000);
    expect(at0.next?.min).toBe(500_000);

    const at500 = must(
      steady.byTier.find((r) => r.tier?.min === 500_000),
      '500,000 구간',
    );
    expect(at500.discount).toBe(50_000);
    expect(at500.spending).toBe(100_000);
    expect(at500.next?.min).toBe(0);
  });

  it('월정액은 사이클 평균 할인에 들어간다', () => {
    const rule = card({
      id: 'A',
      tiers: [{ min: 0 }, { min: 500_000 }],
      monthlyRebateByTier: { '0': 0, '500000': 5_000 },
      benefits: [
        benefit({
          id: 'every',
          match: {},
          discount: { type: 'rate', rate: 0.01 },
          monthlyCapByTier: { '0': 0, '500000': null },
          excludeFromSpending: 'none',
        }),
      ],
      rounding: 'floor1',
    });
    const steady = steadyStateFor(rule, [tx({ id: 't1', amount: 600_000 })]);
    // 6,000 + 월정액 5,000
    expect(steady.monthlyDiscount).toBe(11_000);
  });

  it('거래가 없으면 실적 0이고 할인도 0이다', () => {
    const rule = card({
      id: 'A',
      tiers: [{ min: 0 }],
      benefits: [benefit({ id: 'b', match: {}, monthlyCapByTier: { '0': 10_000 } })],
    });
    const steady = steadyStateFor(rule, []);
    expect(steady.monthlyDiscount).toBe(0);
    expect(steady.monthlySpending).toBe(0);
    expect(steady.cycle).toHaveLength(1);
  });

  it('출발 구간을 지정하면 거기서 사이클까지 가는 길을 남긴다', () => {
    const rule = card({
      id: 'A',
      tiers: [{ min: 0 }, { min: 500_000 }],
      benefits: [
        benefit({
          id: 'shop',
          match: { categories: ['online'] },
          discount: { type: 'rate', rate: 0.1 },
          monthlyCapByTier: { '0': 0, '500000': 50_000 },
          excludeFromSpending: 'full',
        }),
      ],
      rounding: 'floor1',
    });
    const txs: Transaction[] = [
      tx({ id: 'big', amount: 500_000, category: 'online', merchant: '쿠팡' }),
      tx({ id: 'etc', amount: 100_000, category: 'etc' }),
    ];
    // 실적 미달(null)에서 출발하면 할인 0 → 실적 600,000 → 500,000 구간으로 들어간다.
    const steady = steadyStateFor(rule, txs, { startTier: null });
    expect(steady.approach.map((t) => t?.min ?? null)).toEqual([null]);
    expect(steady.cycle).toHaveLength(2);
  });

  it('실적 제외가 없는 카드는 진동할 수 없다', () => {
    /*
     * 전 혜택이 `excludeFromSpending: 'none'`이면 실적이 구간과 무관하게 결제액과 같다.
     * 그러면 구간 사상이 상수함수가 되고, 상수함수는 반드시 고정점을 가진다.
     *
     * 실제로 번들된 다섯 장 중 EVERY 1과 Mr.Life가 이 경우이고, 배분을 76개 훑어도
     * 한 번도 진동하지 않았다. 진동한 셋(토스 삼성·NEED Pay·삼성 iD)은 모두 'full'
     * 혜택을 가지고 있다. 화면이 "이 카드는 달마다 할인액이 왕복한다"를 적어야 하는지는
     * 이 성질로 갈린다.
     */
    const rule = card({
      id: 'A',
      tiers: [{ min: 0 }, { min: 300_000 }, { min: 500_000 }],
      benefits: [
        benefit({
          id: 'shop',
          match: { categories: ['online'] },
          discount: { type: 'rate', rate: 0.1 },
          monthlyCapByTier: { '0': 0, '300000': 20_000, '500000': 50_000 },
          excludeFromSpending: 'none',
        }),
      ],
      rounding: 'floor1',
    });
    // 구간이 갈리는 금액들로 훑는다.
    for (const amount of [100_000, 299_999, 300_000, 400_000, 499_999, 500_000, 900_000]) {
      const steady = steadyStateFor(rule, [
        tx({ id: 'big', amount, category: 'online', merchant: '쿠팡' }),
      ]);
      expect(steady.oscillates, `${amount}원에서 진동`).toBe(false);
      expect(steady.cycle).toHaveLength(1);
    }
  });

  it('실적이 전액 빠지는 혜택이 있으면 진동할 수 있다', () => {
    // 같은 구간표에 excludeFromSpending만 'full'로 바꾸면 진동이 나타난다.
    const rule = card({
      id: 'A',
      tiers: [{ min: 0 }, { min: 300_000 }],
      benefits: [
        benefit({
          id: 'shop',
          match: { categories: ['online'] },
          discount: { type: 'rate', rate: 0.1 },
          monthlyCapByTier: { '0': 0, '300000': 50_000 },
          excludeFromSpending: 'full',
        }),
      ],
      rounding: 'floor1',
    });
    const steady = steadyStateFor(rule, [
      tx({ id: 'big', amount: 400_000, category: 'online', merchant: '쿠팡' }),
    ]);
    // 0 구간: 할인 0 → 실적 400,000 → 300,000 구간.
    // 300,000 구간: 40,000 할인에 그 건이 전액 제외 → 실적 0 → 0 구간.
    expect(steady.oscillates).toBe(true);
    expect(steady.cycle.map((t) => t?.min ?? null).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
      0, 300_000,
    ]);
    expect(steady.monthlyDiscount).toBe(20_000);
  });

  it('같은 입력에 항상 같은 답을 낸다', () => {
    const rule = card({
      id: 'A',
      tiers: [{ min: 0 }, { min: 300_000 }, { min: 500_000 }],
      benefits: [
        benefit({
          id: 'shop',
          match: { categories: ['online'] },
          discount: { type: 'rate', rate: 0.1 },
          monthlyCapByTier: { '0': 0, '300000': 20_000, '500000': 50_000 },
          excludeFromSpending: 'full',
        }),
      ],
      rounding: 'floor1',
    });
    const txs: Transaction[] = [
      tx({ id: 'big', amount: 400_000, category: 'online', merchant: '쿠팡' }),
      tx({ id: 'etc', amount: 200_000, category: 'etc' }),
    ];
    const a = steadyStateFor(rule, txs);
    const b = steadyStateFor(rule, txs);
    expect(a).toEqual(b);
  });
});
