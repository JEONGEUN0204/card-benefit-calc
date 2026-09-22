import type { Benefit, Transaction } from './types.js';

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
 * 여러 조건이 함께 있으면 AND로 묶는다. 단 `excludeMerchants`는 항상 우선한다 —
 * "카페 업종 할인, 단 공항 매장 제외" 같은 약관 문구를 그대로 표현하기 위해서다.
 */
export function matchesBenefit(tx: Transaction, benefit: Benefit): boolean {
  const { categories, merchants, excludeMerchants } = benefit.match;

  if (excludeMerchants?.length && includesAny(tx.merchant, excludeMerchants)) {
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
