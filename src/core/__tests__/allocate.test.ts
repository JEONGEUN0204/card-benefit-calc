import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { allocate, comparePortfolios } from '../allocate.js';
import { parseCardRule } from '../parseCardRule.js';
import { REST_POOL } from '../scope.js';
import type { SpendCeilings } from '../attainable.js';
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

function plan(result: ReturnType<typeof allocate>, cardId: string) {
  return must(
    result.plans.find((p) => p.cardId === cardId),
    cardId,
  );
}

describe('allocate — 대화의 결론을 재현한다', () => {
  /*
   * 사용자가 상담 대화를 한 바퀴 돌려 받은 최종 추천이다.
   *
   *   "팟 40만원 + EVERY 1 60만원이 최종 추천이야."
   *   "팟 40만원 + EVERY 1 60만원 → 월 혜택 3.1만원, 연 순이익 약 35만원"
   *
   * 손으로 따라가면 이렇다.
   *   팟 400,000 → 통합 한도 20,000을 꽉 채운다
   *     온라인몰 50,000×15% = 7,500
   *     구독     15,000×30% = 4,500
   *     배달     50,000×10% = 5,000
   *     편의점   30,000×10% = 3,000   (공동 한도 20,000에 꼭 맞는다)
   *     = 할인 대상 145,000원에 20,000원, 나머지 255,000원은 할인 0원으로 구간을 여는 돈
   *   EVERY 1 600,000 → 6,000(1%) + 5,000(50만 구간 월정액) = 11,000
   *   합 31,000원/월. 연 372,000원에서 연회비(팟 10,000 + EVERY 1 12,000)를 빼면 350,000원.
   *
   * 지출 상한은 대화가 제시한 "쇼핑 없는 달" 조합을 그대로 옮겼다 — "간편결제 7.5만원
   * 1건에 배달 2번, 편의점 3번, 스타벅스 2번, 구독 1개 정도를 섞으면 2만원이 차".
   * 사용자가 "간편결제랑 온라인쇼핑 달마다 저정도 쓰진 않는데.. 구독도 그렇고"라고 했으므로
   * 온라인몰은 0으로 둔다.
   *
   * 이 케이스가 보여 주는 것은 **할인 한계율이 0인 돈도 가치가 있다**는 점이다. 팟 카드의
   * 나머지 200,000원은 할인을 한 푼도 만들지 않지만(팟 카드에는 전 가맹점 혜택이 없다),
   * 그 돈이 없으면 40만원 구간이 열리지 않아 20,000원이 통째로 사라진다. 한계 할인율만
   * 보는 배분은 이 돈을 EVERY 1에 줘서 1%(2,000원)를 벌고 20,000원을 잃는다.
   */
  const pot = realCard('bnk-pot.json');
  const every1 = realCard('woori-every1.json');

  const ceilings: SpendCeilings = {
    byKey: {
      'm:네이버시리즈': 75_000, // 간편결제·웹툰이 한 통이다(카카오페이 ⊂ 카카오페이지)
      'c:delivery': 50_000,
      'c:convenience': 40_000,
      'm:starbucks': 20_000,
      'm:disney': 15_000, // 구독 한 개
      'm:11번가': 0, // 온라인몰 — 쇼핑 없는 달
      'm:셀픽스': 0, // 인생네컷
      'm:경주월드': 0, // 놀이공원
      [REST_POOL]: 800_000,
    },
    monthlyBudget: 1_000_000,
  };

  const result = allocate({ cards: [pot, every1], ceilings });

  it('팟 카드에 40만원, EVERY 1에 60만원을 배정한다', () => {
    expect(plan(result, 'bnk-pot').monthlySpend).toBe(400_000);
    expect(plan(result, 'woori-every1').monthlySpend).toBe(600_000);
  });

  it('구간이 40만원·50만원으로 열린다', () => {
    expect(plan(result, 'bnk-pot').tier?.min).toBe(400_000);
    expect(plan(result, 'woori-every1').tier?.min).toBe(500_000);
  });

  it('월 혜택이 31,000원이다', () => {
    expect(plan(result, 'bnk-pot').monthlyDiscount).toBe(20_000);
    expect(plan(result, 'woori-every1').monthlyDiscount).toBe(11_000);
    expect(result.monthlyDiscount).toBe(31_000);
  });

  it('연회비를 뺀 연 순이익이 35만원이다', () => {
    expect(result.annualFeeTotal).toBe(22_000);
    expect(result.annualNet).toBe(350_000);
  });

  it('예산을 남기지 않는다', () => {
    expect(result.leftover).toBe(0);
  });

  it('할인 한계율이 0인 돈도 팟 카드에 배정한다 — 구간을 열기 때문이다', () => {
    const potPlan = plan(result, 'bnk-pot');
    const rest = potPlan.byKey[REST_POOL]?.amount ?? 0;
    // 할인 대상 지출 상한이 200,000원뿐이라 남은 200,000원은 구간을 여는 데만 쓰인다.
    expect(rest).toBe(200_000);
    expect(potPlan.monthlySpend - rest).toBe(200_000);
  });

  it('진동하지 않는다 — 두 카드 모두 실적 제외가 없다', () => {
    expect(result.plans.every((p) => !p.oscillates)).toBe(true);
  });

  it('최적임이 증명된다 — 완화 상한과 차이가 없다', () => {
    expect(result.gap).toBe(0);
    expect(result.upperBound).toBe(result.monthlyDiscount);
  });

  it('80만원 구간을 고르지 않는 이유가 숫자로 설명된다', () => {
    /*
     * 팟 카드를 80만원까지 쓰면 통합 한도가 4만원으로 올라가지만, 이 사용자의 지출로는
     * 23,000원까지만 찬다(간편결제 7,500 + 구독 4,500 + 배달 5,000 + 편의점 4,000 +
     * 스타벅스 2,000). 그러면 EVERY 1에 20만원만 남아 50만원 구간의 월정액 5,000원을
     * 잃고 1% 2,000원만 받는다 — 합 25,000원으로 31,000원보다 못하다.
     *
     * 즉 팟 카드의 한도를 두 배로 키우는 것보다 EVERY 1의 월정액 사다리를 지키는 것이
     * 낫다. 대화가 팟 40만원을 고른 이유가 이것이고, 같은 결론이 숫자로 나온다.
     */
    const forced = allocate({
      cards: [pot, every1],
      ceilings,
      constraints: [{ cardId: 'bnk-pot', minMonthlySpend: 800_000 }],
    });
    expect(plan(forced, 'bnk-pot').tier?.min).toBe(800_000);
    expect(forced.monthlyDiscount).toBeLessThan(result.monthlyDiscount);
    expect(forced.monthlyDiscount).toBe(25_000);
  });
});

describe('allocate — 상한이 바뀌면 답이 바뀐다', () => {
  /*
   * 대화의 추천은 사용자의 지출 상한에 달려 있다. "2만원만 채울 수 있다"는 말은 소비의
   * 한계가 아니라 **한도**가 2만원이었다는 뜻이다 — 40만원 구간의 통합 한도가 2만원이다.
   * 같은 지출을 80만원 구간에 놓으면 한도가 4만원이라 더 받는다.
   *
   * 그래서 온라인쇼핑을 하는 달에는 답이 뒤집힌다. 이 도구가 있어야 하는 이유가 이것이고,
   * 대화는 사용자의 "2만원만 가능할 것 같아"를 그대로 받아 더 따지지 않았다.
   */
  const pot = realCard('bnk-pot.json');
  const every1 = realCard('woori-every1.json');

  it('온라인쇼핑과 간편결제를 넉넉히 쓰면 팟 80만원이 낫다', () => {
    const result = allocate({
      cards: [pot, every1],
      ceilings: {
        byKey: {
          'm:11번가': 100_000, // 온라인몰 15% → 15,000(혜택 한도)
          'm:네이버시리즈': 150_000, // 간편결제 10% → 15,000(혜택 한도)
          'c:delivery': 50_000,
          'c:convenience': 40_000,
          'm:starbucks': 20_000,
          'm:disney': 15_000,
          'm:셀픽스': 0,
          'm:경주월드': 0,
          [REST_POOL]: 625_000,
        },
        monthlyBudget: 1_000_000,
      },
    });
    expect(plan(result, 'bnk-pot').tier?.min).toBe(800_000);
    // 팟 카드의 통합 한도 40,000이 꽉 차고, EVERY 1은 20만원에 1% 2,000원
    expect(plan(result, 'bnk-pot').monthlyDiscount).toBe(40_000);
    expect(result.monthlyDiscount).toBe(42_000);
  });
});

describe('allocate — 기본 동작', () => {
  const plain = (id: string, rate: number, cap: number, fee = 0): CardRule =>
    card({
      id,
      annualFee: fee,
      tiers: [{ min: 0 }],
      benefits: [
        benefit({
          id: 'every',
          match: {},
          discount: { type: 'rate', rate },
          monthlyCapByTier: { '0': cap },
          excludeFromSpending: 'none',
        }),
      ],
      rounding: 'floor1',
    });

  it('한 장만 주면 거기에 다 쓴다', () => {
    const result = allocate({
      cards: [plain('A', 0.01, 100_000)],
      ceilings: { byKey: { [REST_POOL]: 500_000 }, monthlyBudget: 500_000 },
    });
    expect(plan(result, 'A').monthlySpend).toBe(500_000);
    expect(result.monthlyDiscount).toBe(5_000);
  });

  it('할인율이 높은 카드에 먼저 몰아준다', () => {
    const result = allocate({
      cards: [plain('LOW', 0.01, 1_000_000), plain('HIGH', 0.02, 1_000_000)],
      ceilings: { byKey: { [REST_POOL]: 500_000 }, monthlyBudget: 500_000 },
    });
    expect(plan(result, 'HIGH').monthlySpend).toBe(500_000);
    expect(plan(result, 'LOW').monthlySpend).toBe(0);
    expect(result.monthlyDiscount).toBe(10_000);
  });

  it('한도가 차면 다음 카드로 넘어간다', () => {
    // HIGH는 2%에 한도 4,000원 → 200,000원까지만 쓸모가 있다. 남은 300,000은 LOW가 1%.
    const result = allocate({
      cards: [plain('LOW', 0.01, 1_000_000), plain('HIGH', 0.02, 4_000)],
      ceilings: { byKey: { [REST_POOL]: 500_000 }, monthlyBudget: 500_000 },
    });
    expect(plan(result, 'HIGH').monthlySpend).toBe(200_000);
    expect(plan(result, 'LOW').monthlySpend).toBe(300_000);
    // 4,000 + 3,000
    expect(result.monthlyDiscount).toBe(7_000);
  });

  it('연회비가 혜택보다 크면 그 카드를 쓰지 않는다', () => {
    // 1% 한도 1,000원 → 월 최대 1,000원인데 연회비 120,000원이면 월 10,000원이다.
    const result = allocate({
      cards: [plain('CHEAP', 0.01, 1_000_000, 0), plain('PRICEY', 0.02, 1_000, 120_000)],
      ceilings: { byKey: { [REST_POOL]: 500_000 }, monthlyBudget: 500_000 },
    });
    expect(plan(result, 'PRICEY').monthlySpend).toBe(0);
    expect(result.annualFeeTotal).toBe(0);
  });

  it('카드별 최소 사용액 제약을 지킨다 — 적금 우대 조건 같은 것', () => {
    const result = allocate({
      cards: [plain('LOW', 0.01, 1_000_000), plain('HIGH', 0.02, 1_000_000)],
      ceilings: { byKey: { [REST_POOL]: 500_000 }, monthlyBudget: 500_000 },
      constraints: [{ cardId: 'LOW', minMonthlySpend: 100_000 }],
    });
    expect(plan(result, 'LOW').monthlySpend).toBe(100_000);
    expect(plan(result, 'HIGH').monthlySpend).toBe(400_000);
    // 400,000×2% + 100,000×1% = 8,000 + 1,000
    expect(result.monthlyDiscount).toBe(9_000);
  });

  it('카드별 최대 사용액 제약을 지킨다', () => {
    const result = allocate({
      cards: [plain('LOW', 0.01, 1_000_000), plain('HIGH', 0.02, 1_000_000)],
      ceilings: { byKey: { [REST_POOL]: 500_000 }, monthlyBudget: 500_000 },
      constraints: [{ cardId: 'HIGH', maxMonthlySpend: 200_000 }],
    });
    expect(plan(result, 'HIGH').monthlySpend).toBe(200_000);
    expect(plan(result, 'LOW').monthlySpend).toBe(300_000);
  });

  it('지출 상한 합이 예산보다 작으면 남긴다', () => {
    const result = allocate({
      cards: [plain('A', 0.01, 1_000_000)],
      ceilings: { byKey: { [REST_POOL]: 200_000 }, monthlyBudget: 500_000 },
    });
    expect(plan(result, 'A').monthlySpend).toBe(200_000);
    expect(result.leftover).toBe(300_000);
  });

  it('구간을 열어야 혜택이 나오면 그 구간을 채운다', () => {
    /*
     * 0 구간에서는 혜택이 없고 300,000 구간에서 1%가 열리는 카드. 예산이 300,000이면
     * 전부 써야 3,000원이 나온다. 한계율만 보면 0 구간에서 한계율이 0이라 한 푼도
     * 배정하지 않고 0원으로 끝난다.
     */
    const gated = card({
      id: 'GATED',
      tiers: [{ min: 0 }, { min: 300_000 }],
      benefits: [
        benefit({
          id: 'every',
          match: {},
          discount: { type: 'rate', rate: 0.01 },
          monthlyCapByTier: { '0': 0, '300000': 100_000 },
          excludeFromSpending: 'none',
        }),
      ],
      rounding: 'floor1',
    });
    const result = allocate({
      cards: [gated],
      ceilings: { byKey: { [REST_POOL]: 300_000 }, monthlyBudget: 300_000 },
    });
    expect(plan(result, 'GATED').tier?.min).toBe(300_000);
    expect(result.monthlyDiscount).toBe(3_000);
  });

  it('예산이 구간에 모자라면 그 구간을 열지 않는다', () => {
    const gated = card({
      id: 'GATED',
      tiers: [{ min: 0 }, { min: 300_000 }],
      benefits: [
        benefit({
          id: 'every',
          match: {},
          discount: { type: 'rate', rate: 0.01 },
          monthlyCapByTier: { '0': 0, '300000': 100_000 },
          excludeFromSpending: 'none',
        }),
      ],
      rounding: 'floor1',
    });
    const result = allocate({
      cards: [gated],
      ceilings: { byKey: { [REST_POOL]: 200_000 }, monthlyBudget: 200_000 },
    });
    expect(plan(result, 'GATED').tier).toBeNull();
    expect(result.monthlyDiscount).toBe(0);
  });

  it('카드가 없으면 빈 결과다', () => {
    const result = allocate({
      cards: [],
      ceilings: { byKey: { [REST_POOL]: 500_000 }, monthlyBudget: 500_000 },
    });
    expect(result.plans).toEqual([]);
    expect(result.monthlyDiscount).toBe(0);
    expect(result.leftover).toBe(500_000);
  });

  it('예산이 0이면 아무것도 배정하지 않는다', () => {
    const result = allocate({
      cards: [plain('A', 0.01, 100_000)],
      ceilings: { byKey: {}, monthlyBudget: 0 },
    });
    expect(result.monthlyDiscount).toBe(0);
    expect(plan(result, 'A').monthlySpend).toBe(0);
  });

  it('같은 입력에 항상 같은 답을 낸다', () => {
    const input = {
      cards: [plain('LOW', 0.01, 1_000_000), plain('HIGH', 0.02, 4_000)],
      ceilings: { byKey: { [REST_POOL]: 500_000 }, monthlyBudget: 500_000 },
    };
    expect(allocate(input)).toEqual(allocate(input));
  });
});

describe('allocate — 금액의 출처는 FIFO 하나다', () => {
  it('배정한 거래를 applyDiscounts로 돌린 값이 결과에 그대로 올라간다', () => {
    /*
     * 불변규칙 4: 최적화기는 배분안만 제안하고 금액은 전부 FIFO 경로에서 나온다.
     * 그래서 최적화기의 근사 오차는 "덜 좋은 배분을 골랐다"로만 나타나고, 화면에 뜨는
     * 숫자가 틀리는 일은 구조적으로 일어나지 않는다.
     *
     * 횟수 제한이 걸린 카드로 확인한다 — 월 2회, 건당 한도 1,000원이면 최대 2,000원이고,
     * 한도표만 보는 계산은 10,000원이라고 답한다.
     */
    const limited = card({
      id: 'LIMITED',
      tiers: [{ min: 0 }],
      benefits: [
        benefit({
          id: 'capped',
          match: { categories: ['online'] },
          discount: { type: 'rate', rate: 0.1 },
          perTransactionCap: 1_000,
          countLimit: { period: 'month', max: 2 },
          monthlyCapByTier: { '0': 10_000 },
          excludeFromSpending: 'none',
        }),
      ],
      rounding: 'floor1',
    });
    const result = allocate({
      cards: [limited],
      ceilings: { byKey: { 'c:online': 500_000, [REST_POOL]: 0 }, monthlyBudget: 500_000 },
    });
    expect(result.monthlyDiscount).toBe(2_000);
  });
});

describe('comparePortfolios — 구성 비교', () => {
  const plain = (id: string, rate: number, cap: number, fee = 0): CardRule =>
    card({
      id,
      annualFee: fee,
      tiers: [{ min: 0 }],
      benefits: [
        benefit({
          id: 'every',
          match: {},
          discount: { type: 'rate', rate },
          monthlyCapByTier: { '0': cap },
          excludeFromSpending: 'none',
        }),
      ],
      rounding: 'floor1',
    });

  const input = {
    cards: [plain('LOW', 0.01, 1_000_000), plain('HIGH', 0.02, 4_000)],
    ceilings: { byKey: { [REST_POOL]: 500_000 }, monthlyBudget: 500_000 },
  };

  it('카드 조합마다 하나씩, 연 순이익 내림차순으로 돌려준다', () => {
    const options = comparePortfolios(input);
    expect(options.map((o) => o.cardIds)).toEqual([
      ['LOW', 'HIGH'],
      ['LOW'],
      ['HIGH'],
    ]);
    const nets = options.map((o) => o.allocation.annualNet);
    expect([...nets].sort((a, b) => b - a)).toEqual(nets);
  });

  it('가장 좋은 구성이 allocate의 답과 같다', () => {
    const best = comparePortfolios(input)[0];
    expect(best?.allocation.annualNet).toBe(allocate(input).annualNet);
  });

  it('한 장만 쓰는 구성도 계산한다', () => {
    const options = comparePortfolios(input);
    const onlyHigh = must(
      options.find((o) => o.cardIds.join() === 'HIGH'),
      'HIGH만',
    );
    // 2%에 한도 4,000원 → 200,000원까지만 쓸모가 있고 나머지는 남는다
    expect(onlyHigh.allocation.monthlyDiscount).toBe(4_000);
    expect(onlyHigh.allocation.leftover).toBe(300_000);
  });

  it('반드시 써야 하는 카드가 빠진 구성은 내놓지 않는다', () => {
    const options = comparePortfolios({
      ...input,
      constraints: [{ cardId: 'LOW', minMonthlySpend: 100_000 }],
    });
    expect(options.every((o) => o.cardIds.includes('LOW'))).toBe(true);
    expect(options.map((o) => o.cardIds)).toEqual([['LOW', 'HIGH'], ['LOW']]);
  });

  it('카드가 없으면 빈 목록이다', () => {
    expect(
      comparePortfolios({
        cards: [],
        ceilings: { byKey: {}, monthlyBudget: 500_000 },
      }),
    ).toEqual([]);
  });

  it('연회비가 비싼 카드는 구성 비교에서 뒤로 간다', () => {
    const options = comparePortfolios({
      cards: [plain('CHEAP', 0.01, 1_000_000, 0), plain('PRICEY', 0.02, 1_000, 120_000)],
      ceilings: { byKey: { [REST_POOL]: 500_000 }, monthlyBudget: 500_000 },
    });
    // CHEAP 한 장이 가장 낫다 — PRICEY는 월 1,000원을 받으려고 월 10,000원을 낸다
    expect(options[0]?.cardIds).toEqual(['CHEAP']);
    expect(options.at(-1)?.cardIds).toEqual(['PRICEY']);
  });
});
