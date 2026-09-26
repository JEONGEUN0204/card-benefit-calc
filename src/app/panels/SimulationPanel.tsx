import { useMemo, useState } from 'react';
import { simulate } from '../../core/index.js';
import type { CardRule, MonthResult, Transaction, Won } from '../../core/index.js';
import type { UncategorizedMerchant } from '../../import/index.js';
import { categoryLabel, describeResult, tierName, won } from '../labels.js';

interface Props {
  card: CardRule;
  transactions: readonly Transaction[];
  uncategorized: readonly UncategorizedMerchant[];
}

/** 금액 입력칸. 콤마·"원"을 섞어 적어도 숫자만 읽는다. 비우면 null. */
function parseAmountInput(text: string): Won | null {
  const digits = text.replace(/[^0-9]/g, '');
  return digits === '' ? null : Number(digits);
}

/** 기능 3 — 내 사용내역으로 월별 할인을 이어 달린다. */
export function SimulationPanel({ card, transactions, uncategorized }: Props) {
  const [prevInput, setPrevInput] = useState('');
  const initialPrevSpending = parseAmountInput(prevInput);

  const months = useMemo(
    () =>
      simulate(card, transactions, initialPrevSpending === null ? {} : { initialPrevSpending }),
    [card, transactions, initialPrevSpending],
  );
  const byId = useMemo(() => new Map(transactions.map((t) => [t.id, t])), [transactions]);
  const totalDiscount = months.reduce((sum, m) => sum + m.totalDiscount, 0);
  const uncategorizedCount = uncategorized.reduce((sum, m) => sum + m.count, 0);

  return (
    <section className="panel" aria-labelledby="sim-title">
      <div className="panel-head">
        <h2 id="sim-title">4. 월별로 실제 받는 할인</h2>
      </div>

      {transactions.length === 0 ? (
        <p className="muted">
          명세서를 올리면 달마다 어느 구간이 적용되고, 어떤 결제가 왜 할인을 못 받았는지 보여 드립니다.
        </p>
      ) : (
        <>
          <label className="inline-field">
            첫 달({months[0]?.month})의 전월실적
            <input
              inputMode="numeric"
              placeholder="모르면 비워 두세요"
              value={prevInput}
              onChange={(e) => setPrevInput(e.target.value)}
            />
            {initialPrevSpending !== null && <span className="num muted">{won(initialPrevSpending)}</span>}
          </label>

          {uncategorizedCount > 0 && (
            <p className="warning-inline">
              미분류 결제 {uncategorizedCount}건은 혜택 계산에서 빠져 있습니다. 위에서 업종을 정하면 결과가
              바뀔 수 있습니다.
            </p>
          )}

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">월</th>
                  <th scope="col" className="num">
                    전월실적
                  </th>
                  <th scope="col">적용 구간</th>
                  <th scope="col" className="num">
                    할인
                  </th>
                  <th scope="col" className="num">
                    이 달 실적
                  </th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <MonthRow key={m.month} month={m} />
                ))}
              </tbody>
              <tfoot>
                <tr className="total">
                  <th scope="row" colSpan={3}>
                    {months.length}개월 합계
                  </th>
                  <td className="num">
                    <strong>{won(totalDiscount)}</strong>
                  </td>
                  <td className="num muted">연회비 {won(card.annualFee)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {months[0]?.tierAssumed === true && (
            <p className="hint">
              첫 달은 전월 데이터가 없어 전월실적을 0원으로 가정했습니다. 알고 있다면 위에 입력하세요.
            </p>
          )}

          {months.map((m) => (
            <details key={m.month} className="month-detail">
              <summary>
                {m.month} 결제 {m.transactions.length}건 자세히
              </summary>
              <div className="table-scroll">
                <table className="compact">
                  <thead>
                    <tr>
                      <th scope="col">날짜</th>
                      <th scope="col">가맹점</th>
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
                    {m.transactions.map((r) => {
                      const tx = byId.get(r.txId);
                      if (tx === undefined) return null;
                      const excluded = r.countedSpending < tx.amount;
                      return (
                        <tr key={r.txId} className={r.discount > 0 ? 'discounted' : ''}>
                          <td>{tx.date.slice(5)}</td>
                          <td>{tx.merchant}</td>
                          <td className={tx.category === 'uncategorized' ? 'attention' : 'muted'}>
                            {categoryLabel(tx.category)}
                          </td>
                          <td className="num">{won(tx.amount)}</td>
                          <td>{describeResult(r)}</td>
                          <td className={`num${excluded ? ' attention' : ''}`}>{won(r.countedSpending)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </>
      )}
    </section>
  );
}

function MonthRow({ month: m }: { month: MonthResult }) {
  return (
    <tr>
      <th scope="row">{m.month}</th>
      <td className="num">{m.prevSpending === null ? <span className="muted">모름</span> : won(m.prevSpending)}</td>
      <td>
        {m.tier === null ? '구간 없음' : tierName(m.tier)}
        {m.tierAssumed && <span className="tag">가정</span>}
      </td>
      <td className="num">{won(m.totalDiscount)}</td>
      <td className="num">{won(m.countedSpending)}</td>
    </tr>
  );
}
