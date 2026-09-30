import type { CardRule } from '../../core/index.js';
import { CARD_IMAGES } from '../data.js';

/**
 * 카드 겉모습. 번들된 이미지 파일이 있을 때만 그린다.
 *
 * 이미지가 없으면 아무것도 그리지 않는다. 전에는 규칙의 `art` 색으로 카드 모양을 지어
 * 그렸는데, 실제 카드와 닮지 않은 색 판은 알아보는 데 돕지 못하고 자리만 차지했다 — 카드가
 * 늘어나면 그런 판이 목록을 덮는다. 어느 카드인지는 언제나 옆의 글자가 정한다.
 *
 * 이미지는 번들된 것만 쓴다. 빌드 CSP가 `img-src 'self' data:`라서 카드사 서버의 URL은
 * 어차피 막힌다. 옆에 이름이 글자로 있으므로 그림은 장식으로 두고 보조기술에서 숨긴다.
 */
export function CardPlate({ card }: { card: CardRule }) {
  const image = card.art?.image === undefined ? undefined : CARD_IMAGES[card.art.image];
  if (image === undefined) return null;

  return (
    <div className="plate" aria-hidden="true">
      <img src={image} alt="" width={72} height={45} />
    </div>
  );
}
