import { describe, expect, it } from 'vitest';
import { detectFormat, findFormat } from '../formats/index.js';
import { parseCsv } from '../csv.js';
import { parseStatement, parseStatementCsv } from '../statement.js';
import { addUserRule, defaultRuleset } from '../category/rules.js';

/** 신한 — 이용구분 컬럼으로 결제유형을 적고, 취소는 이용금액을 음수로 찍는다. */
const SHINHAN = `신한카드 이용대금명세서
조회기간 2026-01-01 ~ 2026-01-31

이용일자,이용가맹점,업종,이용금액,이용구분
2026.01.05,스타벅스 강남2호점,커피전문점,"5,500",일시불
2026.01.07,GS25 역삼점,편의점,"7,200",일시불
2026.01.20,이마트 성수점,대형할인점,"84,000",할부(3개월)
`;

/** KB — 승인상태 컬럼으로 취소를 표시한다. */
const KB = `거래일자,가맹점명,업종,거래금액,할부,승인상태
2026-01-05,스타벅스 강남2호점,커피전문점,"5,500",일시불,정상
2026-01-06,배달의민족,배달대행,"18,000",일시불,취소
2026-01-09,이마트 성수점,대형할인점,"84,000",무이자3개월,정상
`;

/** 삼성 — 금액에 '원'이 붙고, 두 자리 연도를 쓰며, 취소는 음수 행이다. */
const SAMSUNG = `이용일,가맹점,업종명,승인금액,결제방법
26.01.05,스타벅스 강남2호점,커피전문점,"5,500원",일시불
26.01.06,배달의민족,배달대행,"18,000원",일시불
26.01.08,배달의민족,배달대행,"-18,000원",일시불
`;

describe('포맷 감지', () => {
  it('카드사별 헤더로 포맷을 알아낸다', () => {
    expect(detectFormat(parseCsv(SHINHAN))?.id).toBe('shinhan');
    expect(detectFormat(parseCsv(KB))?.id).toBe('kb');
    expect(detectFormat(parseCsv(SAMSUNG))?.id).toBe('samsung');
  });

  it('아는 카드사가 아니면 generic으로 떨어진다', () => {
    const rows = parseCsv('날짜,가맹점,금액\n2026-01-05,스타벅스,5500');
    expect(detectFormat(rows)?.id).toBe('generic');
  });

  it('필수 컬럼이 아예 없으면 감지에 실패한다', () => {
    expect(detectFormat(parseCsv('안내문입니다\n문의 1588-0000'))).toBeNull();
  });

  it('포맷을 id로 직접 고를 수 있다', () => {
    expect(findFormat('shinhan')?.label).toContain('신한');
    expect(findFormat('없는카드사')).toBeNull();
  });
});

describe('parseStatementCsv — 신한', () => {
  const got = parseStatementCsv(SHINHAN);

  it('헤더 앞 안내문 행을 건너뛰고 거래만 읽는다', () => {
    expect(got.formatId).toBe('shinhan');
    expect(got.transactions).toHaveLength(3);
  });

  it('날짜·금액·가맹점을 Transaction 형태로 정규화한다', () => {
    expect(got.transactions[0]).toMatchObject({
      date: '2026-01-05',
      merchant: '스타벅스 강남2호점',
      amount: 5500,
      category: 'cafe',
      paymentType: 'lump',
    });
  });

  it('할부 표기를 결제유형으로 옮긴다', () => {
    expect(got.transactions[2]?.paymentType).toBe('installment');
  });

  it('거래마다 원본 행 번호를 담은 id를 붙인다', () => {
    // 결과에서 이상한 건을 발견하면 명세서 파일의 몇 번째 줄인지 바로 찾을 수 있어야 한다.
    expect(got.transactions[0]?.id).toBe('r5');
  });
});

describe('parseStatementCsv — KB', () => {
  const got = parseStatementCsv(KB);

  it('승인상태가 취소인 행은 거래에서 뺀다', () => {
    expect(got.transactions.map((t) => t.merchant)).toEqual([
      '스타벅스 강남2호점',
      '이마트 성수점',
    ]);
    expect(got.issues.some((i) => i.kind === 'cancelled')).toBe(true);
  });

  it('무이자할부를 일반 할부와 구분한다', () => {
    expect(got.transactions[1]?.paymentType).toBe('interestFreeInstallment');
  });
});

describe('parseStatementCsv — 삼성', () => {
  const got = parseStatementCsv(SAMSUNG);

  it('금액의 원 표기와 두 자리 연도를 읽는다', () => {
    expect(got.transactions[0]).toMatchObject({ date: '2026-01-05', amount: 5500 });
  });

  it('음수 취소 행은 원거래와 함께 사라진다', () => {
    // 취소 행만 빼고 원거래를 남기면 실적이 실제보다 높게 잡혀 구간이 틀린다.
    expect(got.transactions.map((t) => t.merchant)).toEqual(['스타벅스 강남2호점']);
    expect(got.issues.filter((i) => i.kind === 'cancelled')).toHaveLength(1);
  });

  it('짝이 없는 취소 행은 문제로 남긴다', () => {
    const orphan = parseStatementCsv(`이용일,가맹점,업종명,승인금액,결제방법
26.01.08,배달의민족,배달대행,"-18,000원",일시불
`);
    expect(orphan.transactions).toHaveLength(0);
    expect(orphan.issues.some((i) => i.kind === 'unmatchedCancellation')).toBe(true);
  });
});

describe('거래 순서', () => {
  it('날짜 오름차순으로 내보낸다', () => {
    // 할인 배정이 FIFO라서 순서가 곧 결과다. 명세서는 최신순으로 내려오는 경우가 많다.
    const desc = parseStatementCsv(`거래일자,가맹점명,거래금액,할부,승인상태
2026-01-20,이마트,"84,000",일시불,정상
2026-01-07,GS25,"7,200",일시불,정상
2026-01-05,스타벅스,"5,500",일시불,정상
`);
    expect(desc.transactions.map((t) => t.date)).toEqual(['2026-01-05', '2026-01-07', '2026-01-20']);
  });

  it('최신순 파일이면 같은 날 안의 순서도 원래대로 되돌린다', () => {
    // 하루 1회 같은 횟수 제한은 같은 날 어느 건이 먼저냐에 따라 결과가 달라진다.
    const desc = parseStatementCsv(`거래일자,가맹점명,거래금액,할부,승인상태
2026-01-07,나중건,"7,200",일시불,정상
2026-01-07,먼저건,"5,500",일시불,정상
2026-01-05,이전날,"1,000",일시불,정상
`);
    expect(desc.transactions.map((t) => t.merchant)).toEqual(['이전날', '먼저건', '나중건']);
  });
});

describe('읽지 못한 행', () => {
  const got = parseStatementCsv(`이용일자,이용가맹점,업종,이용금액,이용구분
2026.01.05,스타벅스,커피전문점,"5,500",일시불
합계,,,"5,500",
2026.13.99,깨진날짜,커피전문점,"1,000",일시불
2026.01.06,금액없음,커피전문점,해당없음,일시불
2026.01.07,영원결제,커피전문점,0,일시불
`);

  it('거래로 읽을 수 없는 행은 버리고 이유를 남긴다', () => {
    expect(got.transactions).toHaveLength(1);
    expect(got.issues.map((i) => i.kind).sort()).toEqual(
      ['badAmount', 'badDate', 'skippedRow', 'zeroAmount'].sort(),
    );
  });

  it('문제 행마다 원본 행 번호를 알려준다', () => {
    const badDate = got.issues.find((i) => i.kind === 'badDate');
    expect(badDate?.row).toBe(4);
  });
});

describe('카테고리 매핑', () => {
  it('미분류 가맹점을 건수·금액과 함께 모아준다', () => {
    const got = parseStatementCsv(`거래일자,가맹점명,거래금액,할부,승인상태
2026-01-05,이름없는가게,"5,000",일시불,정상
2026-01-06,이름없는가게,"3,000",일시불,정상
`);
    expect(got.uncategorized).toEqual([{ merchant: '이름없는가게', count: 2, amount: 8000 }]);
  });

  it('사용자 규칙을 넘기면 그 분류를 따른다', () => {
    const ruleset = addUserRule(defaultRuleset(), { pattern: '이름없는가게', category: 'mart' });
    const got = parseStatementCsv(
      `거래일자,가맹점명,거래금액,할부,승인상태\n2026-01-05,이름없는가게,"5,000",일시불,정상\n`,
      { ruleset },
    );
    expect(got.transactions[0]?.category).toBe('mart');
    expect(got.uncategorized).toEqual([]);
  });
});

describe('parseStatement 옵션', () => {
  it('연도가 없는 명세서는 defaultYear로 채운다', () => {
    const got = parseStatement(parseCsv('날짜,가맹점,금액\n01/05,스타벅스,5500'), {
      defaultYear: 2026,
    });
    expect(got.transactions[0]?.date).toBe('2026-01-05');
  });

  it('idPrefix로 여러 파일의 거래 id 충돌을 막는다', () => {
    const got = parseStatementCsv('날짜,가맹점,금액\n2026-01-05,스타벅스,5500', {
      idPrefix: 'jan-',
    });
    expect(got.transactions[0]?.id).toBe('jan-r2');
  });

  it('포맷을 강제로 지정할 수 있다', () => {
    const got = parseStatementCsv(SHINHAN, { formatId: 'generic' });
    expect(got.formatId).toBe('generic');
    expect(got.transactions).toHaveLength(3);
  });

  it('헤더를 못 찾으면 빈 결과와 이유를 돌려준다', () => {
    const got = parseStatementCsv('안내문입니다\n문의 1588-0000');
    expect(got.transactions).toEqual([]);
    expect(got.issues[0]?.kind).toBe('noHeader');
  });
});

describe('취소 짝짓기 — 실제 명세서에서 나온 경우', () => {
  it('가맹점명 앞의 "취소-" 접두를 떼고 원거래를 찾는다', () => {
    const got = parseStatementCsv(`이용일자,이용가맹점,이용금액
2026.01.05,(주)이마트 성수점,"30,000"
2026.01.06,취소-(주)이마트 성수점,"-30,000"
`);
    expect(got.transactions).toHaveLength(0);
    expect(got.issues.map((i) => i.kind)).toEqual(['cancelled']);
  });

  it('부분취소는 원거래 금액을 그만큼 줄인다', () => {
    // 3만원 중 1만원 취소. 원거래를 통째로 두면 실적이 1만원 부풀고, 통째로 빼면 2만원 모자란다.
    const got = parseStatementCsv(`이용일자,이용가맹점,이용금액
2026.01.05,이마트,"30,000"
2026.01.06,이마트,"-10,000"
`);
    expect(got.transactions.map((t) => t.amount)).toEqual([20_000]);
    expect(got.issues.map((i) => [i.row, i.kind])).toEqual([[3, 'partiallyCancelled']]);
  });

  it('부분취소는 취소일보다 늦은 거래를 건드리지 않는다', () => {
    const got = parseStatementCsv(`이용일자,이용가맹점,이용금액
2026.01.05,이마트,"30,000"
2026.01.06,이마트,"-10,000"
2026.01.09,이마트,"25,000"
`);
    expect(got.transactions.map((t) => t.amount)).toEqual([20_000, 25_000]);
  });

  it('전액취소 짝이 있으면 부분취소보다 먼저 쓴다', () => {
    const got = parseStatementCsv(`이용일자,이용가맹점,이용금액
2026.01.05,이마트,"30,000"
2026.01.06,이마트,"10,000"
2026.01.07,이마트,"-10,000"
`);
    expect(got.transactions.map((t) => t.amount)).toEqual([30_000]);
  });

  it('어느 원거래보다 큰 취소는 여전히 짝 없는 취소다', () => {
    const got = parseStatementCsv(`이용일자,이용가맹점,이용금액
2026.01.05,이마트,"30,000"
2026.01.06,이마트,"-50,000"
`);
    expect(got.transactions.map((t) => t.amount)).toEqual([30_000]);
    expect(got.issues.map((i) => i.kind)).toEqual(['unmatchedCancellation']);
  });
});

describe('요약 행', () => {
  it('날짜가 비고 가맹점 칸에 소계·합계가 섞인 행은 거래 아님으로 본다', () => {
    // "날짜 읽기 실패"로 보이면 사용자는 거래를 잃은 줄 안다.
    const got = parseStatementCsv(`이용일자,이용가맹점,이용금액
2026.01.05,이마트,"30,000"
,소계(홍길동),"30,000"
,청구합계-가상은행 000***000,"30,000"
`);
    expect(got.transactions).toHaveLength(1);
    expect(got.issues.map((i) => i.kind)).toEqual(['skippedRow', 'skippedRow']);
  });

  it('날짜가 있으면 이름에 합계가 들어가도 거래다', () => {
    const got = parseStatementCsv(`이용일자,이용가맹점,이용금액
2026.01.05,합계마트,"30,000"
`);
    expect(got.transactions).toHaveLength(1);
  });
});

describe('연도 없는 날짜', () => {
  it('12월과 1월이 섞이면 하반기 거래를 전년도로 돌린다', () => {
    // 청구주기 명세서는 12.18~01.17처럼 해를 넘긴다. defaultYear는 1월 쪽 연도다.
    const got = parseStatementCsv(
      `날짜,가맹점,금액
12.28,이마트,"1,000"
01.03,이마트,"2,000"
`,
      { defaultYear: 2027 },
    );
    expect(got.transactions.map((t) => t.date)).toEqual(['2026-12-28', '2027-01-03']);
  });

  it('해를 넘기지 않는 명세서는 그대로 둔다', () => {
    const got = parseStatementCsv(
      `날짜,가맹점,금액
07.18,이마트,"1,000"
08.17,이마트,"2,000"
`,
      { defaultYear: 2026 },
    );
    expect(got.transactions.map((t) => t.date)).toEqual(['2026-07-18', '2026-08-17']);
  });
});
