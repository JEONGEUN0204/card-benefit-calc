import { useMemo, useState } from 'react';
import { patternFromTransactions, requiredSpendFor } from '../../core/index.js';
import type { CardRule, SpendingPattern, Transaction } from '../../core/index.js';
import { categoryLabel, tierName, won } from '../labels.js';
import { AlertIcon } from '../shell/icons.js';

interface Props {
  card: CardRule;
  transactions: readonly Transaction[];
}

/** 명세서가 없을 때 쓰는 예시 패턴. `scripts/sim.ts --required`와 같다. */
const EXAMPLE_PATTERN: SpendingPattern = {
  weights: { cafe: 1, convenience: 1, mart: 3, transport: 1, delivery: 1, etc: 3 },
  defaultTicket: 15_000,
  ticketSize: { cafe: 5_000, convenience: 6_000, transport: 1_500 },
};

/**
 * 업종이 아닌 조건(가맹점명·해외 여부)으로만 붙는 혜택이 있는가. 예시 패턴의 가상 거래는
 * 가맹점명 자리에 업종 이름만 있고 해외 표시도 없어 이런 혜택에 닿지 못한다.
 */
function matchesBeyondCategory(card: CardRule): boolean {
  return card.benefits.some(
    (b) =>
      (b.match.categories ?? []).length === 0 &&
      ((b.match.merchants ?? []).length > 0 || b.match.overseas === true),
  );
}

/** 'keep'은 목표 구간을 이미 쓰고 있는 상황(유지). 숫자는 지금 구간의 min. */
type Current = 'keep' | number;

/** 기능 2 — 목표 구간을 채우려면 실제로 얼마를 써야 하나. */
export function RequiredSpendPanel({ card, transactions }: Props) {
  const targets = card.tiers.filter((t) => t.min > 0);
  const [targetMin, setTargetMin] = useState<number | null>(null);
  const [current, setCurrent] = useState<Current>('keep');
  const [useMine, setUseMine] = useState(true);

  const target = targets.find((t) => t.min === targetMin) ?? targets[0];
  const mine = transactions.length > 0 && useMine;

  const result = useMemo(() => {
    if (target === undefined) return null;
    const pattern = mine ? patternFromTransactions(transactions) : EXAMPLE_PATTERN;
    const currentTier = current === 'keep' ? undefined : card.tiers.find((t) => t.min === current);
    return requiredSpendFor(card, target, pattern, currentTier === undefined ? {} : { currentTier });
  }, [card, target, current, mine, transactions]);

  if (target === undefined) {
    return (
      <section className="panel" aria-labelledby="req-title">
        <div className="panel-head">
          <h2 id="req-title">구간 채우기 계산기</h2>
        </div>
        <p className="muted">이 카드는 전월실적 구간이 없습니다.</p>
      </section>
    );
  }

  return (
    <section className="panel" aria-labelledby="req-title">
      {/* 단계 제목이 바로 위에 있어 화면에는 한 번만 적고, 구역 이름은 보조기술에만 남긴다. */}
      <h2 id="req-title" className="sr-only">
        구간 채우기 계산기
      </h2>
      <p className="panel-desc">
        할인받은 결제는 실적에서 빠집니다. 그래서 “30만원 구간”을 채우려면 30만원보다 더 써야
        합니다. 얼마나 더 써야 하는지 역산합니다.
      </p>

      <div className="controls">
        <label>
          목표 구간
          <select
            value={target.min}
            onChange={(event) => {
              setTargetMin(Number(event.target.value));
              setCurrent('keep');
            }}
          >
            {targets.map((tier) => (
              <option key={tier.min} value={tier.min}>
                {tierName(tier)}
              </option>
            ))}
          </select>
        </label>
        <label>
          이번 달 적용 중인 구간
          <select
            value={current}
            onChange={(event) =>
              setCurrent(event.target.value === 'keep' ? 'keep' : Number(event.target.value))
            }
          >
            <option value="keep">목표 구간 그대로 (유지하려면)</option>
            {card.tiers
              .filter((t) => t.min < target.min)
              .map((tier) => (
                <option key={tier.min} value={tier.min}>
                  {tierName(tier)} (올라가려면)
                </option>
              ))}
          </select>
        </label>
        <fieldset>
          <legend>소비 비중</legend>
          <label>
            <input
              type="radio"
              name="pattern-source"
              checked={mine}
              disabled={transactions.length === 0}
              onChange={() => setUseMine(true)}
            />
            내 명세서
            {transactions.length === 0 ? ' (올린 명세서 없음)' : ` (${transactions.length}건)`}
          </label>
          <label>
            <input
              type="radio"
              name="pattern-source"
              checked={!mine}
              onChange={() => setUseMine(false)}
            />
            예시 패턴
          </label>
        </fieldset>
      </div>

      {!mine && matchesBeyondCategory(card) ? (
        <p className="callout warn">
          <AlertIcon />
          <span className="grow">
            예시 패턴은 업종 비중만 담고 있어, 가맹점이나 해외 결제로 붙는 이 카드의 혜택은
            계산에 들어가지 않습니다. 할인받아 빠지는 몫이 실제보다 작게 나오니 명세서를 올려 내
            결제로 계산하세요.
          </span>
        </p>
      ) : null}

      {result === null ? null : result.requiredTotalSpend === null ? (
        <p className="callout danger">
          <AlertIcon />
          <span className="grow">
            이 소비 비중으로는 목표 실적에 도달할 수 없습니다. 결제 대부분이 실적에서 빠집니다.
          </span>
        </p>
      ) : (
        <>
          {/*
            할인 결과의 순액 원장을 덧셈 방향으로 쓴다. 필요 결제액은 `requiredSpendFor`가
            실적으로 남는 몫 + 빠지는 몫으로 내므로 두 줄을 더하면 언제나 맨 아래 값이 된다.
            맨 아래는 할인이 아니라 써야 하는 돈이라 순액 초록 대신 잉크색이다.
          */}
          <dl className="net-ledger">
            <div className="net-row">
              <dt>
                실적으로 남는 몫
                <small>{tierName(target)} 구간을 여는 데 쓰이는 금액.</small>
              </dt>
              <dd>{won(result.resultingSpending)}</dd>
            </div>
            <div className={`net-row loss${result.excludedAmount === 0 ? ' zero' : ''}`}>
              <dt>
                할인받아 빠지는 몫
                <small>
                  {result.excludedAmount > 0
                    ? `그달 받는 할인 ${won(result.expectedDiscount)}이 걸린 결제라 실적에 안 들어갑니다.`
                    : result.expectedDiscount > 0
                      ? `할인 ${won(result.expectedDiscount)}을 받지만 이 카드는 할인받은 결제도 실적에 넣습니다.`
                      : '이 소비 비중에서는 할인이 걸리는 결제가 없어 빠지는 몫이 없습니다.'}
                </small>
              </dt>
              <dd>{result.excludedAmount === 0 ? won(0) : `+${won(result.excludedAmount)}`}</dd>
            </div>
            <div className="net-row result spend">
              <dt>실제로 써야 하는 금액</dt>
              <dd>{won(result.requiredTotalSpend)}</dd>
            </div>
          </dl>

          <details>
            <summary>업종별 결제액</summary>
            <div className="table-scroll">
              <table className="compact">
                <tbody>
                  {Object.entries(result.breakdown)
                    .filter(([, amount]) => amount > 0)
                    .sort(([, a], [, b]) => b - a)
                    .map(([category, amount]) => (
                      <tr key={category}>
                        <th scope="row">{categoryLabel(category)}</th>
                        <td className="num">{won(amount)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </details>

          <p className="section-note">
            {mine
              ? '올린 명세서의 결제를 가맹점 그대로 되풀이해 늘려 계산했습니다.'
              : '예시 소비 비중으로 계산했습니다. 명세서를 올리면 내 결제로 바뀝니다.'}{' '}
            할인은 이번 달 구간이, 실적 제외는 그 할인이 정하므로 “유지”와 “올라가기”의 답이
            다릅니다.
          </p>
        </>
      )}
    </section>
  );
}
