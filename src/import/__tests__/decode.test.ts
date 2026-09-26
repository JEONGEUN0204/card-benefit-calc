import { describe, expect, it } from 'vitest';
import { decodeStatementBytes } from '../decode.js';

describe('decodeStatementBytes', () => {
  it('UTF-8 명세서를 그대로 읽는다', () => {
    const bytes = new TextEncoder().encode('이용일자,금액\n2026-01-05,5500');
    expect(decodeStatementBytes(bytes)).toBe('이용일자,금액\n2026-01-05,5500');
  });

  it('UTF-8로 읽히지 않으면 EUC-KR로 읽는다', () => {
    // 카드사 CSV 다운로드는 아직 EUC-KR(CP949)이 흔하다. UTF-8로 읽으면 헤더가 전부
    // 깨져 "헤더를 찾지 못했다"로 끝나는데, 사용자는 파일이 잘못된 줄 안다.
    // "이용일자,5500" — 이 C0CC, 용 BFEB, 일 C0CF, 자 C0DA
    const bytes = new Uint8Array([
      0xc0, 0xcc, 0xbf, 0xeb, 0xc0, 0xcf, 0xc0, 0xda, 0x2c, 0x35, 0x35, 0x30, 0x30,
    ]);
    expect(decodeStatementBytes(bytes)).toBe('이용일자,5500');
  });

  it('UTF-8 BOM을 걷어낸다', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('이용일자')]);
    expect(decodeStatementBytes(bytes)).toBe('이용일자');
  });
});
