import type { RoundingMode, Won } from './types.js';

/**
 * 할인액을 카드사 절사 규칙에 맞춰 정수 원으로 되돌린다.
 *
 * 정률 할인은 필연적으로 소수를 만든다. 그 소수가 계산 파이프라인을 타고 흐르면
 * 한도 차감과 실적 산정에서 1원씩 어긋나므로, 할인액이 정해지는 즉시 여기를 거친다.
 * 이 모듈 밖에서 금액에 `Math.floor`/`Math.round`를 직접 쓰지 않는다.
 */
export function roundDiscount(raw: number, mode: RoundingMode): Won {
  if (!Number.isFinite(raw)) {
    throw new Error(`할인액이 유한한 수가 아닙니다: ${raw}`);
  }
  if (raw < 0) {
    // 음수 할인은 "카드사가 돈을 더 받는다"는 뜻이라 도메인상 성립하지 않는다.
    // 조용히 0으로 만들면 계산 버그가 숨으므로 드러낸다.
    throw new Error(`할인액은 음수일 수 없습니다: ${raw}`);
  }

  switch (mode) {
    case 'floor1':
      return Math.floor(raw);
    case 'floor10':
      return Math.floor(raw / 10) * 10;
    case 'round10':
      return Math.round(raw / 10) * 10;
  }
}
