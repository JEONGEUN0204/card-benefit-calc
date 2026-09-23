import { describe, expect, it } from 'vitest';
import {
  UNCATEGORIZED,
  addUserRule,
  categorize,
  defaultRuleset,
  parseUserRules,
  removeUserRule,
  serializeUserRules,
  withUserRules,
} from '../category/rules.js';
import type { CategoryRule } from '../category/types.js';

const rule = (over: Partial<CategoryRule> & { id: string }): CategoryRule => ({
  pattern: 'x',
  category: 'etc',
  ...over,
});

describe('categorize — 기본 규칙', () => {
  it('브랜드명 부분일치로 카테고리를 정한다', () => {
    const rs = defaultRuleset();
    expect(categorize({ merchant: '스타벅스 강남2호점' }, rs).category).toBe('cafe');
    expect(categorize({ merchant: 'GS25 역삼점' }, rs).category).toBe('convenience');
    expect(categorize({ merchant: '배달의민족' }, rs).category).toBe('delivery');
  });

  it('카드사가 준 업종명으로도 분류한다', () => {
    const rs = defaultRuleset();
    const got = categorize({ merchant: '이름없는커피집', issuerCategory: '커피전문점' }, rs);
    expect(got.category).toBe('cafe');
  });

  it('가맹점명 규칙이 업종명 규칙보다 앞선다', () => {
    // 카드사 업종 분류는 뭉뚱그려질 때가 있어 브랜드명이 더 정확하다.
    const rs = defaultRuleset();
    const got = categorize({ merchant: '스타벅스 강남점', issuerCategory: '일반음식점' }, rs);
    expect(got.category).toBe('cafe');
  });

  it('어디에도 안 걸리면 미분류로 남긴다', () => {
    // 'etc'로 뭉개면 사용자가 고칠 지점이 사라진다.
    const got = categorize({ merchant: '알수없는가맹점' }, defaultRuleset());
    expect(got.category).toBe(UNCATEGORIZED);
    expect(got.source).toBe('fallback');
    expect(got.ruleId).toBeNull();
  });
});

describe('categorize — 사용자 규칙', () => {
  it('사용자 규칙이 기본 규칙을 이긴다', () => {
    const rs = withUserRules(defaultRuleset(), [
      rule({ id: 'u1', pattern: '스타벅스', category: 'restaurant' }),
    ]);
    const got = categorize({ merchant: '스타벅스 강남점' }, rs);
    expect(got.category).toBe('restaurant');
    expect(got.source).toBe('user');
    expect(got.ruleId).toBe('u1');
  });

  it('사용자 규칙끼리는 앞에 있는 것이 이긴다', () => {
    const rs = withUserRules(defaultRuleset(), [
      rule({ id: 'first', pattern: '동네', category: 'cafe' }),
      rule({ id: 'second', pattern: '동네', category: 'mart' }),
    ]);
    expect(categorize({ merchant: '동네가게' }, rs).ruleId).toBe('first');
  });

  it('exact는 정규화된 전체 일치만 맞춘다', () => {
    const rs = withUserRules(defaultRuleset(), [
      rule({ id: 'u1', pattern: '동네가게', category: 'mart', match: 'exact' }),
    ]);
    expect(categorize({ merchant: '동네가게' }, rs).category).toBe('mart');
    expect(categorize({ merchant: '동네가게 2호점' }, rs).category).toBe(UNCATEGORIZED);
  });

  it('regex를 쓸 수 있다', () => {
    const rs = withUserRules(defaultRuleset(), [
      rule({ id: 'u1', pattern: '^택시[0-9]+$', category: 'transport', match: 'regex' }),
    ]);
    expect(categorize({ merchant: '택시1234' }, rs).ruleId).toBe('u1');
    // 앵커가 걸려 이 규칙은 비껴간다. 기본 규칙의 '택시'에는 여전히 걸리므로
    // 카테고리가 아니라 어느 규칙이 정했는지로 확인한다.
    expect(categorize({ merchant: '택시요금정산' }, rs).ruleId).not.toBe('u1');
  });

  it('깨진 regex는 던지지 않고 건너뛴다', () => {
    // 사용자가 직접 고치는 규칙이므로 한 줄이 잘못돼도 나머지 분류가 멈추면 안 된다.
    const rs = withUserRules(defaultRuleset(), [
      rule({ id: 'bad', pattern: '(((', category: 'transport', match: 'regex' }),
    ]);
    expect(() => categorize({ merchant: '스타벅스' }, rs)).not.toThrow();
    expect(categorize({ merchant: '스타벅스' }, rs).category).toBe('cafe');
  });
});

describe('규칙 편집', () => {
  it('addUserRule은 맨 앞에 넣어 최근 수정이 이기게 한다', () => {
    const rs = addUserRule(
      withUserRules(defaultRuleset(), [rule({ id: 'old', pattern: '동네', category: 'cafe' })]),
      { pattern: '동네가게', category: 'mart' },
    );
    expect(categorize({ merchant: '동네가게' }, rs).category).toBe('mart');
  });

  it('같은 패턴을 다시 지정하면 덮어쓴다', () => {
    const one = addUserRule(defaultRuleset(), { pattern: '동네가게', category: 'cafe' });
    const two = addUserRule(one, { pattern: '동네가게', category: 'mart' });
    expect(two.user).toHaveLength(1);
    expect(categorize({ merchant: '동네가게' }, two).category).toBe('mart');
  });

  it('원본 규칙집을 건드리지 않는다', () => {
    const base = defaultRuleset();
    addUserRule(base, { pattern: '동네가게', category: 'mart' });
    expect(base.user).toHaveLength(0);
  });

  it('removeUserRule은 id로 지운다', () => {
    const rs = withUserRules(defaultRuleset(), [rule({ id: 'u1', pattern: '동네', category: 'mart' })]);
    expect(removeUserRule(rs, 'u1').user).toHaveLength(0);
  });
});

describe('사용자 규칙 직렬화', () => {
  it('저장했다 읽으면 그대로 돌아온다', () => {
    const rs = addUserRule(defaultRuleset(), { pattern: '동네가게', category: 'mart', note: '집 앞' });
    const back = parseUserRules(serializeUserRules(rs));
    expect(back).toEqual(rs.user);
  });

  it('형식이 깨진 항목은 버리고 나머지를 살린다', () => {
    const json = JSON.stringify([
      { id: 'ok', pattern: '동네가게', category: 'mart' },
      { id: 'no-category', pattern: '동네' },
      'garbage',
    ]);
    expect(parseUserRules(json).map((r) => r.id)).toEqual(['ok']);
  });

  it('JSON 자체가 깨졌으면 빈 배열이다', () => {
    expect(parseUserRules('{{{')).toEqual([]);
  });
});
