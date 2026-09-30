import { useMemo } from 'react';
import { maxDiscountByTier } from '../../core/index.js';
import type { CardRule, MonthResult, Transaction } from '../../core/index.js';
import type { UncategorizedMerchant } from '../../import/index.js';
import { downloadCsv } from '../download.js';
import { resultCsv } from '../export.js';
import { categoryLabel, describeResult, tierName, won } from '../labels.js';
import { Meter } from '../shell/Meter.js';
import { monthCeiling } from '../summary.js';
import { AlertIcon, DownloadIcon, InboxIcon } from '../shell/icons.js';

interface Props {
  card: CardRule;
  months: readonly MonthResult[];
  transactions: readonly Transaction[];
  uncategorized: readonly UncategorizedMerchant[];
  /** 첫 달 전월실적 입력값. 원본 문자열을 그대로 들고 있어야 입력 중에 커서가 튀지 않는다. */
  prevInput: string;
  onPrevInput: (text: string) => void;
  /** 미분류가 있을 때 가맹점 분류 화면으로 보낸다. */
  onFixCategories: () => void;
}

/** 기능 3 — 내 사용내역으로 월별 할인을 이어 달린다. */
export function SimulationPanel({
  card,
  months,
  transactions,
  uncategorized,
  prevInput,
  onPrevInput,
  onFixCategories,
}: Props) {
  const byId = useMemo(() => new Map(transactions.map((t) => [t.id, t])), [transactions]);
  const tierMax = useMemo(() => maxDiscountByTier(card), [card]);

  const totalDiscount = months.reduce((sum, m) => sum + m.totalDiscount, 0);
  const uncategorizedCount = uncategorized.reduce((sum, m) => sum + m.count, 0);

  if (transactions.length === 0) {
    return (
      <section className="panel" aria-labelledby="sim-title">
        <div className="panel-head">
          <h2 id="sim-title">월별 할인 결과</h2>
        </div>
        <div className="empty">
          <InboxIcon />
          <p>
            명세서를 올리면 달마다 어느 구간이 적용되고, 어떤 결제가 왜 할인을 못 받았는지
            보여 드립니다.
          </p>
        </div>
      </section>
    );
  }

  const exportCsv = () => {
    const first = months[0]?.month ?? '';
    const last = months[months.length - 1]?.month ?? '';
    downloadCsv(`카드혜택-${card.id}-${first}_${last}.csv`, resultCsv(months, transactions));
  };

  return (
    <section className="panel" aria-labelledby="sim-title">
      <div className="panel-head">
        <h2 id="sim-title">월별 할인 결과</h2>
        <button type="button" onClick={exportCsv}>
          <DownloadIcon /> 결과 내려받기 (CSV)
        </button>
      </div>
      <p className="panel-desc">
        전월실적이 그달의 구간을 정하고, 그달 받은 할인이 다음 달 실적에서 빠집니다. 그 고리를
        올린 기간만큼 이어서 계산한 결과입니다.
      </p>

      <label className="field">
        첫 달({months[0]?.month})의 전월실적
        <input
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="done"
          placeholder="모르면 비워 두세요"
          value={prevInput}
          onChange={(event) => onPrevInput(event.target.value)}
        />
      </label>

      {uncategorizedCount > 0 && (
        <p className="callout warn">
          <AlertIcon />
          <span className="grow">
            업종을 모르는 결제 {uncategorizedCount}건이 혜택 계산에서 빠져 있습니다. 업종을 정하면
            결과가 올라갈 수 있습니다.{' '}
            <button type="button" className="link" onClick={onFixCategories}>
              가맹점 분류로 이동
            </button>
          </span>
        </p>
      )}

      <div className="table-scroll">
        <table className="stack">
          <thead>
            <tr>
              <th scope="col">월</th>
              <th scope="col" className="num">
                전월실적
              </th>
              <th scope="col">적용 구간</th>
              <th scope="col" className="num">
                받은 할인
              </th>
              <th scope="col">구간 한도 소진</th>
              <th scope="col" className="num">
                이 달 실적
              </th>
            </tr>
          </thead>
          <tbody>
            {months.map((month) => (
              <tr key={month.month}>
                <th scope="row">{month.month}</th>
                <td className="num" data-label="전월실적">
                  {month.prevSpending === null ? (
                    <span className="muted">모름</span>
                  ) : (
                    won(month.prevSpending)
                  )}
                </td>
                <td data-label="적용 구간">
                  {month.tier === null ? '구간 없음' : tierName(month.tier)}
                  {month.tierAssumed && <span className="tag">가정</span>}
                </td>
                <td className={`num${month.totalDiscount > 0 ? ' discount' : ''}`} data-label="받은 할인">
                  {won(month.totalDiscount)}
                </td>
                <td data-label="구간 한도 소진">
                  <Meter
                    value={month.totalDiscount}
                    max={monthCeiling(tierMax, month)}
                    inline
                  />
                </td>
                <td className="num" data-label="이 달 실적">
                  {won(month.countedSpending)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="total">
              <th scope="row" colSpan={3}>
                {months.length}개월 합계
              </th>
              <td className="num" data-label="받은 할인">
                {won(totalDiscount)}
              </td>
              <td className="muted" colSpan={2} data-label="연회비">
                연회비 {won(card.annualFee)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {months[0]?.tierAssumed === true && (
        <p className="section-note">
          첫 달은 전월 데이터가 없어 전월실적을 0원으로 가정했습니다. 알고 있다면 위에 입력하세요.
        </p>
      )}

      <h3>달별 상세</h3>
      {months.map((month) => (
        <details key={month.month}>
          <summary>
            {month.month}, 결제 {month.transactions.length}건에 할인 {won(month.totalDiscount)}
            {month.rebate > 0 && `(월정액 ${won(month.rebate)} 포함)`}
          </summary>
          <div className="table-scroll">
            <table className="compact stack">
              <thead>
                <tr>
                  <th scope="col">가맹점</th>
                  <th scope="col">날짜</th>
                  <th scope="col">업종</th>
                  <th scope="col" className="num">
                    금액
                  </th>
                  <th scope="col">결과</th>
                  <th scope="col" className="num">
                    실적 반영
                  </th>
                </tr>
              </thead>
              <tbody>
                {month.transactions.map((result) => {
                  const tx = byId.get(result.txId);
                  if (tx === undefined) return null;
                  const excluded = result.countedSpending < tx.amount;
                  return (
                    <tr key={result.txId}>
                      <th scope="row">{tx.merchant}</th>
                      <td data-label="날짜">{tx.date.slice(5)}</td>
                      <td
                        className={tx.category === 'uncategorized' ? 'attention' : 'muted'}
                        data-label="업종"
                      >
                        {categoryLabel(tx.category)}
                        {/* 명세서가 해외라고 적은 결제. 해외 할인이 왜 붙었는지(또는 안 붙었는지) 여기서 보인다. */}
                        {tx.overseas === true && <span className="tag">해외</span>}
                      </td>
                      <td className="num" data-label="금액">
                        {won(tx.amount)}
                      </td>
                      <td className={result.discount > 0 ? 'discount' : 'muted'} data-label="결과">
                        {describeResult(result)}
                      </td>
                      <td className={`num${excluded ? ' excluded' : ''}`} data-label="실적 반영">
                        {won(result.countedSpending)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </section>
  );
}
