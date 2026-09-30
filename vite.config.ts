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
  /**
   * GitHub Pages는 `/card-benefit-calc/` 아래에 서므로 배포 워크플로가 BASE_PATH로 넘긴다.
   * 페이지 사이 링크는 상대 경로(`app/`, `../`)라 base와 무관하게 맞는다.
   */
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), contentSecurityPolicy()],
  build: {
    outDir: 'dist',
    /**
     * HTML 진입점이 둘이다. 홈(`/`)은 서비스 소개, 계산기는 `/app/`이다.
     * 소개 페이지는 스크립트가 없는 정적 페이지라 CSP를 그대로 통과한다.
     */
    rollupOptions: {
      input: {
        landing: 'index.html',
        app: 'app/index.html',
      },
    },
  },
});
