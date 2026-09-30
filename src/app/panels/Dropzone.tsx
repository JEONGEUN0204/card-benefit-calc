import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { FORMATS } from '../../import/index.js';
import { SAMPLE_STATEMENTS } from '../data.js';
import { loadStatementFile, loadStatementText } from '../files.js';
import type { LoadedStatement } from '../files.js';
import { AlertIcon, UploadIcon } from '../shell/icons.js';

interface Props {
  onLoaded: (statements: LoadedStatement[]) => void;
  onError: (message: string) => void;
  /** 알림 문구. 중복 파일 안내처럼 이 자리에서 바로 읽혀야 하는 것들. */
  notice?: string | null;
}

/** 자동 감지되는 카드사 이름. 포맷 라벨의 첫 낱말이 카드사다. generic은 카드사가 아니다. */
const ISSUERS = FORMATS.filter((f) => f.id !== 'generic')
  .map((f) => f.label.split(' ')[0] ?? f.label)
  .join(', ');

/**
 * 명세서를 넣는 자리.
 *
 * 엑셀은 파싱에 수백 밀리초가 걸려서 읽는 동안 상태를 보여 준다 — 아무 반응이 없으면 파일이
 * 안 들어간 줄 알고 다시 넣는다.
 */
export function Dropzone({ onLoaded, onError, notice = null }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const readFiles = async (files: FileList | null) => {
    if (files === null || files.length === 0) return;
    setBusy(true);
    try {
      onLoaded(await Promise.all([...files].map(loadStatementFile)));
    } catch (error) {
      onError(`파일을 읽지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void readFiles(event.dataTransfer.files);
  };

  const loadSample = (name: string) => {
    const sample = SAMPLE_STATEMENTS.find((s) => s.name === name);
    if (sample !== undefined) onLoaded([loadStatementText(sample.name, sample.text)]);
  };

  return (
    <>
      <div
        className={`dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <UploadIcon size={28} />
        <p>
          카드사에서 내려받은 이용내역 파일을 여기에 끌어다 놓으세요. 여러 달이면 여러 파일을 한
          번에 넣어도 됩니다.
        </p>

        <div className="actions">
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            명세서 파일 고르기
          </button>

          {busy && (
            <span className="busy" role="status">
              <span className="spinner" />
              읽는 중…
            </span>
          )}

          {!busy && SAMPLE_STATEMENTS.length > 0 && (
            <label className="field">
              가상 샘플
              <select
                value=""
                onChange={(event) => {
                  loadSample(event.target.value);
                  event.target.value = '';
                }}
              >
                <option value="">고르기…</option>
                {SAMPLE_STATEMENTS.map((sample) => (
                  <option key={sample.name} value={sample.name}>
                    {sample.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <p className="formats">CSV와 엑셀 파일. {ISSUERS} 포맷은 자동으로 알아봅니다.</p>

        <input
          ref={input}
          type="file"
          accept=".csv,.xlsx,.xls,.xlsm"
          multiple
          hidden
          onChange={(event) => {
            void readFiles(event.target.files);
            event.target.value = '';
          }}
        />
      </div>

      {notice !== null && (
        <p className="callout warn" role="status">
          <AlertIcon />
          <span className="grow">{notice}</span>
        </p>
      )}
    </>
  );
}
