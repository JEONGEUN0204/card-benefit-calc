/**
 * 헤더 행 찾기와 컬럼 매핑.
 *
 * 카드사 명세서는 맨 위에 안내문·조회기간 같은 행이 몇 줄 붙어 나온다. 그래서 "첫 행이
 * 헤더"라고 가정할 수 없고, 필수 컬럼이 전부 잡히는 첫 행을 헤더로 본다.
 */
import { REQUIRED_FIELDS } from './types.js';
import type { ColumnIndex, FieldName, RawRow, StatementFormat } from './types.js';

/**
 * 컬럼을 배정하는 순서.
 *
 * 부분일치 라운드에서 앞선 필드가 컬럼을 먼저 가져간다. `할부`가 `할부금액`을 집어가면
 * 금액 컬럼이 밀리므로, 금액을 결제유형보다 앞에 둔다.
 */
const FIELD_ORDER: readonly FieldName[] = [
  'date',
  'merchant',
  'amount',
  'status',
  'paymentType',
  'issuerCategory',
];

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, '');

export interface HeaderMatch {
  /** 헤더 행의 0-based 인덱스. */
  rowIndex: number;
  columns: ColumnIndex;
  /** 잡아낸 컬럼 수. 포맷 감지에서 동점을 가른다. */
  matched: number;
}

/**
 * 헤더 한 행을 논리 필드 → 컬럼 인덱스로 옮긴다.
 *
 * 완전일치를 먼저 전부 시도하고 남은 필드만 부분일치로 채운다. `이용금액`과 `이용구분`이
 * 둘 다 `이용`으로 시작하는 식이라, 부분일치를 먼저 하면 엉뚱한 컬럼을 집는다.
 */
function mapColumns(header: RawRow, format: StatementFormat): ColumnIndex | null {
  const cells = header.map(norm);
  const taken = new Set<number>();
  const columns: Partial<Record<FieldName, number>> = {};

  const assign = (exact: boolean): void => {
    for (const field of FIELD_ORDER) {
      if (columns[field] !== undefined) continue;
      const candidates = format.columns[field];
      if (candidates === undefined) continue;

      for (const candidate of candidates) {
        const needle = norm(candidate);
        if (needle === '') continue;
        const index = cells.findIndex(
          (cell, i) =>
            !taken.has(i) && cell !== '' && (exact ? cell === needle : cell.includes(needle)),
        );
        if (index >= 0) {
          columns[field] = index;
          taken.add(index);
          break;
        }
      }
    }
  };

  assign(true);
  assign(false);

  if (!REQUIRED_FIELDS.every((field) => columns[field] !== undefined)) return null;
  return columns;
}

/** 이 포맷을 알아보는 컬럼명이 헤더에 전부 있는지. */
function signatureMatches(header: RawRow, format: StatementFormat): boolean {
  const cells = header.map(norm);
  return format.signature.every((name) => cells.includes(norm(name)));
}

/** 안내문이 이보다 길게 붙은 명세서는 본 적이 없다. 데이터 행을 헤더로 오인하지 않게 막는다. */
const HEADER_SEARCH_LIMIT = 30;

export function locateHeader(
  rows: readonly RawRow[],
  format: StatementFormat,
): HeaderMatch | null {
  const end = Math.min(rows.length, HEADER_SEARCH_LIMIT);
  for (let i = 0; i < end; i += 1) {
    const row = rows[i];
    if (row === undefined) continue;
    if (!signatureMatches(row, format)) continue;

    const columns = mapColumns(row, format);
    if (columns === null) continue;
    return { rowIndex: i, columns, matched: Object.keys(columns).length };
  }
  return null;
}
