import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCardRule } from '../parseCardRule.js';
import { peakingCurve } from '../peaking.js';
import type { CardRule, SpendingPattern } from '../types.js';
import { benefit, card, must } from './helpers.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function realCard(file: string): CardRule {
  const parsed = parseCardRule(JSON.parse(readFileSync(join(ROOT, 'fixtures', 'cards', file), 'utf8')));
  if (!parsed.ok) throw new Error(parsed.issues.map((i) => `${i.path}: ${i.message}`).join(', '));
  return parsed.card;
}

/** 전 가맹점 혜택만 보는 카드라 어디에 쓰는지는 중요하지 않다. */
const PLAIN: SpendingPattern = { weights: { etc: 1 }, defaultTicket: 100_000 };

describe('peakingCurve — 카드의정석 EVERY 1', () => {
  /*
   * 이 표는 사용자가 상담 대화에서 직접 물어 받은 값이다. 엔진이 같은 숫자를 내야 한다.
   *
   * 규칙: 국내외 1% 할인(한도 없음) + 전월실적 구간별 월정액(50만 5,000 / 100만 10,000 /
   * 150만 15,000 / 200만 20,000). 실적 제외가 없어 실적이 결제액과 같으므로, 매달 같은
   * 금액을 쓰면 전월실적도 같은 금액이다 — 정상상태에서 "전월실적 구간"과 "이번 달 사용액"이
   * 맞아떨어진다.
   *
   * | 월 사용액 | 기본 1% | 월정액 | 월 혜택 | 피킹률 | 연회비 반영 |
   * |-----------|---------|--------|---------|--------|-------------|
   * |  500,000  |  5,000  | 5,000  | 10,000  | 2.00%  | 1.80%       |
   * |  600,000  |  6,000  | 5,000  | 11,000  | 1.83%  | 1.67%       |
   * |  700,000  |  7,000  | 5,000  | 12,000  | 1.71%  | 1.57%       |
   * |  800,000  |  8,000  | 5,000  | 13,000  | 1.63%  | 1.50%       |
   * |  900,000  |  9,000  | 5,000  | 14,000  | 1.56%  | 1.44%       |
   *
   * 연회비는 12,000원이라 월 1,000원이다.
   */
  const rule = realCard('woori-every1.json');
  const spends = [500_000, 600_000, 700_000, 800_000, 900_000];
  const curve = peakingCurve(rule, PLAIN, spends);

  it('월 혜택이 대화의 표와 같다', () => {
    expect(curve.map((p) => p.discount)).toEqual([10_000, 11_000, 12_000, 13_000, 14_000]);
  });

  it('피킹률이 대화의 표와 같다', () => {
    const pct = curve.map((p) => Number((p.rate * 100).toFixed(2)));
    expect(pct).toEqual([2.0, 1.83, 1.71, 1.63, 1.56]);
  });

  it('연회비를 반영한 순 피킹률이 대화의 표와 같다', () => {
    const pct = curve.map((p) => Number((p.netRate * 100).toFixed(2)));
    expect(pct).toEqual([1.8, 1.67, 1.57, 1.5, 1.44]);
  });

  it('50만원을 넘긴 뒤 한계 피킹률이 1%로 떨어진다 — 카드를 갈아타는 지점이다', () => {
    /*
     * 이 한 줄이 배분의 근거다. 50만원까지는 평균 2%지만 그 다음 1원은 1%만 받는다.
     * 그래서 50만원만 채우고 나머지는 한계율이 더 높은 카드로 옮기는 것이 이득이다.
     */
    const marginals = curve.map((p) => Number((p.marginalRate * 100).toFixed(2)));
    // 첫 점은 원점에서 본 한계율이라 평균과 같다.
    expect(marginals).toEqual([2.0, 1.0, 1.0, 1.0, 1.0]);
  });

  it('구간이 모두 열려 사이클이 흔들리지 않는다', () => {
    expect(curve.every((p) => !p.oscillates)).toBe(true);
    expect(curve.map((p) => p.tier?.min ?? null)).toEqual([
      500_000, 500_000, 500_000, 500_000, 500_000,
    ]);
  });

  it('100만원에서 월정액이 한 칸 올라 피킹률이 다시 2%가 된다', () => {
    const at = must(peakingCurve(rule, PLAIN, [1_000_000])[0], '100만원');
    // 10,000 + 월정액 10,000
    expect(at.discount).toBe(20_000);
    expect(Number((at.rate * 100).toFixed(2))).toBe(2.0);
  });

  it('50만원에 1원 모자라면 월정액이 사라진다', () => {
    const at = must(peakingCurve(rule, PLAIN, [499_900])[0], '49.99만원');
    // 499,900 × 1% = 4,999원, 월정액 0
    expect(at.discount).toBe(4_999);
    expect(at.tier?.min).toBe(0);
  });
});

describe('peakingCurve — 일반', () => {
  it('지출이 0이면 비율을 0으로 둔다 — 0으로 나누지 않는다', () => {
    const rule = card({
      id: 'A',
      benefits: [benefit({ id: 'b', match: {}, monthlyCapByTier: { '0': 10_000 } })],
    });
    const at = must(peakingCurve(rule, PLAIN, [0])[0], '0원');
    expect(at.discount).toBe(0);
    expect(at.rate).toBe(0);
    expect(at.marginalRate).toBe(0);
    expect(at.netRate).toBe(0);
  });

  it('지출을 오름차순으로 정렬해 한계율을 잰다', () => {
    const rule = realCard('woori-every1.json');
    const curve = peakingCurve(rule, PLAIN, [900_000, 500_000, 700_000]);
    expect(curve.map((p) => p.spend)).toEqual([500_000, 700_000, 900_000]);
  });

  it('한도가 다 차면 한계 피킹률이 0이 된다', () => {
    // 10% 할인에 월 한도 10,000원 → 100,000원을 넘게 쓰면 더 받을 것이 없다.
    const rule = card({
      id: 'A',
      tiers: [{ min: 0 }],
      benefits: [
        benefit({
          id: 'b',
          match: {},
          discount: { type: 'rate', rate: 0.1 },
          monthlyCapByTier: { '0': 10_000 },
          excludeFromSpending: 'none',
        }),
      ],
      rounding: 'floor1',
    });
    const curve = peakingCurve(rule, PLAIN, [100_000, 200_000, 300_000]);
    expect(curve.map((p) => p.discount)).toEqual([10_000, 10_000, 10_000]);
    expect(curve.map((p) => p.marginalRate)).toEqual([0.1, 0, 0]);
  });

  it('진동하는 배분은 사이클 평균을 쓰고 그 사실을 알린다', () => {
    const rule = card({
      id: 'A',
      tiers: [{ min: 0 }, { min: 300_000 }],
      benefits: [
        benefit({
          id: 'shop',
          match: {},
          discount: { type: 'rate', rate: 0.1 },
          monthlyCapByTier: { '0': 0, '300000': 50_000 },
          excludeFromSpending: 'full',
        }),
      ],
      rounding: 'floor1',
    });
    const at = must(peakingCurve(rule, PLAIN, [400_000])[0], '40만원');
    expect(at.oscillates).toBe(true);
    // 0 구간 0원 ↔ 300,000 구간 40,000원 → 평균 20,000원
    expect(at.discount).toBe(20_000);
    expect(at.tier).toBeNull();
  });
});
