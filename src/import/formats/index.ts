/**
 * 포맷 레지스트리.
 *
 * 새 카드사를 붙일 때는 이 디렉터리에 포맷 파일을 하나 더 만들고 여기 배열에 넣는다.
 * 계산 엔진도, 카테고리 매핑도 건드릴 일이 없다.
 */
import { locateHeader } from '../columns.js';
import type { RawRow, StatementFormat } from '../types.js';
import { generic } from './generic.js';
import { kb } from './kb.js';
import { samsung } from './samsung.js';
import { shinhan } from './shinhan.js';
import { woori } from './woori.js';

/** generic은 항상 마지막이다 — 전용 포맷이 먼저 잡혀야 한다. */
export const FORMATS: readonly StatementFormat[] = [shinhan, kb, samsung, woori, generic];

export function findFormat(id: string): StatementFormat | null {
  return FORMATS.find((f) => f.id === id) ?? null;
}

/**
 * 헤더를 보고 카드사를 알아낸다.
 *
 * `signature`가 긴 포맷(=더 구체적인 포맷)이 이긴다. 동점이면 컬럼을 더 많이 잡아낸 쪽을
 * 쓴다. 어떤 포맷으로도 필수 컬럼을 못 찾으면 null이다.
 */
export function detectFormat(rows: readonly RawRow[]): StatementFormat | null {
  let best: { format: StatementFormat; score: number; matched: number } | null = null;

  for (const format of FORMATS) {
    const header = locateHeader(rows, format);
    if (header === null) continue;

    const score = format.signature.length;
    if (
      best === null ||
      score > best.score ||
      (score === best.score && header.matched > best.matched)
    ) {
      best = { format, score, matched: header.matched };
    }
  }

  return best?.format ?? null;
}

export { generic, kb, samsung, shinhan, woori };
