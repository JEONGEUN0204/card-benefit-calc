/**
 * 엑셀 워크북 → 문자열 행렬.
 *
 * SheetJS에 의존하는 유일한 모듈이다. 여기서 행렬로 바꿔버리면 그 아래(포맷 감지·파싱·
 * 카테고리)는 CSV와 완전히 같은 경로를 탄다. 파일을 읽는 일은 호출자가 맡으므로 이
 * 모듈도 파일시스템·네트워크를 건드리지 않는다 — 결제내역은 브라우저 안에 남는다.
 */
import * as XLSX from 'xlsx';
import { parseStatement } from './statement.js';
import type { ParseOptions, ParseResult } from './statement.js';

export interface WorkbookOptions {
  /** 읽을 시트 이름. 생략하면 첫 시트. */
  sheetName?: string;
}

/** 워크북 안의 시트 이름들. 사용자에게 고르게 할 때 쓴다. */
export function listSheets(data: ArrayBuffer | Uint8Array): string[] {
  return XLSX.read(data, { type: 'array' }).SheetNames;
}

export function readWorkbookRows(
  data: ArrayBuffer | Uint8Array,
  options: WorkbookOptions = {},
): string[][] {
  // raw: false — 숫자·날짜를 엑셀이 화면에 보여주는 문자열 그대로 받는다. 날짜 셀이
  // 일련번호(45000)로 넘어오면 파싱 단계에서 복구할 방법이 없다.
  const book = XLSX.read(data, { type: 'array', raw: false, cellDates: false });
  const name = options.sheetName ?? book.SheetNames[0];
  if (name === undefined) return [];

  const sheet = book.Sheets[name];
  if (sheet === undefined) return [];

  // defval: '' — 빈 셀을 빠뜨리면 그 행의 컬럼이 통째로 밀린다.
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: true,
  });

  return rows.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? '').trim()) : []));
}

/** 엑셀 명세서를 바로 거래 목록으로 옮긴다. */
export function parseStatementWorkbook(
  data: ArrayBuffer | Uint8Array,
  options: ParseOptions & WorkbookOptions = {},
): ParseResult {
  const sheet = options.sheetName === undefined ? {} : { sheetName: options.sheetName };
  return parseStatement(readWorkbookRows(data, sheet), options);
}
