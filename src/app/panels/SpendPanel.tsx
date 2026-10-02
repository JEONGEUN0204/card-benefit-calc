import { useState } from 'react';
import { REST_POOL } from '../../core/index.js';
import type { Won } from '../../core/index.js';
import { formatAmountInput, parseAmountInput } from '../amount.js';
import { won } from '../labels.js';
import { DEFAULT_OPEN_QUESTIONS, orderForDisplay } from '../questions.js';
import type { QuestionView } from '../questions.js';
import { AlertIcon } from '../shell/icons.js';

interface Props {
  views: readonly QuestionView[];
  budget: Won | null;
  ceilings: Readonly<Record<string, Won>>;
  onBudget: (value: Won | null) => void;
  onCeiling: (pool: string, value: Won | null) => void;
}

/**
 * 2단계 — 항목마다 한 달에 **얼마까지 쓸 수 있는지** 받는다.
 *
 * 묻는 항목은 고른 카드의 규칙이 정한다(`spendQuestions`). 평균이 아니라 상한을 묻는
 * 이유는 처방이기 때문이다 — "이만큼까지 쓸 수 있다"를 알면 그 안에서 가장 많이 받는
 * 방법을 찾아 준다. 건수는 묻지 않는다. 그건 처방이 답할 일이다.
 *
 * 답하지 않은 항목은 0으로 본다. 보수적으로 안전하다 — 처방이 실제보다 작게 나온다.
 */
export function SpendPanel({ views, budget, ceilings, onBudget, onCeiling }: Props) {
  const [showAll, setShowAll] = useState(false);
  const ordered = orderForDisplay(views);
  const usable = ordered.filter((v) => !v.timeGatedOnly);
  const gated = ordered.filter((v) => v.timeGatedOnly);

  const shown = showAll ? usable : usable.slice(0, DEFAULT_OPEN_QUESTIONS);
  const hidden = usable.length - shown.length;

  const specificTotal = usable
    .filter((v) => v.pool !== REST_POOL)
    .reduce((sum, v) => sum + (ceilings[v.pool] ?? 0), 0);
  const restTotal = ceilings[REST_POOL] ?? 0;
  const assigned = specificTotal + restTotal;

  return (
    <>
      <section className="panel" aria-labelledby="spend-budget">
        <div className="panel-head">
          <h2 id="spend-budget">한 달에 카드로 쓰는 돈</h2>
          <p className="panel-desc">
            카드로 결제하는 금액을 통째로 적으세요. 아래 항목들을 합한 값이 이보다 작으면 남는
            돈은 배분에 쓰이지 않습니다.
          </p>
        </div>
        <div className="field">
          <label htmlFor="budget">월 예산</label>
          <input
            id="budget"
            type="text"
            inputMode="numeric"
            placeholder="예: 1,000,000"
            value={formatAmountInput(budget)}
            onChange={(e) => onBudget(parseAmountInput(e.target.value))}
          />
        </div>
        {budget !== null && assigned > budget && (
          <p className="callout warn">
            <AlertIcon />
            <span className="grow">
              항목별 상한을 합치면 {won(assigned)}으로 월 예산보다 많습니다. 상한이라 그대로
              두어도 되지만, 배분은 예산 안에서만 나눕니다.
            </span>
          </p>
        )}
      </section>

      <section className="panel" aria-labelledby="spend-pools">
        <div className="panel-head">
          <h2 id="spend-pools">항목마다 쓸 수 있는 최대</h2>
          <p className="panel-desc">
            고른 카드의 혜택이 가리키는 항목만 묻습니다. 평소보다 많이 쓸 수 있는 상한을
            적으세요 — 적게 적으면 처방도 작게 나옵니다.
          </p>
        </div>

        <ul className="qlist">
          {shown.map((view) => (
            <li key={view.pool} className="qrow">
              <div className="qhead">
                <label htmlFor={`pool-${view.pool}`}>{view.label}</label>
                {view.pool === REST_POOL ? (
                  <p className="qwhy">
                    위 항목에 없는 평범한 지출입니다. 할인이 붙지 않는 카드에서도 이 돈이
                    전월실적을 쌓아 구간을 엽니다.
                  </p>
                ) : (
                  <p className="qwhy">{view.benefitSummary}</p>
                )}
                {view.note !== null && <p className="qnote">{view.note}</p>}
              </div>
              <input
                id={`pool-${view.pool}`}
                type="text"
                inputMode="numeric"
                placeholder="0"
                value={formatAmountInput(ceilings[view.pool])}
                onChange={(e) => onCeiling(view.pool, parseAmountInput(e.target.value))}
              />
            </li>
          ))}
        </ul>

        {hidden > 0 && (
          <p className="section-note">
            덜 중요한 항목 {hidden}개를 접어 두었습니다.{' '}
            <button type="button" className="link" onClick={() => setShowAll(true)}>
              모두 펼치기
            </button>
          </p>
        )}
        {showAll && usable.length > DEFAULT_OPEN_QUESTIONS && (
          <p className="section-note">
            <button type="button" className="link" onClick={() => setShowAll(false)}>
              덜 중요한 항목 접기
            </button>
          </p>
        )}

        {gated.length > 0 && (
          <p className="section-note">
            {gated.map((v) => v.label).join(', ')} 는 승인시간 조건이 걸려 있어 묻지 않습니다.
            명세서에도 가상 거래에도 승인시간이 없어, 짐작으로 붙이면 밤에 쓰지 않은 결제가
            할인으로 잡힙니다.
          </p>
        )}
      </section>
    </>
  );
}
