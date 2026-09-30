import type { Benefit, HourRange, Transaction, Weekday } from './types.js';

/** `Date.getUTCDay()`가 돌려주는 0~6 순서. */
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const satisfies readonly Weekday[];

/**
 * 거래 날짜의 요일.
 *
 * 같은 날짜 문자열이 어디서 돌아도 같은 요일이어야 하므로 UTC로 고정해 계산한다. 로컬
 * 시간대로 파싱하면 서버와 브라우저에서 다른 답이 나올 수 있다.
 */
function weekdayOf(date: string): Weekday | null {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (matched === null) return null;
  const [, year, month, day] = matched;
  const at = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return WEEKDAYS[at.getUTCDay()] ?? null;
}

/** `HH:MM`을 자정부터의 분으로. 형식이 어긋나면 null이다. */
function minutesOf(time: string): number | null {
  const matched = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (matched === null) return null;
  const [, hour, minute] = matched;
  const h = Number(hour);
  const m = Number(minute);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/** `from` 포함, `to` 미포함. `from`이 더 크면 자정을 넘는 구간이다. */
function withinHours(minutes: number, range: HourRange): boolean {
  const from = range.from * 60;
  const to = range.to * 60;
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

/**
 * 가맹점명 비교용 정규화.
 *
 * 명세서의 가맹점명은 "스타벅스 강남2호점", "STARBUCKS COEX"처럼 지점명과 공백이
 * 제각각 붙어 나온다. 규칙에는 브랜드명만 적고, 비교할 때 공백·대소문자를 없앤다.
 */
function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

function includesAny(haystack: string, needles: readonly string[]): boolean {
  const h = normalize(haystack);
  return needles.some((n) => h.includes(normalize(n)));
}

/**
 * 거래가 혜택의 매칭 조건을 만족하는지 판정한다.
 *
 * 조건이 비어 있으면 "조건 없음"으로 본다. `match: {}`는 전 가맹점 할인이다.
 * 여러 조건이 함께 있으면 AND로 묶는다. 단 제외 조건(`exclude*`)은 항상 우선한다 —
 * "카페 업종 할인, 단 공항 매장 제외" 같은 약관 문구를 그대로 표현하기 위해서다.
 */
export function matchesBenefit(tx: Transaction, benefit: Benefit): boolean {
  const {
    categories,
    merchants,
    excludeMerchants,
    excludeCategories,
    excludePaymentTypes,
    overseas,
    weekdays,
    hours,
  } = benefit.match;

  // 해외 표시가 없는 거래는 국내로 본다.
  if (overseas !== undefined && overseas !== (tx.overseas === true)) {
    return false;
  }
  if (weekdays !== undefined && weekdays.length > 0) {
    const day = weekdayOf(tx.date);
    if (day === null || !weekdays.includes(day)) return false;
  }
  // 승인 시간을 모르는 거래에는 시간대 혜택을 붙이지 않는다. 짐작으로 붙이면 밤에 쓰지 않은
  // 결제가 할인으로 잡혀, 오류 없이 할인액만 늘어난다.
  if (hours !== undefined) {
    const minutes = tx.time === undefined ? null : minutesOf(tx.time);
    if (minutes === null || !withinHours(minutes, hours)) return false;
  }
  if (excludeMerchants?.length && includesAny(tx.merchant, excludeMerchants)) {
    return false;
  }
  if (excludeCategories?.includes(tx.category)) {
    return false;
  }
  // 결제유형을 적지 않은 명세서 줄은 일시불로 본다. 실적 제외(`spending.ts`)와 같은 기준이다.
  if (excludePaymentTypes?.includes(tx.paymentType ?? 'lump')) {
    return false;
  }
  if (categories?.length && !categories.includes(tx.category)) {
    return false;
  }
  if (merchants?.length && !includesAny(tx.merchant, merchants)) {
    return false;
  }
  return true;
}

/**
 * 거래에 매칭되는 혜택을 우선순위 내림차순으로 돌려준다.
 *
 * 동률일 때 정의 순서를 유지해야 같은 입력이 항상 같은 결과를 내므로 안정 정렬을 쓴다.
 * 실제로 어느 혜택을 적용할지는 한도·최소금액을 아는 `discount.ts`가 정한다.
 */
export function matchBenefits(tx: Transaction, benefits: readonly Benefit[]): Benefit[] {
  return benefits
    .filter((b) => matchesBenefit(tx, b))
    .map((b, index) => ({ b, index }))
    .sort((x, y) => (y.b.priority ?? 0) - (x.b.priority ?? 0) || x.index - y.index)
    .map(({ b }) => b);
}
