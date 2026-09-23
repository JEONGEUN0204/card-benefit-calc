import type { StatementFormat } from '../types.js';

/**
 * 신한카드 이용대금명세서.
 *
 * 결제유형을 `이용구분`에 문장으로 적고("일시불", "할부(3개월)"), 취소는 같은 가맹점·같은
 * 금액의 음수 행으로 따로 붙인다. 취소 판정은 기본 동작(금액 음수)으로 충분하다.
 */
export const shinhan: StatementFormat = {
  id: 'shinhan',
  label: '신한카드 이용대금명세서',
  signature: ['이용일자', '이용가맹점', '이용금액'],
  columns: {
    date: ['이용일자', '이용일'],
    merchant: ['이용가맹점', '가맹점명'],
    amount: ['이용금액', '금액'],
    paymentType: ['이용구분', '할부개월', '할부'],
    issuerCategory: ['업종', '업종명'],
  },
};
