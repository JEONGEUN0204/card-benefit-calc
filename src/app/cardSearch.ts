import type { CardRule } from '../core/index.js';

/** 대소문자와 띄어쓰기를 지운다. "Deep Dream"을 "deepdream"으로도 찾게 한다. */
const normalize = (text: string): string => text.toLocaleLowerCase('ko-KR').replace(/\s+/g, '');

/**
 * 카드 고르기의 검색. 카드 이름이나 카드사 이름에 검색어가 들어 있는 카드를 카드사별로
 * 묶어 돌려준다. 카드사는 가나다순, 같은 카드사 안에서는 들어온 순서를 지킨다.
 *
 * 카드가 늘어나면 드롭다운 한 줄로는 찾을 수 없어 이 함수를 둔다. 화면과 떼어 둔 것은
 * 순서와 묶음 규칙을 테스트로 못 박기 위해서다.
 */
export function searchCards(
  cards: readonly CardRule[],
  query: string,
): [issuer: string, cards: CardRule[]][] {
  const needle = normalize(query);
  const groups = new Map<string, CardRule[]>();
  for (const card of cards) {
    if (needle !== '' && !normalize(`${card.issuer}${card.name}`).includes(needle)) continue;
    const bucket = groups.get(card.issuer);
    if (bucket === undefined) groups.set(card.issuer, [card]);
    else bucket.push(card);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b, 'ko'));
}
