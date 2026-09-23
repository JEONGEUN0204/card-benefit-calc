/**
 * CSV 텍스트 → 문자열 행렬.
 *
 * 카드사 CSV는 금액에 천단위 콤마를 넣고 따옴표로 감싸 내려준다. 단순히 `split(',')`로
 * 자르면 컬럼이 통째로 밀려서, 날짜 자리에 금액이 들어가는 식으로 조용히 틀린다.
 */

export interface CsvOptions {
  /** 생략하면 탭과 콤마 중 많은 쪽을 쓴다. */
  delimiter?: string;
}

/** 탭으로 구분된 파일(엑셀에서 "텍스트로 저장")도 흔해서 개수로 판별한다. */
function detectDelimiter(text: string): string {
  const head = text.slice(0, 4096);
  const tabs = (head.match(/\t/g) ?? []).length;
  const commas = (head.match(/,/g) ?? []).length;
  return tabs > commas ? '\t' : ',';
}

export function parseCsv(text: string, options: CsvOptions = {}): string[][] {
  // BOM은 카드사가 엑셀에서 열리도록 붙인다. 첫 컬럼명에 붙어 헤더 매칭을 깨뜨린다.
  const source = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (source === '') return [];

  const delimiter = options.delimiter ?? detectDelimiter(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let inQuotes = false;

  const endCell = (): void => {
    row.push(quoted ? cell : cell.trim());
    cell = '';
    quoted = false;
  };

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];

    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      quoted = true;
    } else if (ch === delimiter) {
      endCell();
    } else if (ch === '\n') {
      endCell();
      rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }

  // 파일 끝의 줄바꿈이 빈 행을 만들면 안 된다. 중간의 빈 줄은 행 번호를 맞추기 위해 남긴다.
  if (cell !== '' || quoted || row.length > 0) {
    endCell();
    rows.push(row);
  }

  return rows;
}
