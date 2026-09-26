/**
 * 명세서 여러 장 → 거래 목록 하나.
 *
 * 카드사 명세서는 보통 한 달에 한 파일이라 3개월치를 보려면 세 장을 합쳐야 한다. 이때
 * 같은 파일을 두 번 올리거나 조회 기간이 겹치면 거래가 두 번 들어가 실적이 조용히
 * 부풀고, 결과 숫자는 여전히 그럴듯하다. 그래서 합치면서 겹친 거래를 걸러 따로 돌려준다.
 */
import type { Transaction } from '../core/types.js';
import { UNCATEGORIZED } from './category/rules.js';
import { normalizeMerchant } from './normalize.js';
import { summarizeUncategorized } from './statement.js';
import type { ParseResult } from './statement.js';
import type { UncategorizedMerchant } from './types.js';

export interface MergedStatements {
  /** 날짜순. 같은 날이면 파일 순서, 파일 안 순서를 지킨다. */
  transactions: Transaction[];
  /** 앞 파일에 이미 있던 거래라 뺀 것. 사용자에게 보여줄 목록이다. */
  duplicates: Transaction[];
  uncategorized: UncategorizedMerchant[];
}

function keyOf(tx: Transaction): string {
  return `${tx.date}|${normalizeMerchant(tx.merchant)}|${tx.amount}`;
}

/**
 * 파일 단위로 겹친 거래를 거른다.
 *
 * 같은 날 같은 가게에서 같은 금액을 두 번 결제하는 일은 흔하므로 한 파일 안에서는
 * 중복으로 보지 않는다. 뒤 파일의 거래는 앞 파일들에 있던 건수만큼만 지운다.
 */
export function mergeParseResults(
  results: readonly ParseResult[],
  fallback: string = UNCATEGORIZED,
): MergedStatements {
  const seen = new Map<string, number>();
  const kept: Transaction[] = [];
  const duplicates: Transaction[] = [];

  for (const result of results) {
    const available = new Map(seen);
    for (const tx of result.transactions) {
      const key = keyOf(tx);
      const left = available.get(key) ?? 0;
      if (left > 0) {
        available.set(key, left - 1);
        duplicates.push(tx);
        continue;
      }
      kept.push(tx);
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }

  // Array.prototype.sort는 안정 정렬이라 같은 날 거래의 순서가 그대로 남는다.
  const transactions = kept.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return {
    transactions,
    duplicates,
    uncategorized: summarizeUncategorized(transactions, fallback),
  };
}
