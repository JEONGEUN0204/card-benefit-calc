/**
 * 지출 질문에 사람 말을 붙인다.
 *
 * `src/core/ask.ts`는 구조만 낸다 — 풀 키, 업종·가맹점 목록, 중요도, 그 풀을 쓰는 혜택.
 * "온라인몰"이라 부를지 "쇼핑"이라 부를지는 계산이 아니므로 여기서 정한다.
 */
import { REST_POOL } from '../core/index.js';
import type { CardRule, SpendQuestion, Won } from '../core/index.js';
import { categoryLabel, won } from './labels.js';

/** 가맹점 이름을 몇 개까지 늘어놓을지. 넘으면 "등 N곳"으로 줄인다. */
const MERCHANT_HEADS = 3;

export interface QuestionView {
  pool: string;
  /** 칸에 적는 이름. "쿠팡·마켓컬리·무신사 등 10곳" */
  label: string;
  /** 이 돈이 어떤 혜택을 부르는지. "팟 카드 온라인쇼핑 15% (월 15,000원)" */
  benefitSummary: string;
  /** 건당 최소금액이나 승인시간처럼 답하기 전에 알아야 할 것. 없으면 null. */
  note: string | null;
  /** 처방에 들어가지 못하는 항목. 물어도 쓸 데가 없다. */
  timeGatedOnly: boolean;
  /** 한도 없는 혜택이 걸려 중요도를 다른 항목과 견줄 수 없는 항목. */
  unbounded: boolean;
  impact: Won;
}

/**
 * 보여 줄 가맹점 순서. 한글 이름을 앞에 둔다.
 *
 * core는 코드 단위로 정렬해 같은 입력이 같은 답을 내게 한다. 그러면 라틴 이름이 앞서서
 * "DISNEY·MELON·NETFLIX"가 되는데, 한국 사용자에게는 "넷플릭스·멜론·디즈니플러스"가 훨씬
 * 빨리 읽힌다. 같은 브랜드를 두 표기로 적어 둔 규칙이 많아 셋만 보여 줄 때 어느 쪽이 뜨는지가
 * 읽는 속도를 가른다.
 */
function displayOrder(merchants: readonly string[]): string[] {
  const hangul = (s: string): boolean => /^[가-힣]/.test(s);
  return [...merchants].sort((a, b) => {
    if (hangul(a) !== hangul(b)) return hangul(a) ? -1 : 1;
    return a.localeCompare(b, 'ko');
  });
}

function labelFor(question: SpendQuestion): string {
  if (question.kind === 'rest') return '나머지 결제';
  if (question.kind === 'overseas') return '해외 결제';
  if (question.merchants.length > 0) {
    const heads = displayOrder(question.merchants).slice(0, MERCHANT_HEADS).join('·');
    const rest = question.merchants.length - MERCHANT_HEADS;
    return rest > 0 ? `${heads} 등 ${question.merchants.length}곳` : heads;
  }
  return question.categories.map(categoryLabel).join('·');
}

/**
 * 할인율을 사람이 읽는 꼴로. 0.15 → "15%".
 *
 * 정액 할인은 비율이 아니라 금액이므로 `effectiveRateOf`가 환산한 값을 그대로 적으면
 * 어색하다("100%"). 그런 혜택은 비율을 적지 않는다.
 */
function rateText(rate: number): string | null {
  if (!(rate > 0) || rate >= 1) return null;
  return `${Math.round(rate * 1000) / 10}%`;
}

function summaryFor(question: SpendQuestion, names: ReadonlyMap<string, string>): string {
  const parts: string[] = [];
  for (const user of question.usedBy) {
    const card = names.get(user.cardId) ?? user.cardId;
    const rate = rateText(user.rate);
    const cap = user.nominalCap === null ? '한도 없음' : `월 ${won(user.nominalCap)}`;
    parts.push(`${card} ${rate === null ? user.label : rate} (${cap})`);
  }
  return parts.join(', ');
}

function noteFor(question: SpendQuestion): string | null {
  const notes: string[] = [];
  if (question.timeGatedOnly) {
    /*
     * 승인시간은 명세서에도 가상 거래에도 없다. 짐작으로 붙이면 밤에 쓰지 않은 결제가
     * 할인으로 잡혀 조용히 부푸므로, 이 항목은 처방에서 뺀다.
     */
    notes.push('승인시간 조건이 걸려 있어 처방에 넣지 못합니다');
  }
  if (question.minTransaction !== undefined) {
    notes.push(`${won(question.minTransaction)} 이상 결제만`);
  }
  return notes.length === 0 ? null : notes.join(' · ');
}

export function questionViews(
  questions: readonly SpendQuestion[],
  cards: readonly CardRule[],
): QuestionView[] {
  const names = new Map(cards.map((c) => [c.id, c.name]));
  return questions.map((question) => ({
    pool: question.pool,
    label: labelFor(question),
    benefitSummary: summaryFor(question, names),
    note: noteFor(question),
    timeGatedOnly: question.timeGatedOnly,
    unbounded: question.unbounded,
    impact: question.impact,
  }));
}

/**
 * 처음 펼쳐 둘 질문의 수.
 *
 * 카드 두세 장이면 질문이 5~11개라 전부 펼친다 — 접어 두면 중요한 항목이 숨는다. 실제로
 * 팟 카드와 EVERY 1을 고르면 아홉 개가 나오는데, 여섯 개만 펼치면 간편결제가 접힌 채로
 * 남는다. 네 장이 넘어 18개까지 늘 때만 접는다.
 *
 * 답하지 않은 항목은 0으로 보므로 접어 둬도 처방이 과장되지는 않는다 — 작게 나온다.
 */
export const DEFAULT_OPEN_QUESTIONS = 10;

/** 나머지 결제 질문은 늘 맨 위에 둔다. 구간을 여는 돈의 출처라 답이 사실상 배분을 정한다. */
export function orderForDisplay(views: readonly QuestionView[]): QuestionView[] {
  const rest = views.filter((v) => v.pool === REST_POOL);
  const others = views.filter((v) => v.pool !== REST_POOL);
  return [...rest, ...others];
}
