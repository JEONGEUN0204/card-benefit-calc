import { useState } from 'react';
import { FORMATS } from '../../import/index.js';
import type { MergedStatements, ParseResult } from '../../import/index.js';
import { switchSheet } from '../files.js';
import type { LoadedStatement } from '../files.js';
import { ISSUE_LABEL, won } from '../labels.js';
import { InfoIcon } from '../shell/icons.js';
import { Dropzone } from './Dropzone.js';

interface Props {
  statements: LoadedStatement[];
  parsed: ParseResult[];
  merged: MergedStatements;
  defaultYear: number | null;
  notice: string | null;
  onYearChange: (year: number | null) => void;
  onChange: (next: LoadedStatement[]) => void;
  onLoaded: (incoming: LoadedStatement[]) => void;
  onError: (message: string) => void;
}

/** 계산에서 빠졌지만 정상적인 행. 따로 경고할 일이 아니다. */
const QUIET_ISSUES = new Set([
  'skippedRow',
  'cancelled',
  'zeroAmount',
  'partiallyCancelled',
  'issuerBenefit',
]);

/** 칸에 적힌 글자를 연도로. 2000~2100이 아니면 아직 연도가 아니다. */
function toYear(text: string): number | null {
  if (!/^\d{4}$/.test(text)) return null;
  const year = Number(text);
  return year >= 2000 && year <= 2100 ? year : null;
}

/** 올린 파일을 관리하는 화면. 포맷·시트·연도를 바로잡는 곳이다. */
export function FilesPanel({
  statements,
  parsed,
  merged,
  defaultYear,
  notice,
  onYearChange,
  onChange,
  onLoaded,
  onError,
}: Props) {
  // 치는 도중의 "2", "20"은 칸에만 두고, 네 자리 연도가 되어야 파서에 넘긴다.
  const [yearText, setYearText] = useState(defaultYear === null ? '' : String(defaultYear));
  const update = (index: number, next: LoadedStatement) =>
    onChange(statements.map((s, i) => (i === index ? next : s)));

  const total = merged.transactions.reduce((sum, t) => sum + t.amount, 0);
  const firstDate = merged.transactions[0]?.date;
  const lastDate = merged.transactions[merged.transactions.length - 1]?.date;

  return (
    <section className="panel" aria-labelledby="files-title">
      <div className="panel-head">
        <h2 id="files-title">명세서 파일</h2>
        {statements.length > 0 && (
          <p className="section-note">
            파일 {statements.length}개, 거래 {merged.transactions.length}건
          </p>
        )}
      </div>

      <Dropzone onLoaded={onLoaded} onError={onError} notice={notice} />

      <p className="callout">
        <InfoIcon />
        <span className="grow">
          우리카드는 실제 명세서로 맞춘 포맷입니다. 신한·KB·삼성은 아직 추정 컬럼명이라, 헤더를
          못 찾으면 포맷을 직접 골라 보고 그래도 안 되면 알려 주세요.
        </span>
      </p>

      {statements.length > 0 && (
        <>
          <ul className="file-list">
            {statements.map((statement, index) => {
              const result = parsed[index];
              if (result === undefined) return null;
              return (
                <FileCard
                  key={statement.key}
                  statement={statement}
                  result={result}
                  onFormat={(formatId) => update(index, { ...statement, formatId })}
                  onSheet={(sheet) =>
                    void switchSheet(statement, sheet).then((next) => update(index, next))
                  }
                  onRemove={() => onChange(statements.filter((_, i) => i !== index))}
                />
              );
            })}
          </ul>

          <label className="field">
            연도가 없는 날짜(예: 07.18)에 붙일 연도 — 12~1월 명세서면 1월 쪽 연도
            <input
              type="number"
              inputMode="numeric"
              autoComplete="off"
              enterKeyHint="done"
              min={2000}
              max={2100}
              placeholder="예: 2026"
              value={yearText}
              onChange={(event) => {
                setYearText(event.target.value);
                onYearChange(toYear(event.target.value));
              }}
            />
          </label>

          {merged.duplicates.length > 0 && (
            <details className="warn">
              <summary>
                앞 파일과 겹치는 거래 {merged.duplicates.length}건은 한 번만 셌습니다
              </summary>
              <p>같은 명세서를 두 번 올렸거나 조회 기간이 겹친 것 같습니다.</p>
              <div className="table-scroll">
                <table className="compact">
                  <tbody>
                    {merged.duplicates.map((tx) => (
                      <tr key={tx.id}>
                        <td>{tx.date}</td>
                        <td>{tx.merchant}</td>
                        <td className="num">{won(tx.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          <dl className="facts">
            <div>
              <dt>거래</dt>
              <dd>{merged.transactions.length}건</dd>
            </div>
            <div>
              <dt>기간</dt>
              <dd>{firstDate === undefined || lastDate === undefined ? '—' : `${firstDate} ~ ${lastDate}`}</dd>
            </div>
            <div>
              <dt>결제 합계</dt>
              <dd className="num">{won(total)}</dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}

interface FileCardProps {
  statement: LoadedStatement;
  result: ParseResult;
  onFormat: (formatId: string | null) => void;
  onSheet: (sheet: string) => void;
  onRemove: () => void;
}

function FileCard({ statement, result, onFormat, onSheet, onRemove }: FileCardProps) {
  const failed = result.issues.some((i) => i.kind === 'noHeader');
  // 날짜를 하나도 못 읽었다면 거의 항상 연도 없는 명세서다. 행마다 오류를 늘어놓기보다 할 일을 말한다.
  const needsYear =
    !failed && result.transactions.length === 0 && result.issues.some((i) => i.kind === 'badDate');
  const problems = result.issues.filter((i) => !QUIET_ISSUES.has(i.kind));
  const detected = FORMATS.find((f) => f.id === result.formatId);

  return (
    <li className={`file-card${failed ? ' failed' : ''}`}>
      <div className="file-head">
        <strong className="file-name">{statement.name}</strong>
        <button type="button" className="link" onClick={onRemove}>
          빼기
        </button>
      </div>

      <div className="file-controls">
        <label>
          포맷
          <select
            value={statement.formatId ?? ''}
            onChange={(event) => onFormat(event.target.value === '' ? null : event.target.value)}
          >
            <option value="">
              자동 감지
              {statement.formatId === null && detected !== undefined ? ` (${detected.label})` : ''}
            </option>
            {FORMATS.map((format) => (
              <option key={format.id} value={format.id}>
                {format.label}
              </option>
            ))}
          </select>
        </label>
        {statement.workbook !== null && statement.workbook.sheets.length > 1 && (
          <label>
            시트
            <select value={statement.workbook.sheet} onChange={(event) => onSheet(event.target.value)}>
              {statement.workbook.sheets.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {failed ? (
        <p className="callout danger">
          거래 목록의 헤더(날짜·가맹점·금액)를 찾지 못했습니다. 포맷을 직접 골라 보세요.
        </p>
      ) : needsYear ? (
        <p className="callout danger">
          날짜에 연도가 없는 명세서입니다. 아래 “붙일 연도”를 입력하세요.
        </p>
      ) : (
        <p className="file-stat">
          읽은 행 {result.rowCount}개 → 거래 {result.transactions.length}건
          {result.issues.length > 0 && ` · 계산에서 뺀 행 ${result.issues.length}개`}
        </p>
      )}

      {result.issues.length > 0 && !failed && !needsYear && (
        <details open={problems.length > 0}>
          <summary>
            계산에서 뺀 행 보기
            {problems.length > 0 && <span className="flag">확인 필요 {problems.length}</span>}
          </summary>
          <div className="table-scroll">
            <table className="compact">
              <tbody>
                {result.issues.map((issue, index) => (
                  <tr key={index} className={QUIET_ISSUES.has(issue.kind) ? '' : 'attention'}>
                    <td className="num">{issue.row === 0 ? '파일' : `${issue.row}행`}</td>
                    <td>{ISSUE_LABEL[issue.kind]}</td>
                    <td>{issue.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </li>
  );
}
