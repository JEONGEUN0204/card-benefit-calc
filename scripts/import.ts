/**
 * 카드사 명세서를 읽어 거래 목록으로 옮기는 CLI.
 *
 * 파일을 읽는 일은 여기서만 한다. `src/import`의 파서는 문자열 행렬만 받는 순수 함수라
 * 브라우저에서도 같은 결과를 낸다.
 *
 *   npm run import -- fixtures/statements/shinhan-3months.csv
 *   npm run import -- fixtures/statements/kb-sample.csv --rules my-rules.json
 *   npm run import -- 명세서.xlsx --year 2026 --format samsung
 *   npm run import -- fixtures/statements/shinhan-3months.csv --card simple-cafe --out /tmp/case.json
 *     → npm run sim -- /tmp/case.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defaultRuleset, parseUserRules, withUserRules } from '../src/import/category/rules.js';
import { parseStatementCsv } from '../src/import/statement.js';
import { listSheets, parseStatementWorkbook } from '../src/import/workbook.js';
import type { ParseOptions, ParseResult } from '../src/import/statement.js';
import type { IssueKind } from '../src/import/types.js';
import type { Won } from '../src/core/types.js';

const ISSUE_LABEL: Record<IssueKind, string> = {
  unknownFormat: '모르는 포맷',
  noHeader: '헤더 없음',
  badDate: '날짜 읽기 실패',
  badAmount: '금액 읽기 실패',
  zeroAmount: '0원 결제',
  skippedRow: '거래 아님',
  cancelled: '취소됨',
  unmatchedCancellation: '짝 없는 취소',
};

const won = (n: Won): string => `${n.toLocaleString('ko-KR')}원`;

/** 한글은 폭이 2라서 글자 수로만 맞추면 표가 어긋난다. */
const pad = (s: string, width: number): string =>
  s +
  ' '.repeat(
    Math.max(0, width - [...s].reduce((w, c) => w + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0)),
  );

function flagValue(args: readonly string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  return at < 0 ? undefined : args[at + 1];
}

function loadRuleset(path: string | undefined) {
  const base = defaultRuleset();
  if (path === undefined) return base;
  return withUserRules(base, parseUserRules(readFileSync(resolve(path), 'utf8')));
}

function parseFile(path: string, options: ParseOptions, sheetName?: string): ParseResult {
  const full = resolve(path);
  if (/\.(xlsx|xlsm|xls)$/i.test(path)) {
    const data = new Uint8Array(readFileSync(full));
    const sheets = listSheets(data);
    if (sheets.length > 1 && sheetName === undefined) {
      console.log(`시트가 여러 개다: ${sheets.join(', ')} — 첫 시트를 읽는다 (--sheet 로 지정).`);
    }
    return parseStatementWorkbook(data, sheetName === undefined ? options : { ...options, sheetName });
  }
  return parseStatementCsv(readFileSync(full, 'utf8'), options);
}

function printResult(result: ParseResult): void {
  console.log(`\n포맷: ${result.formatId} / 읽은 행 ${result.rowCount}개 → 거래 ${result.transactions.length}건\n`);

  for (const tx of result.transactions) {
    console.log(
      `  ${pad(tx.id, 8)} ${tx.date}  ${pad(tx.merchant, 22)} ${pad(won(tx.amount), 12)}` +
        ` ${pad(tx.category, 14)} ${tx.paymentType ?? 'lump'}`,
    );
  }

  const total = result.transactions.reduce((a, t) => a + t.amount, 0);
  console.log(`\n  합계 ${won(total)}`);

  if (result.issues.length > 0) {
    console.log('\n거래로 읽지 않은 행:');
    for (const issue of result.issues) {
      const where = issue.row === 0 ? '파일' : `${issue.row}행`;
      console.log(`  ${pad(where, 8)} ${pad(ISSUE_LABEL[issue.kind], 16)} ${issue.message}`);
    }
  }

  if (result.uncategorized.length > 0) {
    // 여기 있는 가맹점이 많을수록 시뮬레이션 결과가 실제와 멀어진다. 규칙을 채우라는 뜻이다.
    console.log('\n카테고리를 정하지 못한 가맹점 (금액 큰 순):');
    for (const m of result.uncategorized) {
      console.log(`  ${pad(m.merchant, 24)} ${pad(`${m.count}건`, 8)} ${won(m.amount)}`);
    }
    console.log(
      '\n  규칙 파일(JSON)에 이렇게 적고 --rules 로 넘기면 분류가 바뀐다:\n' +
        '  [{ "id": "u1", "pattern": "가맹점이름", "category": "mart" }]',
    );
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const flags = new Set(['--format', '--year', '--rules', '--out', '--card', '--sheet']);
  const target = args.find((a, i) => !a.startsWith('--') && !flags.has(args[i - 1] ?? ''));

  if (target === undefined) {
    console.error(
      '사용법: npm run import -- <명세서.csv|xlsx> [--format shinhan] [--year 2026]\n' +
        '                        [--rules rules.json] [--sheet 시트명] [--card <id> --out case.json]',
    );
    process.exit(1);
  }

  const formatId = flagValue(args, '--format');
  const year = flagValue(args, '--year');
  const options: ParseOptions = {
    ruleset: loadRuleset(flagValue(args, '--rules')),
    ...(formatId === undefined ? {} : { formatId }),
    ...(year === undefined ? {} : { defaultYear: Number(year) }),
  };

  const result = parseFile(target, options, flagValue(args, '--sheet'));
  printResult(result);

  const out = flagValue(args, '--out');
  if (out === undefined) return;

  const card = flagValue(args, '--card');
  if (card === undefined) {
    console.error('\n--out 을 쓰려면 --card <카드 id> 도 필요하다.');
    process.exit(1);
  }

  writeFileSync(
    resolve(out),
    `${JSON.stringify({ card, transactions: result.transactions }, null, 2)}\n`,
    'utf8',
  );
  console.log(`\n${out} 에 저장했다. 이어서: npm run sim -- ${out}`);
}

main();
