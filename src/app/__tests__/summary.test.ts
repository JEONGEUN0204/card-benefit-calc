import { maxDiscountByTier, simulate } from '../../core/index.js';
import type { CardRule, Transaction } from '../../core/index.js';
import { monthCeiling, summarize } from '../summary.js';
import threeMonth from '../../../fixtures/cases/07-three-month.json';
import simpleCafe from '../../../fixtures/testcards/simple-cafe.json';

/**
 * 손으로 계산한 기대값.
 *
 * 카페 10% 할인(월 1만원 한도)이 30만원 구간에서만 열리는 카드다. 첫 달은 전월실적을
 * 몰라 0으로 가정하므로 구간이 0 — 할인이 없고, 그 달 실적 35만원이 둘째 달 구간을
 * 연다. 둘째 달에 카페 10만원을 쓰면 정확히 한도 1만원을 받는다.
 */
const CARD: CardRule = {
  id: 'test-cafe',
  name: '테스트 카페카드',
  issuer: '테스트',
  annualFee: 12_000,
  tiers: [{ min: 0 }, { min: 300_000, label: '30만원 이상' }],
  benefits: [
    {
      id: 'cafe',
      label: '카페 10%',
      match: { categories: ['cafe'] },
      discount: { type: 'rate', rate: 0.1 },
      monthlyCapByTier: { '0': 0, '300000': 10_000 },
      excludeFromSpending: 'full',
    },
  ],
  spendingExclusions: [],
  rounding: 'floor10',
};

const TRANSACTIONS: Transaction[] = [
  { id: 't1', date: '2026-01-05', amount: 100_000, merchant: '카페', category: 'cafe' },
  { id: 't2', date: '2026-01-10', amount: 250_000, merchant: '기타', category: 'etc' },
  { id: 't3', date: '2026-02-05', amount: 100_000, merchant: '카페', category: 'cafe' },
  { id: 't4', date: '2026-02-10', amount: 250_000, merchant: '기타', category: 'etc' },
];

describe('summarize', () => {
  const months = simulate(CARD, TRANSACTIONS);
  const s = summarize(CARD, months, TRANSACTIONS);

  it('기간과 건수를 센다', () => {
    expect(s.months).toBe(2);
    expect(s.firstMonth).toBe('2026-01');
    expect(s.lastMonth).toBe('2026-02');
    expect(s.txCount).toBe(4);
    expect(s.totalSpend).toBe(700_000);
  });

  it('총 할인은 둘째 달 한도 1만원뿐이다', () => {
    expect(s.totalDiscount).toBe(10_000);
  });

  it('월평균은 절사해 정수 원으로 낸다', () => {
    expect(s.monthlyAverage).toBe(5_000);
  });

  it('연환산에서 연회비를 뺀 순이득을 낸다', () => {
    // 5,000 × 12 = 60,000 − 연회비 12,000
    expect(s.annualizedDiscount).toBe(60_000);
    expect(s.annualNet).toBe(48_000);
  });

  it('적용 구간의 한도 상한과 남긴 한도를 낸다', () => {
    // 첫 달은 0 구간이라 상한 0, 둘째 달은 1만원. 둘째 달에 한도를 꽉 썼다.
    expect(s.capCeiling).toBe(10_000);
    expect(s.unusedCap).toBe(0);
  });

  it('안내문 최대는 최상위 구간의 월 최대를 달 수만큼 더한 값이다', () => {
    // 최상위(30만원) 구간 월 최대 1만원 × 2개월
    expect(s.advertisedCeiling).toBe(20_000);
  });

  it('구간이 낮아 잃은 몫은 최상위 구간 대비 모자란 한도의 합이다', () => {
    // 첫 달 0 구간(월 최대 0원) → 1만원을 잃고, 둘째 달은 최상위라 0원
    expect(s.tierShortfall).toBe(10_000);
  });

  it('안내문 최대 − 구간 몫 − 못 쓴 한도 = 실제 할인', () => {
    expect(s.advertisedCeiling - s.tierShortfall - s.unusedCap).toBe(s.totalDiscount);
  });

  it('할인율은 금액이 아니라 비율로 남긴다', () => {
    expect(s.discountRate).toBeCloseTo(10_000 / 700_000, 10);
  });
});

describe('summarize — 거래가 없을 때', () => {
  const s = summarize(CARD, [], []);

  it('0으로 나누지 않는다', () => {
    expect(s.months).toBe(0);
    expect(s.monthlyAverage).toBe(0);
    expect(s.annualizedDiscount).toBe(0);
    expect(s.discountRate).toBe(0);
    expect(s.firstMonth).toBeNull();
    expect(s.advertisedCeiling).toBe(0);
    expect(s.tierShortfall).toBe(0);
  });

  it('연회비만큼 마이너스로 시작한다', () => {
    expect(s.annualNet).toBe(-12_000);
  });
});

/**
 * 소개 페이지 첫 화면의 순액 원장.
 *
 * 소개 페이지는 계산하지 않고 숫자를 본문에 박아 둔다(CLAUDE.md). 그 숫자가 어느 픽스처에서
 * 나왔는지를 여기서 못 박아, 엔진이 바뀌어 값이 달라지면 소개 페이지도 고치라고 알린다.
 * 기대값은 `npm run sim -- fixtures/cases/07-three-month.json`과 `--max`를 보고 손으로 셌다:
 * 월 최대 15,000 × 3 = 45,000, 1·3월은 구간 미달이라 30,000을 잃고, 2월은 한도 15,000 중
 * 10,500만 받아 4,500을 남긴다.
 */
describe('summarize — 소개 페이지 첫 화면 (골든 케이스 07)', () => {
  const card = simpleCafe as CardRule;
  const txs = threeMonth.transactions as Transaction[];
  const s = summarize(card, simulate(card, txs), txs);

  it('45,000 − 30,000 − 4,500 = 10,500', () => {
    expect(s.advertisedCeiling).toBe(45_000);
    expect(s.tierShortfall).toBe(30_000);
    expect(s.unusedCap).toBe(4_500);
    expect(s.totalDiscount).toBe(10_500);
  });
});

/**
 * 한도 없는 혜택과 월정액이 있는 카드(카드의정석 EVERY 1의 모양).
 *
 * 한도가 없으면 "안내문 최대"가 무한대가 된다. 그 몫은 실제로 받은 만큼을 상한으로 보고,
 * 나머지(월정액·한도 있는 혜택)만 구간과 한도로 뺀다 — 그래야 원장의 뺄셈이 계속 맞는다.
 *
 * 손계산: 1월은 전월실적을 몰라 0 구간. 600,000 × 1% = 6,000, 월정액 0.
 * 2월은 1월 실적 600,000(1%는 실적에서 빠지지 않는다)으로 50만 구간. 100,000 × 1% = 1,000,
 * 월정액 5,000. 총 12,000.
 * 한도 있는 몫의 월 최대는 0 구간 0, 50만 구간 5,000. 한도 없는 몫은 6,000 + 1,000 = 7,000.
 * 안내문 최대 = 5,000 × 2 + 7,000 = 17,000, 구간 몫 = 5,000(1월), 못 쓴 한도 = 0.
 */
describe('summarize — 한도 없는 혜택과 월정액', () => {
  const card: CardRule = {
    id: 'every',
    name: '에브리',
    issuer: '테스트',
    annualFee: 12_000,
    tiers: [{ min: 0 }, { min: 500_000 }],
    monthlyRebateByTier: { '0': 0, '500000': 5_000 },
    benefits: [
      {
        id: 'base',
        label: '1%',
        match: {},
        discount: { type: 'rate', rate: 0.01 },
        monthlyCapByTier: { '0': null, '500000': null },
        excludeFromSpending: 'none',
      },
    ],
    spendingExclusions: [],
    rounding: 'floor10',
  };
  const txs: Transaction[] = [
    { id: 'j', date: '2026-01-10', amount: 600_000, merchant: '가게', category: 'etc' },
    { id: 'f', date: '2026-02-10', amount: 100_000, merchant: '가게', category: 'etc' },
  ];
  const months = simulate(card, txs);
  const s = summarize(card, months, txs);

  it('17,000 − 5,000 − 0 = 12,000', () => {
    expect(s.totalDiscount).toBe(12_000);
    expect(s.advertisedCeiling).toBe(17_000);
    expect(s.tierShortfall).toBe(5_000);
    expect(s.unusedCap).toBe(0);
    expect(s.capCeiling).toBe(12_000);
  });

  it('달의 상한은 한도 있는 몫의 월 최대에 한도 없는 몫의 실제 할인을 더한 값이다', () => {
    const rows = maxDiscountByTier(card);
    expect(months.map((m) => monthCeiling(rows, m))).toEqual([6_000, 6_000]);
  });
});
