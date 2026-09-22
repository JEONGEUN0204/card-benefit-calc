import { describe, expect, it } from 'vitest';
import { roundDiscount } from '../rounding.js';

describe('roundDiscount', () => {
  it('floor10은 10원 미만을 버린다', () => {
    expect(roundDiscount(1234, 'floor10')).toBe(1230);
    expect(roundDiscount(1230, 'floor10')).toBe(1230);
    expect(roundDiscount(9, 'floor10')).toBe(0);
  });

  it('floor1은 1원 미만을 버린다', () => {
    expect(roundDiscount(1234.7, 'floor1')).toBe(1234);
    expect(roundDiscount(0.9, 'floor1')).toBe(0);
  });

  it('round10은 10원 단위로 반올림한다', () => {
    expect(roundDiscount(1234, 'round10')).toBe(1230);
    expect(roundDiscount(1235, 'round10')).toBe(1240);
    expect(roundDiscount(1236, 'round10')).toBe(1240);
  });

  it('정률 할인이 만든 소수를 정수로 되돌린다', () => {
    // 3300원 * 12% = 396원 → floor10 → 390원
    expect(roundDiscount(3300 * 0.12, 'floor10')).toBe(390);
  });

  it('0은 그대로 0이다', () => {
    expect(roundDiscount(0, 'floor10')).toBe(0);
  });

  it('음수 할인은 도메인상 있을 수 없으므로 거부한다', () => {
    expect(() => roundDiscount(-10, 'floor10')).toThrow();
  });
});
