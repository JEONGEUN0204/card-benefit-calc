import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { spendQuestions } from '../ask.js';
import { parseCardRule } from '../parseCardRule.js';
import { REST_POOL } from '../scope.js';
import type { CardRule } from '../types.js';
import { benefit, card, must } from './helpers.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function realCard(file: string): CardRule {
  const parsed = parseCardRule(
    JSON.parse(readFileSync(join(ROOT, 'fixtures', 'cards', file), 'utf8')),
  );
  if (!parsed.ok) throw new Error(parsed.issues.map((i) => `${i.path}: ${i.message}`).join(', '));
  return parsed.card;
}

function find(questions: ReturnType<typeof spendQuestions>, pool: string) {
  return must(
    questions.find((q) => q.pool === pool),
    pool,
  );
}

/*
 * 무엇을 물을지는 고른 카드의 규칙이 정한다. 사용자가 "카드 정보에 따라 필요한 값만
 * 받도록 하면 좋을듯"이라고 한 자리다.
 *
 * core는 **구조**만 낸다 — 풀 키, 업종·가맹점 목록, 중요도, 그 풀을 쓰는 혜택. 한국어
 * 라벨은 화면이 붙인다. "온라인몰"이라고 부를지 "쇼핑"이라고 부를지는 계산이 아니다.
 */
describe('spendQuestions', () => {
  it('풀마다 질문 하나를 내고 나머지 결제도 포함한다', () => {
    const questions = spendQuestions([
      card({
        id: 'A',
        benefits: [
          benefit({ id: 'shop', match: { categories: ['online'] } }),
          benefit({ id: 'cafe', match: { merchants: ['스타벅스'] } }),
        ],
      }),
    ]);
    expect(questions.map((q) => q.pool).sort()).toEqual(['c:online', 'm:스타벅스', REST_POOL]);
  });

  it('업종·가맹점 목록을 그대로 넘겨 화면이 이름을 지을 수 있게 한다', () => {
    const questions = spendQuestions([
      card({
        id: 'A',
        benefits: [benefit({ id: 'shop', match: { merchants: ['쿠팡', '11번가', 'G마켓'] } })],
      }),
    ]);
    const q = find(questions, 'm:11번가');
    expect(q.kind).toBe('merchant');
    expect(q.merchants).toEqual(['11번가', 'G마켓', '쿠팡']);
    expect(q.categories).toEqual([]);
  });

  it('업종으로 맞추는 혜택은 kind가 category다', () => {
    const questions = spendQuestions([
      card({ id: 'A', benefits: [benefit({ id: 'b', match: { categories: ['delivery'] } })] }),
    ]);
    expect(find(questions, 'c:delivery').kind).toBe('category');
  });

  it('해외 전용 혜택은 kind가 overseas다', () => {
    const questions = spendQuestions([
      card({ id: 'A', benefits: [benefit({ id: 'os', match: { overseas: true } })] }),
    ]);
    expect(find(questions, 'o:1').kind).toBe('overseas');
  });

  it('나머지 결제는 kind가 rest이고 늘 들어 있다', () => {
    const questions = spendQuestions([
      card({ id: 'A', benefits: [benefit({ id: 'b', match: { categories: ['online'] } })] }),
    ]);
    const rest = find(questions, REST_POOL);
    expect(rest.kind).toBe('rest');
    expect(rest.categories).toEqual([]);
    expect(rest.merchants).toEqual([]);
  });

  it('조건 없는 전 가맹점 혜택만 있는 카드는 나머지 결제만 묻는다', () => {
    const questions = spendQuestions([
      card({ id: 'A', benefits: [benefit({ id: 'every', match: {} })] }),
    ]);
    expect(questions.map((q) => q.pool)).toEqual([REST_POOL]);
  });

  it('그 풀을 쓰는 카드와 혜택을 알려준다 — 화면이 "왜 묻는가"를 적는다', () => {
    const questions = spendQuestions([
      card({
        id: 'A',
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
      card({
        id: 'B',
        benefits: [
          benefit({
            id: 'mall',
            label: '온라인몰 7% 할인',
            match: { categories: ['online'] },
            discount: { type: 'rate', rate: 0.07 },
            monthlyCapByTier: { '0': 5_000 },
          }),
        ],
      }),
    ]);
    const q = find(questions, 'c:online');
    expect(q.usedBy).toEqual([
      { cardId: 'A', benefitId: 'shop', label: '온라인쇼핑 15% 할인', rate: 0.15, nominalCap: 15_000 },
      { cardId: 'B', benefitId: 'mall', label: '온라인몰 7% 할인', rate: 0.07, nominalCap: 5_000 },
    ]);
  });

  it('중요도는 그 항목에서 받을 수 있는 최대 할인이고 내림차순으로 정렬한다', () => {
    const questions = spendQuestions(
      [
        card({
          id: 'A',
          benefits: [
            benefit({
              id: 'small',
              match: { categories: ['cafe'] },
              discount: { type: 'rate', rate: 0.1 },
              monthlyCapByTier: { '0': 2_000 },
            }),
            benefit({
              id: 'big',
              match: { categories: ['online'] },
              discount: { type: 'rate', rate: 0.1 },
              monthlyCapByTier: { '0': 15_000 },
            }),
          ],
        }),
      ],
      { budget: 1_000_000 },
    );
    expect(find(questions, 'c:online').impact).toBe(15_000);
    expect(find(questions, 'c:cafe').impact).toBe(2_000);
    // 중요한 것부터. 나머지 결제는 혜택이 없어 0이라 맨 뒤다.
    expect(questions.map((q) => q.pool)).toEqual(['c:online', 'c:cafe', REST_POOL]);
    expect(questions.every((q) => !q.unbounded)).toBe(true);
  });

  it('여러 카드가 같은 풀을 쓰면 가장 많이 받는 카드로 중요도를 잰다', () => {
    const questions = spendQuestions(
      [
        card({
          id: 'LOW',
          benefits: [
            benefit({
              id: 'b',
              match: { categories: ['online'] },
              discount: { type: 'rate', rate: 0.1 },
              monthlyCapByTier: { '0': 3_000 },
            }),
          ],
        }),
        card({
          id: 'HIGH',
          benefits: [
            benefit({
              id: 'b',
              match: { categories: ['online'] },
              discount: { type: 'rate', rate: 0.1 },
              monthlyCapByTier: { '0': 20_000 },
            }),
          ],
        }),
      ],
      { budget: 1_000_000 },
    );
    expect(find(questions, 'c:online').impact).toBe(20_000);
  });

  it('나머지 결제의 중요도는 전 가맹점 혜택이 정한다', () => {
    const questions = spendQuestions(
      [
        card({
          id: 'A',
          benefits: [
            benefit({
              id: 'every',
              match: {},
              discount: { type: 'rate', rate: 0.01 },
              monthlyCapByTier: { '0': null },
              excludeFromSpending: 'none',
            }),
          ],
          rounding: 'floor1',
        }),
      ],
      { budget: 1_000_000 },
    );
    // 1% × 1,000,000
    expect(find(questions, REST_POOL).impact).toBe(10_000);
  });

  it('월정액은 중요도에 들어가지 않는다 — 어느 항목에 써도 받는 돈이다', () => {
    const questions = spendQuestions(
      [
        card({
          id: 'A',
          tiers: [{ min: 0 }],
          monthlyRebateByTier: { '0': 5_000 },
          benefits: [
            benefit({
              id: 'b',
              match: { categories: ['online'] },
              discount: { type: 'rate', rate: 0.1 },
              monthlyCapByTier: { '0': 3_000 },
            }),
          ],
        }),
      ],
      { budget: 1_000_000 },
    );
    expect(find(questions, 'c:online').impact).toBe(3_000);
  });

  it('건당 최소금액이 있으면 알려준다 — 화면이 "1만원 이상 결제만"을 적는다', () => {
    const questions = spendQuestions([
      card({
        id: 'A',
        benefits: [
          benefit({ id: 'b', match: { merchants: ['네이버페이'] }, minTransaction: 10_000 }),
        ],
      }),
    ]);
    expect(find(questions, 'm:네이버페이').minTransaction).toBe(10_000);
  });

  it('건당 최소금액이 여럿이면 가장 낮은 값을 알려준다', () => {
    const questions = spendQuestions([
      card({
        id: 'A',
        benefits: [
          benefit({ id: 'x', match: { categories: ['online'] }, minTransaction: 10_000 }),
          benefit({ id: 'y', match: { categories: ['online'] }, minTransaction: 5_000 }),
        ],
      }),
    ]);
    expect(find(questions, 'c:online').minTransaction).toBe(5_000);
  });

  it('승인시간 조건뿐인 풀은 처방에 못 들어간다고 알린다', () => {
    const questions = spendQuestions([
      card({
        id: 'A',
        benefits: [
          benefit({
            id: 'night',
            match: { categories: ['mart'], hours: { from: 21, to: 9 } },
          }),
        ],
      }),
    ]);
    const q = find(questions, 'c:mart');
    expect(q.timeGatedOnly).toBe(true);
    expect(q.impact).toBe(0);
  });

  it('같은 풀에 시간 조건 없는 혜택이 하나라도 있으면 처방에 들어간다', () => {
    const questions = spendQuestions([
      card({
        id: 'A',
        benefits: [
          benefit({ id: 'night', match: { categories: ['mart'], hours: { from: 21, to: 9 } } }),
          benefit({ id: 'day', match: { categories: ['mart'] } }),
        ],
      }),
    ]);
    expect(find(questions, 'c:mart').timeGatedOnly).toBe(false);
  });

  it('카드가 없으면 나머지 결제만 묻는다', () => {
    expect(spendQuestions([]).map((q) => q.pool)).toEqual([REST_POOL]);
  });

  it('같은 입력에 항상 같은 답을 낸다', () => {
    const cards = [
      card({
        id: 'A',
        benefits: [
          benefit({ id: 'a', match: { categories: ['online'] } }),
          benefit({ id: 'b', match: { categories: ['cafe'] } }),
        ],
      }),
    ];
    expect(spendQuestions(cards)).toEqual(spendQuestions(cards));
  });
});

describe('spendQuestions — 실제 카드', () => {
  it('팟 카드와 EVERY 1을 고르면 아홉 개를 묻는다', () => {
    const questions = spendQuestions([realCard('bnk-pot.json'), realCard('woori-every1.json')], {
      budget: 1_000_000,
    });
    expect(questions).toHaveLength(9);
    // 나머지 결제는 EVERY 1의 1%가 정한다
    expect(find(questions, REST_POOL).impact).toBe(10_000);
    // 놀이공원은 월 한도가 안내에 없어 한도 없음으로 적혀 있다
    expect(find(questions, 'm:경주월드').unbounded).toBe(true);
    expect(find(questions, 'm:disney').unbounded).toBe(false);
  });

  it('한도가 있는 항목을 먼저 묻는다 — 한도 없는 항목은 상한을 모르면 무한대로 커진다', () => {
    /*
     * 놀이공원 50%는 월 한도가 안내에 없어 null(한도 없음)이다. 중요도를 액수로만 재면
     * 50만원이 되어 첫 질문이 되는데, 대부분 0원을 쓰는 항목이다. 한도 없는 항목은
     * 상한을 모르는 동안 중요도를 과장하므로 뒤로 보낸다.
     */
    const questions = spendQuestions([realCard('bnk-pot.json'), realCard('woori-every1.json')], {
      budget: 1_000_000,
    });
    const firstUnbounded = questions.findIndex((q) => q.unbounded);
    expect(firstUnbounded).toBeGreaterThan(0);
    // 한도 없는 항목 뒤로는 전부 한도 없는 항목이다.
    expect(questions.slice(firstUnbounded).every((q) => q.unbounded)).toBe(true);
    // 그중에서는 액수가 큰 것이 앞이라 나머지 결제(1만원)가 놀이공원(50만원)보다 뒤다.
    expect(questions.at(-1)?.pool).toBe(REST_POOL);
  });

  it('승인시간 조건이 걸린 Mr.Life의 밤 혜택을 알린다', () => {
    const questions = spendQuestions([realCard('shinhan-toss-mrlife.json')], {
      budget: 1_000_000,
    });
    const gated = questions.filter((q) => q.timeGatedOnly);
    expect(gated.length).toBeGreaterThan(0);
    for (const q of gated) expect(q.impact).toBe(0);
  });
});
