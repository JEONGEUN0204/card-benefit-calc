import { describe, expect, it } from 'vitest';
import { matchBenefits, matchesBenefit } from '../match.js';
import { benefit, tx } from './helpers.js';

describe('matchesBenefit', () => {
  it('카테고리가 일치하면 매칭된다', () => {
    const b = benefit({ id: 'cafe', match: { categories: ['cafe'] } });
    expect(matchesBenefit(tx({ id: 't1', category: 'cafe' }), b)).toBe(true);
    expect(matchesBenefit(tx({ id: 't2', category: 'mart' }), b)).toBe(false);
  });

  it('가맹점명은 부분일치한다', () => {
    const b = benefit({ id: 'sb', match: { merchants: ['스타벅스'] } });
    expect(matchesBenefit(tx({ id: 't1', merchant: '스타벅스 강남2호점' }), b)).toBe(true);
    expect(matchesBenefit(tx({ id: 't2', merchant: '투썸플레이스' }), b)).toBe(false);
  });

  it('가맹점명 비교는 대소문자와 공백을 무시한다', () => {
    const b = benefit({ id: 'sb', match: { merchants: ['STARBUCKS'] } });
    expect(matchesBenefit(tx({ id: 't1', merchant: 'star bucks coex' }), b)).toBe(true);
  });

  it('excludeMerchants가 merchants보다 우선한다', () => {
    const b = benefit({
      id: 'cafe',
      match: { categories: ['cafe'], excludeMerchants: ['공항'] },
    });
    expect(matchesBenefit(tx({ id: 't1', category: 'cafe', merchant: '카페 인천공항점' }), b)).toBe(false);
    expect(matchesBenefit(tx({ id: 't2', category: 'cafe', merchant: '카페 역삼점' }), b)).toBe(true);
  });

  it('카테고리와 가맹점 조건이 함께 있으면 둘 다 만족해야 한다', () => {
    const b = benefit({ id: 'x', match: { categories: ['cafe'], merchants: ['스타벅스'] } });
    expect(matchesBenefit(tx({ id: 't1', category: 'cafe', merchant: '스타벅스' }), b)).toBe(true);
    expect(matchesBenefit(tx({ id: 't2', category: 'mart', merchant: '스타벅스' }), b)).toBe(false);
  });

  it('조건이 비어 있으면 모든 거래에 매칭된다 (전 가맹점 할인)', () => {
    const b = benefit({ id: 'all', match: {} });
    expect(matchesBenefit(tx({ id: 't1', category: 'anything' }), b)).toBe(true);
  });
});

describe('matchBenefits', () => {
  it('매칭되는 혜택을 priority 내림차순으로 돌려준다', () => {
    const low = benefit({ id: 'low', match: {}, priority: 1 });
    const high = benefit({ id: 'high', match: {}, priority: 9 });
    const none = benefit({ id: 'none', match: { categories: ['taxi'] } });
    const got = matchBenefits(tx({ id: 't1', category: 'cafe' }), [low, high, none]);
    expect(got.map((b) => b.id)).toEqual(['high', 'low']);
  });

  it('priority가 없으면 0으로 보고, 동률이면 정의 순서를 유지한다', () => {
    const a = benefit({ id: 'a', match: {} });
    const b2 = benefit({ id: 'b', match: {}, priority: 0 });
    const got = matchBenefits(tx({ id: 't1' }), [a, b2]);
    expect(got.map((b) => b.id)).toEqual(['a', 'b']);
  });

  it('매칭이 없으면 빈 배열이다', () => {
    const b = benefit({ id: 'taxi', match: { categories: ['taxi'] } });
    expect(matchBenefits(tx({ id: 't1', category: 'cafe' }), [b])).toEqual([]);
  });
});
