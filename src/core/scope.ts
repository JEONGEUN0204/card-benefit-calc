import type { Benefit, CardRule } from './types.js';

/**
 * 조건이 없는 혜택(전 가맹점 할인)의 그룹 키.
 *
 * 카테고리도 가맹점도 적지 않은 혜택은 어떤 결제에나 붙으므로 따로 물을 것이 없다.
 * 이 그룹의 상한은 월 총예산 그 자체다.
 */
export const ALL_SCOPE = 'all';

export interface ScopeMember {
  cardId: string;
  benefitId: string;
  /**
   * 승인시간 조건이 걸려 처방에 넣을 수 없는 혜택.
   *
   * 가상 거래에는 시간이 없고(명세서에도 승인시간 컬럼이 없다) 시간 조건은 표시가 없으면
   * 붙지 않는다. 처방에 넣으면 밤에 쓰지 않은 결제를 할인으로 세어 조용히 부푼다.
   */
  timeGated: boolean;
}

/**
 * 같은 돈을 가리키는 혜택의 묶음.
 *
 * 원소(카테고리·가맹점·해외)가 겹치는 혜택을 연결 요소로 묶는다. 그룹끼리는 원소를
 * 공유하지 않으므로 가장 작은 원소가 그룹의 유일한 id가 된다 — 카드를 더 고르면 그룹이
 * 합쳐질 수 있지만, 새 원소가 기존 최솟값보다 작지 않은 한 키는 그대로 남는다.
 */
export interface ScopeGroup {
  key: string;
  categories: string[];
  merchants: string[];
  overseas: boolean;
  members: ScopeMember[];
}

/**
 * "나머지 결제" 풀의 키.
 *
 * 고른 카드의 어떤 혜택도 가리키지 않는 평범한 지출이다. 할인은 전 가맹점 혜택이 있는
 * 카드에서만 붙지만, **실적은 어느 카드에서나 쌓인다** — 그래서 이 통이 꼭 있어야 한다.
 * 팟 카드로 40만원을 쓸 때 할인 대상은 15~20만원뿐이고 나머지는 할인 0원으로 구간을 여는
 * 돈이다. 이 통이 없으면 배분기가 한계 할인율만 보고 그 카드에 한 푼도 주지 않아 상위
 * 구간을 영원히 열지 못한다.
 *
 * 그룹 키는 `c:`·`m:`·`o:` 접두를 달거나 `all`이므로 이 키와 부딫치지 않는다.
 */
export const REST_POOL = 'rest';

/** 가맹점명 비교용 정규화. `match.ts`의 기준과 같아야 한다. */
function normalizeMerchant(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

/**
 * 이 혜택의 돈이 어느 풀에서 나오는지 가리키는 원소들.
 *
 * `overseas: false`는 원소가 아니다 — 국내 전용이라는 제한일 뿐 풀을 새로 만들지 않는다.
 * 요일·시간 조건도 "언제"를 제한할 뿐 "어디"를 가르지 않으므로 원소가 아니다.
 */
function elementsOf(benefit: Benefit): string[] {
  const out: string[] = [];
  for (const c of benefit.match.categories ?? []) out.push(`c:${c}`);
  for (const m of benefit.match.merchants ?? []) out.push(`m:${normalizeMerchant(m)}`);
  if (benefit.match.overseas === true) out.push('o:1');
  return out;
}

/** 원소를 연결 요소로 묶는 union-find. */
class Components {
  private readonly parent = new Map<string, string>();

  find(x: string): string {
    const seen = this.parent.get(x);
    if (seen === undefined) {
      this.parent.set(x, x);
      return x;
    }
    if (seen === x) return x;
    const root = this.find(seen);
    this.parent.set(x, root);
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    // 작은 쪽을 뿌리로 삼아 결과가 입력 순서에 좌우되지 않게 한다.
    if (ra < rb) this.parent.set(rb, ra);
    else this.parent.set(ra, rb);
  }
}

interface Building {
  elements: Set<string>;
  /** 정규화한 가맹점명 → 화면에 적을 원래 표기. 먼저 본 표기를 쓴다. */
  merchantLabels: Map<string, string>;
  members: ScopeMember[];
}

/**
 * 고른 카드들의 혜택을 지출 풀로 묶는다.
 *
 * 묶지 않으면 같은 돈을 카드마다 따로 물어 두 번 세게 되고, 배분 최적화가 있지도 않은
 * 예산을 나눠 쓴다. 할인액만 부풀고 오류는 나지 않는 종류의 실수다.
 */
export function scopeGroups(cards: readonly CardRule[]): ScopeGroup[] {
  const components = new Components();

  // 1차: 한 혜택이 가리키는 원소들을 서로 묶는다.
  for (const card of cards) {
    for (const b of card.benefits) {
      const elements = elementsOf(b);
      const [first] = elements;
      if (first === undefined) continue;
      for (const e of elements) components.union(first, e);
    }
  }

  /*
   * 1.5차: 가맹점 키워드의 부분일치 관계도 묶는다.
   *
   * 엔진의 가맹점 비교는 부분일치(`match.ts`의 `includesAny`)다. 그래서 "쿠팡와우" 결제는
   * "쿠팡" 키워드에도 걸린다. 키워드 문자열이 같은 것만 묶으면 그 돈이 두 질문에 나뉘어
   * 세어지고(한 카드는 쇼핑몰로, 다른 카드는 구독으로), 배분 최적화가 있지도 않은 예산을
   * 나눠 쓴다 — 오류 없이 할인액만 부푼다.
   *
   * 실제로 번들된 다섯 장에서 쿠팡와우·컬리멤버스·네이버플러스스토어가 이 경우다. 전부
   * "쇼핑몰 이름을 품은 구독 서비스"라는 한 패턴이다.
   */
  const merchantElements = [
    ...new Set(
      cards.flatMap((card) =>
        card.benefits.flatMap((b) => elementsOf(b).filter((e) => e.startsWith('m:'))),
      ),
    ),
  ];
  for (const a of merchantElements) {
    for (const b of merchantElements) {
      if (a === b) continue;
      if (b.slice(2).includes(a.slice(2))) components.union(a, b);
    }
  }

  // 2차: 혜택을 그룹에 넣는다. 카드 순서·혜택 정의 순서를 그대로 지킨다.
  const groups = new Map<string, Building>();
  const take = (root: string): Building => {
    const seen = groups.get(root);
    if (seen !== undefined) return seen;
    const fresh: Building = { elements: new Set(), merchantLabels: new Map(), members: [] };
    groups.set(root, fresh);
    return fresh;
  };

  for (const card of cards) {
    for (const b of card.benefits) {
      const elements = elementsOf(b);
      const [first] = elements;
      const root = first === undefined ? ALL_SCOPE : components.find(first);
      const building = take(root);
      for (const e of elements) building.elements.add(e);
      for (const m of b.match.merchants ?? []) {
        const normalized = normalizeMerchant(m);
        if (!building.merchantLabels.has(normalized)) building.merchantLabels.set(normalized, m);
      }
      building.members.push({
        cardId: card.id,
        benefitId: b.id,
        timeGated: b.match.hours !== undefined,
      });
    }
  }

  const out: ScopeGroup[] = [];
  for (const [root, building] of groups) {
    const elements = [...building.elements].sort();
    const categories = elements.filter((e) => e.startsWith('c:')).map((e) => e.slice(2));
    const merchants = [...building.merchantLabels.values()].sort();
    out.push({
      // 조건 없는 그룹은 원소가 없어 뿌리가 곧 키다.
      key: elements[0] ?? root,
      categories,
      merchants,
      overseas: building.elements.has('o:1'),
      members: building.members,
    });
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** 이 혜택이 속한 지출 풀의 키. 그룹에 없는 혜택이면 null. */
export function scopeKeyOf(
  groups: readonly ScopeGroup[],
  cardId: string,
  benefitId: string,
): string | null {
  for (const g of groups) {
    for (const m of g.members) {
      if (m.cardId === cardId && m.benefitId === benefitId) return g.key;
    }
  }
  return null;
}

/**
 * 돈을 담는 통의 목록. 서로 겹치지 않으며 한 결제는 정확히 한 통에 들어간다.
 *
 * 구체 풀(카테고리·가맹점·해외로 좁혀진 것)에 "나머지 결제"를 더한 것이다. 조건이 없는
 * 전 가맹점 그룹(`ALL_SCOPE`)은 통이 아니다 — 그 혜택은 모든 통에서 벌기 때문에 돈을
 * 따로 담을 필요가 없고, 담으면 같은 돈이 두 번 세어진다.
 */
export function spendPools(groups: readonly ScopeGroup[]): string[] {
  const specific = groups.filter((g) => g.key !== ALL_SCOPE).map((g) => g.key);
  return [...specific, REST_POOL];
}

/**
 * 이 혜택이 돈을 끌어올 수 있는 통들.
 *
 * 구체 혜택은 자기 통 하나뿐이다. 조건이 없는 전 가맹점 혜택은 **모든 통**에서 번다 —
 * 다른 카드를 위해 만들어진 통의 돈이라도 이 카드로 결제하면 1%가 붙기 때문이고, 배분기가
 * 그 선택을 할 수 있어야 한다.
 */
export function poolsForBenefit(
  groups: readonly ScopeGroup[],
  cardId: string,
  benefitId: string,
): string[] {
  const key = scopeKeyOf(groups, cardId, benefitId);
  if (key === null) return [];
  return key === ALL_SCOPE ? spendPools(groups) : [key];
}
