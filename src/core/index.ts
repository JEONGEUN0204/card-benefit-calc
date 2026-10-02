/**
 * 계산 엔진 공개 API.
 *
 * 이 디렉터리의 모든 함수는 순수 함수다. DOM·파일시스템·네트워크에 의존하지 않으므로
 * 브라우저에서도 Node에서도 같은 숫자를 낸다. 결제내역은 이 경계를 넘지 않는다.
 */
export type {
  Benefit,
  CapGroup,
  ChoiceGroup,
  CardArt,
  CardRule,
  CountLimit,
  DiscountReason,
  DiscountSpec,
  ExclusionMode,
  HourRange,
  MatchRule,
  MonthResult,
  PaymentType,
  RequiredSpendResult,
  RoundingMode,
  SpendingExclusion,
  SpendingPattern,
  SpendingSample,
  StackedDiscount,
  Tier,
  TierMaxDiscount,
  Transaction,
  TxResult,
  Weekday,
  Won,
} from './types.js';

export { roundDiscount } from './rounding.js';
export { assertResolved, resolveChoices } from './choice.js';
export type { ChoiceSelection } from './choice.js';
export { parseCardRule } from './parseCardRule.js';
export type { CardRuleIssue, ParseCardRuleResult } from './parseCardRule.js';
export { matchBenefits, matchesBenefit } from './match.js';
export { benefitCapFor, groupCapFor, rebateFor, selectTier, totalCapFor } from './tier.js';
export { applyDiscounts } from './discount.js';
export type { MonthDiscountResult, TxDiscount } from './discount.js';
export { calcSpending, countedSpendingOf, isExcludedFromSpending } from './spending.js';
export type { SpendingResult } from './spending.js';
export { simulate } from './simulate.js';
export type { SimulateOptions } from './simulate.js';
export { maxDiscountByTier } from './maxDiscount.js';
export { requiredSpendFor } from './requiredSpend.js';
export { patternFromTransactions } from './pattern.js';
export type { RequiredSpendOptions } from './requiredSpend.js';
export { SPREAD_DAYS, synthesizeMonth, synthesizeSlices } from './synthesize.js';
export type { SpendSlice, Synthetic } from './synthesize.js';
export { ALL_SCOPE, scopeGroups, scopeKeyOf } from './scope.js';
export type { ScopeGroup, ScopeMember } from './scope.js';
export { attainableByTier } from './attainable.js';
export type { AttainableBenefit, AttainableLimit, SpendCeilings, TierAttainable } from './attainable.js';
export { steadyStateFor } from './steady.js';
export { peakingCurve } from './peaking.js';
export { allocate, comparePortfolios } from './allocate.js';
export { spendQuestions } from './ask.js';
export type { QuestionUser, SpendQuestion, SpendQuestionOptions } from './ask.js';
export type {
  AllocateInput,
  Allocation,
  AllocationWarning,
  AllocationWarningKind,
  CardConstraint,
  CardPlan,
  PoolAssignment,
  PortfolioOption,
} from './allocate.js';
export { REST_POOL, poolsForBenefit, spendPools } from './scope.js';
export type { PeakingPoint } from './peaking.js';
export type { SteadyOptions, SteadyState, SteadyTierRow } from './steady.js';
