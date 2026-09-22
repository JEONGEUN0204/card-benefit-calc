import type { Benefit, CardRule, Transaction } from '../types.js';

/** 테스트용 거래 생성. 지정하지 않은 필드는 무난한 기본값을 쓴다. */
export function tx(over: Partial<Transaction> & { id: string }): Transaction {
  return {
    date: '2026-01-15',
    amount: 10_000,
    merchant: '테스트가맹점',
    category: 'etc',
    ...over,
  };
}

/** 테스트용 혜택 생성. */
export function benefit(over: Partial<Benefit> & { id: string }): Benefit {
  return {
    label: over.id,
    match: {},
    discount: { type: 'rate', rate: 0.1 },
    monthlyCapByTier: { '0': 10_000 },
    excludeFromSpending: 'none',
    ...over,
  };
}

/** 테스트용 카드 규칙 생성. */
export function card(over: Partial<CardRule> & { id: string }): CardRule {
  return {
    name: over.id,
    issuer: 'TEST',
    annualFee: 0,
    tiers: [{ min: 0 }],
    benefits: [],
    spendingExclusions: [],
    rounding: 'floor10',
    ...over,
  };
}

/** `noUncheckedIndexedAccess` 아래에서 조회 결과를 단언 없이 꺼내기 위한 헬퍼. */
export function must<T>(v: T | undefined, msg: string): T {
  if (v === undefined) throw new Error(`없어야 할 undefined: ${msg}`);
  return v;
}
