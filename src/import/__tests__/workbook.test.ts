import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseStatementWorkbook, readWorkbookRows } from '../workbook.js';

/** 테스트용 엑셀 파일을 메모리에서 만든다. */
function xlsxOf(rows: unknown[][]): Uint8Array {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), '명세서');
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as Uint8Array;
}

describe('readWorkbookRows', () => {
  it('엑셀 시트를 문자열 행렬로 읽는다', () => {
    const rows = readWorkbookRows(
      xlsxOf([
        ['이용일자', '이용가맹점', '이용금액'],
        ['2026-01-05', '스타벅스', 5500],
      ]),
    );
    expect(rows[0]).toEqual(['이용일자', '이용가맹점', '이용금액']);
    expect(rows[1]).toEqual(['2026-01-05', '스타벅스', '5500']);
  });

  it('빈 셀은 빈 문자열로 채워 컬럼이 밀리지 않게 한다', () => {
    const rows = readWorkbookRows(xlsxOf([['a', '', 'c'], ['1', '', '3']]));
    expect(rows[1]).toEqual(['1', '', '3']);
  });
});

describe('parseStatementWorkbook', () => {
  it('엑셀 명세서도 CSV와 같은 결과를 낸다', () => {
    const got = parseStatementWorkbook(
      xlsxOf([
        ['이용일자', '이용가맹점', '업종', '이용금액', '이용구분'],
        ['2026.01.05', '스타벅스 강남2호점', '커피전문점', 5500, '일시불'],
      ]),
    );
    expect(got.formatId).toBe('shinhan');
    expect(got.transactions[0]).toMatchObject({ date: '2026-01-05', amount: 5500, category: 'cafe' });
  });
});
