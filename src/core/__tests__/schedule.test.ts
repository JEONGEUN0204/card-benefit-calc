/**
 * 요일·시간대 조건.
 *
 * 토스 신한카드 Mr.Life의 "주말 할인(토요일/일요일)"과 "Night Time 할인(오후 9시~오전 9시)"을
 * 옮기려고 넣은 조건이다. 둘은 성격이 다르다 — 요일은 거래 날짜에서 언제나 나오지만, 승인
 * 시간은 명세서가 적어 줄 때만 있다. 그래서 시간 조건은 해외 결제와 같은 원칙을 따른다:
 * 표시가 없으면 그 혜택은 붙지 않는다. 짐작으로 붙이면 밤에 쓰지 않은 결제가 할인으로
 * 잡혀, 오류 없이 할인액만 부풀어 오른다.
 */
import { describe, expect, it } from 'vitest';
import { matchesBenefit } from '../match.js';
import { parseCardRule } from '../parseCardRule.js';
import { benefit, tx } from './helpers.js';

// 2026-01-01은 목요일이다. 1/3 토, 1/4 일, 1/5 월.
const SAT = '2026-01-03';
const SUN = '2026-01-04';
const MON = '2026-01-05';

describe('요일 조건(weekdays)', () => {
  const weekend = benefit({ id: 'weekend', match: { weekdays: ['sat', 'sun'] } });

  it('지정한 요일의 거래만 매칭된다', () => {
    expect(matchesBenefit(tx({ id: 't1', date: SAT }), weekend)).toBe(true);
    expect(matchesBenefit(tx({ id: 't2', date: SUN }), weekend)).toBe(true);
    expect(matchesBenefit(tx({ id: 't3', date: MON }), weekend)).toBe(false);
  });

  it('요일은 거래 날짜에서 나오므로 시간대(TZ)와 무관하게 같은 답을 낸다', () => {
    // 같은 날짜 문자열은 어디서 돌려도 같은 요일이어야 한다. UTC로 고정해 계산한다.
    const weekdayOf = (date: string): boolean =>
      matchesBenefit(tx({ id: 'x', date }), weekend);
    expect(weekdayOf('2026-01-03')).toBe(true);
    expect(weekdayOf('2026-02-28')).toBe(true); // 토요일
    expect(weekdayOf('2026-03-01')).toBe(true); // 일요일
    expect(weekdayOf('2026-03-02')).toBe(false); // 월요일
  });

  it('비우면 요일 조건이 없다', () => {
    const any = benefit({ id: 'any', match: {} });
    expect(matchesBenefit(tx({ id: 't1', date: MON }), any)).toBe(true);
  });
});

describe('시간대 조건(hours)', () => {
  // "오후 9시부터 오전 9시까지" — from은 포함, to는 미포함이다.
  const night = benefit({ id: 'night', match: { hours: { from: 21, to: 9 } } });

  it('자정을 넘는 구간은 양쪽 끝을 모두 포함한다', () => {
    expect(matchesBenefit(tx({ id: 't1', time: '22:30' }), night)).toBe(true);
    expect(matchesBenefit(tx({ id: 't2', time: '02:00' }), night)).toBe(true);
    expect(matchesBenefit(tx({ id: 't3', time: '12:00' }), night)).toBe(false);
  });

  it('경계에서 from은 들어가고 to는 빠진다', () => {
    expect(matchesBenefit(tx({ id: 't1', time: '21:00' }), night)).toBe(true);
    expect(matchesBenefit(tx({ id: 't2', time: '20:59' }), night)).toBe(false);
    expect(matchesBenefit(tx({ id: 't3', time: '08:59' }), night)).toBe(true);
    expect(matchesBenefit(tx({ id: 't4', time: '09:00' }), night)).toBe(false);
  });

  it('자정을 넘지 않는 구간도 같은 경계 규칙을 쓴다', () => {
    const day = benefit({ id: 'day', match: { hours: { from: 9, to: 18 } } });
    expect(matchesBenefit(tx({ id: 't1', time: '09:00' }), day)).toBe(true);
    expect(matchesBenefit(tx({ id: 't2', time: '17:59' }), day)).toBe(true);
    expect(matchesBenefit(tx({ id: 't3', time: '18:00' }), day)).toBe(false);
    expect(matchesBenefit(tx({ id: 't4', time: '08:59' }), day)).toBe(false);
  });

  it('승인 시간이 없는 거래에는 시간 조건이 붙은 혜택이 매칭되지 않는다', () => {
    // 해외 표시가 없는 거래를 국내로 보는 것과 같은 원칙이다. 짐작으로 붙이지 않는다.
    expect(matchesBenefit(tx({ id: 't1' }), night)).toBe(false);
  });

  it('시간 조건이 없는 혜택은 승인 시간이 없어도 매칭된다', () => {
    const any = benefit({ id: 'any', match: {} });
    expect(matchesBenefit(tx({ id: 't1' }), any)).toBe(true);
  });
});

describe('요일과 시간대가 함께 있으면 둘 다 만족해야 한다', () => {
  const b = benefit({
    id: 'weekend-night',
    match: { weekdays: ['sat'], hours: { from: 21, to: 9 } },
  });

  it('둘 다 맞아야 매칭된다', () => {
    expect(matchesBenefit(tx({ id: 't1', date: SAT, time: '23:00' }), b)).toBe(true);
    expect(matchesBenefit(tx({ id: 't2', date: SAT, time: '13:00' }), b)).toBe(false);
    expect(matchesBenefit(tx({ id: 't3', date: MON, time: '23:00' }), b)).toBe(false);
  });
});

describe('parseCardRule이 잘못된 요일·시간대를 막는다', () => {
  function ruleWith(match: unknown): unknown {
    return {
      id: 'c',
      name: 'c',
      issuer: 'T',
      annualFee: 0,
      tiers: [{ min: 0 }],
      spendingExclusions: [],
      rounding: 'floor1',
      benefits: [
        {
          id: 'b',
          label: 'b',
          match,
          discount: { type: 'rate', rate: 0.1 },
          monthlyCapByTier: { '0': 1000 },
          excludeFromSpending: 'none',
        },
      ],
    };
  }

  it('요일 이름이 아니면 막는다', () => {
    const got = parseCardRule(ruleWith({ weekdays: ['토요일'] }));
    expect(got.ok).toBe(false);
  });

  it('24시 범위를 벗어난 시각을 막는다', () => {
    expect(parseCardRule(ruleWith({ hours: { from: 21, to: 24 } })).ok).toBe(false);
    expect(parseCardRule(ruleWith({ hours: { from: -1, to: 9 } })).ok).toBe(false);
    expect(parseCardRule(ruleWith({ hours: { from: 21.5, to: 9 } })).ok).toBe(false);
  });

  it('from과 to가 같으면 막는다 — 빈 구간인지 24시간인지 알 수 없다', () => {
    expect(parseCardRule(ruleWith({ hours: { from: 9, to: 9 } })).ok).toBe(false);
  });

  it('제대로 적은 조건은 통과한다', () => {
    const got = parseCardRule(ruleWith({ weekdays: ['sat', 'sun'], hours: { from: 21, to: 9 } }));
    expect(got.ok).toBe(true);
  });
});
