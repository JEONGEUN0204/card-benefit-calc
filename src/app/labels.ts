import type { DiscountReason, ExclusionMode, PaymentType, Tier, TxResult, Won } from '../core/index.js';
import type { IssueKind } from '../import/index.js';

export const won = (n: Won): string => `${n.toLocaleString('ko-KR')}원`;

export const tierName = (tier: Tier): string => tier.label ?? `${won(tier.min)} 이상`;

const CATEGORY_LABEL: Record<string, string> = {
  cafe: '카페',
  restaurant: '음식점',
  convenience: '편의점',
  mart: '마트',
  online: '온라인쇼핑',
  delivery: '배달',
  transport: '대중교통',
  gas: '주유',
  travel: '여행',
  telecom: '통신',
  utility: '공과금',
  insurance: '보험',
  tax: '세금',
  giftCard: '상품권',
  movie: '영화',
  culture: '문화',
  hospital: '병원',
  beauty: '뷰티',
  fashion: '패션',
  education: '교육',
  pet: '반려동물',
  sports: '스포츠',
  etc: '기타',
  uncategorized: '미분류',
};

export const categoryLabel = (category: string): string => CATEGORY_LABEL[category] ?? category;

export const REASON_LABEL: Record<DiscountReason, string> = {
  ok: '할인',
  noMatch: '해당 혜택 없음',
  belowMin: '건당 최소금액 미달',
  benefitCapReached: '혜택 월 한도 소진',
  totalCapReached: '통합 한도 소진',
  countLimit: '횟수 제한 초과',
  roundedToZero: '절사되어 0원',
  tierLocked: '실적 구간 미달',
};

const CAPPED_LABEL: Record<NonNullable<TxResult['cappedBy']>, string> = {
  benefit: '혜택 한도',
  total: '통합 한도',
  perTransaction: '건당 한도',
};

/** "550원 할인 (통합 한도에 잘림)" 또는 "건당 최소금액 미달". */
export function describeResult(result: TxResult): string {
  if (result.discount <= 0) return REASON_LABEL[result.reason];
  const capped = result.cappedBy === undefined ? '' : ` (${CAPPED_LABEL[result.cappedBy]}에 잘림)`;
  return `${won(result.discount)} 할인${capped}`;
}

export const EXCLUSION_LABEL: Record<ExclusionMode, string> = {
  full: '할인받은 건 전액 제외',
  discountOnly: '할인액만 제외',
  none: '제외 안 함',
};

export const PAYMENT_TYPE_LABEL: Record<PaymentType, string> = {
  lump: '일시불',
  installment: '할부',
  interestFreeInstallment: '무이자할부',
};

export const ISSUE_LABEL: Record<IssueKind, string> = {
  unknownFormat: '모르는 포맷',
  noHeader: '헤더 없음',
  badDate: '날짜 읽기 실패',
  badAmount: '금액 읽기 실패',
  zeroAmount: '0원 결제',
  skippedRow: '거래 아님',
  cancelled: '취소됨',
  unmatchedCancellation: '짝 없는 취소',
  partiallyCancelled: '부분취소',
  issuerBenefit: '카드사 혜택',
};
