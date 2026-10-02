import { useMemo } from 'react';
import { REST_POOL, attainableByTier, scopeGroups } from '../../core/index.js';
import type { Allocation, CardPlan, CardRule, Tier, Won } from '../../core/index.js';
import { downloadCsv } from '../download.js';
import { planCsv, planFilename } from '../export.js';
import { tierName, won } from '../labels.js';
import type { QuestionView } from '../questions.js';
import { CardPlate } from '../shell/CardPlate.js';
import { AlertIcon } from '../shell/icons.js';

const minus = (n: Won): string => (n === 0 ? '0원' : `− ${won(n)}`);

/**
 * 구간 이름. 처방에 오르는 카드는 늘 구간이 있지만(구간이 없으면 쓰지 않는 카드다)
 * 타입이 그것을 모르므로 여기서 한 번 받는다.
 */
const tierLabel = (tier: Tier | null): string => (tier === null ? '구간 없음' : tierName(tier));

interface Props {
  cards: readonly CardRule[];
  allocation: Allocation;
  views: readonly QuestionView[];
  ceilings: Readonly<Record<string, Won>>;
  budget: Won;
}

/**
 * 3단계 — 배분 처방.
 *
 * 여기 적힌 금액은 모두 `applyDiscounts` + `calcSpending`을 거친 값이다(불변규칙 4).
 * 최적화기는 배분안만 제안하고 금액을 만들지 않으므로, 최적화기가 덜 좋은 배분을 골랐더라도
 * 화면의 숫자는 그 배분을 실제로 실행했을 때 받는 액수다.
 */
export function PlanPanel({ cards, allocation, views, ceilings, budget }: Props) {
  const label = useMemo(() => {
    const map = new Map<string, string>();
    for (const view of views) map.set(view.pool, view.label);
    return map;
  }, [views]);

  const used = allocation.plans.filter((p) => p.used);
  const unused = allocation.plans.filter((p) => !p.used);

  if (used.length === 0) {
    return (
      <p className="empty">
        배분할 것이 없습니다. 1단계에서 카드를 고르고 2단계에서 항목별 상한을 적어 주세요.
      </p>
    );
  }

  return (
    <>
      <section className="net" aria-label="연 순이익">
        <div className="net-for">
          <p>
            <strong>월 {won(budget)}을 이렇게 나눠 쓰면</strong>
            <span className="muted">카드 {used.length}장, 매달 같은 방식으로 반복할 때</span>
          </p>
        </div>

        <dl className="net-ledger">
          <div className="net-row">
            <dt>
              한 해 받는 혜택
              <small>월 {won(allocation.monthlyDiscount)} × 12개월</small>
            </dt>
            <dd>{won(allocation.monthlyDiscount * 12)}</dd>
          </div>
          <div className={`net-row loss${allocation.annualFeeTotal === 0 ? ' zero' : ''}`}>
            <dt>
              연회비
              <small>쓰기로 한 카드만 셉니다. 안 쓰는 카드는 빠집니다.</small>
            </dt>
            <dd>{minus(allocation.annualFeeTotal)}</dd>
          </div>
          <div className="net-row result">
            <dt>한 해 남는 금액</dt>
            <dd>{won(allocation.annualNet)}</dd>
          </div>
        </dl>

        <dl className="net-facts">
          <div>
            <dt>월 혜택</dt>
            <dd>{won(allocation.monthlyDiscount)}</dd>
          </div>
          <div>
            <dt>이보다 나은 배분</dt>
            <dd>
              {allocation.gap === 0 ? '없습니다' : `${won(allocation.gap)}까지 더 가능`}
            </dd>
          </div>
          {allocation.leftover > 0 && (
            <div>
              <dt>쓸 곳이 없어 남긴 돈</dt>
              <dd>{won(allocation.leftover)}</dd>
            </div>
          )}
        </dl>
      </section>

      {/*
        매달 들고 다니며 "이번 결제는 어느 카드로"를 보는 표다. Blob으로 이 탭 안에서 만들어
        떨어뜨린다 — 어디로도 올리지 않는다(규칙 2).
      */}
      <p className="section-note">
        <button
          type="button"
          className="link"
          onClick={() => downloadCsv(planFilename(cards, allocation), planCsv(cards, allocation, { labels: label, restPool: REST_POOL }))}
        >
          처방표를 CSV로 내려받기
        </button>
      </p>

      {used.map((plan) => {
        const card = cards.find((c) => c.id === plan.cardId);
        if (card === undefined) return null;
        return (
          <PlanCard
            key={plan.cardId}
            card={card}
            plan={plan}
            cards={cards}
            ceilings={ceilings}
            budget={budget}
            label={label}
          />
        );
      })}

      {unused.length > 0 && (
        <p className="section-note">
          {unused
            .map((p) => cards.find((c) => c.id === p.cardId)?.name ?? p.cardId)
            .join(', ')}
          은 쓰지 않는 쪽이 낫습니다 — 연회비를 내고 얻는 것이 그보다 작습니다. 4단계에서
          구성끼리 견주어 보세요.
        </p>
      )}

      {allocation.warnings.map((warning, at) => (
        <p key={`warn-${at}`} className="callout">
          <AlertIcon />
          <span className="grow">
            {warning.cardId !== undefined &&
              `${cards.find((c) => c.id === warning.cardId)?.name ?? warning.cardId}: `}
            {warning.message}
          </span>
        </p>
      ))}
    </>
  );
}

interface CardProps {
  card: CardRule;
  plan: CardPlan;
  cards: readonly CardRule[];
  ceilings: Readonly<Record<string, Won>>;
  budget: Won;
  label: ReadonlyMap<string, string>;
}

function PlanCard({ card, plan, cards, ceilings, budget, label }: CardProps) {
  /*
   * 안내문의 월 최대와 내 소비로 받을 수 있는 최대를 나란히 세운다. 둘의 차이가 이 도구의
   * 존재 이유다 — 카드사가 말하는 월 4만원은 한도의 상한일 뿐이고, 그만큼 받으려면 해당
   * 항목에 그만큼 써야 한다.
   */
  const compare = useMemo(() => {
    const groups = scopeGroups(cards);
    const rows = attainableByTier(card, groups, { byKey: ceilings, monthlyBudget: budget });
    const row = rows.find((r) => r.tier.min === (plan.tier?.min ?? -1));
    return row === undefined ? null : { nominal: row.nominal, attainable: row.attainable };
  }, [card, cards, ceilings, budget, plan.tier]);

  const assigned = Object.entries(plan.byKey)
    .filter(([, at]) => at.amount > 0)
    .sort((a, b) => b[1].amount - a[1].amount);

  return (
    <section className="panel" aria-labelledby={`plan-${card.id}`}>
      <div className="panel-head">
        <h2 id={`plan-${card.id}`}>{card.name}</h2>
        <p className="panel-desc">
          월 {won(plan.monthlySpend)} · {tierLabel(plan.tier)} · 월 혜택{' '}
          {won(plan.monthlyDiscount)}
        </p>
      </div>

      <CardPlate card={card} />

      {compare !== null && compare.nominal > compare.attainable && (
        <p className="tier-nominal">
          안내문 기준 이 구간의 월 최대는 {won(compare.nominal)}인데, 적어 주신 지출로는{' '}
          {won(compare.attainable)}까지 찹니다. 횟수 제한과 건당 조건, 그리고 그 항목에 쓰는
          돈이 한도보다 적어서입니다.
        </p>
      )}

      <div className="table-scroll">
        <table>
          <caption className="sr-only">{card.name}의 항목별 배정</caption>
          <thead>
            <tr>
              <th scope="col">항목</th>
              <th scope="col">금액</th>
              <th scope="col">건수</th>
              <th scope="col">건당</th>
            </tr>
          </thead>
          <tbody>
            {assigned.map(([pool, at]) => (
              <tr key={pool}>
                <th scope="row">
                  {label.get(pool) ?? pool}
                  {pool === REST_POOL && (
                    <small className="qnote">할인은 붙지 않고 구간을 여는 돈입니다</small>
                  )}
                </th>
                <td className="num">{won(at.amount)}</td>
                <td className="num">{at.txCount}건</td>
                <td className="num">{won(Math.floor(at.amount / at.txCount))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/*
        "순할인"이 말하는 뺄셈. 할인받은 결제가 실적에서 빠지는 카드는 같은 구간을 지키는 데
        더 많은 돈이 든다. 카드마다 다르므로 한 줄로 적는다 — 토스 삼성·NEED Pay·삼성 iD는
        빠지고, EVERY 1·Mr.Life·팟 카드는 남는다.
      */}
      <dl className="facts">
        <div>
          <dt>이 달 실적</dt>
          <dd>{won(plan.monthlySpending)}</dd>
        </div>
        <div>
          <dt>할인받아 실적에서 빠진 몫</dt>
          <dd className={plan.excludedFromSpending > 0 ? 'loss' : undefined}>
            {plan.excludedFromSpending === 0 ? '없음' : minus(plan.excludedFromSpending)}
          </dd>
        </div>
      </dl>

      <p className="section-note">
        {plan.excludedFromSpending > 0
          ? `${won(plan.monthlySpend)}을 써도 실적은 ${won(plan.monthlySpending)}입니다 — 할인받은 결제가 실적에서 빠지기 때문입니다. 다음 달 ${tierLabel(plan.tier)}을 지키려면 이만큼을 계속 써야 합니다.`
          : `이 카드는 할인받은 결제도 실적에 남습니다. 쓴 ${won(plan.monthlySpend)}이 그대로 실적이 되어 다음 달 ${tierLabel(plan.tier)}이 유지됩니다.`}
      </p>

      {plan.oscillates && (
        <p className="callout warn">
          <AlertIcon />
          <span className="grow">
            이 카드는 할인받은 결제가 실적에서 빠져 달마다 구간이 왕복합니다. 위 월 혜택은 그
            왕복의 평균입니다.
          </span>
        </p>
      )}
    </section>
  );
}
