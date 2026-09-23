/**
 * 명세서 행렬 → `Transaction[]`.
 *
 * 이 함수가 내놓는 배열은 `core/simulate`에 그대로 들어간다. 그래서 거래를 만들어내는
 * 것만큼이나 "만들지 않은 행"을 남기는 일이 중요하다. 합계 행 하나를 조용히 거래로
 * 읽으면 그 달 실적이 두 배가 되고, 결과 숫자는 여전히 그럴듯하다.
 */
import type { Transaction, Won } from '../core/types.js';
import { categorize, defaultRuleset } from './category/rules.js';
import type { CategoryRuleset } from './category/types.js';
import { locateHeader } from './columns.js';
import { parseCsv } from './csv.js';
import type { CsvOptions } from './csv.js';
import { detectFormat, findFormat } from './formats/index.js';
import { normalizeMerchant, parseDate, parsePaymentType, parseWon } from './normalize.js';
import type {
  ColumnIndex,
  FieldCells,
  ParseIssue,
  RawRow,
  StatementFormat,
  UncategorizedMerchant,
} from './types.js';

export interface ParseOptions {
  /** 포맷을 직접 고른다. 생략하면 헤더를 보고 알아낸다. */
  formatId?: string;
  /** 카테고리 규칙집. 생략하면 기본 규칙만 쓴다. */
  ruleset?: CategoryRuleset;
  /** 연도를 적지 않는 명세서("01/05")에 붙일 연도. */
  defaultYear?: number;
  /** 거래 id 접두사. 여러 파일을 합칠 때 id 충돌을 막는다. */
  idPrefix?: string;
}

export interface ParseResult {
  /** 실제로 쓴 포맷. 감지에 실패했으면 'unknown'. */
  formatId: string;
  transactions: Transaction[];
  /** 거래로 읽지 못했거나 계산에서 뺀 행. 사용자에게 그대로 보여줄 목록이다. */
  issues: ParseIssue[];
  /** 카테고리를 못 정한 가맹점. 금액이 큰 순. */
  uncategorized: UncategorizedMerchant[];
  /** 헤더 아래에서 거래로 읽으려 시도한 행 수. */
  rowCount: number;
}

/** 거래가 아닌 요약 행. 가맹점명 자리에 이런 말이 들어온다. */
const SKIP_KEYWORDS = ['합계', '소계', '총계', '누계', '이월', 'total'];

/** 상쇄를 기다리는 거래. 카테고리는 취소 정리가 끝난 뒤에 붙인다. */
interface Entry {
  row: number;
  date: string;
  amount: Won;
  merchant: string;
  issuerCategory: string;
  paymentTypeText: string;
  cancelled: boolean;
}

interface Reversal {
  row: number;
  date: string;
  merchant: string;
  amount: Won;
}

function readCells(row: RawRow, columns: ColumnIndex): FieldCells {
  const at = (index: number | undefined): string | undefined =>
    index === undefined ? undefined : (row[index] ?? '');
  return {
    date: at(columns.date),
    merchant: at(columns.merchant),
    amount: at(columns.amount),
    paymentType: at(columns.paymentType),
    issuerCategory: at(columns.issuerCategory),
    status: at(columns.status),
  };
}

function isSummaryRow(cells: FieldCells): boolean {
  const merchant = (cells.merchant ?? '').trim();
  if (merchant === '') return true;
  const date = (cells.date ?? '').trim();
  return SKIP_KEYWORDS.some((k) => merchant === k || date === k);
}

/**
 * 취소 행을 원거래와 짝지어 둘 다 계산에서 뺀다.
 *
 * 취소 행만 버리고 원거래를 남기면 실적이 실제보다 높게 잡혀 다음 달 구간이 틀린다.
 * 명세서에 시각이 없어 같은 날 같은 금액이 여러 건이면 마지막 건부터 상쇄한다.
 */
function reconcile(entries: Entry[], reversals: readonly Reversal[], issues: ParseIssue[]): void {
  for (const reversal of reversals) {
    let matched: Entry | null = null;
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      if (entry === undefined || entry.cancelled) continue;
      if (entry.amount !== reversal.amount) continue;
      if (entry.date > reversal.date) continue;
      if (normalizeMerchant(entry.merchant) !== normalizeMerchant(reversal.merchant)) continue;
      matched = entry;
      break;
    }

    if (matched === null) {
      const won = reversal.amount.toLocaleString('ko-KR');
      issues.push({
        row: reversal.row,
        kind: 'unmatchedCancellation',
        message: `취소 행인데 짝이 되는 원거래를 찾지 못했다 (${reversal.merchant}, ${won}원). 원거래가 지난 달 명세서에 있을 수 있다.`,
      });
      continue;
    }

    matched.cancelled = true;
    issues.push({
      row: reversal.row,
      kind: 'cancelled',
      message: `취소된 거래다. ${matched.row}행의 원거래와 함께 계산에서 뺐다.`,
    });
  }
}

/**
 * 거래를 시간순으로 되돌린다.
 *
 * 할인 배정이 FIFO라서 순서가 곧 결과다. 명세서는 최신순으로 내려오는 경우가 많은데,
 * 날짜로만 정렬하면 같은 날 안의 순서가 뒤집힌 채 남는다. 그러면 "하루 1회" 같은 횟수
 * 제한에서 엉뚱한 건이 할인을 가져간다. 최신순이면 행 순서부터 뒤집고 안정 정렬한다.
 */
function toChronological(entries: readonly Entry[]): Entry[] {
  const first = entries[0];
  const last = entries[entries.length - 1];
  const descending = first !== undefined && last !== undefined && first.date > last.date;
  const ordered = descending ? [...entries].reverse() : [...entries];
  return ordered.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function summarizeUncategorized(
  transactions: readonly Transaction[],
  fallback: string,
): UncategorizedMerchant[] {
  const byMerchant = new Map<string, UncategorizedMerchant>();
  for (const tx of transactions) {
    if (tx.category !== fallback) continue;
    const found = byMerchant.get(tx.merchant);
    if (found === undefined) {
      byMerchant.set(tx.merchant, { merchant: tx.merchant, count: 1, amount: tx.amount });
    } else {
      found.count += 1;
      found.amount += tx.amount;
    }
  }
  // 금액이 큰 가맹점부터 고치는 편이 결과를 가장 많이 바꾼다.
  return [...byMerchant.values()].sort((a, b) => b.amount - a.amount);
}

function resolveFormat(
  rows: readonly RawRow[],
  options: ParseOptions,
  issues: ParseIssue[],
): StatementFormat | null {
  if (options.formatId === undefined) return detectFormat(rows);

  const chosen = findFormat(options.formatId);
  if (chosen !== null) return chosen;

  issues.push({
    row: 0,
    kind: 'unknownFormat',
    message: `모르는 포맷이다: ${options.formatId}. 헤더를 보고 직접 알아낸다.`,
  });
  return detectFormat(rows);
}

/** 명세서 행렬을 거래 목록으로 옮긴다. */
export function parseStatement(rows: readonly RawRow[], options: ParseOptions = {}): ParseResult {
  const issues: ParseIssue[] = [];
  const ruleset = options.ruleset ?? defaultRuleset();
  const idPrefix = options.idPrefix ?? '';

  const format = resolveFormat(rows, options, issues);
  const header = format === null ? null : locateHeader(rows, format);
  if (format === null || header === null) {
    issues.push({
      row: 0,
      kind: 'noHeader',
      message: '거래 목록의 헤더를 찾지 못했다. 날짜·가맹점·금액 컬럼이 있는 시트인지 확인한다.',
    });
    return {
      formatId: format?.id ?? 'unknown',
      transactions: [],
      issues,
      uncategorized: [],
      rowCount: 0,
    };
  }

  const entries: Entry[] = [];
  const reversals: Reversal[] = [];
  let rowCount = 0;

  for (let i = header.rowIndex + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (row === undefined) continue;
    if (row.every((cell) => cell.trim() === '')) continue;

    const rowNumber = i + 1;
    rowCount += 1;
    const cells = readCells(row, header.columns);

    if (isSummaryRow(cells)) {
      issues.push({ row: rowNumber, kind: 'skippedRow', message: '거래 행이 아니라 건너뛰었다.' });
      continue;
    }

    const merchant = (cells.merchant ?? '').trim();
    const date = parseDate(cells.date ?? '', options.defaultYear);
    if (date === null) {
      issues.push({
        row: rowNumber,
        kind: 'badDate',
        message: `날짜를 읽을 수 없다: "${cells.date ?? ''}"`,
      });
      continue;
    }

    const amount = parseWon(cells.amount ?? '');
    if (amount === null) {
      issues.push({
        row: rowNumber,
        kind: 'badAmount',
        message: `금액을 읽을 수 없다: "${cells.amount ?? ''}"`,
      });
      continue;
    }
    if (amount === 0) {
      issues.push({ row: rowNumber, kind: 'zeroAmount', message: '0원 결제라 계산에서 뺐다.' });
      continue;
    }

    const kind = format.classifyRow?.(cells, amount) ?? (amount < 0 ? 'reversal' : 'normal');

    if (kind === 'voided') {
      issues.push({ row: rowNumber, kind: 'cancelled', message: '취소된 거래라 계산에서 뺐다.' });
      continue;
    }
    // 음수 금액은 어떤 경우에도 거래가 되지 않는다. 음수 결제액이 계산 엔진에 들어가면
    // 실적이 도로 줄어드는 기괴한 결과가 조용히 나온다.
    if (kind === 'reversal' || amount < 0) {
      reversals.push({ row: rowNumber, date, merchant, amount: Math.abs(amount) });
      continue;
    }

    entries.push({
      row: rowNumber,
      date,
      amount,
      merchant,
      issuerCategory: (cells.issuerCategory ?? '').trim(),
      paymentTypeText: cells.paymentType ?? '',
      cancelled: false,
    });
  }

  reconcile(entries, reversals, issues);

  const transactions = toChronological(entries.filter((e) => !e.cancelled)).map((entry) => {
    const match = categorize(
      entry.issuerCategory === ''
        ? { merchant: entry.merchant }
        : { merchant: entry.merchant, issuerCategory: entry.issuerCategory },
      ruleset,
    );
    const tx: Transaction = {
      id: `${idPrefix}r${entry.row}`,
      date: entry.date,
      amount: entry.amount,
      merchant: entry.merchant,
      category: match.category,
      paymentType: parsePaymentType(entry.paymentTypeText),
    };
    return tx;
  });

  issues.sort((a, b) => a.row - b.row);

  return {
    formatId: format.id,
    transactions,
    issues,
    uncategorized: summarizeUncategorized(transactions, ruleset.fallback),
    rowCount,
  };
}

/** CSV 텍스트를 바로 거래 목록으로 옮긴다. */
export function parseStatementCsv(
  text: string,
  options: ParseOptions & CsvOptions = {},
): ParseResult {
  const csvOptions = options.delimiter === undefined ? {} : { delimiter: options.delimiter };
  return parseStatement(parseCsv(text, csvOptions), options);
}
