import { useMemo, useState } from 'react';
import { patternFromTransactions, requiredSpendFor } from '../../core/index.js';
import type { CardRule, SpendingPattern, Transaction } from '../../core/index.js';
import { categoryLabel, tierName, won } from '../labels.js';

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
      <section className="panel">
        <h2>5. 구간을 채우려면</h2>
        <p className="muted">이 카드는 실적 구간이 없습니다.</p>
      </section>
    );
  }

  return (
    <section className="panel" aria-labelledby="req-title">
      <div className="panel-head">
        <h2 id="req-title">5. 구간을 채우려면 실제로 얼마를 써야 하나</h2>
      </div>

      <div className="controls">
        <label>
          목표 구간
          <select
            value={target.min}
            onChange={(e) => {
              setTargetMin(Number(e.target.value));
              setCurrent('keep');
            }}
          >
            {targets.map((t) => (
              <option key={t.min} value={t.min}>
                {tierName(t)}
              </option>
            ))}
          </select>
        </label>
        <label>
          이번 달 적용 중인 구간
          <select
            value={current}
            onChange={(e) => setCurrent(e.target.value === 'keep' ? 'keep' : Number(e.target.value))}
          >
            <option value="keep">목표 구간 그대로 (유지하려면)</option>
            {card.tiers
              .filter((t) => t.min < target.min)
              .map((t) => (
                <option key={t.min} value={t.min}>
                  {tierName(t)} (올라가려면)
                </option>
              ))}
          </select>
        </label>
        <fieldset>
          <legend>소비 비중</legend>
          <label>
            <input
              type="radio"
              checked={mine}
              disabled={transactions.length === 0}
              onChange={() => setUseMine(true)}
            />
            내 명세서{transactions.length === 0 ? ' (올린 명세서 없음)' : ` (${transactions.length}건)`}
          </label>
          <label>
            <input type="radio" checked={!mine} onChange={() => setUseMine(false)} />
            예시 패턴
          </label>
        </fieldset>
      </div>

      {result === null ? null : result.requiredTotalSpend === null ? (
        <p className="error">이 소비 비중으로는 목표 실적에 도달할 수 없습니다. 결제 대부분이 실적에서 빠집니다.</p>
      ) : (
        <>
          <p className="headline">
            실적 <span className="num">{won(target.min)}</span>을 채우려면{' '}
            <strong className="num">{won(result.requiredTotalSpend)}</strong>을 써야 합니다.
            {result.excludedAmount > 0 && (
              <>
                {' '}
                <span className="flag">{won(result.excludedAmount)}이 실적에서 빠짐</span>
              </>
            )}
          </p>
          <dl className="facts">
            <div>
              <dt>그때의 실적</dt>
              <dd className="num">{won(result.resultingSpending)}</dd>
            </div>
            <div>
              <dt>실적에서 빠지는 금액</dt>
              <dd className="num">{won(result.excludedAmount)}</dd>
            </div>
            <div>
              <dt>그달 받는 할인</dt>
              <dd className="num">{won(result.expectedDiscount)}</dd>
            </div>
          </dl>
          <details>
            <summary>업종별 결제액</summary>
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
          </details>
          <p className="hint">
            {mine
              ? '올린 명세서의 업종별 결제 비중과 평균 결제액을 그대로 늘려 계산했습니다.'
              : '예시 소비 비중으로 계산했습니다. 명세서를 올리면 내 비중으로 바뀝니다.'}{' '}
            할인은 이번 달 구간이, 실적 제외는 그 할인이 정하므로 “유지”와 “올라가기”의 답이 다릅니다.
          </p>
        </>
      )}
    </section>
  );
}
