import type { StatementFormat } from '../types.js';

/**
 * 우리카드 이용대금명세서 상세 내역 (.xls).
 *
 * 실제 명세서 한 장(2026-09)으로 맞춘 포맷이다. 다른 카드사 포맷과 크게 다른 점:
 * - 헤더가 두 줄 병합 셀이고 셀 안에 줄바꿈이 있다(`이용\n일자`). 둘째 줄의 `원금`이
 *   해외 결제의 원화 금액을 담는다.
 * - 날짜가 `MM.DD`라 연도가 없다. 호출자가 `defaultYear`를 줘야 한다.
 * - `매출구분`이 행의 성격을 말한다. `취소`는 가맹점명 앞에 `취소-`를 붙인 음수 행이고,
 *   `차감`은 카드사가 준 캐시백·추가할인이다. 둘 다 음수라서 금액만 보면 구분되지 않는다.
 * - `국외일시불`의 이용금액은 현지통화다(USD 22 → 22). 원화는 `원금` 칸 앞쪽에 있다.
 * - `원금`은 카드사 혜택을 뺀 금액이다(이용금액 − 혜택금액). 할인은 엔진이 계산하므로
 *   국내 결제는 이용금액을 쓴다. 해외는 혜택이 원금에 반영되지 않은 행만 봤다.
 * - `국내할부`의 이용금액은 총액이고 `원금`은 이번 회차 금액이다. 실적은 총액으로 본다.
 */
export const woori: StatementFormat = {
  id: 'woori',
  label: '우리카드 이용대금명세서',
  headerRows: 2,
  signature: ['이용일자', '매출구분', '이용가맹점(은행)명'],
  columns: {
    date: ['이용일자'],
    merchant: ['이용가맹점(은행)명', '이용가맹점'],
    amount: ['이용금액(해외현지/체크카드)', '이용금액'],
    status: ['매출구분'],
    paymentType: ['할부개월'],
    billedAmount: ['원금'],
  },
  classifyRow: (cells, amount) => {
    const status = cells.status ?? '';
    if (status.includes('차감')) return 'issuerBenefit';
    if (status.includes('취소') || amount < 0) return 'reversal';
    return 'normal';
  },
  amountText: (cells) => {
    if (!(cells.status ?? '').includes('국외')) return cells.amount;
    // "33,170 \n USD22.00" — 앞쪽이 원화다. 실제 파일에는 줄바꿈 문자가 아니라 글자 그대로의
    // `\n`이 들어 있다. 이걸 못 떼면 USD 숫자까지 붙어 3,317,022원이 된다.
    return (cells.billedAmount ?? '').split(/\\n|\r?\n/)[0];
  },
};
