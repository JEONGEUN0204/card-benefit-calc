import { describe, expect, it } from 'vitest';
import { ALL_SCOPE, REST_POOL, poolsForBenefit, scopeGroups, scopeKeyOf, spendPools } from '../scope.js';
import { benefit, card, must } from './helpers.js';

/**
 * 지출 풀 묶기. 여러 카드의 혜택이 같은 돈을 가리키면 한 질문으로 묶어야 한다.
 *
 * 따로 두면 "간편결제 15만원"을 두 카드에 각각 물어 같은 돈이 두 번 세어지고, 배분
 * 최적화가 있지도 않은 예산을 나눠 쓴다 — 오류 없이 할인액만 부푼다.
 *
 * 묶음은 원소(카테고리·가맹점) 겹침의 연결 요소다. 그룹끼리는 원소를 공유할 수 없으므로
 * 가장 작은 원소가 그룹의 유일한 id가 된다.
 */
describe('scopeGroups', () => {
  it('카테고리가 겹치는 혜택을 한 그룹으로 묶는다', () => {
    const groups = scopeGroups([
      card({
        id: 'A',
        benefits: [
          benefit({ id: 'b1', match: { categories: ['online', 'delivery'] } }),
          benefit({ id: 'b2', match: { categories: ['delivery', 'cafe'] } }),
        ],
      }),
    ]);
    expect(groups).toHaveLength(1);
    const g = must(groups[0], 'group');
    expect(g.categories).toEqual(['cafe', 'delivery', 'online']);
    expect(g.key).toBe('c:cafe');
    expect(g.members.map((m) => m.benefitId)).toEqual(['b1', 'b2']);
  });

  it('겹치지 않는 카테고리는 따로 둔다', () => {
    const groups = scopeGroups([
      card({
        id: 'A',
        benefits: [
          benefit({ id: 'b1', match: { categories: ['online'] } }),
          benefit({ id: 'b2', match: { categories: ['cafe'] } }),
        ],
      }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['c:cafe', 'c:online']);
  });

  it('가맹점 목록이 겹치면 카드가 달라도 한 그룹이다', () => {
    const groups = scopeGroups([
      card({
        id: 'A',
        benefits: [benefit({ id: 'pay', match: { merchants: ['네이버페이', '카카오페이'] } })],
      }),
      card({
        id: 'B',
        benefits: [benefit({ id: 'pay', match: { merchants: ['카카오페이', '토스페이'] } })],
      }),
    ]);
    expect(groups).toHaveLength(1);
    const g = must(groups[0], 'group');
    expect(g.merchants).toEqual(['네이버페이', '카카오페이', '토스페이']);
    expect(g.key).toBe('m:네이버페이');
    expect(g.members).toEqual([
      { cardId: 'A', benefitId: 'pay', timeGated: false },
      { cardId: 'B', benefitId: 'pay', timeGated: false },
    ]);
  });

  it('조건이 없는 혜택은 전 가맹점 그룹이다 — 월 총예산이 곧 상한이다', () => {
    const groups = scopeGroups([
      card({ id: 'A', benefits: [benefit({ id: 'every', match: {} })] }),
    ]);
    expect(groups.map((g) => g.key)).toEqual([ALL_SCOPE]);
    expect(must(groups[0], 'g').categories).toEqual([]);
    expect(must(groups[0], 'g').merchants).toEqual([]);
  });

  it('해외 전용 혜택은 해외라는 원소로 묶인다', () => {
    const groups = scopeGroups([
      card({ id: 'A', benefits: [benefit({ id: 'os', match: { overseas: true } })] }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['o:1']);
    expect(must(groups[0], 'g').overseas).toBe(true);
  });

  it('국내 전용(overseas: false)은 원소가 아니다 — 가맹점이 풀을 정한다', () => {
    const groups = scopeGroups([
      card({
        id: 'A',
        benefits: [benefit({ id: 'pay', match: { merchants: ['KB Pay'], overseas: false } })],
      }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['m:kbpay']);
    expect(must(groups[0], 'g').overseas).toBe(false);
  });

  it('한 키워드가 다른 키워드의 부분문자열이면 한 그룹이다', () => {
    /*
     * 엔진의 가맹점 비교가 부분일치(`includesAny`)라 "쿠팡와우" 결제는 "쿠팡" 키워드에도
     * 걸린다. 완전일치로만 묶으면 그 돈이 두 질문에 나뉘어 세어지고, 배분 최적화가 있지도
     * 않은 예산을 나눠 쓴다.
     */
    const groups = scopeGroups([
      card({ id: 'A', benefits: [benefit({ id: 'shop', match: { merchants: ['쿠팡'] } })] }),
      card({ id: 'B', benefits: [benefit({ id: 'sub', match: { merchants: ['쿠팡와우'] } })] }),
    ]);
    expect(groups).toHaveLength(1);
    const g = must(groups[0], 'g');
    expect(g.merchants).toEqual(['쿠팡', '쿠팡와우']);
    expect(g.key).toBe('m:쿠팡');
  });

  it('부분일치가 사슬로 이어지면 모두 한 그룹이다', () => {
    const groups = scopeGroups([
      card({ id: 'A', benefits: [benefit({ id: 'a', match: { merchants: ['네이버플러스'] } })] }),
      card({ id: 'B', benefits: [benefit({ id: 'b', match: { merchants: ['네이버플러스스토어'] } })] }),
      card({ id: 'C', benefits: [benefit({ id: 'c', match: { merchants: ['네이버플러스멤버십'] } })] }),
    ]);
    expect(groups).toHaveLength(1);
    expect(must(groups[0], 'g').key).toBe('m:네이버플러스');
  });

  it('부분문자열이 아니면 묶지 않는다', () => {
    const groups = scopeGroups([
      card({ id: 'A', benefits: [benefit({ id: 'a', match: { merchants: ['쿠팡'] } })] }),
      card({ id: 'B', benefits: [benefit({ id: 'b', match: { merchants: ['컬리'] } })] }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('가맹점명은 공백·대소문자를 지워 비교한다 — 매칭과 같은 기준이다', () => {
    const groups = scopeGroups([
      card({ id: 'A', benefits: [benefit({ id: 'a', match: { merchants: ['KB Pay'] } })] }),
      card({ id: 'B', benefits: [benefit({ id: 'b', match: { merchants: ['kbpay'] } })] }),
    ]);
    expect(groups).toHaveLength(1);
  });

  it('승인시간 조건이 걸린 혜택은 timeGated로 표시한다', () => {
    const groups = scopeGroups([
      card({
        id: 'A',
        benefits: [
          benefit({ id: 'night', match: { categories: ['mart'], hours: { from: 21, to: 9 } } }),
          benefit({ id: 'day', match: { categories: ['mart'] } }),
        ],
      }),
    ]);
    const g = must(groups[0], 'g');
    expect(g.members).toEqual([
      { cardId: 'A', benefitId: 'night', timeGated: true },
      { cardId: 'A', benefitId: 'day', timeGated: false },
    ]);
  });

  it('요일 조건은 timeGated가 아니다 — 요일은 거래 날짜에서 나온다', () => {
    const groups = scopeGroups([
      card({
        id: 'A',
        benefits: [benefit({ id: 'weekend', match: { categories: ['mart'], weekdays: ['sat'] } })],
      }),
    ]);
    expect(must(must(groups[0], 'g').members[0], 'm').timeGated).toBe(false);
  });

  it('카테고리와 가맹점을 함께 적은 혜택은 두 풀을 한 그룹으로 합친다', () => {
    // 매칭이 AND라 이 혜택의 돈은 두 풀의 교집합이다. 한 그룹으로 묶어 한 번만 센다.
    const groups = scopeGroups([
      card({
        id: 'A',
        benefits: [benefit({ id: 'b', match: { categories: ['hospital'], merchants: ['약국'] } })],
      }),
    ]);
    expect(groups).toHaveLength(1);
    const g = must(groups[0], 'g');
    expect(g.categories).toEqual(['hospital']);
    expect(g.merchants).toEqual(['약국']);
    expect(g.key).toBe('c:hospital');
  });

  it('카드를 넣는 순서가 결과를 바꾸지 않는다', () => {
    const a = card({
      id: 'A',
      benefits: [benefit({ id: 'b1', match: { categories: ['online'] } })],
    });
    const b = card({
      id: 'B',
      benefits: [benefit({ id: 'b2', match: { categories: ['online', 'delivery'] } })],
    });
    const forward = scopeGroups([a, b]);
    const backward = scopeGroups([b, a]);
    expect(forward.map((g) => g.key)).toEqual(backward.map((g) => g.key));
    expect(must(forward[0], 'g').categories).toEqual(must(backward[0], 'g').categories);
  });

  it('scopeKeyOf가 혜택이 속한 그룹을 돌려준다', () => {
    const cards = [
      card({
        id: 'A',
        benefits: [
          benefit({ id: 'shop', match: { categories: ['online'] } }),
          benefit({ id: 'every', match: {} }),
        ],
      }),
    ];
    const groups = scopeGroups(cards);
    expect(scopeKeyOf(groups, 'A', 'shop')).toBe('c:online');
    expect(scopeKeyOf(groups, 'A', 'every')).toBe(ALL_SCOPE);
    expect(scopeKeyOf(groups, 'A', '없는혜택')).toBeNull();
  });
});

/*
 * 지출 풀과 혜택은 다른 것이다.
 *
 * 풀은 **돈을 담는 통**이고 서로 겹치지 않는다 — 한 결제는 정확히 한 통에 들어간다.
 * 혜택은 여러 통에서 벌 수 있다. 전 가맹점 혜택(EVERY 1의 1%)이 그렇다.
 *
 * "나머지 결제" 통이 꼭 있어야 한다. 팟 카드로 40만원을 쓸 때 할인 대상은 15~20만원뿐이고
 * 남은 돈은 **할인 0원이지만 실적을 쌓아 한도를 여는** 지출이다. 그 돈을 담을 통이 없으면
 * 배분기가 "구간을 열기 위해 쓰는 돈"을 표현할 수 없고, 한계 할인율이 0인 카드에는 한 푼도
 * 배정하지 않아 상위 구간을 영원히 못 연다.
 */
describe('지출 풀', () => {
  it('구체 풀들과 나머지 풀을 돌려준다', () => {
    const cards = [
      card({
        id: 'A',
        benefits: [
          benefit({ id: 'shop', match: { categories: ['online'] } }),
          benefit({ id: 'cafe', match: { merchants: ['스타벅스'] } }),
        ],
      }),
    ];
    const pools = spendPools(scopeGroups(cards));
    expect(pools).toEqual(['c:online', 'm:스타벅스', REST_POOL]);
  });

  it('전 가맹점 혜택만 있는 카드는 나머지 풀 하나로 끝난다', () => {
    const cards = [card({ id: 'A', benefits: [benefit({ id: 'every', match: {} })] })];
    expect(spendPools(scopeGroups(cards))).toEqual([REST_POOL]);
  });

  it('구체 혜택은 자기 풀에서만 번다', () => {
    const cards = [
      card({ id: 'A', benefits: [benefit({ id: 'shop', match: { categories: ['online'] } })] }),
    ];
    const groups = scopeGroups(cards);
    expect(poolsForBenefit(groups, 'A', 'shop')).toEqual(['c:online']);
  });

  it('전 가맹점 혜택은 모든 풀에서 번다 — 나머지 풀까지', () => {
    const cards = [
      card({
        id: 'A',
        benefits: [
          benefit({ id: 'shop', match: { categories: ['online'] } }),
          benefit({ id: 'every', match: {} }),
        ],
      }),
    ];
    const groups = scopeGroups(cards);
    expect(poolsForBenefit(groups, 'A', 'every')).toEqual(['c:online', REST_POOL]);
  });

  it('두 카드가 섞여도 전 가맹점 혜택은 다른 카드의 풀에서도 번다', () => {
    // EVERY 1의 1%는 팟 카드가 쇼핑에 쓰라고 만든 풀의 돈에도 붙는다 — 그 돈을 EVERY 1으로
    // 결제하면 그렇다. 배분기가 그 선택을 할 수 있어야 한다.
    const cards = [
      card({ id: 'POT', benefits: [benefit({ id: 'shop', match: { categories: ['online'] } })] }),
      card({ id: 'EVERY', benefits: [benefit({ id: 'every', match: {} })] }),
    ];
    const groups = scopeGroups(cards);
    expect(poolsForBenefit(groups, 'EVERY', 'every')).toEqual(['c:online', REST_POOL]);
    expect(poolsForBenefit(groups, 'POT', 'shop')).toEqual(['c:online']);
  });

  it('없는 혜택을 물으면 빈 목록이다', () => {
    const groups = scopeGroups([card({ id: 'A', benefits: [benefit({ id: 'b', match: {} })] })]);
    expect(poolsForBenefit(groups, 'A', '없음')).toEqual([]);
    expect(poolsForBenefit(groups, '없음', 'b')).toEqual([]);
  });

  it('나머지 풀 키는 그룹 키와 겹치지 않는다', () => {
    // 카테고리 이름이 'rest'인 카드가 와도 키가 부딫치지 않아야 한다.
    const groups = scopeGroups([
      card({ id: 'A', benefits: [benefit({ id: 'b', match: { categories: ['rest'] } })] }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['c:rest']);
    expect(spendPools(groups)).toEqual(['c:rest', REST_POOL]);
    expect(REST_POOL).not.toBe('c:rest');
  });
});
