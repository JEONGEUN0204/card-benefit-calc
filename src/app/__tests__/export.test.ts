import { describe, expect, it } from 'vitest';
import { REST_POOL, allocate } from '../../core/index.js';
import type { Benefit, CardRule } from '../../core/index.js';
import { planCsv, planFilename } from '../export.js';

function benefit(over: Partial<Benefit> & { id: string }): Benefit {
  return {
    label: over.id,
    match: {},
    discount: { type: 'rate', rate: 0.01 },
    monthlyCapByTier: { '0': 100_000 },
    excludeFromSpending: 'none',
    ...over,
  };
}

function card(over: Partial<CardRule> & { id: string }): CardRule {
  return {
    name: over.id,
    issuer: 'TEST',
    annualFee: 0,
    tiers: [{ min: 0 }],
    benefits: [],
    spendingExclusions: [],
    rounding: 'floor1',
    ...over,
  };
}

const cards = [
  card({
    id: 'A',
    name: '가카드',
    annualFee: 12_000,
    benefits: [benefit({ id: 'every' })],
  }),
];

const allocation = allocate({
  cards,
  ceilings: { byKey: { [REST_POOL]: 500_000 }, monthlyBudget: 500_000 },
});

function lines(text: string): string[] {
  return text.split('\r\n');
}

describe('planCsv', () => {
  it('머리글이 처방을 읽는 순서대로다', () => {
    expect(lines(planCsv(cards, allocation))[0]).toBe('카드,항목,월 금액,건수,건당 금액,비고');
  });

  it('줄바꿈은 CRLF다 — 엑셀이 LF만 있으면 한 줄로 읽는다', () => {
    expect(planCsv(cards, allocation)).toContain('\r\n');
  });

  it('금액에 콤마를 넣지 않는다 — 표 계산기가 문자열로 읽는다', () => {
    const text = planCsv(cards, allocation);
    expect(text).toContain('500000');
    expect(text).not.toContain('500,000');
  });

  it('항목 이름을 화면에 적은 말로 바꾼다', () => {
    const text = planCsv(cards, allocation, {
      labels: new Map([[REST_POOL, '나머지 결제']]),
      restPool: REST_POOL,
    });
    expect(text).toContain('나머지 결제');
    expect(text).toContain('할인 없음, 구간을 여는 돈');
  });

  it('카드마다 합계 줄을 넣는다', () => {
    const text = planCsv(cards, allocation);
    // 500,000 × 1% = 5,000
    expect(text).toContain('월 혜택 5000원');
    expect(text).toContain('할인받은 결제도 실적에 남는다');
  });

  it('실적에서 빠지는 카드는 얼마가 빠졌는지 적는다', () => {
    const strict = [
      card({
        id: 'F',
        name: '빠지는카드',
        benefits: [
          benefit({
            id: 'all',
            discount: { type: 'rate', rate: 0.1 },
            monthlyCapByTier: { '0': 100_000 },
            excludeFromSpending: 'full',
          }),
        ],
      }),
    ];
    const result = allocate({
      cards: strict,
      ceilings: { byKey: { [REST_POOL]: 300_000 }, monthlyBudget: 300_000 },
    });
    expect(planCsv(strict, result)).toContain('실적에서 빠져');
  });

  it('쓰지 않는 카드도 한 줄로 남긴다 — 왜 뺐는지가 결과의 일부다', () => {
    const two = [
      card({ id: 'GOOD', name: '좋은카드', benefits: [benefit({ id: 'e' })] }),
      card({
        id: 'BAD',
        name: '비싼카드',
        annualFee: 240_000,
        benefits: [benefit({ id: 'e', monthlyCapByTier: { '0': 1_000 } })],
      }),
    ];
    const result = allocate({
      cards: two,
      ceilings: { byKey: { [REST_POOL]: 500_000 }, monthlyBudget: 500_000 },
    });
    const text = planCsv(two, result);
    expect(text).toContain('비싼카드,쓰지 않음');
    expect(text).toContain('연회비를 내고 얻을 것이 없다');
  });

  it('맨 아래에 연 순이익과 최적 여부를 적는다', () => {
    const text = planCsv(cards, allocation);
    const tail = lines(text).slice(-4);
    expect(tail[0]).toContain('월 혜택');
    expect(tail[1]).toContain('연 혜택');
    expect(tail[2]).toContain('연회비');
    expect(tail[3]).toContain('연 순이익');
    // 5,000 × 12 − 12,000
    expect(tail[3]).toContain('48000');
  });

  it('쉼표가 든 값은 인용부호로 감싼다', () => {
    const text = planCsv(cards, allocation, {
      labels: new Map([[REST_POOL, '가, 나']]),
    });
    expect(text).toContain('"가, 나"');
  });
});

describe('planFilename', () => {
  it('어느 구성인지 파일 이름으로 알 수 있다', () => {
    expect(planFilename(cards, allocation)).toBe('순할인 처방 가카드 월5000원.csv');
  });

  it('쓰는 카드가 없으면 그래도 이름이 나온다', () => {
    const empty = allocate({ cards: [], ceilings: { byKey: {}, monthlyBudget: 0 } });
    expect(planFilename([], empty)).toContain('.csv');
  });
});
