import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../core/types.js';
import { mergeParseResults } from '../merge.js';
import type { ParseResult } from '../statement.js';

function tx(id: string, date: string, merchant: string, amount: number, category = 'mart'): Transaction {
  return { id, date, merchant, amount, category, paymentType: 'lump' };
}

function result(transactions: Transaction[]): ParseResult {
  return { formatId: 'generic', transactions, issues: [], uncategorized: [], rowCount: transactions.length };
}

describe('mergeParseResults — 여러 명세서 합치기', () => {
  it('파일을 건너 날짜순으로 합친다', () => {
    const got = mergeParseResults([
      result([tx('b1', '2026-02-03', '이마트', 10_000), tx('b2', '2026-02-10', '이마트', 20_000)]),
      result([tx('a1', '2026-01-05', '이마트', 30_000)]),
    ]);
    expect(got.transactions.map((t) => t.id)).toEqual(['a1', 'b1', 'b2']);
  });

  it('같은 날 거래는 파일 순서와 파일 안 순서를 지킨다', () => {
    // 할인 배정이 FIFO라 같은 날 안의 순서가 곧 결과다.
    const got = mergeParseResults([
      result([tx('a1', '2026-01-05', '스타벅스', 5_000), tx('a2', '2026-01-05', '투썸', 6_000)]),
      result([tx('b1', '2026-01-05', 'GS25', 7_000)]),
    ]);
    expect(got.transactions.map((t) => t.id)).toEqual(['a1', 'a2', 'b1']);
  });

  it('다른 파일에 똑같이 있는 거래는 한 번만 센다', () => {
    // 같은 명세서를 두 번 올리거나 조회 기간이 겹치면 실적이 조용히 두 배가 된다.
    const got = mergeParseResults([
      result([tx('a1', '2026-01-05', '이마트', 10_000), tx('a2', '2026-01-31', 'CU', 3_000)]),
      result([tx('b1', '2026-01-31', 'CU', 3_000), tx('b2', '2026-02-01', 'CU', 3_000)]),
    ]);
    expect(got.transactions.map((t) => t.id)).toEqual(['a1', 'a2', 'b2']);
    expect(got.duplicates.map((t) => t.id)).toEqual(['b1']);
  });

  it('겹친 거래는 앞 파일에 있던 건수만큼만 뺀다', () => {
    // 앞 파일에 2건, 뒤 파일에 3건이면 뒤 파일의 1건은 진짜 새 거래다.
    const got = mergeParseResults([
      result([tx('a1', '2026-01-05', 'CU', 3_000), tx('a2', '2026-01-05', 'CU', 3_000)]),
      result([
        tx('b1', '2026-01-05', 'CU', 3_000),
        tx('b2', '2026-01-05', 'CU', 3_000),
        tx('b3', '2026-01-05', 'CU', 3_000),
      ]),
    ]);
    expect(got.transactions.map((t) => t.id)).toEqual(['a1', 'a2', 'b3']);
    expect(got.duplicates.map((t) => t.id)).toEqual(['b1', 'b2']);
  });

  it('한 파일 안의 똑같은 거래는 중복이 아니다', () => {
    // 같은 날 편의점에서 같은 금액을 두 번 결제하는 일은 흔하다.
    const got = mergeParseResults([
      result([tx('a1', '2026-01-05', 'CU', 3_000), tx('a2', '2026-01-05', 'CU', 3_000)]),
    ]);
    expect(got.transactions).toHaveLength(2);
    expect(got.duplicates).toEqual([]);
  });

  it('가맹점명은 표기 차이를 무시하고 비교한다', () => {
    const got = mergeParseResults([
      result([tx('a1', '2026-01-05', '(주)이마트 성수점', 10_000)]),
      result([tx('b1', '2026-01-05', '이마트성수점', 10_000)]),
    ]);
    expect(got.duplicates.map((t) => t.id)).toEqual(['b1']);
  });

  it('미분류 가맹점을 파일을 건너 다시 모은다', () => {
    const got = mergeParseResults([
      result([
        tx('a1', '2026-01-05', '동네빵집', 8_000, 'uncategorized'),
        tx('a2', '2026-01-06', '꽃집', 30_000, 'uncategorized'),
      ]),
      result([
        tx('b1', '2026-02-05', '동네빵집', 9_000, 'uncategorized'),
        // 앞 파일과 겹친 거래는 미분류 합계에도 넣지 않는다.
        tx('b2', '2026-01-06', '꽃집', 30_000, 'uncategorized'),
      ]),
    ]);
    expect(got.uncategorized).toEqual([
      { merchant: '꽃집', count: 1, amount: 30_000 },
      { merchant: '동네빵집', count: 2, amount: 17_000 },
    ]);
  });
});
