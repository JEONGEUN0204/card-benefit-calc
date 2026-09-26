/**
 * 앱에 번들되는 정적 데이터: 카드 규칙과 가상 샘플 명세서.
 *
 * 둘 다 빌드 시점에 JS로 들어가므로 실행 중에 네트워크를 타지 않는다.
 */
import type { CardRule } from '../core/index.js';

const cardModules = import.meta.glob<CardRule>('../../fixtures/cards/*.json', {
  eager: true,
  import: 'default',
});

/** 이름순. 지금은 전부 가상 카드다. */
export const CARDS: readonly CardRule[] = Object.values(cardModules).sort((a, b) =>
  a.name.localeCompare(b.name, 'ko'),
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
