/**
 * 문자열을 이 브라우저에서 파일로 떨어뜨린다.
 *
 * Blob URL로 앵커를 눌러 저장하므로 네트워크를 타지 않는다 — 결제내역이 브라우저 밖으로
 * 나가는 유일한 경로는 사용자가 직접 고른 이 저장이다 (CLAUDE.md 규칙 2).
 */

/** 엑셀은 BOM 없는 UTF-8 CSV의 한글을 깨뜨린다. */
const BOM = '﻿';

function save(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // 바로 해제하면 저장이 시작되기 전에 URL이 사라지는 브라우저가 있다.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadCsv(filename: string, text: string): void {
  save(filename, new Blob([BOM + text], { type: 'text/csv;charset=utf-8' }));
}
