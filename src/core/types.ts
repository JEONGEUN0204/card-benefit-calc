/**
 * 도메인 타입 정의.
 *
 * 금액은 전부 `Won` — 정수 원 단위 number 다. 부동소수 중간값을 만들지 않는다.
 * 할인율 계산처럼 소수가 불가피한 지점은 즉시 `rounding.ts`를 거쳐 정수로 되돌린다.
 */

/** 정수 원 단위 금액. */
export type Won = number;

/**
 * 할인받은 결제 건이 다음 달 실적에서 빠지는 방식.
 *
 * 한국 카드는 `full`(할인받은 건 전액 제외)이 다수다. 이 필드를 잘못 읽으면
 * 필요 사용액이 크게 어긋나므로, 약관 추출 시 원문 인용을 남긴다.
 */
export type ExclusionMode =
  /** 할인받은 결제 건의 "전액"을 실적에서 제외 */
  | 'full'
  /** 할인액만 실적에서 제외 */
  | 'discountOnly'
  /** 제외하지 않음 */
  | 'none';

/** 전월실적 구간. `min`은 하한(이상)이며 상한은 다음 구간의 `min`이 정한다. */
export interface Tier {
  /** 이 구간에 진입하는 전월실적 하한. 0은 "실적 없음" 구간. */
  min: Won;
  label?: string;
}

/** 거래가 어떤 혜택에 해당하는지 판정하는 규칙. */
export interface MatchRule {
  /** 카테고리 완전일치. 비우면 카테고리 조건 없음. */
  categories?: string[];
  /** 가맹점명 부분일치(대소문자·공백 무시). 비우면 가맹점 조건 없음. */
  merchants?: string[];
  /** 부분일치하면 매칭에서 제외. `merchants`보다 우선한다. */
  excludeMerchants?: string[];
}

/** 할인 방식. 정률 또는 정액. */
export type DiscountSpec =
  | { type: 'rate'; rate: number }
  | { type: 'amount'; amount: Won };

/** 혜택 사용 횟수 제한. */
export interface CountLimit {
  period: 'month' | 'day';
  max: number;
}

export interface Benefit {
  id: string;
  /** 사용자에게 보여줄 이름. 예: "커피 20% 할인" */
  label: string;
  match: MatchRule;
  discount: DiscountSpec;
  /** 건당 최소 결제금액. 약관의 "N원 이상"은 경계 포함이다. */
  minTransaction?: Won;
  /** 건당 최대 할인액. */
  perTransactionCap?: Won;
  /**
   * 전월실적 구간별 월 할인 한도. 키는 `Tier.min`의 문자열.
   * 값이 0이면 해당 구간에서 혜택이 없다는 뜻이다.
   */
  monthlyCapByTier: Record<string, Won>;
  countLimit?: CountLimit;
  excludeFromSpending: ExclusionMode;
  /** 한 거래에 여러 혜택이 매칭될 때의 우선순위. 클수록 우선. 기본 0. */
  priority?: number;
  /** 약관 원문 인용. 추출 근거를 남겨 검수할 수 있게 한다. */
  sourceNote?: string;
}

/** 실적 산정에서 기본적으로 빠지는 항목. */
export interface SpendingExclusion {
  kind: 'category' | 'merchant' | 'paymentType';
  /** `kind`에 따라 카테고리명 / 가맹점명 부분일치 / 결제유형 값. */
  values: string[];
}

/** 할인액 절사 방식. */
export type RoundingMode = 'floor10' | 'floor1' | 'round10';

export interface CardRule {
  id: string;
  name: string;
  issuer: string;
  annualFee: Won;
  /** `min` 오름차순. 0 구간을 포함하는 것이 보통이다. */
  tiers: Tier[];
  benefits: Benefit[];
  /** 구간별 통합 할인 한도. 키는 `Tier.min`. 없으면 통합 한도 없음. */
  totalMonthlyCapByTier?: Record<string, Won>;
  spendingExclusions: SpendingExclusion[];
  rounding: RoundingMode;
  sourceNote?: string;
}

export type PaymentType = 'lump' | 'installment' | 'interestFreeInstallment';

export interface Transaction {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  amount: Won;
  merchant: string;
  category: string;
  paymentType?: PaymentType;
}

/**
 * 건별 처리 결과의 사유.
 *
 * "왜 이 건은 할인을 못 받았는가"를 사용자에게 설명하기 위한 필드다.
 * 계산 결과의 부산물이 아니라 이 서비스의 주요 산출물이다.
 */
export type DiscountReason =
  /** 할인 적용됨 */
  | 'ok'
  /** 매칭되는 혜택 없음 */
  | 'noMatch'
  /** 건당 최소 결제금액 미달 */
  | 'belowMin'
  /** 해당 혜택의 월 한도 소진 */
  | 'benefitCapReached'
  /** 통합 할인 한도 소진 */
  | 'totalCapReached'
  /** 횟수 제한 초과 */
  | 'countLimit'
  /** 결제액이 작아 절사 후 할인이 0원이 됨 */
  | 'roundedToZero'
  /** 현재 전월실적 구간에서는 이 혜택의 한도가 0 */
  | 'tierLocked';

export interface TxResult {
  txId: string;
  /** 할인이 적용된 혜택. 미적용 시 null. */
  appliedBenefitId: string | null;
  discount: Won;
  reason: DiscountReason;
  /**
   * 할인이 "적용은 됐지만 한도에 잘려 일부만" 받은 경우 어떤 한도가 잘랐는지.
   * 사용자가 가장 궁금해하는 지점이므로 reason(ok)과 별도로 남긴다.
   */
  cappedBy?: "benefit" | "total" | "perTransaction";
  /** 이 거래가 실적에 기여한 금액. */
  countedSpending: Won;
}

export interface MonthResult {
  /** YYYY-MM */
  month: string;
  /** 이 달에 실제로 적용된 구간. 어느 구간에도 못 미치면 null(혜택 없음). */
  tier: Tier | null;
  /** 구간을 결정한 전월실적. 전월 데이터가 없어 가정했다면 null. */
  prevSpending: Won | null;
  /**
   * 구간이 실제 전월실적이 아니라 가정으로 정해졌는지.
   * 첫 달은 전월 데이터가 없어 가정할 수밖에 없고, 그 사실을 감춰선 안 된다.
   */
  tierAssumed: boolean;
  transactions: TxResult[];
  totalDiscount: Won;
  /** benefitId → 소진한 월 한도. */
  capUsage: Record<string, Won>;
  totalCapUsed: Won;
  /** 이 달의 실적. 다음 달 구간을 결정한다. */
  countedSpending: Won;
}

/** 구간별 월 최대 할인액 (기능 1). */
export interface TierMaxDiscount {
  tier: Tier;
  /** 혜택별 월 한도의 단순 합. */
  sumOfBenefitCaps: Won;
  /** 통합 한도까지 반영한 실제 최대 할인액. */
  maxDiscount: Won;
  /** 통합 한도 때문에 잘렸는지. 잘렸다면 사용자에게 알릴 가치가 있다. */
  cappedByTotal: boolean;
  /** benefitId → 이 구간의 월 한도. */
  byBenefit: Record<string, Won>;
}

/** 소비 패턴 — 사용내역이 없을 때 필요 사용액을 역산하는 입력 (기능 2). */
export interface SpendingPattern {
  /** 카테고리별 비중. 합이 1이 아니어도 내부에서 정규화한다. */
  weights: Record<string, number>;
  /** 카테고리별 평균 건단가. 건수 분해에 쓴다. 없으면 `defaultTicket`. */
  ticketSize?: Record<string, Won>;
  /** 건단가 기본값. */
  defaultTicket?: Won;
}

/** 목표 구간에 도달하기 위한 필요 사용액 (기능 2). */
export interface RequiredSpendResult {
  /** 목표 구간. */
  targetTier: Tier;
  /** 목표 실적을 채우는 데 필요한 총 결제액. 도달 불가면 null. */
  requiredTotalSpend: Won | null;
  /** 그때의 실적 금액. */
  resultingSpending: Won;
  /** 실적에서 빠지는 금액 (할인 적용 건 + 기본 제외 항목). */
  excludedAmount: Won;
  /** 그때 받게 되는 할인액. */
  expectedDiscount: Won;
  /** 카테고리별 결제액 내역. */
  breakdown: Record<string, Won>;
}
