import type {
  Benefit,
  DiscountReason,
  ExclusionMode,
  PaymentType,
  Tier,
  TxResult,
  Won,
} from '../core/index.js';
import type { IssueKind } from '../import/index.js';

export const won = (n: Won): string => `${n.toLocaleString('ko-KR')}원`;

/**
 * 고르는 칸에 세우는 혜택 배지. "토스페이·토스쇼핑 15% 할인" → "토스페이 15%".
 *
 * 규칙 JSON의 `label`은 약관 문장을 그대로 옮긴 것이라 배지로 쓰기에 길다. 끝에 붙은 할인
 * 표기를 떼고, 대상이 가운뎃점으로 여럿이면 첫 대상만 남긴다 — 배지가 나란히 서는 자리라
 * 하나가 두 줄을 차지하면 칸이 무너진다.
 *
 * 떼는 일은 뒤에서부터 한다. 앞에서 첫 숫자를 찾으면 "GS25 5% 할인"이 "GS 5%"가 된다.
 * 값은 라벨이 아니라 `discount`에서 읽는다 — 라벨은 사람이 적은 글이라 숫자가 어긋날 수
 * 있지만 `discount`는 엔진이 실제로 쓰는 값이다.
 */
export function benefitTag(benefit: Benefit): string {
  const head = benefit.label.replace(/[\s(]*[\d,.]+\s*(%|원)[^%원]*$/, '');
  const name = (head.split('·')[0] ?? '').trim();
  const value =
    benefit.discount.type === 'rate'
      ? `${Math.round(benefit.discount.rate * 1000) / 10}%`
      : won(benefit.discount.amount);
  return name === '' ? value : `${name} ${value}`;
}

/**
 * 한도 없는 혜택이 열린 구간의 월 최대 옆에 붙는 말. "+ 1% 한도 없음".
 *
 * 월 최대 숫자는 한도 없는 혜택을 뺀 몫이라 이 말이 없으면 거기서 끝인 것처럼 읽힌다. 혜택이
 * 하나면 할인율만 적는다 — 전 가맹점 할인이 보통이라 이름을 붙이면 길기만 하다. 여럿이면 어느
 * 쪽인지 가려야 하므로 배지 문구를 잇는다.
 */
export function unboundedNote(card: { benefits: readonly Benefit[] }, ids: readonly string[]): string {
  const list = card.benefits.filter((b) => ids.includes(b.id));
  if (list.length === 0) return '';
  const text =
    list.length === 1 && list[0] !== undefined
      ? benefitTag({ ...list[0], label: '' })
      : list.map(benefitTag).join('·');
  return `+ ${text} 한도 없음`;
}

export const tierName =(tier: Tier): string => tier.label ?? `${won(tier.min)} 이상`;

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
  groupCapReached: '묶인 혜택의 공동 한도 소진',
  totalCapReached: '통합 한도 소진',
  countLimit: '횟수 제한 초과',
  roundedToZero: '절사되어 0원',
  tierLocked: '실적 구간 미달',
};

const CAPPED_LABEL: Record<NonNullable<TxResult['cappedBy']>, string> = {
  benefit: '혜택 한도',
  group: '공동 한도',
  total: '통합 한도',
  perTransaction: '건당 한도',
};

/** "550원 할인 (통합 한도에 잘림)", "2,000원 할인 (중복 500원 포함)" 또는 "건당 최소금액 미달". */
export function describeResult(result: TxResult): string {
  if (result.discount <= 0) return REASON_LABEL[result.reason];
  const notes: string[] = [];
  if (result.cappedBy !== undefined) notes.push(`${CAPPED_LABEL[result.cappedBy]}에 잘림`);
  const stacked = (result.stacked ?? []).reduce((sum, part) => sum + part.discount, 0);
  if (stacked > 0) notes.push(`중복 ${won(stacked)} 포함`);
  return `${won(result.discount)} 할인${notes.length === 0 ? '' : ` (${notes.join(', ')})`}`;
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

/**
 * 앞말의 받침에 맞는 조사를 고른다.
 *
 * 카드 이름이 데이터에서 오기 때문에 "카페카드은"처럼 어긋나는 자리가 생긴다. 한글 음절은
 * 0xAC00부터 종성 28개씩 묶여 있어 나머지가 0이면 받침이 없다. 한글이 아닌 글자로 끝나면
 * (숫자·영문) 판단할 수 없으므로 받침 없는 쪽을 쓴다 — "SHOPPING+는"이 "+은"보다 낫다.
 */
export function josa(word: string, withJong: string, withoutJong: string): string {
  const last = word.trim().at(-1);
  if (last === undefined) return withoutJong;
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return withoutJong;
  return (code - 0xac00) % 28 === 0 ? withoutJong : withJong;
}
