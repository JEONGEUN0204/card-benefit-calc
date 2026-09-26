import { useMemo } from 'react';
import { maxDiscountByTier } from '../../core/index.js';
import type { CardRule, SpendingExclusion } from '../../core/index.js';
import { EXCLUSION_LABEL, PAYMENT_TYPE_LABEL, categoryLabel, tierName, won } from '../labels.js';

interface Props {
  cards: readonly CardRule[];
  card: CardRule;
  onSelect: (id: string) => void;
}

function describeExclusion(ex: SpendingExclusion): string {
  if (ex.kind === 'category') return ex.values.map(categoryLabel).join(', ');
  if (ex.kind === 'paymentType') {
    return ex.values
      .map((v) => PAYMENT_TYPE_LABEL[v as keyof typeof PAYMENT_TYPE_LABEL] ?? v)
      .join(', ');
  }
  return ex.values.map((v) => `'${v}' 포함 가맹점`).join(', ');
}

/** 기능 1 — 구간별 월 최대 할인. 거래 없이 규칙만으로 나온다. */
export function CardPanel({ cards, card, onSelect }: Props) {
  const rows = useMemo(() => maxDiscountByTier(card), [card]);
  const tiers = rows.map((r) => r.tier);
  const hasTotalCap = card.totalMonthlyCapByTier !== undefined;

  return (
    <section className="panel" aria-labelledby="card-title">
      <div className="panel-head">
        <h2 id="card-title">1. 카드</h2>
        <label className="inline-field">
          <span className="sr-only">카드 선택</span>
          <select value={card.id} onChange={(e) => onSelect(e.target.value)}>
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.issuer}
              </option>
            ))}
          </select>
        </label>
      </div>

      <dl className="facts">
        <div>
          <dt>연회비</dt>
          <dd className="num">{won(card.annualFee)}</dd>
        </div>
        <div>
          <dt>실적에서 빠지는 결제</dt>
          <dd>{card.spendingExclusions.map(describeExclusion).join(' · ') || '없음'}</dd>
        </div>
      </dl>
      {card.sourceNote !== undefined && <p className="note">{card.sourceNote}</p>}

      <h3>구간별 월 최대 할인</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">혜택</th>
              <th scope="col">실적 제외</th>
              {tiers.map((t) => (
                <th scope="col" className="num" key={t.min}>
                  {tierName(t)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {card.benefits.map((b) => (
              <tr key={b.id}>
                <th scope="row" title={b.sourceNote}>
                  {b.label}
                </th>
                <td className="muted">{EXCLUSION_LABEL[b.excludeFromSpending]}</td>
                {rows.map((r) => {
                  const cap = r.byBenefit[b.id] ?? 0;
                  return (
                    <td className={`num${cap === 0 ? ' muted' : ''}`} key={r.tier.min}>
                      {cap === 0 ? '—' : won(cap)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            {hasTotalCap && (
              <tr>
                <th scope="row" colSpan={2}>
                  통합 할인 한도
                </th>
                {rows.map((r) => {
                  const cap = card.totalMonthlyCapByTier?.[String(r.tier.min)] ?? 0;
                  return (
                    <td className="num" key={r.tier.min}>
                      {won(cap)}
                    </td>
                  );
                })}
              </tr>
            )}
            <tr className="total">
              <th scope="row" colSpan={2}>
                실제 월 최대
              </th>
              {rows.map((r) => (
                <td className="num" key={r.tier.min}>
                  <strong>{won(r.maxDiscount)}</strong>
                  {r.cappedByTotal && (
                    <span className="flag" title={`혜택 한도 합 ${won(r.sumOfBenefitCaps)}`}>
                      통합 한도에 잘림 ({won(r.sumOfBenefitCaps)} → {won(r.maxDiscount)})
                    </span>
                  )}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="hint">
        한도의 상한입니다. 그만큼 받으려면 해당 업종에서 실제로 그만큼 써야 하고, 할인받은 결제는
        다음 달 실적에서 빠질 수 있습니다.
      </p>
    </section>
  );
}
