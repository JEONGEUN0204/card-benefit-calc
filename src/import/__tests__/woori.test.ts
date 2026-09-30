import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseCsv } from '../csv.js';
import { detectFormat } from '../formats/index.js';
import { parseStatement } from '../statement.js';
import { parseStatementWorkbook } from '../workbook.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * 실제 우리카드 명세서(.xls)의 구조를 본뜬 가상 샘플. 값은 전부 지어낸 것이다.
 * 두 줄 병합 헤더, 셀 안 줄바꿈, 연도 없는 날짜, `취소-`·`차감-` 접두, 해외 결제의
 * 원화가 `원금` 칸에 있는 구조를 그대로 옮겼다.
 */
const rows = parseCsv(readFileSync(join(ROOT, 'fixtures', 'statements', 'woori-sample.csv'), 'utf8'));

describe('우리카드 이용대금명세서', () => {
  const got = parseStatement(rows, { defaultYear: 2026 });

  it('두 줄 헤더를 보고 우리카드로 감지한다', () => {
    expect(detectFormat(rows)?.id).toBe('woori');
    expect(got.formatId).toBe('woori');
  });

  it('거래만 시간순으로 읽는다', () => {
    expect(got.transactions.map((t) => [t.date, t.merchant, t.amount])).toEqual([
      ['2026-07-18', '스타벅스 강남2호점', 5_500],
      // 27,730원 중 22,730원이 부분취소되어 5,000원이 남는다.
      ['2026-07-20', '(주)이마트 성수점', 5_000],
      // 이용금액 칸은 현지통화(USD 22)다. 원화는 원금 칸 첫 줄에 있다.
      ['2026-07-23', 'NETFLIX.COM', 33_170],
      // 할부는 원금(이번 회차 30만원)이 아니라 이용금액(총액)이다.
      ['2026-08-01', '삼성전자 스토어', 1_500_000],
      ['2026-08-05', 'GS25 역삼점', 7_200],
    ]);
  });

  it('할부개월로 결제유형을 읽는다', () => {
    expect(got.transactions.find((t) => t.merchant === '삼성전자 스토어')?.paymentType).toBe('installment');
    expect(got.transactions.find((t) => t.merchant === 'GS25 역삼점')?.paymentType).toBe('lump');
  });

  it('매출구분의 국외로 해외 결제를 표시한다. 국내 결제에는 표시가 없다', () => {
    expect(got.transactions.filter((t) => t.overseas === true).map((t) => t.merchant)).toEqual([
      'NETFLIX.COM',
    ]);
    expect(got.transactions.find((t) => t.merchant === 'GS25 역삼점')).not.toHaveProperty('overseas');
  });

  it('행마다 왜 거래로 읽지 않았는지 남긴다', () => {
    expect(got.issues.map((i) => [i.row, i.kind])).toEqual([
      [6, 'partiallyCancelled'],
      [8, 'cancelled'],
      // 차감은 환불이 아니라 카드사가 준 캐시백·추가할인이다. 원거래를 줄이면 실적이 틀린다.
      [10, 'issuerBenefit'],
      [13, 'issuerBenefit'],
      [14, 'skippedRow'],
      [15, 'skippedRow'],
    ]);
  });

  it('BIFF(.xls) 파일로 받아도 같은 결과를 낸다', () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'sheet 1');
    const xls = XLSX.write(book, { type: 'array', bookType: 'biff8' }) as Uint8Array;
    const fromXls = parseStatementWorkbook(xls, { defaultYear: 2026 });
    expect(fromXls.formatId).toBe('woori');
    expect(fromXls.transactions).toEqual(got.transactions);
  });
});
