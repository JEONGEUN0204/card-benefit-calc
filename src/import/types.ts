/**
 * 명세서 파싱 계층의 타입.
 *
 * 이 계층의 출력은 `src/core`의 `Transaction[]`이다. 파싱은 문자열 행렬을 입력으로 받는
 * 순수 함수라, 파일을 읽는 일(File API·fs)은 호출자가 맡는다. 결제내역이 네트워크를
 * 타지 않는 것은 이 경계 덕분이다.
 */
import type { Won } from '../core/types.js';

/** 명세서 원본 한 행. 셀은 전부 문자열로 정규화된 상태다. */
export type RawRow = readonly string[];

/**
 * 논리 필드.
 *
 * 카드사마다 컬럼 이름이 달라도(`이용가맹점` / `가맹점명` / `가맹점`) 여기로 모인다.
 * 포맷별 파서가 하는 일은 결국 "이 카드사의 컬럼명은 어느 논리 필드인가"를 적는 것이다.
 */
export type FieldName =
  | 'date'
  | 'merchant'
  | 'amount'
  | 'paymentType'
  | 'issuerCategory'
  | 'status'
  /** 청구되는 원화 금액. 해외 결제의 이용금액이 현지통화로 적히는 명세서에서 쓴다. */
  | 'billedAmount';

/** 이 세 필드를 못 잡으면 거래로 읽을 수 없다. */
export const REQUIRED_FIELDS: readonly FieldName[] = ['date', 'merchant', 'amount'];

/** 헤더에서 찾아낸 컬럼 위치. 값은 행 안의 인덱스. */
export type ColumnIndex = Readonly<Partial<Record<FieldName, number>>>;

/** 한 행에서 뽑아낸 논리 필드 값. 그 카드사에 없는 컬럼은 undefined. */
export type FieldCells = Readonly<{ [K in FieldName]?: string | undefined }>;

/**
 * 행의 성격.
 *
 * 취소를 어떻게 적느냐가 카드사마다 갈린다. 원래 행의 상태를 `취소`로 바꾸는 곳(`voided`)과,
 * 음수 금액의 취소 행을 따로 붙이는 곳(`reversal`)이 있다. 뒤쪽은 원거래까지 찾아 함께
 * 빼야 실적이 맞는다.
 */
export type RowKind =
  | 'normal'
  | 'voided'
  | 'reversal'
  /**
   * 카드사가 준 캐시백·추가할인이 음수 행으로 붙은 것. 환불이 아니라서 원거래를 줄이면
   * 실적이 틀린다. 결제도 아니므로 그냥 뺀다.
   */
  | 'issuerBenefit';

export interface StatementFormat {
  readonly id: string;
  readonly label: string;
  /**
   * 논리 필드 → 이 카드사가 쓰는 컬럼명 후보. 앞에 있을수록 우선한다.
   * 완전일치를 먼저 시도하고, 남은 필드만 부분일치로 채운다.
   */
  readonly columns: Readonly<Partial<Record<FieldName, readonly string[]>>>;
  /**
   * 이 컬럼명이 헤더에 전부(완전일치) 있으면 이 포맷으로 본다.
   * 길수록 구체적이라 감지에서 우선한다. generic은 비어 있다.
   */
  readonly signature: readonly string[];
  /** 행의 성격 판정. 생략하면 "금액이 음수면 취소 행"으로 본다. */
  readonly classifyRow?: (cells: FieldCells, amount: Won) => RowKind;
  /**
   * 헤더가 몇 줄인지. 2면 헤더 행과 바로 아랫줄을 컬럼별로 이어 붙여 하나의 헤더로 본다.
   * 병합 셀로 `당월결제하실금액` 아래에 `원금`·`혜택금액`을 늘어놓는 명세서가 있다.
   */
  readonly headerRows?: 1 | 2;
  /** 금액으로 읽을 셀. 생략하면 `amount`. 해외 결제만 다른 칸을 봐야 할 때 쓴다. */
  readonly amountText?: (cells: FieldCells) => string | undefined;
}

export type IssueKind =
  /** 지정한 포맷 id를 찾지 못함 */
  | 'unknownFormat'
  /** 헤더 행을 찾지 못해 아무것도 읽지 못함 */
  | 'noHeader'
  /** 날짜를 읽을 수 없음 */
  | 'badDate'
  /** 금액을 읽을 수 없음 */
  | 'badAmount'
  /** 0원 결제라 계산에 의미가 없음 */
  | 'zeroAmount'
  /** 합계·소계처럼 거래가 아닌 행 */
  | 'skippedRow'
  /** 취소된 거래라 계산에서 뺌 */
  | 'cancelled'
  /** 취소 행인데 짝이 되는 원거래를 못 찾음 */
  | 'unmatchedCancellation'
  /** 일부만 취소돼 원거래 금액을 줄임 */
  | 'partiallyCancelled'
  /** 카드사 캐시백·추가할인 행이라 결제로 보지 않음 */
  | 'issuerBenefit';

export interface ParseIssue {
  /** 원본 파일의 행 번호(1-based, 헤더·안내문 포함). 사용자가 파일에서 바로 찾게 한다. */
  row: number;
  kind: IssueKind;
  message: string;
}

/** 카테고리를 못 정한 가맹점. 사용자가 규칙을 추가할 후보 목록이다. */
export interface UncategorizedMerchant {
  merchant: string;
  count: number;
  amount: Won;
}
