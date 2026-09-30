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
  /**
   * 이 카테고리는 할인 대상이 아니다. "국내외 가맹점 1%, 단 공과금·상품권 제외"처럼 전
   * 가맹점 혜택에 제외 목록이 붙는 약관을 옮기는 자리다. 실적 제외(`spendingExclusions`)와는
   * 별개다 — 할인에서 빠진다고 실적에서도 빠지는 것은 아니다.
   */
  excludeCategories?: string[];
  /**
   * 이 결제유형은 할인 대상이 아니다. "무이자할부 이용금액은 할인 제외". 결제유형이 적히지
   * 않은 거래는 일시불로 본다.
   */
  excludePaymentTypes?: PaymentType[];
  /**
   * 해외 결제 조건. `true`면 해외 결제에만, `false`면 국내 결제에만 붙는다. 비우면 둘 다.
   * "해외 가맹점 2%"와 "국내 가맹점 이용 시 제공"을 옮기는 자리다.
   */
  overseas?: boolean;
  /**
   * 이 요일에만 붙는다. "주말할인서비스는 공휴일 여부와 상관없이 토요일/일요일에 해당".
   * 비우면 요일 조건 없음. 요일은 거래 날짜에서 계산하므로 명세서가 따로 적어 줄 필요가 없다.
   */
  weekdays?: Weekday[];
  /**
   * 이 시간대에만 붙는다. "승인시간 기준으로 오후 9시부터 오전 9시까지"는 `{ from: 21, to: 9 }`다.
   * 24시간제 시(hour) 단위이고 `from`은 포함, `to`는 미포함이다. `from`이 `to`보다 크면 자정을
   * 넘는 구간으로 읽는다.
   *
   * 승인 시간은 명세서가 적어 줄 때만 거래에 붙는다(`Transaction.time`). 시간을 모르는 거래에는
   * 이 조건이 붙은 혜택이 매칭되지 않는다 — 해외 표시가 없는 거래를 국내로 보는 것과 같은
   * 원칙이다. 짐작으로 붙이면 밤에 쓰지 않은 결제가 할인으로 잡혀 할인액이 조용히 부푼다.
   */
  hours?: HourRange;
}

/** 요일. `Transaction.date`에서 계산한다. */
export type Weekday = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';

/** 시간대. 24시간제 시 단위이고, `from` 포함 `to` 미포함이다. */
export interface HourRange {
  from: number;
  to: number;
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

/**
 * 혜택 여럿이 나눠 쓰는 월 할인 한도.
 *
 * 할인율이 다르면 혜택을 나눠야 하는데 한도는 하나로 묶여 있는 카드가 있다. 토스 삼성카드의
 * "토스페이/토스쇼핑 15%"와 "온라인 영역 10%"가 하나의 "전월 이용금액대별 통합 월 할인한도"를
 * 나눠 쓴다. 각 혜택에 같은 한도를 따로 주면 월 최대가 두 배로 부풀어, 오류 없이 그럴듯한
 * 숫자가 나온다. 카드 전체에 걸리는 `CardRule.totalMonthlyCapByTier`와는 다른 층이다.
 */
export interface CapGroup {
  id: string;
  /** 화면에 적을 이름. 예: "토스/온라인 통합" */
  label: string;
  /** 구간별 월 한도. 키는 `Tier.min`의 문자열. */
  monthlyCapByTier: Record<string, Won>;
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
   * 값이 0이면 해당 구간에서 혜택이 없다는 뜻이다. `null`이면 그 구간에서 **한도가 없다**
   * ("할인 한도 없음"). 큰 수로 대신하면 구간별 최대 할인표에 그 수가 그대로 뜨므로 따로
   * 적는다. 키가 없는 것과는 다르다 — 키가 없으면 여전히 0이다.
   */
  monthlyCapByTier: Record<string, Won | null>;
  /**
   * 혜택 사용 횟수 제한. 여럿이면 모두 함께 걸린다 — "일 1회/월 5회 할인 적용"처럼 제한이 두
   * 겹인 약관이 있고, 하나만 적으면 어느 쪽을 골라도 할인이 실제보다 많게 잡힌다.
   */
  countLimit?: CountLimit | CountLimit[];
  /** 이 혜택이 속한 `CapGroup.id`. 같은 그룹의 혜택끼리 한 한도를 나눠 쓴다. */
  capGroup?: string;
  /**
   * 이 혜택이 택1 선택지 중 하나일 때, 어느 그룹의 어느 선택지인지. 그 선택지를 골랐을 때만
   * 켜진다(`resolveChoices`).
   */
  choice?: { group: string; option: string };
  /**
   * 다른 혜택과 한 거래에 겹쳐 붙는다. "간편결제 할인과 중복 적용 가능". 평소에는 한 거래에
   * 혜택 하나만 붙고, 중복 혜택은 그 하나에 더해 각자 자기 한도에서 깎인다.
   */
  stackable?: boolean;
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

/**
 * 카드 겉모습.
 *
 * 계산에는 쓰이지 않는다. 화면에서 "지금 어느 카드를 보고 있는지"를 이름만으로 가리기
 * 어려워서 두는 필드다. `image`는 `fixtures/cards/images/` 안의 파일 이름이고, 파일이
 * 없으면 `bg`·`fg`로 카드 모양을 그린다.
 */
export interface CardArt {
  image?: string;
  /** 플레이트 바탕색. `#rrggbb`. */
  bg?: string;
  /** 플레이트 위 글자색. `#rrggbb`. */
  fg?: string;
}

/**
 * 고객이 여러 혜택 중 하나를 골라 쓰는 자리. "KB Pay/네이버페이/카카오페이/토스페이(택1)".
 *
 * 선택지를 다 켜면 월 최대가 실제의 몇 배로 부푸므로, 계산 전에 `resolveChoices`로 하나만
 * 남긴다. 남기지 않은 규칙을 계산 함수에 넘기면 멈춘다.
 */
export interface ChoiceGroup {
  id: string;
  /** 화면에 적을 이름. 예: "자주 쓰는 간편결제" */
  label: string;
  /** 첫 선택지가 기본값이다. */
  options: { id: string; label: string }[];
}

export interface CardRule {
  id: string;
  name: string;
  issuer: string;
  annualFee: Won;
  /** `min` 오름차순. 0 구간을 포함하는 것이 보통이다. */
  tiers: Tier[];
  benefits: Benefit[];
  /** 혜택 여럿이 나눠 쓰는 한도. `Benefit.capGroup`이 id로 가리킨다. */
  capGroups?: CapGroup[];
  /** 택1 선택지. `Benefit.choice`가 가리킨다. `resolveChoices`를 거치면 사라진다. */
  choices?: ChoiceGroup[];
  /** 구간별 통합 할인 한도. 키는 `Tier.min`. 없으면 통합 한도 없음. */
  totalMonthlyCapByTier?: Record<string, Won>;
  /**
   * 전월실적 구간에 따라 달마다 얹히는 정액 할인. 키는 `Tier.min`.
   *
   * 거래에 붙지 않는 할인이다 — 카드의정석 EVERY 1의 "전월실적에 따라 매월 최대 2만원
   * 청구할인". `Benefit`은 거래에 매칭돼야 움직이므로 카드에 따로 둔다. 세 층의 한도 어디에도
   * 잡히지 않고, 실적도 건드리지 않는다(결제가 아니라 청구에서 빠지는 돈이다).
   */
  monthlyRebateByTier?: Record<string, Won>;
  spendingExclusions: SpendingExclusion[];
  rounding: RoundingMode;
  sourceNote?: string;
  art?: CardArt;
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
  /**
   * 해외 결제. 명세서가 가를 수 있을 때만 파서가 붙인다(우리카드의 `국외일시불`). 표시가 없으면
   * 국내로 본다 — 해외 표기가 없는 명세서에서는 해외 혜택이 잡히지 않는다.
   */
  overseas?: boolean;
  /**
   * 승인 시간. `HH:MM`(24시간제). 명세서가 적어 줄 때만 파서가 붙인다.
   *
   * 없으면 시간대 조건(`MatchRule.hours`)이 붙은 혜택은 이 거래에 매칭되지 않는다. 날짜만
   * 적는 명세서가 대부분이라, 그런 명세서에서는 밤 시간대 혜택이 잡히지 않는다.
   */
  time?: string;
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
  /** 같은 그룹의 혜택들이 나눠 쓰는 한도 소진 */
  | 'groupCapReached'
  /** 통합 할인 한도 소진 */
  | 'totalCapReached'
  /** 횟수 제한 초과 */
  | 'countLimit'
  /** 결제액이 작아 절사 후 할인이 0원이 됨 */
  | 'roundedToZero'
  /** 현재 전월실적 구간에서는 이 혜택의 한도가 0 */
  | 'tierLocked';

/** 한 거래에 겹쳐 붙은 중복 혜택 하나의 몫. */
export interface StackedDiscount {
  benefitId: string;
  discount: Won;
  cappedBy?: 'benefit' | 'group' | 'total' | 'perTransaction';
}

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
  cappedBy?: "benefit" | "group" | "total" | "perTransaction";
  /**
   * 대표 혜택에 겹쳐 붙은 중복 혜택(`Benefit.stackable`). `discount`는 이것까지 더한 합이다.
   * 겹친 것이 없으면 필드가 없다.
   */
  stacked?: StackedDiscount[];
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
  /** 거래 할인에 `rebate`를 더한 이 달의 할인 합계. */
  totalDiscount: Won;
  /** 이 달 구간에 딸린 월정액 할인(`CardRule.monthlyRebateByTier`). 없으면 0. */
  rebate: Won;
  /** benefitId → 소진한 월 한도. */
  capUsage: Record<string, Won>;
  /** capGroup id → 그룹이 소진한 월 한도. */
  groupUsage: Record<string, Won>;
  totalCapUsed: Won;
  /** 이 달의 실적. 다음 달 구간을 결정한다. */
  countedSpending: Won;
}

/** 구간별 월 최대 할인액 (기능 1). */
export interface TierMaxDiscount {
  tier: Tier;
  /**
   * 혜택별 월 한도의 단순 합에 월정액을 더한 값. 카드사 안내문이 보통 보여 주는 숫자다.
   * 한도 없는 혜택은 더하지 않는다.
   */
  sumOfBenefitCaps: Won;
  /**
   * 그룹 한도와 통합 한도까지 반영한 실제 최대 할인액(월정액 포함).
   * `unboundedBenefits`가 비어 있지 않으면 그 혜택들을 뺀, 상한이 있는 몫만의 최대다.
   */
  maxDiscount: Won;
  /** 이 구간의 월정액 할인. */
  rebate: Won;
  /**
   * 이 구간에서 어떤 한도에도 묶이지 않는 혜택. 쓰는 만큼 할인이 늘어나 최대치가 없다.
   * 통합 한도가 있으면 여기 들지 않는다 — 그 한도가 상한이 된다.
   */
  unboundedBenefits: string[];
  /** 그룹 한도 때문에 잘렸는지. */
  cappedByGroup: boolean;
  /** 통합 한도 때문에 잘렸는지. 잘렸다면 사용자에게 알릴 가치가 있다. */
  cappedByTotal: boolean;
  /** benefitId → 이 구간의 월 한도. `null`은 한도 없음. */
  byBenefit: Record<string, Won | null>;
  /** capGroup id → 이 구간의 그룹 한도. */
  byGroup: Record<string, Won>;
}

/** 소비 패턴 — 사용내역이 없을 때 필요 사용액을 역산하는 입력 (기능 2). */
export interface SpendingPattern {
  /** 카테고리별 비중. 합이 1이 아니어도 내부에서 정규화한다. */
  weights: Record<string, number>;
  /** 카테고리별 평균 건단가. 건수 분해에 쓴다. 없으면 `defaultTicket`. */
  ticketSize?: Record<string, Won>;
  /** 건단가 기본값. */
  defaultTicket?: Won;
  /**
   * 실제 거래 표본. 있으면 비중·건단가 대신 이 거래들을 순서대로 되풀이해 가상 거래를 만든다.
   * 혜택 대부분이 가맹점명·해외 여부로 붙어서, 업종 비중만으로는 할인이 한 건도 걸리지 않는다.
   */
  samples?: SpendingSample[];
}

/** 가상 거래의 틀이 되는 거래 한 건. 날짜와 id는 가상 거래를 만들 때 새로 붙인다. */
export type SpendingSample = Pick<Transaction, 'merchant' | 'category' | 'amount'> &
  Pick<Transaction, 'paymentType' | 'overseas'>;

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
