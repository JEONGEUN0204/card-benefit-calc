import type { StatementFormat } from '../types.js';

/**
 * 어느 카드사인지 모를 때 쓰는 포맷.
 *
 * 흔한 컬럼명을 넓게 후보로 잡는다. 카드사 전용 포맷이 먼저 잡히도록 `signature`를 비워
 * 감지 우선순위를 가장 낮게 둔다. 여기까지 와서 필수 컬럼을 못 찾으면 파싱을 포기한다 —
 * 엉뚱한 컬럼을 금액으로 읽느니 "못 읽었다"고 말하는 편이 낫다.
 */
export const generic: StatementFormat = {
  id: 'generic',
  label: '일반 명세서 (컬럼명 추정)',
  signature: [],
  columns: {
    date: ['거래일자', '이용일자', '승인일자', '매출일자', '거래일', '이용일', '날짜', '일자', 'date'],
    merchant: ['이용가맹점', '가맹점명', '가맹점', '상호', '가맹점상호', '내용', '적요', 'merchant'],
    amount: ['이용금액', '거래금액', '승인금액', '결제금액', '매출금액', '금액', 'amount'],
    status: ['승인상태', '거래상태', '취소여부', '상태', 'status'],
    paymentType: ['이용구분', '결제방법', '할부개월', '할부기간', '할부', 'payment'],
    issuerCategory: ['업종명', '업종', '가맹점업종', '카테고리', 'category'],
  },
};
