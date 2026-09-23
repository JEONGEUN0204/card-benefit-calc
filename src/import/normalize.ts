/**
 * 명세서 셀 → 계산 엔진이 쓰는 값.
 *
 * 카드사마다 날짜 구분자, 금액 표기, 할부 표기가 다르다. 여기서 한 번에 흡수해서
 * 포맷별 파서는 "어느 컬럼이 무엇인가"만 적게 한다.
 */
import type { PaymentType, Won } from '../core/types.js';

/** 회계식 괄호 표기와 카드사가 쓰는 음수 기호. */
const NEGATIVE_MARKS = ['-', '△', '▲', '−'];

/**
 * "12,340원", "₩12,340", "(12,340)" → 정수 원.
 *
 * 읽을 수 없으면 null이다. 0으로 뭉개면 "금액을 못 읽었다"와 "0원 결제"가 섞여서
 * 사용자가 무엇이 빠졌는지 알 수 없게 된다.
 */
export function parseWon(raw: string): Won | null {
  const text = raw.trim();
  if (text === '') return null;

  const negative =
    (/^\(.*\)$/.test(text) && /\d/.test(text)) || NEGATIVE_MARKS.some((m) => text.includes(m));
  const digits = text.replace(/[^0-9.]/g, '');
  if (!/\d/.test(digits)) return null;

  const value = Number(digits);
  if (!Number.isFinite(value)) return null;

  // 엑셀 셀이 만든 부동소수 꼬리(12339.9999999)를 정수로 되돌리는 것이라, 할인액 절사
  // (core/rounding.ts)와는 성격이 다르다. 명세서에 적힌 결제액은 애초에 정수다.
  const won = Math.round(value);
  return negative ? -won : won;
}

function toIsoDate(year: number, month: number, day: number): string | null {
  const y = year < 100 ? 2000 + year : year;
  if (y < 1000) return null;

  // 2026-02-30 같은 값은 Date가 조용히 3월로 굴려버린다. 되돌려 확인한다.
  const date = new Date(Date.UTC(y, month - 1, day));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * "2026.01.05", "26-01-05", "20260105", "01/05" → 'YYYY-MM-DD'.
 *
 * 연도가 없는 명세서는 `defaultYear` 없이는 null이다. 멋대로 올해를 붙이면 몇 달치
 * 시뮬레이션이 통째로 어긋나는데, 결과 숫자는 그럴듯해서 눈치채기 어렵다.
 */
export function parseDate(raw: string, defaultYear?: number): string | null {
  const head = raw.trim().split(/\s+/)[0] ?? '';
  if (head === '') return null;

  const full = head.match(/^(\d{2,4})[.\-/](\d{1,2})[.\-/](\d{1,2})\.?$/);
  if (full?.[1] !== undefined && full[2] !== undefined && full[3] !== undefined) {
    return toIsoDate(Number(full[1]), Number(full[2]), Number(full[3]));
  }

  const packed = head.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (packed?.[1] !== undefined && packed[2] !== undefined && packed[3] !== undefined) {
    return toIsoDate(Number(packed[1]), Number(packed[2]), Number(packed[3]));
  }

  const noYear = head.match(/^(\d{1,2})[.\-/](\d{1,2})\.?$/);
  if (noYear?.[1] !== undefined && noYear[2] !== undefined && defaultYear !== undefined) {
    return toIsoDate(defaultYear, Number(noYear[1]), Number(noYear[2]));
  }

  return null;
}

/**
 * "일시불", "무이자 3개월", "03" → 결제유형.
 *
 * 무이자할부는 실적에서 통째로 빼는 카드가 많아 일반 할부와 반드시 구분해야 한다.
 * 알 수 없는 표기는 일시불로 본다 — `core/spending.ts`가 쓰는 기본값과 같다.
 */
export function parsePaymentType(raw: string): PaymentType {
  const text = raw.trim();
  if (text === '') return 'lump';
  if (text.includes('무이자')) return 'interestFreeInstallment';
  if (text.includes('할부')) return 'installment';
  if (text.includes('일시불')) return 'lump';

  const months = Number(text.replace(/[^0-9]/g, ''));
  return Number.isFinite(months) && months >= 2 ? 'installment' : 'lump';
}

const COMPANY_PREFIX = /^(\(주\)|\(유\)|㈜|주식회사|유한회사)\s*/;

/**
 * 가맹점명 비교용 정규화.
 *
 * `core/match.ts`의 정규화(공백·대소문자 무시)에 사업자 표기 제거를 더한 것이다.
 * 숫자는 남긴다 — GS25, CU, 11번가처럼 숫자가 상호의 일부인 가맹점이 많다.
 */
export function normalizeMerchant(s: string): string {
  return s.trim().replace(COMPANY_PREFIX, '').toLowerCase().replace(/\s+/g, '');
}
