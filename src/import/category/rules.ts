/**
 * 카테고리 규칙집 조작과 분류.
 *
 * 기본 매핑은 반드시 틀린다 — 동네 가게, 새로 생긴 브랜드, 사람마다 다른 분류 기준까지
 * 앱이 알 수는 없다. 그래서 사용자 규칙이 기본 규칙을 항상 이기고, 어디에도 안 걸린
 * 가맹점은 `etc`로 뭉개지 않고 `uncategorized`로 남겨 고칠 지점을 드러낸다.
 */
import { normalizeMerchant } from '../normalize.js';
import { BUILTIN_CATEGORY_RULES } from './defaults.js';
import type {
  Categorizable,
  CategoryMatch,
  CategoryRule,
  CategoryRuleset,
  MatchField,
  MatchKind,
} from './types.js';

/** 규칙에 걸리지 않은 거래의 카테고리. */
export const UNCATEGORIZED = 'uncategorized';

const MATCH_KINDS: readonly MatchKind[] = ['contains', 'exact', 'regex'];
const MATCH_FIELDS: readonly MatchField[] = ['merchant', 'issuerCategory'];

export function defaultRuleset(): CategoryRuleset {
  return { user: [], builtin: BUILTIN_CATEGORY_RULES, fallback: UNCATEGORIZED };
}

/** 저장해둔 사용자 규칙을 얹은 규칙집을 만든다. */
export function withUserRules(
  ruleset: CategoryRuleset,
  user: readonly CategoryRule[],
): CategoryRuleset {
  return { ...ruleset, user: [...user] };
}

/** id 없이 적어도 되게 하는 입력 형태. */
export type NewCategoryRule = Omit<CategoryRule, 'id'> & { id?: string };

function ruleId(rule: NewCategoryRule): string {
  if (rule.id !== undefined) return rule.id;
  const field = rule.field ?? 'merchant';
  const kind = rule.match ?? 'contains';
  return `user:${field}:${kind}:${normalizeMerchant(rule.pattern)}`;
}

/**
 * 사용자 규칙을 맨 앞에 넣는다.
 *
 * 같은 대상(필드·매칭방식·패턴)의 기존 규칙은 지운다. 같은 가맹점을 다시 지정하면
 * 덮어쓰는 것이 사용자가 기대하는 동작이고, 안 그러면 죽은 규칙이 쌓인다.
 */
export function addUserRule(ruleset: CategoryRuleset, rule: NewCategoryRule): CategoryRuleset {
  const id = ruleId(rule);
  const next: CategoryRule = {
    id,
    pattern: rule.pattern,
    category: rule.category,
    ...(rule.match === undefined ? {} : { match: rule.match }),
    ...(rule.field === undefined ? {} : { field: rule.field }),
    ...(rule.note === undefined ? {} : { note: rule.note }),
  };
  return { ...ruleset, user: [next, ...ruleset.user.filter((r) => r.id !== id)] };
}

export function removeUserRule(ruleset: CategoryRuleset, id: string): CategoryRuleset {
  return { ...ruleset, user: ruleset.user.filter((r) => r.id !== id) };
}

function valueFor(rule: CategoryRule, input: Categorizable): string {
  return (rule.field === 'issuerCategory' ? input.issuerCategory : input.merchant) ?? '';
}

function ruleMatches(rule: CategoryRule, input: Categorizable): boolean {
  const value = valueFor(rule, input);
  if (value.trim() === '' || rule.pattern === '') return false;

  if (rule.match === 'regex') {
    // 정규식은 정규화하지 않은 원본에 맞춘다. 사용자가 적은 공백·대소문자가 그대로
    // 의미를 갖는 편이 덜 놀랍다.
    try {
      return new RegExp(rule.pattern, 'i').test(value.trim());
    } catch {
      // 사용자가 직접 고치는 규칙이다. 한 줄이 깨졌다고 나머지 분류가 멈추면 안 된다.
      return false;
    }
  }

  const haystack = normalizeMerchant(value);
  const needle = normalizeMerchant(rule.pattern);
  return rule.match === 'exact' ? haystack === needle : haystack.includes(needle);
}

/**
 * 거래 한 건의 카테고리를 정한다.
 *
 * 사용자 규칙 → 기본 규칙 → fallback 순으로 본다. 어느 규칙이 정했는지(`ruleId`) 같이
 * 돌려줘서, 분류가 이상할 때 어느 줄을 고쳐야 하는지 사용자가 알 수 있게 한다.
 */
export function categorize(input: Categorizable, ruleset: CategoryRuleset): CategoryMatch {
  for (const rule of ruleset.user) {
    if (ruleMatches(rule, input)) {
      return { category: rule.category, ruleId: rule.id, source: 'user' };
    }
  }
  for (const rule of ruleset.builtin) {
    if (ruleMatches(rule, input)) {
      return { category: rule.category, ruleId: rule.id, source: 'builtin' };
    }
  }
  return { category: ruleset.fallback, ruleId: null, source: 'fallback' };
}

/** 사용자 규칙만 저장 형식(JSON)으로 내보낸다. 기본 규칙은 앱이 들고 있다. */
export function serializeUserRules(ruleset: CategoryRuleset): string {
  return JSON.stringify(ruleset.user, null, 2);
}

function toRule(value: unknown): CategoryRule | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v['id'] !== 'string' || typeof v['pattern'] !== 'string') return null;
  if (typeof v['category'] !== 'string') return null;

  const match = v['match'];
  if (match !== undefined && !MATCH_KINDS.includes(match as MatchKind)) return null;
  const field = v['field'];
  if (field !== undefined && !MATCH_FIELDS.includes(field as MatchField)) return null;
  const note = v['note'];
  if (note !== undefined && typeof note !== 'string') return null;

  return {
    id: v['id'],
    pattern: v['pattern'],
    category: v['category'],
    ...(match === undefined ? {} : { match: match as MatchKind }),
    ...(field === undefined ? {} : { field: field as MatchField }),
    ...(note === undefined ? {} : { note: note as string }),
  };
}

/**
 * 저장해둔 사용자 규칙을 읽는다.
 *
 * 형식이 깨진 항목은 버리고 나머지를 살린다. 규칙 하나가 잘못됐다고 사용자가 쌓아온
 * 분류를 통째로 잃게 할 이유가 없다.
 */
export function parseUserRules(json: string): CategoryRule[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const rules: CategoryRule[] = [];
  for (const item of parsed) {
    const rule = toRule(item);
    if (rule !== null) rules.push(rule);
  }
  return rules;
}
