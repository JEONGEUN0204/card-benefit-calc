/**
 * 명세서 가져오기 공개 API.
 *
 * 파싱은 문자열 행렬을 받는 순수 함수다. 파일을 읽는 일(브라우저 File API, Node fs)은
 * 호출자가 맡는다. 덕분에 결제내역은 이 경계를 넘지 않고, 계산 엔진(`src/core`)은
 * 명세서 형식을 전혀 모른 채로 남는다.
 *
 * 엑셀은 여기서 내보내지 않는다. `./workbook.js`를 직접 import 해야 SheetJS가 딸려오고,
 * CSV만 쓰는 화면은 엑셀 라이브러리를 번들에 넣지 않아도 된다.
 */
export type {
  ColumnIndex,
  FieldCells,
  FieldName,
  IssueKind,
  ParseIssue,
  RawRow,
  RowKind,
  StatementFormat,
  UncategorizedMerchant,
} from './types.js';

export { parseCsv } from './csv.js';
export type { CsvOptions } from './csv.js';

export { normalizeMerchant, parseDate, parsePaymentType, parseWon } from './normalize.js';

export { FORMATS, detectFormat, findFormat, generic, kb, samsung, shinhan, woori } from './formats/index.js';
export { locateHeader } from './columns.js';
export type { HeaderMatch } from './columns.js';

export { parseStatement, parseStatementCsv, summarizeUncategorized } from './statement.js';
export type { ParseOptions, ParseResult } from './statement.js';

export {
  UNCATEGORIZED,
  addUserRule,
  categorize,
  defaultRuleset,
  parseUserRules,
  removeUserRule,
  serializeUserRules,
  withUserRules,
} from './category/rules.js';
export type { NewCategoryRule } from './category/rules.js';
export { BUILTIN_CATEGORY_RULES } from './category/defaults.js';
export { CATEGORIES, isKnownCategory } from './category/vocabulary.js';
export type { Category } from './category/vocabulary.js';
export type {
  Categorizable,
  CategoryMatch,
  CategoryRule,
  CategoryRuleset,
  MatchField,
  MatchKind,
} from './category/types.js';

export { decodeStatementBytes } from './decode.js';
export { mergeParseResults } from './merge.js';
export type { MergedStatements } from './merge.js';
