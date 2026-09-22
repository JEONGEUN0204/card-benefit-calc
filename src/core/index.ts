/**
 * 계산 엔진 공개 API.
 *
 * 이 디렉터리의 모든 함수는 순수 함수다. DOM·파일시스템·네트워크에 의존하지 않으므로
 * 브라우저에서도 Node에서도 같은 숫자를 낸다. 결제내역은 이 경계를 넘지 않는다.
 */
export type {
  Benefit,
  CardRule,
  CountLimit,
  DiscountReason,
  DiscountSpec,
  ExclusionMode,
  MatchRule,
  MonthResult,
  PaymentType,
  RequiredSpendResult,
  RoundingMode,
  SpendingExclusion,
  SpendingPattern,
  Tier,
  TierMaxDiscount,
  Transaction,
  TxResult,
  Won,
} from './types.js';

export { roundDiscount } from './rounding.js';
export { matchBenefits, matchesBenefit } from './match.js';
export { benefitCapFor, selectTier, totalCapFor } from './tier.js';
export { applyDiscounts } from './discount.js';
export type { MonthDiscountResult, TxDiscount } from './discount.js';
export { calcSpending, countedSpendingOf, isExcludedFromSpending } from './spending.js';
export type { SpendingResult } from './spending.js';
export { simulate } from './simulate.js';
export type { SimulateOptions } from './simulate.js';
export { maxDiscountByTier } from './maxDiscount.js';
export { requiredSpendFor } from './requiredSpend.js';
export type { RequiredSpendOptions } from './requiredSpend.js';
