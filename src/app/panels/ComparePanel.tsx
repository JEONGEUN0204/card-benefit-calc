import type { CardRule, PortfolioOption, Won } from '../../core/index.js';
import { won } from '../labels.js';

const minus = (n: Won): string => (n === 0 ? '0원' : `− ${won(n)}`);

interface Props {
  cards: readonly CardRule[];
  options: readonly PortfolioOption[];
}

/**
 * 4단계 — 구성끼리 견준다.
 *
 * 3단계는 "가장 좋은 배분"을 하나 보여 준다. 그런데 카드를 새로 발급할지 정하려면
 * "둘 다 쓸 때"와 "한 장만 쓸 때"를 나란히 봐야 한다 — 연회비가 그 차이를 먹는지
 * 알아야 하기 때문이다.
 *
 * 반드시 써야 하는 카드(적금 우대 조건 같은 것)가 빠진 구성은 애초에 목록에 없다.
 */
export function ComparePanel({ cards, options }: Props) {
  if (options.length === 0) {
    return <p className="empty">1단계에서 카드를 고르면 구성을 견줍니다.</p>;
  }

  const name = (id: string): string => cards.find((c) => c.id === id)?.name ?? id;
  const best = options[0];

  return (
    <>
      <section className="panel" aria-labelledby="compare-table">
        <div className="panel-head">
          <h2 id="compare-table">구성별 연 순이익</h2>
          <p className="panel-desc">
            같은 지출을 어느 카드 조합에 나눠 쓸 때 한 해에 얼마가 남는지입니다. 연회비를 이미
            뺀 금액입니다.
          </p>
        </div>

        <div className="table-scroll">
          <table>
            <caption className="sr-only">카드 조합별 연 순이익</caption>
            <thead>
              <tr>
                <th scope="col">구성</th>
                <th scope="col">월 혜택</th>
                <th scope="col">연회비</th>
                <th scope="col">연 순이익</th>
                <th scope="col">차이</th>
              </tr>
            </thead>
            <tbody>
              {options.map((option) => {
                const gap =
                  best === undefined
                    ? 0
                    : option.allocation.annualNet - best.allocation.annualNet;
                return (
                  <tr
                    key={option.cardIds.join('+')}
                    className={option === best ? 'best' : undefined}
                  >
                    <th scope="row">
                      {option.cardIds.map(name).join(' + ')}
                      {option === best && <span className="flag">가장 좋음</span>}
                    </th>
                    <td className="num">{won(option.allocation.monthlyDiscount)}</td>
                    <td className="num">{minus(option.allocation.annualFeeTotal)}</td>
                    <td className="num">{won(option.allocation.annualNet)}</td>
                    <td className="num">{gap === 0 ? '—' : minus(-gap)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <p className="section-note">
        한 장을 뺀 구성이 더 나을 수도 있습니다 — 연회비가 그 카드로 더 받는 혜택보다 크면
        그렇습니다. 반대로 카드를 늘리면 매달 실적을 둘·셋 맞춰야 하는 수고가 생깁니다. 금액이
        비슷하면 적게 쓰는 쪽이 편합니다.
      </p>

      <p className="section-note">
        목록에 없는 카드와는 견줄 수 없습니다. 이 도구는 <strong>가진 카드의 배분</strong>까지 답하고, 어떤
        카드를 새로 만들지는 답하지 않습니다 — 카드 규칙은 저장소에 커밋된 것만 쓰기 때문입니다.
      </p>
    </>
  );
}
