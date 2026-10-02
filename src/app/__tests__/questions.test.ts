import { describe, expect, it } from 'vitest';
import { REST_POOL, spendQuestions } from '../../core/index.js';
import type { Benefit, CardRule } from '../../core/index.js';
import { DEFAULT_OPEN_QUESTIONS, orderForDisplay, questionViews } from '../questions.js';

function benefit(over: Partial<Benefit> & { id: string }): Benefit {
  return {
    label: over.id,
    match: {},
    discount: { type: 'rate', rate: 0.1 },
    monthlyCapByTier: { '0': 10_000 },
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
    rounding: 'floor10',
    ...over,
  };
}

function view(cards: CardRule[], pool: string) {
  const views = questionViews(spendQuestions(cards, { budget: 1_000_000 }), cards);
  const found = views.find((v) => v.pool === pool);
  if (found === undefined) throw new Error(`질문이 없다: ${pool}`);
  return found;
}

describe('questionViews', () => {
  it('업종은 한국어 이름으로 적는다', () => {
    const cards = [
      card({
        id: 'A',
        benefits: [benefit({ id: 'b', match: { categories: ['delivery'] } })],
      }),
    ];
    expect(view(cards, 'c:delivery').label).toBe('배달');
  });

  it('업종이 여럿이면 가운뎃점으로 잇는다', () => {
    const cards = [
      card({
        id: 'A',
        benefits: [benefit({ id: 'b', match: { categories: ['cafe', 'restaurant'] } })],
      }),
    ];
    expect(view(cards, 'c:cafe').label).toBe('카페·음식점');
  });

  it('가맹점은 셋까지 적고 나머지는 개수로 줄인다', () => {
    const cards = [
      card({
        id: 'A',
        benefits: [
          benefit({ id: 'b', match: { merchants: ['쿠팡', '11번가', 'G마켓', '옥션', 'SSG'] } }),
        ],
      }),
    ];
    // 정렬은 core가 코드 단위 순서로 한다
    const label = view(cards, 'm:11번가').label;
    expect(label).toContain('등 5곳');
    expect(label.split('·')).toHaveLength(3);
    // 한글 이름을 앞에 둔다 — "DISNEY·MELON·NETFLIX"보다 "쿠팡·옥션"이 빨리 읽힌다.
    expect(label.startsWith('쿠팡') || label.startsWith('옥션')).toBe(true);
  });

  it('가맹점이 셋 이하면 그대로 적는다', () => {
    const cards = [
      card({ id: 'A', benefits: [benefit({ id: 'b', match: { merchants: ['스타벅스'] } })] }),
    ];
    expect(view(cards, 'm:스타벅스').label).toBe('스타벅스');
  });

  it('나머지 결제와 해외 결제는 고정된 이름이다', () => {
    const rest = [card({ id: 'A', benefits: [benefit({ id: 'b', match: {} })] })];
    expect(view(rest, REST_POOL).label).toBe('나머지 결제');

    const overseas = [
      card({ id: 'A', benefits: [benefit({ id: 'os', match: { overseas: true } })] }),
    ];
    expect(view(overseas, 'o:1').label).toBe('해외 결제');
  });

  it('어떤 카드의 어떤 혜택을 부르는 돈인지 적는다', () => {
    const cards = [
      card({
        id: 'POT',
        name: '팟 카드',
        benefits: [
          benefit({
            id: 'shop',
            label: '온라인쇼핑 15% 할인',
            match: { categories: ['online'] },
            discount: { type: 'rate', rate: 0.15 },
            monthlyCapByTier: { '0': 15_000 },
          }),
        ],
      }),
    ];
    expect(view(cards, 'c:online').benefitSummary).toBe('팟 카드 15% (월 15,000원)');
  });

  it('카드가 여럿이면 쉼표로 잇는다', () => {
    const cards = [
      card({
        id: 'A',
        name: '가카드',
        benefits: [
          benefit({
            id: 'b',
            match: { categories: ['online'] },
            discount: { type: 'rate', rate: 0.15 },
            monthlyCapByTier: { '0': 15_000 },
          }),
        ],
      }),
      card({
        id: 'B',
        name: '나카드',
        benefits: [
          benefit({
            id: 'b',
            match: { categories: ['online'] },
            discount: { type: 'rate', rate: 0.07 },
            monthlyCapByTier: { '0': 5_000 },
          }),
        ],
      }),
    ];
    expect(view(cards, 'c:online').benefitSummary).toBe(
      '가카드 15% (월 15,000원), 나카드 7% (월 5,000원)',
    );
  });

  it('한도 없는 혜택은 "한도 없음"으로 적는다', () => {
    const cards = [
      card({
        id: 'A',
        name: '가카드',
        benefits: [
          benefit({
            id: 'b',
            match: { categories: ['online'] },
            discount: { type: 'rate', rate: 0.01 },
            monthlyCapByTier: { '0': null },
          }),
        ],
      }),
    ];
    const v = view(cards, 'c:online');
    // "한도 없음"은 혜택 요약이 이미 말한다. 같은 말을 인주색 주의 문구로 겹쳐 적지 않는다.
    expect(v.benefitSummary).toBe('가카드 1% (한도 없음)');
    expect(v.note).toBeNull();
  });

  it('건당 최소금액을 알려준다', () => {
    const cards = [
      card({
        id: 'A',
        benefits: [
          benefit({ id: 'b', match: { merchants: ['네이버페이'] }, minTransaction: 10_000 }),
        ],
      }),
    ];
    expect(view(cards, 'm:네이버페이').note).toContain('10,000원 이상 결제만');
  });

  it('승인시간 조건이 걸린 항목은 처방에 못 넣는다고 적는다', () => {
    const cards = [
      card({
        id: 'A',
        benefits: [
          benefit({ id: 'night', match: { categories: ['mart'], hours: { from: 21, to: 9 } } }),
        ],
      }),
    ];
    const v = view(cards, 'c:mart');
    expect(v.timeGatedOnly).toBe(true);
    expect(v.note).toContain('승인시간');
  });

  it('주의할 것이 없으면 note가 null이다', () => {
    const cards = [
      card({ id: 'A', benefits: [benefit({ id: 'b', match: { categories: ['online'] } })] }),
    ];
    expect(view(cards, 'c:online').note).toBeNull();
  });

  it('정액 할인은 비율을 적지 않는다 — 환산하면 100%처럼 보인다', () => {
    const cards = [
      card({
        id: 'A',
        name: '가카드',
        benefits: [
          benefit({
            id: 'b',
            label: '건당 2천원 할인',
            match: { categories: ['delivery'] },
            discount: { type: 'amount', amount: 2_000 },
            monthlyCapByTier: { '0': 6_000 },
          }),
        ],
      }),
    ];
    expect(view(cards, 'c:delivery').benefitSummary).toBe('가카드 건당 2천원 할인 (월 6,000원)');
  });
});

describe('orderForDisplay', () => {
  it('나머지 결제를 맨 위로 올린다', () => {
    const cards = [
      card({
        id: 'A',
        benefits: [
          benefit({
            id: 'shop',
            match: { categories: ['online'] },
            monthlyCapByTier: { '0': 15_000 },
          }),
          benefit({ id: 'every', match: {}, monthlyCapByTier: { '0': 1_000 } }),
        ],
      }),
    ];
    const views = questionViews(spendQuestions(cards, { budget: 1_000_000 }), cards);
    expect(orderForDisplay(views)[0]?.pool).toBe(REST_POOL);
    // 나머지는 core가 정한 순서를 지킨다
    expect(orderForDisplay(views).map((v) => v.pool)).toEqual([REST_POOL, 'c:online']);
  });

  it('처음 펼치는 질문 수가 정해져 있다', () => {
    expect(DEFAULT_OPEN_QUESTIONS).toBeGreaterThan(0);
  });
});
