import { describe, expect, it } from 'vitest';
import type { Benefit } from '../../core/index.js';
import { benefitTag, describeResult, unboundedNote } from '../labels.js';

/**
 * 고르는 칸의 혜택 배지.
 *
 * 규칙 JSON의 `label`은 약관 문장을 그대로 옮긴 것이라 배지로 쓰기에 길다. 끝에 붙은 할인
 * 표기를 떼고 대상이 여럿이면 첫 대상만 남긴다. 값은 문장이 아니라 `discount`에서 읽는다 —
 * 라벨은 사람이 적은 글이라 숫자가 어긋날 수 있지만 `discount`는 엔진이 실제로 쓰는 값이다.
 */
const benefit = (label: string, discount: Benefit['discount']): Benefit => ({
  id: 'b',
  label,
  match: { categories: ['cafe'] },
  discount,
  monthlyCapByTier: {},
  excludeFromSpending: 'full',
});

describe('benefitTag', () => {
  it('끝의 할인 표기를 떼고 첫 대상만 남긴다', () => {
    expect(benefitTag(benefit('토스페이·토스쇼핑 15% 할인', { type: 'rate', rate: 0.15 }))).toBe(
      '토스페이 15%',
    );
    expect(
      benefitTag(benefit('온라인 간편결제·쇼핑몰 10% 할인', { type: 'rate', rate: 0.1 })),
    ).toBe('온라인 간편결제 10%');
  });

  it('대상이 하나면 그대로 쓴다', () => {
    expect(benefitTag(benefit('스타벅스 50% 할인', { type: 'rate', rate: 0.5 }))).toBe(
      '스타벅스 50%',
    );
  });

  it('이름 안의 숫자는 건드리지 않는다', () => {
    // "GS25"의 25까지 잘라내면 배지가 "GS 5%"가 된다. 뒤에서부터 떼는 이유다.
    expect(benefitTag(benefit('GS25 5% 할인', { type: 'rate', rate: 0.05 }))).toBe('GS25 5%');
  });

  it('정액 할인은 금액으로 적는다', () => {
    expect(benefitTag(benefit('주유 리터당 60원 할인', { type: 'amount', amount: 60 }))).toBe(
      '주유 리터당 60원',
    );
  });

  it('라벨에 할인 표기가 없으면 라벨을 그대로 쓴다', () => {
    expect(benefitTag(benefit('커피', { type: 'rate', rate: 0.2 }))).toBe('커피 20%');
  });

  it('소수점 할인율은 한 자리까지 적는다', () => {
    expect(benefitTag(benefit('전 가맹점 0.5% 할인', { type: 'rate', rate: 0.005 }))).toBe(
      '전 가맹점 0.5%',
    );
  });

  it('값은 라벨이 아니라 discount에서 읽는다', () => {
    // 라벨의 숫자가 규칙과 어긋나도 화면에는 엔진이 쓰는 값이 뜬다.
    expect(benefitTag(benefit('카페 20% 할인', { type: 'rate', rate: 0.15 }))).toBe('카페 15%');
  });
});

/**
 * 한도 없는 혜택이 있는 구간의 월 최대 옆에 붙는 말. 월 최대 숫자는 그 혜택을 뺀 몫이라,
 * 이 말이 없으면 "한 달 최대 20,000원"이 끝인 것처럼 읽힌다.
 */
describe('unboundedNote', () => {
  const card = (benefits: Benefit[]) => ({ benefits });

  it('할인율을 적고 한도가 없다고 밝힌다', () => {
    const b = { ...benefit('국내외 가맹점 1% 할인', { type: 'rate', rate: 0.01 }), id: 'base' };
    expect(unboundedNote(card([b]), ['base'])).toBe('+ 1% 한도 없음');
  });

  it('여럿이면 가운뎃점으로 잇고, 없으면 빈 문자열이다', () => {
    const a = { ...benefit('해외 2%', { type: 'rate', rate: 0.02 }), id: 'a' };
    const b = { ...benefit('국내 1%', { type: 'rate', rate: 0.01 }), id: 'b' };
    expect(unboundedNote(card([a, b]), ['a', 'b'])).toBe('+ 해외 2%·국내 1% 한도 없음');
    expect(unboundedNote(card([a]), [])).toBe('');
  });
});

/** 한 거래에 할인이 둘 붙으면 합계만 적지 않고 겹친 몫을 밝힌다. 아니면 할인율로 역산이 안 맞는다. */
describe('describeResult — 중복 적용', () => {
  it('겹친 몫을 괄호로 밝힌다', () => {
    expect(
      describeResult({
        txId: 'a',
        appliedBenefitId: 'kb',
        discount: 2_000,
        reason: 'ok',
        countedSpending: 0,
        stacked: [{ benefitId: 'fashion', discount: 500 }],
      }),
    ).toBe('2,000원 할인 (중복 500원 포함)');
  });

  it('잘린 한도와 함께 적는다', () => {
    expect(
      describeResult({
        txId: 'a',
        appliedBenefitId: 'kb',
        discount: 2_000,
        reason: 'ok',
        cappedBy: 'benefit',
        countedSpending: 0,
        stacked: [{ benefitId: 'fashion', discount: 500 }],
      }),
    ).toBe('2,000원 할인 (혜택 한도에 잘림, 중복 500원 포함)');
  });
});
