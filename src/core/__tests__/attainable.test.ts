import { describe, expect, it } from 'vitest';
import { attainableByTier } from '../attainable.js';
import { scopeGroups } from '../scope.js';
import type { SpendCeilings } from '../attainable.js';
import type { CardRule } from '../types.js';
import { benefit, card, must } from './helpers.js';

/*
 * 달성 가능 한도. `maxDiscountByTier`는 한도만 보므로, 횟수·건당최소·건당상한 때문에
 * 도달할 수 없는 숫자도 최대치로 찍는다. 여기가 그 구멍을 메운다.
 *
 * 기대값은 전부 손으로 계산했다. 이 값이 틀리면 "내 소비로는 2만원만 찬다"는 답이
 * 오류 없이 그럴듯하게 틀린 숫자로 나온다.
 */

const CEIL = (byKey: Record<string, number>, monthlyBudget = 10_000_000): SpendCeilings => ({
  byKey,
  monthlyBudget,
});

/** 그 구간의 결과를 꺼낸다. */
function at(rule: CardRule, ceilings: SpendCeilings, tierMin = 0) {
  const rows = attainableByTier(rule, scopeGroups([rule]), ceilings);
  return must(
    rows.find((r) => r.tier.min === tierMin),
    `tier ${tierMin}`,
  );
}

function one(rule: CardRule, ceilings: SpendCeilings, benefitId: string, tierMin = 0) {
  const row = at(rule, ceilings, tierMin);
  return must(
    row.byBenefit.find((b) => b.benefitId === benefitId),
    benefitId,
  );
}

function pick(row: ReturnType<typeof at>, benefitId: string) {
  return must(
    row.byBenefit.find((b) => b.benefitId === benefitId),
    benefitId,
  );
}

describe('attainableByTier — 혜택 하나', () => {
  it('지출이 넉넉하면 혜택별 한도가 상한이다', () => {
    // 50만원 × 10% = 5만원이지만 한도가 1만원 → 1만원. 받으려면 10만원만 쓰면 된다.
    const rule = card({
      id: 'A',
      benefits: [
        benefit({
          id: 'b',
          match: { categories: ['online'] },
          discount: { type: 'rate', rate: 0.1 },
          monthlyCapByTier: { '0': 10_000 },
        }),
      ],
    });
    const b = one(rule, CEIL({ 'c:online': 500_000 }), 'b');
    expect(b.attainable).toBe(10_000);
    expect(b.limitedBy).toBe('cap');
    expect(b.spendNeeded).toBe(100_000);
    expect(b.txCount).toBe(1);
    expect(b.nominalCap).toBe(10_000);
  });

  it('건당 한도가 없으면 한 건으로 월 한도를 채운다 — 규칙에 적힌 그대로', () => {
    // 간편결제 10%, 월 2회, 한도 1.5만. 건당 한도가 규칙에 없으므로 15만원 한 건으로 끝난다.
    // "7.5만원 두 건"은 건당 한도가 있을 때의 이야기다.
    const rule = card({
      id: 'A',
      benefits: [
        benefit({
          id: 'pay',
          match: { merchants: ['네이버페이'] },
          discount: { type: 'rate', rate: 0.1 },
          minTransaction: 10_000,
          countLimit: { period: 'month', max: 2 },
          monthlyCapByTier: { '0': 15_000 },
        }),
      ],
    });
    const b = one(rule, CEIL({ 'm:네이버페이': 1_000_000 }), 'pay');
    expect(b.attainable).toBe(15_000);
    expect(b.spendNeeded).toBe(150_000);
    expect(b.txCount).toBe(1);
    expect(b.limitedBy).toBe('cap');
  });

  it('건당 한도와 횟수가 함께 걸리면 월 한도에 못 닿는다', () => {
    // 10%, 건당 최대 5천원, 월 2회 → 2 × 5,000 = 10,000. 한도 1.5만에 못 닿는다.
    // 건당 5,000원을 받으려면 건당 50,000원, 두 건이면 100,000원.
    const rule = card({
      id: 'A',
      benefits: [
        benefit({
          id: 'b',
          match: { categories: ['online'] },
          discount: { type: 'rate', rate: 0.1 },
          perTransactionCap: 5_000,
          countLimit: { period: 'month', max: 2 },
          monthlyCapByTier: { '0': 15_000 },
        }),
      ],
    });
    const b = one(rule, CEIL({ 'c:online': 1_000_000 }), 'b');
    expect(b.attainable).toBe(10_000);
    expect(b.limitedBy).toBe('count');
    expect(b.spendNeeded).toBe(100_000);
    expect(b.txCount).toBe(2);
  });

  it('내 지출 상한이 묶으면 그게 사유다', () => {
    // 이 항목에 5만원밖에 안 쓰면 10%로 5천원이 끝이다.
    const rule = card({
      id: 'A',
      benefits: [
        benefit({
          id: 'b',
          match: { categories: ['online'] },
          discount: { type: 'rate', rate: 0.1 },
          monthlyCapByTier: { '0': 15_000 },
        }),
      ],
    });
    const b = one(rule, CEIL({ 'c:online': 50_000 }), 'b');
    expect(b.attainable).toBe(5_000);
    expect(b.limitedBy).toBe('ceiling');
    expect(b.spendNeeded).toBe(50_000);
  });

  it('건당 최소금액을 못 넘기면 한 푼도 못 받는다', () => {
    const rule = card({
      id: 'A',
      benefits: [
        benefit({
          id: 'b',
          match: { categories: ['online'] },
          discount: { type: 'rate', rate: 0.1 },
          minTransaction: 10_000,
          monthlyCapByTier: { '0': 15_000 },
        }),
      ],
    });
    const b = one(rule, CEIL({ 'c:online': 8_000 }), 'b');
    expect(b.attainable).toBe(0);
    expect(b.limitedBy).toBe('minTransaction');
    expect(b.txCount).toBe(0);
  });

  it('구간이 혜택을 열어 주지 않으면 0이다', () => {
    const rule = card({
      id: 'A',
      tiers: [{ min: 0 }, { min: 400_000 }],
      benefits: [
        benefit({
          id: 'b',
          match: { categories: ['online'] },
          discount: { type: 'rate', rate: 0.1 },
          monthlyCapByTier: { '0': 0, '400000': 20_000 },
        }),
      ],
    });
    const ceilings = CEIL({ 'c:online': 1_000_000 });
    expect(one(rule, ceilings, 'b', 0).limitedBy).toBe('tierLocked');
    expect(one(rule, ceilings, 'b', 400_000).attainable).toBe(20_000);
  });

  it('한도 없는 혜택은 내 지출이 상한이다', () => {
    const rule = card({
      id: 'A',
      benefits: [
        benefit({
          id: 'every',
          match: {},
          discount: { type: 'rate', rate: 0.01 },
          monthlyCapByTier: { '0': null },
        }),
      ],
    });
    const b = one(rule, CEIL({}, 1_000_000), 'every');
    expect(b.nominalCap).toBeNull();
    expect(b.attainable).toBe(10_000);
    expect(b.limitedBy).toBe('ceiling');
  });

  it('정액 할인은 건수가 상한을 정한다', () => {
    // 건당 2,000원, 월 3회, 건당 최소 1만원 → 3건 6,000원. 쓰는 돈은 3만원.
    const rule = card({
      id: 'A',
      benefits: [
        benefit({
          id: 'b',
          match: { categories: ['delivery'] },
          discount: { type: 'amount', amount: 2_000 },
          minTransaction: 10_000,
          countLimit: { period: 'month', max: 3 },
          monthlyCapByTier: { '0': 10_000 },
        }),
      ],
    });
    const b = one(rule, CEIL({ 'c:delivery': 100_000 }), 'b');
    expect(b.attainable).toBe(6_000);
    expect(b.limitedBy).toBe('count');
    expect(b.spendNeeded).toBe(30_000);
    expect(b.txCount).toBe(3);
  });

  it('일 단위 제한은 28일로 환산한다', () => {
    // 일 1회 → 28건. 건당 최대 1,000원 → 28,000원. 건당 1만원씩 28건 = 28만원.
    const rule = card({
      id: 'A',
      benefits: [
        benefit({
          id: 'b',
          match: { categories: ['cafe'] },
          discount: { type: 'rate', rate: 0.1 },
          perTransactionCap: 1_000,
          countLimit: [{ period: 'day', max: 1 }],
          monthlyCapByTier: { '0': 100_000 },
        }),
      ],
    });
    const b = one(rule, CEIL({ 'c:cafe': 10_000_000 }), 'b');
    expect(b.attainable).toBe(28_000);
    expect(b.txCount).toBe(28);
    expect(b.spendNeeded).toBe(280_000);
  });

  it('요일 제한이 일 단위 제한을 줄인다 — 28일에 각 요일은 정확히 4번이다', () => {
    // 토·일만, 일 1회 → 4 × 2 = 8건. 건당 1,000원 → 8,000원.
    const rule = card({
      id: 'A',
      benefits: [
        benefit({
          id: 'b',
          match: { categories: ['cafe'], weekdays: ['sat', 'sun'] },
          discount: { type: 'rate', rate: 0.1 },
          perTransactionCap: 1_000,
          countLimit: [{ period: 'day', max: 1 }],
          monthlyCapByTier: { '0': 100_000 },
        }),
      ],
    });
    const b = one(rule, CEIL({ 'c:cafe': 10_000_000 }), 'b');
    expect(b.attainable).toBe(8_000);
    expect(b.txCount).toBe(8);
  });

  it('일 제한과 월 제한을 함께 적으면 좁은 쪽이 이긴다', () => {
    // 일 1회 → 28건이지만 월 5회가 더 좁다.
    const rule = card({
      id: 'A',
      benefits: [
        benefit({
          id: 'b',
          match: { categories: ['cafe'] },
          discount: { type: 'rate', rate: 0.1 },
          perTransactionCap: 1_000,
          countLimit: [
            { period: 'day', max: 1 },
            { period: 'month', max: 5 },
          ],
          monthlyCapByTier: { '0': 100_000 },
        }),
      ],
    });
    expect(one(rule, CEIL({ 'c:cafe': 10_000_000 }), 'b').attainable).toBe(5_000);
  });

  it('승인시간 조건이 걸린 혜택은 처방에 넣지 않는다', () => {
    const rule = card({
      id: 'A',
      benefits: [
        benefit({
          id: 'night',
          match: { categories: ['mart'], hours: { from: 21, to: 9 } },
          discount: { type: 'rate', rate: 0.1 },
          monthlyCapByTier: { '0': 15_000 },
        }),
      ],
    });
    const b = one(rule, CEIL({ 'c:mart': 1_000_000 }), 'night');
    expect(b.attainable).toBe(0);
    expect(b.limitedBy).toBe('timeGated');
  });

  it('지출 상한을 안 적은 항목은 0으로 본다 — 짐작으로 채우지 않는다', () => {
    const rule = card({
      id: 'A',
      benefits: [
        benefit({
          id: 'b',
          match: { categories: ['online'] },
          discount: { type: 'rate', rate: 0.1 },
          monthlyCapByTier: { '0': 15_000 },
        }),
      ],
    });
    const b = one(rule, CEIL({}), 'b');
    expect(b.attainable).toBe(0);
    expect(b.limitedBy).toBe('ceiling');
  });
});

describe('attainableByTier — 여러 혜택이 겹칠 때', () => {
  it('같은 지출 풀을 나눠 쓰는 두 혜택은 할인율 높은 쪽이 먼저 가져간다', () => {
    // 한 거래에는 혜택 하나만 붙으므로, 온라인 10만원을 15% 혜택에 다 주는 것이 최적이다.
    const rule = card({
      id: 'A',
      benefits: [
        benefit({
          id: 'low',
          match: { categories: ['online'] },
          discount: { type: 'rate', rate: 0.1 },
          monthlyCapByTier: { '0': 15_000 },
        }),
        benefit({
          id: 'high',
          match: { categories: ['online'] },
          discount: { type: 'rate', rate: 0.15 },
          monthlyCapByTier: { '0': 15_000 },
        }),
      ],
    });
    const row = at(rule, CEIL({ 'c:online': 100_000 }));
    expect(pick(row, 'high').attainable).toBe(15_000);
    expect(pick(row, 'low').attainable).toBe(0);
    expect(row.attainable).toBe(15_000);
  });

  it('공동 한도가 두 혜택을 묶는다', () => {
    // 그룹 한도 2만. 15% 혜택이 자기 한도 1.5만을 먼저 채우고, 10% 혜택은 남은 5천만 받는다.
    const rule = card({
      id: 'A',
      capGroups: [{ id: 'g', label: '통합', monthlyCapByTier: { '0': 20_000 } }],
      benefits: [
        benefit({
          id: 'shop',
          match: { categories: ['online'] },
          discount: { type: 'rate', rate: 0.15 },
          capGroup: 'g',
          monthlyCapByTier: { '0': 15_000 },
        }),
        benefit({
          id: 'cafe',
          match: { categories: ['cafe'] },
          discount: { type: 'rate', rate: 0.1 },
          capGroup: 'g',
          monthlyCapByTier: { '0': 15_000 },
        }),
      ],
    });
    const row = at(rule, CEIL({ 'c:online': 200_000, 'c:cafe': 200_000 }));
    expect(pick(row, 'shop').attainable).toBe(15_000);
    expect(pick(row, 'cafe').attainable).toBe(5_000);
    expect(pick(row, 'cafe').limitedBy).toBe('group');
    expect(row.attainable).toBe(20_000);
  });

  it('통합 한도가 카드 전체를 묶는다', () => {
    const rule = card({
      id: 'A',
      totalMonthlyCapByTier: { '0': 10_000 },
      benefits: [
        benefit({
          id: 'a',
          match: { categories: ['online'] },
          discount: { type: 'rate', rate: 0.15 },
          monthlyCapByTier: { '0': 15_000 },
        }),
        benefit({
          id: 'b',
          match: { categories: ['cafe'] },
          discount: { type: 'rate', rate: 0.1 },
          monthlyCapByTier: { '0': 15_000 },
        }),
      ],
    });
    const row = at(rule, CEIL({ 'c:online': 200_000, 'c:cafe': 200_000 }));
    expect(row.attainable).toBe(10_000);
    expect(pick(row, 'b').limitedBy).toBe('total');
  });

  it('월정액은 한도 밖에서 그대로 더한다', () => {
    const rule = card({
      id: 'A',
      monthlyRebateByTier: { '0': 5_000 },
      benefits: [
        benefit({
          id: 'b',
          match: { categories: ['online'] },
          discount: { type: 'rate', rate: 0.1 },
          monthlyCapByTier: { '0': 10_000 },
        }),
      ],
    });
    const row = at(rule, CEIL({ 'c:online': 500_000 }));
    expect(row.rebate).toBe(5_000);
    expect(row.attainable).toBe(15_000);
  });

  it('명목 최대를 나란히 돌려준다 — 둘의 차이가 이 함수의 존재 이유다', () => {
    // 명목: 한도 1.5만. 달성 가능: 월 2회 × 건당 1천원 = 2천원.
    const rule = card({
      id: 'A',
      benefits: [
        benefit({
          id: 'b',
          match: { categories: ['online'] },
          discount: { type: 'rate', rate: 0.1 },
          perTransactionCap: 1_000,
          countLimit: { period: 'month', max: 2 },
          monthlyCapByTier: { '0': 15_000 },
        }),
      ],
    });
    const row = at(rule, CEIL({ 'c:online': 1_000_000 }));
    expect(row.nominal).toBe(15_000);
    expect(row.attainable).toBe(2_000);
  });
});
