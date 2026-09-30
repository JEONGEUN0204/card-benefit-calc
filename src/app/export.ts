/**
 * 계산 결과를 CSV 문자열로 만든다.
 *
 * 순수 문자열 함수다. 파일로 떨어뜨리는 일은 `download.ts`가 하고, 그것도 이 브라우저
 * 안에서 끝난다 — 어디로도 올리지 않는다 (CLAUDE.md 규칙 2).
 *
 * 금액은 콤마 없는 정수로 적는다. `100,000`이라고 적으면 표 계산기가 문자열로 읽어
 * 합계를 못 낸다.
 */
import type { MonthResult, Transaction } from '../core/index.js';
import { REASON_LABEL, categoryLabel, tierName } from './labels.js';

const HEADER = ['월', '적용구간', '전월실적', '날짜', '가맹점', '업종', '결제액', '할인액', '사유', '실적반영'];

/** 쉼표·인용부호·줄바꿈이 있으면 감싸고, 안의 인용부호는 겹친다 (RFC 4180). */
function cell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function resultCsv(
  months: readonly MonthResult[],
  transactions: readonly Transaction[],
): string {
  const byId = new Map(transactions.map((t) => [t.id, t]));
  const rows: string[] = [HEADER.join(',')];

  for (const month of months) {
    const tier =
      month.tier === null ? '구간 없음' : `${tierName(month.tier)}${month.tierAssumed ? '(가정)' : ''}`;
    for (const result of month.transactions) {
      const tx = byId.get(result.txId);
      if (tx === undefined) continue;
      rows.push(
        [
          month.month,
          tier,
          month.prevSpending ?? '',
          tx.date,
          tx.merchant,
          categoryLabel(tx.category),
          tx.amount,
          result.discount,
          REASON_LABEL[result.reason],
          result.countedSpending,
        ]
          .map(cell)
          .join(','),
      );
    }
    // 월정액 할인은 거래가 아니라 구간에 붙는다. 줄이 없으면 할인액 열의 합이 화면 합계보다 작다.
    if (month.rebate > 0) {
      rows.push(
        [month.month, tier, month.prevSpending ?? '', '', '월정액 할인', '', 0, month.rebate, '월정액 할인', 0]
          .map(cell)
          .join(','),
      );
    }
  }

  return rows.join('\r\n');
}
