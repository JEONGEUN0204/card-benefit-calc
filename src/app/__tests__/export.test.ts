import type { MonthResult, Transaction } from '../../core/index.js';
import { resultCsv } from '../export.js';

const TRANSACTIONS: Transaction[] = [
  { id: 't1', date: '2026-02-05', amount: 100_000, merchant: '스타벅스 강남', category: 'cafe' },
  { id: 't2', date: '2026-02-10', amount: 3_000, merchant: '가, 나"다', category: 'etc' },
];

const MONTHS: MonthResult[] = [
  {
    month: '2026-02',
    tier: { min: 300_000, label: '30만원 이상' },
    prevSpending: 350_000,
    tierAssumed: false,
    transactions: [
      { txId: 't1', appliedBenefitId: 'cafe', discount: 10_000, reason: 'ok', countedSpending: 0 },
      { txId: 't2', appliedBenefitId: null, discount: 0, reason: 'noMatch', countedSpending: 3_000 },
    ],
    totalDiscount: 10_000,
    rebate: 0,
    capUsage: { cafe: 10_000 },
    groupUsage: {},
    totalCapUsed: 10_000,
    countedSpending: 3_000,
  },
];

describe('resultCsv', () => {
  const lines = resultCsv(MONTHS, TRANSACTIONS).split('\r\n');

  it('헤더를 먼저 낸다', () => {
    expect(lines[0]).toBe('월,적용구간,전월실적,날짜,가맹점,업종,결제액,할인액,사유,실적반영');
  });

  it('거래를 달의 순서대로 한 줄씩 낸다', () => {
    expect(lines[1]).toBe('2026-02,30만원 이상,350000,2026-02-05,스타벅스 강남,카페,100000,10000,할인,0');
  });

  it('쉼표와 인용부호가 든 가맹점명을 감싸고 인용부호를 겹친다', () => {
    expect(lines[2]).toBe('2026-02,30만원 이상,350000,2026-02-10,"가, 나""다",기타,3000,0,해당 혜택 없음,3000');
  });

  it('금액은 콤마 없는 정수로 낸다 — 표 계산기가 숫자로 읽어야 한다', () => {
    expect(lines[1]).not.toContain('100,000');
  });

  it('줄바꿈으로 끝나지 않는다', () => {
    expect(lines[lines.length - 1]).not.toBe('');
  });
});

describe('resultCsv — 전월실적을 모르는 달', () => {
  it('빈 칸으로 남긴다. 0으로 적으면 실제로 0원 썼다는 뜻이 된다', () => {
    const months: MonthResult[] = [{ ...MONTHS[0]!, prevSpending: null, tierAssumed: true }];
    const row = resultCsv(months, TRANSACTIONS).split('\r\n')[1] ?? '';
    expect(row).toContain('2026-02,30만원 이상(가정),,2026-02-05');
  });
});

describe('resultCsv — 월정액 할인이 있는 달', () => {
  it('거래 뒤에 한 줄로 낸다. 빠뜨리면 할인액 열의 합이 화면 합계와 어긋난다', () => {
    const months: MonthResult[] = [{ ...MONTHS[0]!, rebate: 5_000, totalDiscount: 15_000 }];
    const lines = resultCsv(months, TRANSACTIONS).split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines[3]).toBe('2026-02,30만원 이상,350000,,월정액 할인,,0,5000,월정액 할인,0');
  });

  it('월정액이 0인 달에는 줄을 만들지 않는다', () => {
    expect(resultCsv(MONTHS, TRANSACTIONS).split('\r\n')).toHaveLength(3);
  });
});
