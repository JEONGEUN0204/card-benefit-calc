/**
 * 앱에 번들되는 정적 데이터: 카드 규칙, 카드 이미지, 가상 샘플 명세서.
 *
 * 전부 빌드 시점에 JS로 들어가므로 실행 중에 네트워크를 타지 않는다.
 */
import type { CardRule } from '../core/index.js';

const cardModules = import.meta.glob<CardRule>('../../fixtures/cards/*.json', {
  eager: true,
  import: 'default',
});

/**
 * 이름순.
 *
 * 골든 케이스 전용 가상 카드는 여기 없다. `fixtures/testcards/`에 따로 두어 화면 목록에
 * 뜨지 않게 한다 — 쓸 수 없는 카드를 고르게 되기 때문이다.
 */
export const BUILT_IN_CARDS: readonly CardRule[] = Object.values(cardModules).sort((a, b) =>
  a.name.localeCompare(b.name, 'ko'),
);

/**
 * 카드 이미지. 키는 파일 이름이고, 규칙 JSON의 `art.image`가 이 키를 가리킨다.
 *
 * 빌드 CSP가 `img-src 'self' data:`라서 카드사 서버의 이미지 URL은 화면에 뜨지 않는다.
 * 이미지를 쓰려면 파일이 `fixtures/cards/images/`에 있어야 한다. 비어 있어도 된다 —
 * 그때는 화면이 색으로 카드 모양을 그린다.
 */
const artModules = import.meta.glob<string>(
  '../../fixtures/cards/images/*.{png,jpg,jpeg,webp,avif,svg}',
  { eager: true, import: 'default' },
);

export const CARD_IMAGES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(artModules).map(([path, url]) => [path.split('/').pop() ?? path, url]),
);

const sampleModules = import.meta.glob<string>('../../fixtures/statements/*.csv', {
  eager: true,
  query: '?raw',
  import: 'default',
});

export interface SampleStatement {
  name: string;
  text: string;
}

export const SAMPLE_STATEMENTS: readonly SampleStatement[] = Object.entries(sampleModules)
  .map(([path, text]) => ({ name: path.split('/').pop() ?? path, text }))
  .sort((a, b) => a.name.localeCompare(b.name));
