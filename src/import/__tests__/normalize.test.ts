import { describe, expect, it } from 'vitest';
import { normalizeMerchant, parseDate, parsePaymentType, parseWon } from '../normalize.js';

describe('parseWon', () => {
  it('천단위 콤마를 걷어낸다', () => {
    expect(parseWon('12,340')).toBe(12340);
  });

  it('통화 기호와 원 표기를 걷어낸다', () => {
    expect(parseWon('12,340원')).toBe(12340);
    expect(parseWon('₩12,340')).toBe(12340);
    expect(parseWon('KRW 12,340')).toBe(12340);
  });

  it('음수 금액을 읽는다 (취소 거래)', () => {
    expect(parseWon('-12,340')).toBe(-12340);
    expect(parseWon('△12,340')).toBe(-12340);
  });

  it('괄호 표기를 음수로 본다', () => {
    expect(parseWon('(12,340)')).toBe(-12340);
  });

  it('엑셀 셀이 만든 소수 꼬리는 반올림해 정수로 되돌린다', () => {
    expect(parseWon('12340.00')).toBe(12340);
    expect(parseWon('12339.9999999')).toBe(12340);
  });

  it('읽을 수 없으면 null이다', () => {
    expect(parseWon('')).toBeNull();
    expect(parseWon('   ')).toBeNull();
    expect(parseWon('해당없음')).toBeNull();
    expect(parseWon('-')).toBeNull();
  });
});

describe('parseDate', () => {
  it('카드사마다 다른 구분자를 모두 받는다', () => {
    expect(parseDate('2026-01-05')).toBe('2026-01-05');
    expect(parseDate('2026.01.05')).toBe('2026-01-05');
    expect(parseDate('2026/01/05')).toBe('2026-01-05');
    expect(parseDate('20260105')).toBe('2026-01-05');
  });

  it('한 자리 월·일을 0으로 채운다', () => {
    expect(parseDate('2026.1.5')).toBe('2026-01-05');
  });

  it('두 자리 연도는 2000년대로 본다', () => {
    expect(parseDate('26.01.05')).toBe('2026-01-05');
  });

  it('시각이 붙어 있어도 날짜만 뽑는다', () => {
    expect(parseDate('2026-01-05 14:32:10')).toBe('2026-01-05');
  });

  it('연도가 없으면 defaultYear를 붙인다', () => {
    expect(parseDate('01/05', 2026)).toBe('2026-01-05');
  });

  it('연도가 없고 defaultYear도 없으면 null이다', () => {
    // 연도를 멋대로 올해로 채우면 3개월 시뮬레이션이 통째로 어긋난다.
    expect(parseDate('01/05')).toBeNull();
  });

  it('달력에 없는 날짜는 null이다', () => {
    expect(parseDate('2026-02-30')).toBeNull();
    expect(parseDate('2026-13-01')).toBeNull();
  });

  it('읽을 수 없으면 null이다', () => {
    expect(parseDate('')).toBeNull();
    expect(parseDate('합계')).toBeNull();
  });
});

describe('parsePaymentType', () => {
  it('일시불 표기를 읽는다', () => {
    expect(parsePaymentType('일시불')).toBe('lump');
    expect(parsePaymentType('00')).toBe('lump');
    expect(parsePaymentType('1')).toBe('lump');
    expect(parsePaymentType('')).toBe('lump');
  });

  it('무이자가 붙으면 무이자할부다', () => {
    // 무이자할부는 실적에서 통째로 빠지는 카드가 많아 일반 할부와 구분해야 한다.
    expect(parsePaymentType('무이자할부')).toBe('interestFreeInstallment');
    expect(parsePaymentType('무이자 3개월')).toBe('interestFreeInstallment');
    expect(parsePaymentType('할부(무이자/3개월)')).toBe('interestFreeInstallment');
  });

  it('할부 표기와 2 이상의 개월수는 할부다', () => {
    expect(parsePaymentType('할부')).toBe('installment');
    expect(parsePaymentType('3개월')).toBe('installment');
    expect(parsePaymentType('03')).toBe('installment');
  });
});

describe('normalizeMerchant', () => {
  it('대소문자와 공백을 없앤다', () => {
    expect(normalizeMerchant('Star Bucks COEX')).toBe('starbuckscoex');
  });

  it('사업자 표기 접두사를 걷어낸다', () => {
    expect(normalizeMerchant('(주)스타벅스코리아')).toBe('스타벅스코리아');
    expect(normalizeMerchant('주식회사 배달의민족')).toBe('배달의민족');
  });

  it('숫자는 남긴다', () => {
    // GS25, CU, 11번가처럼 숫자가 상호의 일부인 가맹점이 많다.
    expect(normalizeMerchant('GS25 역삼점')).toBe('gs25역삼점');
  });
});
