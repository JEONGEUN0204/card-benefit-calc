/**
 * localStorage 래퍼.
 *
 * 여기엔 사용자가 고친 카테고리 규칙과 마지막으로 고른 카드만 넣는다. 거래 내역은
 * 저장하지 않는다 — 탭을 닫으면 사라지는 편이 명세서를 다루는 도구로서 덜 놀랍다.
 * 사생활 보호 모드 등에서는 접근 자체가 throw할 수 있어 전부 감싼다.
 */
export const STORAGE_KEYS = {
  userRules: 'card-benefit-calc:user-category-rules',
  cardId: 'card-benefit-calc:card-id',
} as const;

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
