import { describe, expect, it } from 'vitest';
import { applyDiscounts } from '../discount.js';
import { benefit, card, must, tx } from './helpers.js';

const T0 = { min: 0 };

/** 한 건만 넣고 그 결과를 꺼내는 단축 헬퍼. */
function one(rule: Parameters<typeof applyDiscounts>[0], t: ReturnType<typeof tx>) {
  const r = applyDiscounts(rule, T0, [t]);
  return must(r.byTxId[t.id], t.id);
}

describe('applyDiscounts — 할인액 산출', () => {
  it('정률 할인을 절사 규칙에 맞춰 적용한다', () => {
    const rule = card({
      id: 'c',
      rounding: 'floor10',
      benefits: [benefit({ id: 'b', discount: { type: 'rate', rate: 0.2 }, monthlyCapByTier: { '0': 100_000 } })],
    });
    // 3333 * 20% = 666.6 → 10원 단위 절사 → 660
    const got = one(rule, tx({ id: 't1', amount: 3_333 }));
    expect(got.discount).toBe(660);
    expect(got.reason).toBe('ok');
    expect(got.appliedBenefitId).toBe('b');
  });

  it('정액 할인을 적용한다', () => {
    const rule = card({
      id: 'c',
      benefits: [benefit({ id: 'b', discount: { type: 'amount', amount: 1_000 }, monthlyCapByTier: { '0': 100_000 } })],
    });
    expect(one(rule, tx({ id: 't1', amount: 5_000 })).discount).toBe(1_000);
  });

  it('할인액은 결제액을 넘을 수 없다', () => {
    const rule = card({
      id: 'c',
      benefits: [benefit({ id: 'b', discount: { type: 'amount', amount: 1_000 }, monthlyCapByTier: { '0': 100_000 } })],
    });
    expect(one(rule, tx({ id: 't1', amount: 500 })).discount).toBe(500);
  });

  it('절사 결과가 0원이면 할인이 적용되지 않는다', () => {
    const rule = card({
      id: 'c',
      rounding: 'floor10',
      benefits: [benefit({ id: 'b', discount: { type: 'rate', rate: 0.1 }, monthlyCapByTier: { '0': 100_000 } })],
    });
    // 40 * 10% = 4원 → 10원 단위 절사 → 0
    const got = one(rule, tx({ id: 't1', amount: 40 }));
    expect(got.discount).toBe(0);
    expect(got.reason).toBe('roundedToZero');
    expect(got.appliedBenefitId).toBeNull();
  });
});

describe('applyDiscounts — 건당 조건', () => {
  const rule = card({
    id: 'c',
    benefits: [
      benefit({
        id: 'b',
        discount: { type: 'rate', rate: 0.5 },
        minTransaction: 5_000,
        monthlyCapByTier: { '0': 100_000 },
      }),
    ],
  });

  it('건당 최소금액 미달은 할인받지 못한다', () => {
    const got = one(rule, tx({ id: 't1', amount: 4_999 }));
    expect(got.discount).toBe(0);
    expect(got.reason).toBe('belowMin');
  });

  it('약관의 "N원 이상"은 경계를 포함한다', () => {
    const got = one(rule, tx({ id: 't1', amount: 5_000 }));
    expect(got.discount).toBe(2_500);
    expect(got.reason).toBe('ok');
  });

  it('건당 한도를 넘으면 잘리고 그 사실을 남긴다', () => {
    const capped = card({
      id: 'c',
      benefits: [
        benefit({
          id: 'b',
          discount: { type: 'rate', rate: 0.5 },
          perTransactionCap: 1_000,
          monthlyCapByTier: { '0': 100_000 },
        }),
      ],
    });
    const got = one(capped, tx({ id: 't1', amount: 10_000 }));
    expect(got.discount).toBe(1_000);
    expect(got.reason).toBe('ok');
    expect(got.cappedBy).toBe('perTransaction');
  });
});

describe('applyDiscounts — 월 한도', () => {
  const rule = card({
    id: 'c',
    benefits: [
      benefit({ id: 'b', discount: { type: 'rate', rate: 0.5 }, monthlyCapByTier: { '0': 3_000 } }),
    ],
  });

  it('한도를 소진하면 다음 건부터 할인이 없다', () => {
    const r = applyDiscounts(rule, T0, [
      tx({ id: 't1', date: '2026-01-01', amount: 4_000 }), // 2000
      tx({ id: 't2', date: '2026-01-02', amount: 4_000 }), // 남은 1000
      tx({ id: 't3', date: '2026-01-03', amount: 4_000 }), // 0
    ]);
    expect(must(r.byTxId['t1'], 't1').discount).toBe(2_000);

    const t2 = must(r.byTxId['t2'], 't2');
    expect(t2.discount).toBe(1_000);
    expect(t2.reason).toBe('ok');
    expect(t2.cappedBy).toBe('benefit');

    const t3 = must(r.byTxId['t3'], 't3');
    expect(t3.discount).toBe(0);
    expect(t3.reason).toBe('benefitCapReached');

    expect(r.totalDiscount).toBe(3_000);
    expect(r.capUsage['b']).toBe(3_000);
  });

  it('한도가 정확히 딱 맞게 소진되면 잘렸다고 표시하지 않는다', () => {
    const r = applyDiscounts(rule, T0, [tx({ id: 't1', date: '2026-01-01', amount: 6_000 })]);
    const t1 = must(r.byTxId['t1'], 't1');
    expect(t1.discount).toBe(3_000);
    expect(t1.cappedBy).toBeUndefined();
  });

  it('입력 순서가 뒤섞여도 날짜순으로 한도를 소진한다', () => {
    const r = applyDiscounts(rule, T0, [
      tx({ id: 'late', date: '2026-01-20', amount: 4_000 }),
      tx({ id: 'early', date: '2026-01-02', amount: 4_000 }),
    ]);
    expect(must(r.byTxId['early'], 'early').discount).toBe(2_000);
    expect(must(r.byTxId['late'], 'late').discount).toBe(1_000);
  });
});

describe('applyDiscounts — 통합 한도', () => {
  const rule = card({
    id: 'c',
    totalMonthlyCapByTier: { '0': 5_000 },
    benefits: [
      benefit({
        id: 'cafe',
        match: { categories: ['cafe'] },
        discount: { type: 'rate', rate: 0.5 },
        monthlyCapByTier: { '0': 10_000 },
      }),
      benefit({
        id: 'mart',
        match: { categories: ['mart'] },
        discount: { type: 'rate', rate: 0.5 },
        monthlyCapByTier: { '0': 10_000 },
      }),
    ],
  });

  it('혜택별 한도가 남아도 통합 한도에서 잘린다', () => {
    const r = applyDiscounts(rule, T0, [
      tx({ id: 't1', date: '2026-01-01', category: 'cafe', amount: 8_000 }), // 4000
      tx({ id: 't2', date: '2026-01-02', category: 'mart', amount: 8_000 }), // 남은 1000
      tx({ id: 't3', date: '2026-01-03', category: 'mart', amount: 8_000 }), // 0
    ]);
    expect(must(r.byTxId['t1'], 't1').discount).toBe(4_000);

    const t2 = must(r.byTxId['t2'], 't2');
    expect(t2.discount).toBe(1_000);
    expect(t2.cappedBy).toBe('total');

    expect(must(r.byTxId['t3'], 't3').reason).toBe('totalCapReached');
    expect(r.totalCapUsed).toBe(5_000);
  });
});

describe('applyDiscounts — 횟수 제한', () => {
  it('월 횟수를 넘으면 할인받지 못한다', () => {
    const rule = card({
      id: 'c',
      benefits: [
        benefit({
          id: 'b',
          discount: { type: 'amount', amount: 1_000 },
          countLimit: { period: 'month', max: 2 },
          monthlyCapByTier: { '0': 100_000 },
        }),
      ],
    });
    const r = applyDiscounts(rule, T0, [
      tx({ id: 't1', date: '2026-01-01', amount: 10_000 }),
      tx({ id: 't2', date: '2026-01-02', amount: 10_000 }),
      tx({ id: 't3', date: '2026-01-03', amount: 10_000 }),
    ]);
    expect(must(r.byTxId['t2'], 't2').reason).toBe('ok');
    expect(must(r.byTxId['t3'], 't3').reason).toBe('countLimit');
  });

  it('일 횟수 제한은 날짜가 바뀌면 초기화된다', () => {
    const rule = card({
      id: 'c',
      benefits: [
        benefit({
          id: 'b',
          discount: { type: 'amount', amount: 1_000 },
          countLimit: { period: 'day', max: 1 },
          monthlyCapByTier: { '0': 100_000 },
        }),
      ],
    });
    const r = applyDiscounts(rule, T0, [
      tx({ id: 't1', date: '2026-01-01', amount: 10_000 }),
      tx({ id: 't2', date: '2026-01-01', amount: 10_000 }),
      tx({ id: 't3', date: '2026-01-02', amount: 10_000 }),
    ]);
    expect(must(r.byTxId['t1'], 't1').reason).toBe('ok');
    expect(must(r.byTxId['t2'], 't2').reason).toBe('countLimit');
    expect(must(r.byTxId['t3'], 't3').reason).toBe('ok');
  });

  it('할인이 0원인 건은 횟수를 소모하지 않는다', () => {
    const rule = card({
      id: 'c',
      benefits: [
        benefit({
          id: 'b',
          discount: { type: 'amount', amount: 1_000 },
          minTransaction: 5_000,
          countLimit: { period: 'month', max: 1 },
          monthlyCapByTier: { '0': 100_000 },
        }),
      ],
    });
    const r = applyDiscounts(rule, T0, [
      tx({ id: 'small', date: '2026-01-01', amount: 1_000 }),
      tx({ id: 'big', date: '2026-01-02', amount: 10_000 }),
    ]);
    expect(must(r.byTxId['small'], 'small').reason).toBe('belowMin');
    expect(must(r.byTxId['big'], 'big').reason).toBe('ok');
  });
});

describe('applyDiscounts — 구간과 매칭', () => {
  it('해당 구간 한도가 0인 혜택은 잠겨 있다', () => {
    const rule = card({
      id: 'c',
      tiers: [{ min: 0 }, { min: 300_000 }],
      benefits: [benefit({ id: 'b', monthlyCapByTier: { '0': 0, '300000': 5_000 } })],
    });
    expect(one(rule, tx({ id: 't1', amount: 10_000 })).reason).toBe('tierLocked');

    const r = applyDiscounts(rule, { min: 300_000 }, [tx({ id: 't1', amount: 10_000 })]);
    expect(must(r.byTxId['t1'], 't1').reason).toBe('ok');
  });

  it('구간이 null이면 모든 혜택이 잠긴다', () => {
    const rule = card({ id: 'c', benefits: [benefit({ id: 'b' })] });
    const r = applyDiscounts(rule, null, [tx({ id: 't1', amount: 10_000 })]);
    expect(must(r.byTxId['t1'], 't1').reason).toBe('tierLocked');
  });

  it('매칭되는 혜택이 없으면 noMatch다', () => {
    const rule = card({ id: 'c', benefits: [benefit({ id: 'b', match: { categories: ['taxi'] } })] });
    expect(one(rule, tx({ id: 't1', category: 'cafe' })).reason).toBe('noMatch');
  });

  it('혜택이 하나도 없는 카드도 noMatch다', () => {
    expect(one(card({ id: 'c' }), tx({ id: 't1' })).reason).toBe('noMatch');
  });
});

describe('applyDiscounts — 혜택 선택', () => {
  it('한 건에는 우선순위가 높은 혜택 하나만 적용된다', () => {
    const rule = card({
      id: 'c',
      benefits: [
        benefit({ id: 'small', discount: { type: 'amount', amount: 500 }, priority: 9, monthlyCapByTier: { '0': 100_000 } }),
        benefit({ id: 'big', discount: { type: 'amount', amount: 3_000 }, priority: 1, monthlyCapByTier: { '0': 100_000 } }),
      ],
    });
    const got = one(rule, tx({ id: 't1', amount: 10_000 }));
    expect(got.appliedBenefitId).toBe('small');
    expect(got.discount).toBe(500);
  });

  it('우선순위가 같으면 할인액이 큰 혜택을 쓴다', () => {
    const rule = card({
      id: 'c',
      benefits: [
        benefit({ id: 'small', discount: { type: 'amount', amount: 500 }, monthlyCapByTier: { '0': 100_000 } }),
        benefit({ id: 'big', discount: { type: 'amount', amount: 3_000 }, monthlyCapByTier: { '0': 100_000 } }),
      ],
    });
    expect(one(rule, tx({ id: 't1', amount: 10_000 })).appliedBenefitId).toBe('big');
  });

  it('우선순위가 높은 혜택이 막히면 다음 혜택으로 넘어간다', () => {
    const rule = card({
      id: 'c',
      benefits: [
        benefit({ id: 'locked', discount: { type: 'amount', amount: 3_000 }, priority: 9, monthlyCapByTier: { '0': 0 } }),
        benefit({ id: 'open', discount: { type: 'amount', amount: 500 }, monthlyCapByTier: { '0': 100_000 } }),
      ],
    });
    const got = one(rule, tx({ id: 't1', amount: 10_000 }));
    expect(got.appliedBenefitId).toBe('open');
    expect(got.discount).toBe(500);
  });

  it('모든 혜택이 막히면 우선순위가 가장 높은 혜택의 사유를 보고한다', () => {
    const rule = card({
      id: 'c',
      benefits: [
        benefit({ id: 'hi', priority: 9, minTransaction: 50_000, monthlyCapByTier: { '0': 100_000 } }),
        benefit({ id: 'lo', priority: 1, monthlyCapByTier: { '0': 0 } }),
      ],
    });
    expect(one(rule, tx({ id: 't1', amount: 10_000 })).reason).toBe('belowMin');
  });
});
