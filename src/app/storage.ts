/**
 * localStorage 래퍼.
 *
 * 여기 넣는 것은 고른 카드, 카드별로 고른 택1 선택지, 그리고 처방 입력(월 예산과 항목별
 * 지출 상한, 카드별 최소·최대)이다. 거래 내역은 저장하지 않는다 — 애초에 받지 않는다.
 *
 * 지출 상한은 거래가 아니지만 사용자가 적은 예산이라 사생활에 가깝다. 어디로도 보내지
 * 않는다(빌드 CSP가 `connect-src 'none'`이라 보낼 수단 자체가 없다). 푸터에 무엇을
 * 저장하는지 적고, 지우는 길을 둔다.
 *
 * 사생활 보호 모드 등에서는 접근 자체가 throw할 수 있어 전부 감싼다.
 */
export const STORAGE_KEYS = {
  cardIds: 'sunhalin:card-ids',
  choices: 'sunhalin:card-choices',
  budget: 'sunhalin:budget',
  ceilings: 'sunhalin:spend-ceilings',
  constraints: 'sunhalin:card-constraints',
} as const;

/** 카드 id → (선택지 그룹 id → 고른 선택지 id). */
export type SavedChoices = Record<string, Record<string, string>>;
/** 카드 id → 월 최소·최대 사용액. */
export type SavedConstraints = Record<string, { min?: number; max?: number }>;

/**
 * 저장된 택1 선택을 읽는다. 모양이 틀린 값은 버린다 — 여기서 틀린 값은 계산을 막지 않는다.
 * `resolveChoices`가 모르는 선택지를 첫 선택지로 돌리기 때문이다.
 */
export function parseSavedChoices(text: string | null): SavedChoices {
  const value = readJson(text);
  if (value === null) return {};
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
}

/** 저장된 카드 id 목록. 번들에서 사라진 카드는 호출부가 걸러 낸다. */
export function parseSavedIds(text: string | null): string[] {
  if (text === null) return [];
  try {
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value)) return [];
    return value.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

/** 저장된 금액 표. 음수와 정수가 아닌 값은 버린다 — 금액은 정수 원 단위다(규칙 3). */
export function parseSavedAmounts(text: string | null): Record<string, number> {
  const value = readJson(text);
  if (value === null) return {};
  const out: Record<string, number> = {};
  for (const [key, amount] of Object.entries(value)) {
    if (typeof amount === 'number' && Number.isInteger(amount) && amount >= 0) out[key] = amount;
  }
  return out;
}

export function parseSavedConstraints(text: string | null): SavedConstraints {
  const value = readJson(text);
  if (value === null) return {};
  const out: SavedConstraints = {};
  for (const [cardId, limits] of Object.entries(value)) {
    if (typeof limits !== 'object' || limits === null || Array.isArray(limits)) continue;
    const clean: { min?: number; max?: number } = {};
    const { min, max } = limits as { min?: unknown; max?: unknown };
    if (typeof min === 'number' && Number.isInteger(min) && min >= 0) clean.min = min;
    if (typeof max === 'number' && Number.isInteger(max) && max >= 0) clean.max = max;
    if (clean.min !== undefined || clean.max !== undefined) out[cardId] = clean;
  }
  return out;
}

/** 금액 하나. 비어 있거나 모양이 틀리면 null이다. */
export function parseSavedNumber(text: string | null): number | null {
  // `Number('')`은 0이다. 비워 둔 칸이 0원으로 되살아나면 사용자가 적지도 않은 값이 박힌다.
  if (text === null || text.trim() === '') return null;
  const value = Number(text);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function readJson(text: string | null): Record<string, unknown> | null {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function loadString(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
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
 * 더 이상 읽지 않는 키.
 *
 * 남겨 두면 사용자 브라우저에 쓰지 않는 데이터가 계속 앉아 있게 되므로 앱이 뜰 때 지운다.
 * - `user-cards`: 브라우저에서 규칙 JSON을 받던 시절
 * - `user-category-rules`·`card-id`: 명세서를 올려 한 장을 시뮬레이션하던 시절.
 *   가맹점 분류는 화면에서 하지 않고, 카드는 여러 장을 고른다
 * - `card-benefit-calc:*`: 서비스 이름을 순할인으로 바꾸기 전에 쓴 키
 */
const DROPPED_KEYS = [
  'sunhalin:user-cards',
  'sunhalin:user-category-rules',
  'sunhalin:card-id',
  'card-benefit-calc:user-category-rules',
  'card-benefit-calc:card-id',
] as const;

export function dropObsolete(): void {
  try {
    for (const key of DROPPED_KEYS) window.localStorage.removeItem(key);
  } catch {
    // 접근이 막혀 지우지 못해도, 읽는 곳이 없으므로 계산에는 영향이 없다.
  }
}

/** 처방 입력을 모두 지운다. 푸터의 "저장한 값 지우기"가 부른다. */
export function clearAll(): void {
  try {
    for (const key of Object.values(STORAGE_KEYS)) window.localStorage.removeItem(key);
  } catch {
    // 못 지워도 화면 상태는 호출부가 초기화한다.
  }
}
