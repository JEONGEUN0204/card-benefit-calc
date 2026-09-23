/**
 * 표준 카테고리 어휘.
 *
 * 파서가 내는 카테고리와 `fixtures/cards/`의 카드 규칙이 쓰는 카테고리는 같은 말을 써야
 * 한다. 어긋나면 매칭이 안 돼 할인이 조용히 0원이 되는데, 결과가 그럴듯해서 눈으로는
 * 잡히지 않는다. 카드 규칙에 새 카테고리를 쓸 때는 여기에도 추가한다.
 */
const VOCABULARY = [
  'cafe',
  'restaurant',
  'convenience',
  'mart',
  'online',
  'delivery',
  'transport',
  'gas',
  'travel',
  'telecom',
  'utility',
  'insurance',
  'tax',
  'giftCard',
  'movie',
  'culture',
  'hospital',
  'beauty',
  'fashion',
  'education',
  'pet',
  'sports',
  'etc',
  /** 규칙에 걸리지 않아 사용자가 정해줘야 하는 상태. */
  'uncategorized',
] as const;

export type Category = (typeof VOCABULARY)[number];

/** 임의의 문자열과 대조하기 위해 넓은 타입으로 내보낸다. */
export const CATEGORIES: readonly string[] = VOCABULARY;

export function isKnownCategory(value: string): value is Category {
  return VOCABULARY.includes(value as Category);
}
