import type { StatementFormat } from '../types.js';

/**
 * 삼성카드 이용내역.
 *
 * 금액에 "원"이 붙고 연도를 두 자리로 적는다("26.01.05"). 취소는 음수 금액의 별도 행이라
 * 원거래를 찾아 함께 빼야 실적이 맞는다.
 */
export const samsung: StatementFormat = {
  id: 'samsung',
  label: '삼성카드 이용내역',
  signature: ['이용일', '가맹점', '승인금액'],
  columns: {
    date: ['이용일', '이용일자'],
    merchant: ['가맹점', '가맹점명'],
    amount: ['승인금액', '이용금액', '금액'],
    paymentType: ['결제방법', '할부'],
    issuerCategory: ['업종명', '업종'],
  },
};
