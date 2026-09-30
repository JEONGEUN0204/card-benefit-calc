/**
 * 두 겹으로 걸리는 횟수 제한.
 *
 * 토스 신한카드 Mr.Life의 TIME 할인은 "일 1회/월 5회 할인 적용"처럼 제한이 둘이다. 하나만
 * 적으면 어느 쪽을 골라도 과대 계산이 된다 — 월 5회만 적으면 같은 날 세 번 쓴 편의점이 세 건
 * 모두 할인되고, 일 1회만 적으면 한 달에 스무 번 써도 스무 건이 다 할인된다. 둘 다 적을 수
 * 있어야 한다.
 */
import { describe, expect, it } from 'vitest';
import { applyDiscounts } from '../discount.js';
import { benefit, card, must, tx } from './helpers.js';

const tier = { min: 0 };

/** 1,000원씩 할인되도록 10,000원짜리 거래를 쓴다(10%). */
function txOn(id: string, date: string) {
  return tx({ id, date, amount: 10_000 });
}

describe('횟수 제한 둘을 함께 건다', () => {
  const rule = card({
    id: 'c',
    rounding: 'floor1',
    benefits: [
      benefit({
        id: 'time',
        match: {},
        countLimit: [
          { period: 'day', max: 1 },
          { period: 'month', max: 5 },
        ],
        monthlyCapByTier: { '0': 100_000 },
      }),
    ],
  });

  it('같은 날 두 번째 건은 일 제한에 막힌다', () => {
    const got = applyDiscounts(rule, tier, [txOn('a', '2026-01-05'), txOn('b', '2026-01-05')]);
    expect(must(got.byTxId['a'], 'a').discount).toBe(1_000);
    expect(must(got.byTxId['b'], 'b').reason).toBe('countLimit');
  });

  it('날짜가 바뀌면 일 제한은 초기화된다', () => {
    const got = applyDiscounts(rule, tier, [txOn('a', '2026-01-05'), txOn('b', '2026-01-06')]);
    expect(must(got.byTxId['b'], 'b').discount).toBe(1_000);
  });

  it('날짜가 달라도 여섯 번째 건은 월 제한에 막힌다', () => {
    const days = ['01', '02', '03', '04', '05', '06'];
    const got = applyDiscounts(
      rule,
      tier,
      days.map((d, i) => txOn(`t${i}`, `2026-01-${d}`)),
    );
    expect(must(got.byTxId['t4'], 't4').discount).toBe(1_000);
    expect(must(got.byTxId['t5'], 't5').reason).toBe('countLimit');
    expect(got.totalDiscount).toBe(5_000);
  });

  it('할인이 0원인 건은 어느 제한도 쓰지 않는다', () => {
    const got = applyDiscounts(rule, tier, [
      tx({ id: 'zero', date: '2026-01-05', amount: 5 }), // 10% = 0.5 → 절사 후 0원
      txOn('real', '2026-01-05'),
    ]);
    expect(must(got.byTxId['zero'], 'zero').discount).toBe(0);
    expect(must(got.byTxId['real'], 'real').discount).toBe(1_000);
  });
});

describe('제한 하나만 적는 기존 표기도 그대로 돈다', () => {
  it('객체 하나를 적으면 그 제한만 걸린다', () => {
    const rule = card({
      id: 'c',
      rounding: 'floor1',
      benefits: [
        benefit({
          id: 'daily',
          match: {},
          countLimit: { period: 'day', max: 1 },
          monthlyCapByTier: { '0': 100_000 },
        }),
      ],
    });
    const got = applyDiscounts(rule, tier, [
      txOn('a', '2026-01-05'),
      txOn('b', '2026-01-05'),
      txOn('c', '2026-01-06'),
    ]);
    expect(must(got.byTxId['b'], 'b').reason).toBe('countLimit');
    expect(must(got.byTxId['c'], 'c').discount).toBe(1_000);
  });
});
