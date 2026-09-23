import type { StatementFormat } from '../types.js';

/**
 * KB국민카드 이용내역.
 *
 * 취소를 별도 행으로 붙이지 않고 원래 행의 `승인상태`를 "취소"로 바꿔 내려준다. 상쇄할
 * 원거래를 찾을 필요 없이 그 행만 빼면 된다 — 여기가 신한·삼성과 갈리는 지점이다.
 */
export const kb: StatementFormat = {
  id: 'kb',
  label: 'KB국민카드 이용내역',
  signature: ['거래일자', '가맹점명', '거래금액'],
  columns: {
    date: ['거래일자', '이용일자'],
    merchant: ['가맹점명', '가맹점'],
    amount: ['거래금액', '이용금액', '금액'],
    status: ['승인상태', '거래상태', '상태'],
    paymentType: ['할부', '할부개월', '결제방법'],
    issuerCategory: ['업종', '업종명'],
  },
  classifyRow: (cells, amount) => {
    if ((cells.status ?? '').includes('취소')) return 'voided';
    return amount < 0 ? 'reversal' : 'normal';
  },
};
