import type { CardRule } from '../../core/index.js';
import { searchCards } from '../cardSearch.js';

const card = (id: string, name: string, issuer: string): CardRule => ({
  id,
  name,
  issuer,
  annualFee: 0,
  tiers: [{ min: 0 }],
  benefits: [],
  spendingExclusions: [],
  rounding: 'floor1',
});

const CARDS = [
  card('toss', '토스 삼성카드', '삼성카드'),
  card('taptap', 'taptap O', '삼성카드'),
  card('deep', '신한카드 Deep Dream', '신한카드'),
  card('kb', 'KB국민 My WE:SH', 'KB국민카드'),
];

const ids = (groups: ReturnType<typeof searchCards>) =>
  groups.flatMap(([, list]) => list.map((c) => c.id));

describe('searchCards', () => {
  it('빈 검색어면 전부를 카드사 가나다순으로 묶는다 — 한국어 정렬이라 한글이 영문보다 앞', () => {
    const groups = searchCards(CARDS, '');
    expect(groups.map(([issuer]) => issuer)).toEqual(['삼성카드', '신한카드', 'KB국민카드']);
    expect(ids(groups)).toEqual(['toss', 'taptap', 'deep', 'kb']);
  });

  it('카드 이름의 일부로 찾는다', () => {
    expect(ids(searchCards(CARDS, '토스'))).toEqual(['toss']);
  });

  it('카드사 이름으로 찾으면 그 카드사 카드가 모두 나온다', () => {
    expect(ids(searchCards(CARDS, '삼성'))).toEqual(['toss', 'taptap']);
  });

  it('대소문자와 띄어쓰기를 가리지 않는다', () => {
    expect(ids(searchCards(CARDS, 'deepdream'))).toEqual(['deep']);
    expect(ids(searchCards(CARDS, 'TAPTAP'))).toEqual(['taptap']);
  });

  it('맞는 카드가 없으면 빈 목록이다', () => {
    expect(searchCards(CARDS, '현대')).toEqual([]);
  });
});
