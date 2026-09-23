/**
 * 기본 가맹점 → 카테고리 매핑.
 *
 * 앞에 있는 규칙이 이긴다. 구체적인 브랜드명을 먼저 적고, 뭉뚱그린 낱말("카페", "마트")과
 * 카드사 업종명을 뒤에 둔다. `이마트24`가 `이마트`보다 앞에 있어야 편의점이 대형마트로
 * 분류되지 않는 식이라, 순서 자체가 규칙의 일부다.
 *
 * 여기 없는 가맹점은 `uncategorized`로 남고, 사용자가 자기 규칙으로 채운다.
 */
import type { CategoryRule } from './types.js';

/** 가맹점명 부분일치 규칙을 간단히 적기 위한 헬퍼. */
function m(category: string, patterns: readonly string[]): CategoryRule[] {
  return patterns.map((pattern) => ({ id: `builtin:${category}:${pattern}`, pattern, category }));
}

/** 카드사가 준 업종명으로 맞추는 규칙. */
function issuer(category: string, patterns: readonly string[]): CategoryRule[] {
  return patterns.map((pattern) => ({
    id: `builtin:issuer:${category}:${pattern}`,
    pattern,
    category,
    field: 'issuerCategory' as const,
  }));
}

export const BUILTIN_CATEGORY_RULES: readonly CategoryRule[] = [
  // 편의점은 '이마트24'처럼 대형마트 브랜드를 달고 있어 마트보다 먼저 와야 한다.
  ...m('convenience', ['GS25', 'CU편의점', '세븐일레븐', '7-ELEVEN', '이마트24', '미니스톱', '씨유']),

  ...m('cafe', [
    '스타벅스', 'STARBUCKS', '투썸', '이디야', '메가커피', 'MEGA커피', '빽다방',
    '컴포즈커피', '폴바셋', '할리스', '탐앤탐스', '파스쿠찌', '커피빈', '블루보틀',
  ]),

  ...m('delivery', ['배달의민족', '배민', '요기요', '쿠팡이츠', '땡겨요']),

  ...m('mart', ['이마트', '홈플러스', '롯데마트', '코스트코', '하나로마트', '노브랜드', '메가마트']),

  ...m('online', ['쿠팡', '11번가', 'G마켓', '지마켓', '옥션', 'SSG닷컴', '네이버페이', '카카오페이', '알리익스프레스']),

  ...m('transport', ['티머니', '지하철', '코레일', 'KTX', 'SRT', '카카오T', '택시', '한국도로공사', '고속도로', '버스']),

  ...m('gas', ['SK에너지', 'GS칼텍스', 'S-OIL', '에쓰오일', '현대오일뱅크', '주유소']),

  ...m('telecom', ['SK텔레콤', 'SKT', 'KT', 'LG유플러스', 'LGU+', '알뜰폰']),

  ...m('movie', ['CGV', '메가박스', '롯데시네마']),

  ...m('travel', ['대한항공', '아시아나', '제주항공', '야놀자', '여기어때', '호텔', '인터파크투어']),

  ...m('pet', ['동물병원', '펫샵']),

  ...m('hospital', ['병원', '의원', '약국', '한의원', '치과']),

  ...m('beauty', ['올리브영', '미용실', '헤어']),

  ...m('education', ['학원', '교보문고', '알라딘', '예스24']),

  ...m('utility', ['한국전력', '도시가스', '수도사업소', '상수도']),

  ...m('tax', ['국세청', '지방세', '세무서', '위택스']),

  ...m('giftCard', ['상품권', '문화상품권', '해피머니']),

  ...m('insurance', ['화재해상', '생명보험', '손해보험']),

  // 브랜드로 못 잡은 뒤에 쓰는 뭉뚱그린 낱말.
  ...m('cafe', ['카페', '커피']),
  ...m('mart', ['마트']),
  ...m('restaurant', ['식당', '음식점', '분식', '국밥', '김밥']),

  // 마지막 단서: 카드사가 적어준 업종명.
  ...issuer('cafe', ['커피전문점', '커피숍']),
  ...issuer('convenience', ['편의점']),
  ...issuer('mart', ['대형할인점', '슈퍼마켓', '대형마트']),
  ...issuer('delivery', ['배달대행', '음식배달']),
  ...issuer('transport', ['대중교통', '택시', '철도']),
  ...issuer('gas', ['주유소', '충전소']),
  ...issuer('online', ['인터넷쇼핑', '전자상거래', '온라인쇼핑']),
  ...issuer('restaurant', ['일반음식점', '한식', '중식', '양식', '일식']),
  ...issuer('hospital', ['의료기관', '약국']),
  ...issuer('movie', ['영화관']),
  ...issuer('telecom', ['통신요금', '이동통신']),
  ...issuer('utility', ['공과금', '전기요금']),
  ...issuer('tax', ['국세', '지방세']),
];
