import type { PaymentType, SpendingPattern, SpendingSample, Transaction, Won } from './types.js';

const DEFAULT_TICKET: Won = 20_000;
/** 가상 거래를 흩뿌릴 날짜 수. 일 단위 횟수 제한이 현실적으로 걸리게 한다. */
export const SPREAD_DAYS = 28;
const BASE_MONTH = '2026-01';

export interface Synthetic {
  txs: Transaction[];
  breakdown: Record<string, Won>;
}

/** 비중을 합이 1이 되도록 정규화한다. 0 이하 비중은 버린다. */
function normalizeWeights(weights: Record<string, number>): Array<[string, number]> {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const sum = entries.reduce((acc, [, w]) => acc + w, 0);
  return sum <= 0 ? [] : entries.map(([category, w]) => [category, w / sum]);
}

/**
 * 총 결제액을 카테고리 비중과 건단가에 따라 가상 거래로 쪼갠다.
 *
 * 건단가가 필요한 이유는 건당 최소금액·건당 한도·횟수 제한이 전부 "건" 단위이기
 * 때문이다. 총액만으로는 이 조건들을 흉내 낼 수 없다.
 * 마지막 카테고리가 반올림 오차를 흡수해 합계가 정확히 총액과 맞는다.
 */
export function synthesizeMonth(total: Won, pattern: SpendingPattern): Synthetic {
  const samples = (pattern.samples ?? []).filter((s) => s.amount > 0);
  if (samples.length > 0) return repeatSamples(total, samples);

  const parts = normalizeWeights(pattern.weights);
  const breakdown: Record<string, Won> = {};
  const txs: Transaction[] = [];
  let assigned = 0;
  let seq = 0;

  parts.forEach(([category, weight], index) => {
    // 할인액이 아니라 예산 배분이라 절사가 아닌 반올림을 쓴다. roundDiscount는 할인액 전용이다.
    const isLast = index === parts.length - 1;
    const categoryTotal = isLast ? total - assigned : Math.round(total * weight);
    assigned += categoryTotal;
    breakdown[category] = categoryTotal;
    if (categoryTotal <= 0) return;

    const ticket = pattern.ticketSize?.[category] ?? pattern.defaultTicket ?? DEFAULT_TICKET;
    const count = Math.max(1, Math.ceil(categoryTotal / ticket));
    let remaining = categoryTotal;

    for (let i = 0; i < count; i += 1) {
      const amount = i === count - 1 ? remaining : Math.min(ticket, remaining);
      remaining -= amount;
      const day = String((seq % SPREAD_DAYS) + 1).padStart(2, '0');
      txs.push({
        id: `${category}-${String(i).padStart(6, '0')}`,
        date: `${BASE_MONTH}-${day}`,
        amount,
        merchant: category,
        category,
      });
      seq += 1;
    }
  });

  return { txs, breakdown };
}

/**
 * 실제 거래 표본을 순서대로 되풀이해 총액을 채운다. 마지막 건은 남은 금액으로 자른다.
 *
 * 금액을 비율로 늘리지 않고 건을 되풀이하는 이유는 건당 최소금액·건당 한도가 원래 건단가에
 * 걸려 있기 때문이다. 가맹점명·해외·결제유형도 표본 그대로 옮겨 혜택 매칭이 원본과 같다.
 */
function repeatSamples(total: Won, samples: readonly SpendingSample[]): Synthetic {
  const breakdown: Record<string, Won> = {};
  const txs: Transaction[] = [];
  let remaining = total;
  let seq = 0;

  while (remaining > 0) {
    const sample = samples[seq % samples.length]!;
    const amount = Math.min(sample.amount, remaining);
    remaining -= amount;
    breakdown[sample.category] = (breakdown[sample.category] ?? 0) + amount;
    const day = String((seq % SPREAD_DAYS) + 1).padStart(2, '0');
    txs.push({
      ...sample,
      id: `sample-${String(seq).padStart(6, '0')}`,
      date: `${BASE_MONTH}-${day}`,
      amount,
    });
    seq += 1;
  }

  return { txs, breakdown };
}

/**
 * 배분 처방의 한 조각. 어느 항목에 얼마를 몇 건으로 쓰는지다.
 *
 * `allocate`가 만들고 이 모듈이 거래로 바꾼다. 처방을 거래로 되돌릴 수 있어야
 * FIFO로 재현해 검증할 수 있다(불변규칙 4).
 */
export interface SpendSlice {
  /** 질문 항목 id. 거래에는 남지 않고 처방을 되짚을 때 쓴다. */
  key: string;
  category: string;
  merchant: string;
  amount: Won;
  txCount: number;
  overseas?: boolean;
  paymentType?: PaymentType;
}

/**
 * 배분 처방을 가상 거래로 바꾼다.
 *
 * 큰 건을 먼저 오게 날짜를 매긴다. 횟수 제한이 걸린 혜택은 접수 순서대로 한도를 쓰므로,
 * 월초에 소액으로 횟수를 써 버리면 같은 금액을 써도 할인이 줄어든다. 처방이 "큰 건에 먼저
 * 쓰라"고 말하는 것과 같은 순서로 거래를 만들어야, FIFO 재현이 처방을 검증하는 의미가 있다.
 *
 * 날짜는 금액 내림차순과 어긋나지 않게 단조 증가로 흩뿌린다 — `applyDiscounts`가 날짜순으로
 * 처리하므로 날짜가 뒤섞이면 큰 건 우선이 깨진다. 흩뿌리는 이유는 "일 1회" 제한이 한 날에
 * 몰린 거래를 전부 막아 버리지 않게 하는 것이다.
 */
export function synthesizeSlices(slices: readonly SpendSlice[]): Transaction[] {
  interface Draft {
    slice: SpendSlice;
    amount: Won;
    seq: number;
  }
  const drafts: Draft[] = [];

  for (const slice of slices) {
    if (slice.amount <= 0 || slice.txCount <= 0) continue;
    // 건당 금액을 고르게 나눈다. 할인액이 아니라 예산 쪼개기라 Math.floor를 쓴다(불변규칙 3).
    const base = Math.floor(slice.amount / slice.txCount);
    let remaining = slice.amount;
    for (let i = 0; i < slice.txCount; i += 1) {
      const amount = i === slice.txCount - 1 ? remaining : base;
      remaining -= amount;
      if (amount <= 0) continue;
      drafts.push({ slice, amount, seq: i });
    }
  }

  drafts.sort((a, b) => b.amount - a.amount || a.slice.key.localeCompare(b.slice.key) || a.seq - b.seq);

  const total = drafts.length;
  return drafts.map((draft, index) => {
    const day = total === 0 ? 1 : Math.floor((index * SPREAD_DAYS) / total) + 1;
    const tx: Transaction = {
      id: `plan-${String(index).padStart(6, '0')}`,
      date: `${BASE_MONTH}-${String(day).padStart(2, '0')}`,
      amount: draft.amount,
      merchant: draft.slice.merchant,
      category: draft.slice.category,
    };
    if (draft.slice.overseas !== undefined) tx.overseas = draft.slice.overseas;
    if (draft.slice.paymentType !== undefined) tx.paymentType = draft.slice.paymentType;
    return tx;
  });
}
