/**
 * localStorage 래퍼.
 *
 * 여기엔 사용자가 고친 카테고리 규칙과 마지막으로 고른 카드, 카드별로 고른 택1 선택지만 넣는다. 거래 내역은 저장하지
 * 않는다 — 탭을 닫으면 사라지는 편이 명세서를 다루는 도구로서 덜 놀랍다.
 * 사생활 보호 모드 등에서는 접근 자체가 throw할 수 있어 전부 감싼다.
 */
export const STORAGE_KEYS = {
  userRules: 'sunhalin:user-category-rules',
  cardId: 'sunhalin:card-id',
  choices: 'sunhalin:card-choices',
} as const;

/** 카드 id → (선택지 그룹 id → 고른 선택지 id). */
export type SavedChoices = Record<string, Record<string, string>>;

/**
 * 저장된 택1 선택을 읽는다. 모양이 틀린 값은 버린다 — 여기서 틀린 값은 계산을 막지 않는다.
 * `resolveChoices`가 모르는 선택지를 첫 선택지로 돌리기 때문이다.
 */
export function parseSavedChoices(text: string | null): SavedChoices {
  if (text === null) return {};
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    const out: SavedChoices = {};
    for (const [cardId, picks] of Object.entries(value)) {
      if (typeof picks !== 'object' || picks === null || Array.isArray(picks)) continue;
      const clean: Record<string, string> = {};
      for (const [group, option] of Object.entries(picks)) {
        if (typeof option === 'string') clean[group] = option;
      }
      out[cardId] = clean;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * 서비스 이름을 순할인으로 바꾸기 전에 쓰던 키.
 *
 * 새 키가 비어 있을 때만 읽는다. 이름을 바꿨다고 사용자가 직접 고친 업종 규칙이
 * 사라지면 안 된다. 다음 저장이 새 키로 들어가므로 옮겨 쓰는 코드는 따로 두지 않는다.
 */
const LEGACY_KEYS: Readonly<Record<string, string>> = {
  [STORAGE_KEYS.userRules]: 'card-benefit-calc:user-category-rules',
  [STORAGE_KEYS.cardId]: 'card-benefit-calc:card-id',
};

export function loadString(key: string): string | null {
  try {
    const current = window.localStorage.getItem(key);
    if (current !== null) return current;

    const legacy = LEGACY_KEYS[key];
    return legacy === undefined ? null : window.localStorage.getItem(legacy);
  } catch {
    return null;
  }
}

export function saveString(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 저장을 못 해도 이번 세션 동안은 메모리 상태로 계속 동작한다.
  }
}

/**
 * 브라우저에서 규칙 JSON을 받던 시절의 키.
 *
 * 그 길을 없앤 뒤로는 읽는 곳이 없다. 남겨 두면 화면이 쓰지 않는 카드 규칙이 사용자 브라우저에
 * 계속 앉아 있게 되므로, 앱이 뜰 때 한 번 지운다.
 */
const DROPPED_KEYS = ['sunhalin:user-cards'] as const;

export function dropObsolete(): void {
  try {
    for (const key of DROPPED_KEYS) window.localStorage.removeItem(key);
  } catch {
    // 접근이 막혀 지우지 못해도, 읽는 곳이 없으므로 계산에는 영향이 없다.
  }
}
