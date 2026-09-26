import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { FORMATS } from '../../import/index.js';
import type { MergedStatements, ParseResult } from '../../import/index.js';
import { SAMPLE_STATEMENTS } from '../data.js';
import { loadStatementFile, loadStatementText, switchSheet } from '../files.js';
import type { LoadedStatement } from '../files.js';
import { ISSUE_LABEL, won } from '../labels.js';

interface Props {
  statements: LoadedStatement[];
  parsed: ParseResult[];
  merged: MergedStatements;
  defaultYear: number | null;
  onYearChange: (year: number | null) => void;
  onChange: (next: LoadedStatement[]) => void;
}

/** 계산에서 빠졌지만 정상적인 행. 따로 경고할 일이 아니다. */
const QUIET_ISSUES = new Set(['skippedRow', 'cancelled', 'zeroAmount', 'partiallyCancelled', 'issuerBenefit']);

export function ImportPanel({ statements, parsed, merged, defaultYear, onYearChange, onChange }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const add = (incoming: LoadedStatement[]) => {
    const known = new Set(statements.map((s) => s.key));
    const fresh = incoming.filter((s) => !known.has(s.key));
    const skipped = incoming.length - fresh.length;
    setMessage(skipped > 0 ? `이미 올린 파일 ${skipped}개는 건너뛰었습니다.` : null);
    if (fresh.length > 0) onChange([...statements, ...fresh]);
  };

  const readFiles = async (files: FileList | null) => {
    if (files === null || files.length === 0) return;
    try {
      add(await Promise.all([...files].map(loadStatementFile)));
    } catch (error) {
      setMessage(`파일을 읽지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void readFiles(e.dataTransfer.files);
  };

  const update = (index: number, next: LoadedStatement) =>
    onChange(statements.map((s, i) => (i === index ? next : s)));

  const total = merged.transactions.reduce((sum, t) => sum + t.amount, 0);
  const firstDate = merged.transactions[0]?.date;
  const lastDate = merged.transactions[merged.transactions.length - 1]?.date;

  return (
    <section className="panel" aria-labelledby="import-title">
      <div className="panel-head">
        <h2 id="import-title">2. 명세서</h2>
      </div>

      <div
        className={`dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <p>
          카드사에서 내려받은 이용내역 <strong>CSV·엑셀</strong> 파일을 여기에 끌어다 놓으세요. 여러 달이면
          여러 파일을 한 번에 넣어도 됩니다.
        </p>
        <div className="actions">
          <button type="button" className="primary" onClick={() => input.current?.click()}>
            파일 고르기
          </button>
          {SAMPLE_STATEMENTS.map((s) => (
            <button
              type="button"
              key={s.name}
              onClick={() => add([loadStatementText(s.name, s.text)])}
              title="직접 지어낸 가상 명세서"
            >
              샘플: {s.name}
            </button>
          ))}
        </div>
        <input
          ref={input}
          type="file"
          accept=".csv,.xlsx,.xls,.xlsm"
          multiple
          hidden
          onChange={(e) => {
            void readFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {message !== null && <p className="note">{message}</p>}
      <p className="hint">
        우리카드는 실제 명세서로 맞춘 포맷입니다. 신한·KB·삼성은 아직 추정 컬럼명이라, 헤더를 못
        찾으면 포맷을 직접 골라 보고, 그래도 안 되면 알려 주세요.
      </p>

      {statements.length > 0 && (
        <>
          <ul className="file-list">
            {statements.map((s, index) => {
              const result = parsed[index];
              if (result === undefined) return null;
              return (
                <FileCard
                  key={s.key}
                  statement={s}
                  result={result}
                  onFormat={(formatId) => update(index, { ...s, formatId })}
                  onSheet={(sheet) => void switchSheet(s, sheet).then((next) => update(index, next))}
                  onRemove={() => onChange(statements.filter((_, i) => i !== index))}
                />
              );
            })}
          </ul>

          <label className="inline-field">
            연도가 없는 날짜(예: 07.18)에 붙일 연도 — 12~1월 명세서면 1월 쪽 연도
            <input
              type="number"
              min={2000}
              max={2100}
              placeholder="예: 2026"
              value={defaultYear ?? ''}
              onChange={(e) => onYearChange(e.target.value === '' ? null : Number(e.target.value))}
            />
          </label>

          {merged.duplicates.length > 0 && (
            <details className="warning">
              <summary>
                앞 파일과 겹치는 거래 {merged.duplicates.length}건은 한 번만 셌습니다.
              </summary>
              <p>같은 명세서를 두 번 올렸거나 조회 기간이 겹친 것 같습니다.</p>
              <ul>
                {merged.duplicates.map((t) => (
                  <li key={t.id}>
                    {t.date} {t.merchant} {won(t.amount)}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <p className="summary">
            거래 <strong>{merged.transactions.length}건</strong>
            {firstDate !== undefined && lastDate !== undefined && (
              <>
                {' '}
                · {firstDate} ~ {lastDate}
              </>
            )}{' '}
            · 합계 <strong className="num">{won(total)}</strong>
          </p>
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
            onChange={(e) => onFormat(e.target.value === '' ? null : e.target.value)}
          >
            <option value="">
              자동 감지{statement.formatId === null && detected !== undefined ? ` (${detected.label})` : ''}
            </option>
            {FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        {statement.workbook !== null && statement.workbook.sheets.length > 1 && (
          <label>
            시트
            <select value={statement.workbook.sheet} onChange={(e) => onSheet(e.target.value)}>
              {statement.workbook.sheets.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {failed ? (
        <p className="error">
          거래 목록의 헤더(날짜·가맹점·금액)를 찾지 못했습니다. 포맷을 직접 골라 보세요.
        </p>
      ) : needsYear ? (
        <p className="error">날짜에 연도가 없는 명세서입니다. 아래 “붙일 연도”를 입력하세요.</p>
      ) : (
        <p className="muted">
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
          <table className="compact">
            <tbody>
              {result.issues.map((issue, i) => (
                <tr key={i} className={QUIET_ISSUES.has(issue.kind) ? '' : 'attention'}>
                  <td className="num">{issue.row === 0 ? '파일' : `${issue.row}행`}</td>
                  <td>{ISSUE_LABEL[issue.kind]}</td>
                  <td>{issue.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </li>
  );
}
