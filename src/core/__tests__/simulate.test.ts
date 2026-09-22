import { describe, expect, it } from 'vitest';
import { simulate } from '../simulate.js';
import { benefit, card, must, tx } from './helpers.js';

const TIERS = [{ min: 0 }, { min: 300_000 }];

/** 카페 10% 할인, 할인받은 건은 실적에서 전액 제외되는 전형적인 카드. */
const CAFE_CARD = card({
  id: 'cafe-card',
  tiers: TIERS,
  benefits: [
    benefit({
      id: 'cafe',
      match: { categories: ['cafe'] },
      discount: { type: 'rate', rate: 0.1 },
      excludeFromSpending: 'full',
      monthlyCapByTier: { '0': 100_000, '300000': 100_000 },
    }),
  ],
});

describe('simulate — 월 분리와 구간 승계', () => {
  it('거래가 없으면 빈 결과다', () => {
    expect(simulate(CAFE_CARD, [])).toEqual([]);
  });

  it('첫 달은 전월 데이터가 없으므로 구간을 가정했다고 표시한다', () => {
    const [jan] = simulate(CAFE_CARD, [tx({ id: 't1', date: '2026-01-10', category: 'mart', amount: 10_000 })]);
    const m = must(jan, '1월');
    expect(m.month).toBe('2026-01');
    expect(m.prevSpending).toBeNull();
    expect(m.tierAssumed).toBe(true);
    expect(m.tier?.min).toBe(0);
  });

  it('첫 달의 전월실적을 알려주면 가정하지 않는다', () => {
    const [jan] = simulate(
      CAFE_CARD,
      [tx({ id: 't1', date: '2026-01-10', category: 'mart', amount: 10_000 })],
      { initialPrevSpending: 500_000 },
    );
    const m = must(jan, '1월');
    expect(m.prevSpending).toBe(500_000);
    expect(m.tierAssumed).toBe(false);
    expect(m.tier?.min).toBe(300_000);
  });

  it('이번 달 실적이 다음 달 구간을 정한다', () => {
    const months = simulate(CAFE_CARD, [
      tx({ id: 'jan', date: '2026-01-10', category: 'mart', amount: 400_000 }),
      tx({ id: 'feb', date: '2026-02-10', category: 'mart', amount: 10_000 }),
    ]);
    const feb = must(months[1], '2월');
    expect(feb.prevSpending).toBe(400_000);
    expect(feb.tier?.min).toBe(300_000);
    expect(feb.tierAssumed).toBe(false);
  });

  it('입력 순서가 뒤섞여도 월을 시간순으로 정렬한다', () => {
    const months = simulate(CAFE_CARD, [
      tx({ id: 'feb', date: '2026-02-10', amount: 10_000 }),
      tx({ id: 'jan', date: '2026-01-10', amount: 10_000 }),
    ]);
    expect(months.map((m) => m.month)).toEqual(['2026-01', '2026-02']);
  });

  it('거래가 없는 달도 실적 0으로 채워 구간 계산을 끊지 않는다', () => {
    const months = simulate(CAFE_CARD, [
      tx({ id: 'jan', date: '2026-01-10', category: 'mart', amount: 400_000 }),
      tx({ id: 'mar', date: '2026-03-10', category: 'mart', amount: 10_000 }),
    ]);
    expect(months.map((m) => m.month)).toEqual(['2026-01', '2026-02', '2026-03']);

    const feb = must(months[1], '2월');
    expect(feb.transactions).toEqual([]);
    expect(feb.countedSpending).toBe(0);

    // 2월에 안 썼으므로 3월은 실적 0 구간으로 떨어진다
    const mar = must(months[2], '3월');
    expect(mar.prevSpending).toBe(0);
    expect(mar.tier?.min).toBe(0);
  });

  it('연말을 넘어가도 월이 이어진다', () => {
    const months = simulate(CAFE_CARD, [
      tx({ id: 'dec', date: '2025-12-10', amount: 10_000 }),
      tx({ id: 'jan', date: '2026-01-10', amount: 10_000 }),
    ]);
    expect(months.map((m) => m.month)).toEqual(['2025-12', '2026-01']);
  });
});

describe('simulate — 실적 제외가 다음 달에 미치는 영향', () => {
  it('할인받은 건이 실적에서 빠져 다음 달 구간이 내려간다', () => {
    const months = simulate(CAFE_CARD, [
      tx({ id: 'cafe', date: '2026-01-05', category: 'cafe', amount: 200_000 }),
      tx({ id: 'mart', date: '2026-01-06', category: 'mart', amount: 200_000 }),
      tx({ id: 'feb', date: '2026-02-05', category: 'mart', amount: 10_000 }),
    ]);

    const jan = must(months[0], '1월');
    expect(jan.totalDiscount).toBe(20_000);
    // 40만원을 썼지만 할인받은 20만원이 통째로 빠져 실적은 20만원
    expect(jan.countedSpending).toBe(200_000);

    const feb = must(months[1], '2월');
    expect(feb.prevSpending).toBe(200_000);
    expect(feb.tier?.min).toBe(0); // 30만원 구간에 못 미친다
  });

  it('월이 바뀌면 할인 한도가 초기화된다', () => {
    const rule = card({
      id: 'c',
      tiers: [{ min: 0 }],
      benefits: [
        benefit({ id: 'b', discount: { type: 'rate', rate: 0.5 }, monthlyCapByTier: { '0': 1_000 } }),
      ],
    });
    const months = simulate(rule, [
      tx({ id: 'jan', date: '2026-01-10', amount: 10_000 }),
      tx({ id: 'feb', date: '2026-02-10', amount: 10_000 }),
    ]);
    expect(must(months[0], '1월').totalDiscount).toBe(1_000);
    expect(must(months[1], '2월').totalDiscount).toBe(1_000);
  });

  it('건별 결과에 실적 기여액과 사유가 함께 담긴다', () => {
    const months = simulate(CAFE_CARD, [
      tx({ id: 'cafe', date: '2026-01-05', category: 'cafe', amount: 10_000 }),
      tx({ id: 'mart', date: '2026-01-06', category: 'mart', amount: 10_000 }),
    ]);
    const jan = must(months[0], '1월');
    const cafe = must(jan.transactions.find((t) => t.txId === 'cafe'), 'cafe');
    expect(cafe.discount).toBe(1_000);
    expect(cafe.reason).toBe('ok');
    expect(cafe.countedSpending).toBe(0);

    const mart = must(jan.transactions.find((t) => t.txId === 'mart'), 'mart');
    expect(mart.reason).toBe('noMatch');
    expect(mart.countedSpending).toBe(10_000);
  });
});
