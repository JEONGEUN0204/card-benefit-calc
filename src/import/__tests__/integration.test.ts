import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { simulate } from '../../core/simulate.js';
import type { CardRule } from '../../core/types.js';
import { CATEGORIES } from '../category/vocabulary.js';
import { parseStatementCsv } from '../statement.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CARDS_DIR = join(ROOT, 'fixtures', 'testcards');

function loadCard(file: string): CardRule {
  return JSON.parse(readFileSync(join(CARDS_DIR, file), 'utf8')) as CardRule;
}

/** 카페 5,500원 2건 + 편의점 7,200원 1건. 전월실적 30만원 구간에서 돌린다. */
const STATEMENT = `이용일자,이용가맹점,업종,이용금액,이용구분
2026.01.05,스타벅스 강남2호점,커피전문점,"5,500",일시불
2026.01.06,GS25 역삼점,편의점,"7,200",일시불
2026.01.12,투썸플레이스 역삼점,커피전문점,"5,500",일시불
`;

describe('파서 결과가 simulate에 그대로 들어간다', () => {
  it('명세서 → Transaction[] → 월별 결과', () => {
    const card = loadCard('simple-cafe.json');
    const parsed = parseStatementCsv(STATEMENT);
    expect(parsed.uncategorized).toEqual([]);

    const months = simulate(card, parsed.transactions, { initialPrevSpending: 300_000 });
    const jan = months[0];

    // 카페 10%: 550 + 550 = 1,100원. 편의점 500원. 합 1,600원.
    expect(jan?.month).toBe('2026-01');
    expect(jan?.totalDiscount).toBe(1600);
    // 할인받은 세 건 모두 전액 실적 제외라 이 달 실적은 0원이다.
    expect(jan?.countedSpending).toBe(0);
  });
});

describe('카테고리 어휘', () => {
  it('카드 규칙이 쓰는 카테고리는 전부 표준 어휘에 있다', () => {
    // 파서가 내는 카테고리와 카드 규칙의 카테고리가 어긋나면 할인이 조용히 0원이 된다.
    const used = new Set<string>();
    for (const file of readdirSync(CARDS_DIR).filter((f) => f.endsWith('.json'))) {
      const card = loadCard(file);
      for (const b of card.benefits) for (const c of b.match.categories ?? []) used.add(c);
      for (const ex of card.spendingExclusions) {
        if (ex.kind === 'category') for (const c of ex.values) used.add(c);
      }
    }
    expect([...used].filter((c) => !CATEGORIES.includes(c))).toEqual([]);
  });
});
