import type { Won } from '../core/index.js';

/**
 * 금액 입력칸. 콤마·"원"·공백을 섞어 적어도 숫자만 읽는다. 비우면 null.
 *
 * 입력칸을 `type="text"`로 두고 여기서 거르는 이유는 `type="number"`가 모바일에서
 * 콤마를 받지 못하고 스피너를 달기 때문이다. 사람은 "1,000,000원"이라고 적는다.
 */
export function parseAmountInput(text: string): Won | null {
  const digits = text.replace(/[^0-9]/g, '');
  return digits === '' ? null : Number(digits);
}

/** 입력칸에 되돌려 적을 문자열. 0도 적어야 하므로 null과 0을 가른다. */
export function formatAmountInput(value: Won | null | undefined): string {
  return value === null || value === undefined ? '' : value.toLocaleString('ko-KR');
}
