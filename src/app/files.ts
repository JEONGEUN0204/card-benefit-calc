/**
 * 브라우저 File → 문자열 행렬.
 *
 * 파일은 FileReader(`File.arrayBuffer`)로 이 탭 안에서만 읽는다. 업로드가 아니다.
 * 엑셀 라이브러리는 엑셀 파일을 처음 열 때 불러와서, CSV만 쓰는 사람은 받지 않는다.
 */
import { decodeStatementBytes, parseCsv } from '../import/index.js';

export interface LoadedStatement {
  /** 같은 파일을 두 번 넣었는지 가리는 키. */
  key: string;
  name: string;
  rows: string[][];
  /** 엑셀일 때만. 다른 시트를 다시 읽으려고 원본 바이트를 들고 있는다. */
  workbook: { bytes: Uint8Array; sheets: string[]; sheet: string } | null;
  /** 사용자가 고른 포맷. null이면 헤더를 보고 감지한다. */
  formatId: string | null;
}

const WORKBOOK = /\.(xlsx|xlsm|xls)$/i;

export async function loadStatementFile(file: File): Promise<LoadedStatement> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const key = `${file.name}:${file.size}:${file.lastModified}`;

  if (WORKBOOK.test(file.name)) {
    const { listSheets, readWorkbookRows } = await import('../import/workbook.js');
    const sheets = listSheets(bytes);
    const sheet = sheets[0] ?? '';
    return {
      key,
      name: file.name,
      rows: sheet === '' ? [] : readWorkbookRows(bytes, { sheetName: sheet }),
      workbook: { bytes, sheets, sheet },
      formatId: null,
    };
  }

  return {
    key,
    name: file.name,
    rows: parseCsv(decodeStatementBytes(bytes)),
    workbook: null,
    formatId: null,
  };
}

export function loadStatementText(name: string, text: string): LoadedStatement {
  return { key: `sample:${name}`, name, rows: parseCsv(text), workbook: null, formatId: null };
}

export async function switchSheet(
  statement: LoadedStatement,
  sheet: string,
): Promise<LoadedStatement> {
  if (statement.workbook === null) return statement;
  const { readWorkbookRows } = await import('../import/workbook.js');
  return {
    ...statement,
    rows: readWorkbookRows(statement.workbook.bytes, { sheetName: sheet }),
    workbook: { ...statement.workbook, sheet },
  };
}
