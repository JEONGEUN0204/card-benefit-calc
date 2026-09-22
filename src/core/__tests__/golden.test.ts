import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { simulate } from '../simulate.js';
import type { CardRule, MonthResult, Won } from '../types.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CARDS_DIR = join(ROOT, 'fixtures', 'cards');
const CASES_DIR = join(ROOT, 'fixtures', 'cases');

interface ExpectedTx {
  discount?: Won;
  reason?: string;
  /** null이면 "잘리지 않았어야 한다"는 뜻이다. */
  cappedBy?: string | null;
  appliedBenefitId?: string | null;
  countedSpending?: Won;
}

interface ExpectedMonth {
  month: string;
  tierMin?: Won | null;
  tierAssumed?: boolean;
  prevSpending?: Won | null;
  totalDiscount?: Won;
  countedSpending?: Won;
  transactions?: Record<string, ExpectedTx>;
}

interface GoldenCase {
  id: string;
  description: string;
  card: string;
  initialPrevSpending?: Won;
  transactions: Parameters<typeof simulate>[1];
  expect: { months: ExpectedMonth[] };
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

const cards = new Map<string, CardRule>(
  readdirSync(CARDS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const rule = readJson<CardRule>(join(CARDS_DIR, f));
      return [rule.id, rule];
    }),
);

const cases = readdirSync(CASES_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => readJson<GoldenCase>(join(CASES_DIR, f)));

/**
 * 골든 테스트 — 손으로 계산한 기대값이 유일한 기준이다.
 *
 * 약관에서 뽑아낸 규칙 JSON이 맞는지 알려주는 것은 결국 이 픽스처뿐이다. 엔진을 고칠 때
 * 기대값을 결과에 맞춰 바꾸고 싶어지면, 먼저 약관을 다시 읽고 손으로 계산해 볼 것.
 */
describe('골든 케이스', () => {
  it('픽스처가 하나 이상 있다', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const testCase of cases) {
    describe(`${testCase.id} — ${testCase.description}`, () => {
      const rule = cards.get(testCase.card);
      if (rule === undefined) {
        it('카드 규칙을 찾을 수 있다', () => {
          throw new Error(`알 수 없는 카드: ${testCase.card}`);
        });
        return;
      }

      const months = simulate(
        rule,
        testCase.transactions,
        testCase.initialPrevSpending === undefined
          ? {}
          : { initialPrevSpending: testCase.initialPrevSpending },
      );

      it('월 개수와 순서가 기대와 같다', () => {
        expect(months.map((m) => m.month)).toEqual(testCase.expect.months.map((m) => m.month));
      });

      testCase.expect.months.forEach((wanted, index) => {
        describe(wanted.month, () => {
          const got = months[index] as MonthResult | undefined;

          it('월 단위 합계가 맞다', () => {
            expect(got).toBeDefined();
            if (got === undefined) return;

            if (wanted.tierMin !== undefined) expect(got.tier?.min ?? null).toBe(wanted.tierMin);
            if (wanted.tierAssumed !== undefined) expect(got.tierAssumed).toBe(wanted.tierAssumed);
            if (wanted.prevSpending !== undefined) expect(got.prevSpending).toBe(wanted.prevSpending);
            if (wanted.totalDiscount !== undefined) expect(got.totalDiscount).toBe(wanted.totalDiscount);
            if (wanted.countedSpending !== undefined) {
              expect(got.countedSpending).toBe(wanted.countedSpending);
            }
          });

          it('건별 할인과 실적 기여액이 맞다', () => {
            expect(got).toBeDefined();
            if (got === undefined) return;

            for (const [txId, wantedTx] of Object.entries(wanted.transactions ?? {})) {
              const actual = got.transactions.find((t) => t.txId === txId);
              expect(actual, `${txId} 결과가 없다`).toBeDefined();
              if (actual === undefined) continue;

              if (wantedTx.discount !== undefined) {
                expect(actual.discount, `${txId} 할인액`).toBe(wantedTx.discount);
              }
              if (wantedTx.reason !== undefined) {
                expect(actual.reason, `${txId} 사유`).toBe(wantedTx.reason);
              }
              if (wantedTx.cappedBy !== undefined) {
                expect(actual.cappedBy ?? null, `${txId} 잘린 한도`).toBe(wantedTx.cappedBy);
              }
              if (wantedTx.appliedBenefitId !== undefined) {
                expect(actual.appliedBenefitId, `${txId} 적용 혜택`).toBe(wantedTx.appliedBenefitId);
              }
              if (wantedTx.countedSpending !== undefined) {
                expect(actual.countedSpending, `${txId} 실적 기여액`).toBe(wantedTx.countedSpending);
              }
            }

            // 기대값에 적지 않은 건이 있으면 픽스처가 불완전하다는 신호다.
            const covered = new Set(Object.keys(wanted.transactions ?? {}));
            const uncovered = got.transactions.map((t) => t.txId).filter((id) => !covered.has(id));
            expect(uncovered, '기대값이 비어 있는 거래').toEqual([]);
          });
        });
      });
    });
  }
});
