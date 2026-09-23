/** 가맹점명 → 카테고리 매핑 규칙. */

export type MatchKind =
  /** 정규화된 이름에 패턴이 들어 있으면 매칭 (기본) */
  | 'contains'
  /** 정규화된 이름이 패턴과 완전히 같아야 매칭 */
  | 'exact'
  /** 원본 이름에 정규식 매칭 (대소문자 무시) */
  | 'regex';

/** 무엇에 맞출지. 카드사가 업종명을 주는 명세서라면 그쪽으로도 맞출 수 있다. */
export type MatchField = 'merchant' | 'issuerCategory';

export interface CategoryRule {
  /** 어떤 규칙이 분류를 정했는지 되짚기 위한 식별자. */
  id: string;
  pattern: string;
  /** `core`의 카드 규칙이 쓰는 카테고리와 같은 어휘여야 한다. `vocabulary.ts` 참고. */
  category: string;
  match?: MatchKind;
  field?: MatchField;
  /** 사용자가 왜 이렇게 정했는지 남기는 메모. */
  note?: string;
}

/**
 * 규칙집.
 *
 * `builtin`은 앱이 들고 다니는 기본 매핑이고, `user`는 사용자가 고친 것이다. 사용자 규칙이
 * 항상 이긴다 — 기본 매핑이 내 단골집을 잘못 분류했을 때 앱을 고치지 않고 바로잡을 수
 * 있어야 한다.
 */
export interface CategoryRuleset {
  readonly user: readonly CategoryRule[];
  readonly builtin: readonly CategoryRule[];
  /** 어느 규칙에도 안 걸린 거래의 카테고리. */
  readonly fallback: string;
}

/** 분류 대상. 명세서 한 행에서 뽑아낸다. */
export interface Categorizable {
  merchant: string;
  /** 카드사가 명세서에 적어준 업종명. 있으면 보조 단서로 쓴다. */
  issuerCategory?: string;
}

export interface CategoryMatch {
  category: string;
  /** 분류를 정한 규칙. fallback이면 null. */
  ruleId: string | null;
  source: 'user' | 'builtin' | 'fallback';
}
