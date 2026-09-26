/**
 * 명세서 파일 바이트 → 문자열.
 *
 * 카드사 CSV 다운로드는 아직 EUC-KR(CP949)이 흔하다. UTF-8로만 읽으면 한글 헤더가 전부
 * 깨져 "헤더를 찾지 못했다"로 끝나고, 사용자는 파일이 잘못된 줄 안다. 그래서 UTF-8로
 * 엄격하게 읽어보고, 깨지면 EUC-KR로 다시 읽는다. 바이트를 받는 순수 함수라 파일을 여는
 * 일(File API·fs)은 여전히 호출자 몫이다.
 */
export function decodeStatementBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // WHATWG 인코딩 표준에서 'euc-kr'은 CP949(확장 완성형)까지 읽는다.
    return new TextDecoder('euc-kr').decode(bytes);
  }
}
