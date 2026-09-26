import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

/**
 * 빌드 결과물에 CSP를 박는다.
 *
 * `connect-src 'none'`이 핵심이다. fetch·XHR·WebSocket·sendBeacon이 전부 막혀서, 나중에
 * 누가 분석 스크립트나 원격 로깅을 붙여도 결제내역이 브라우저 밖으로 나갈 길이 없다
 * (CLAUDE.md 규칙 2). 개발 서버는 HMR이 WebSocket을 써야 해서 빌드에만 건다.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
        injectTo: 'head-prepend',
      },
    ],
  };
}

export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
  build: { outDir: 'dist' },
});
