import { useMemo, useState } from 'react';
import type { Transaction, Won } from '../../core/index.js';
import { CATEGORIES, UNCATEGORIZED, normalizeMerchant } from '../../import/index.js';
import type { CategoryRule, UncategorizedMerchant } from '../../import/index.js';
import { categoryLabel, won } from '../labels.js';

interface Props {
  transactions: readonly Transaction[];
  uncategorized: readonly UncategorizedMerchant[];
  userRules: readonly CategoryRule[];
  onAssign: (merchant: string, category: string) => void;
  onRemoveRule: (id: string) => void;
}

interface MerchantRow {
  merchant: string;
  category: string;
  count: number;
  amount: Won;
}

const CHOICES = CATEGORIES.filter((c) => c !== UNCATEGORIZED);

function byMerchant(transactions: readonly Transaction[]): MerchantRow[] {
  const rows = new Map<string, MerchantRow>();
  for (const tx of transactions) {
    const found = rows.get(tx.merchant);
    if (found === undefined) {
      rows.set(tx.merchant, { merchant: tx.merchant, category: tx.category, count: 1, amount: tx.amount });
    } else {
      found.count += 1;
      found.amount += tx.amount;
    }
  }
  return [...rows.values()].sort((a, b) => b.amount - a.amount);
}

function CategorySelect({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (category: string) => void;
  label: string;
}) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {value === UNCATEGORIZED && <option value={UNCATEGORIZED}>골라 주세요</option>}
      {CHOICES.map((c) => (
        <option key={c} value={c}>
          {categoryLabel(c)}
        </option>
      ))}
    </select>
  );
}

export function CategoryPanel({ transactions, uncategorized, userRules, onAssign, onRemoveRule }: Props) {
  const [showAll, setShowAll] = useState(false);
  const merchants = useMemo(() => byMerchant(transactions), [transactions]);
  const userPatterns = useMemo(
    () => new Set(userRules.map((r) => normalizeMerchant(r.pattern))),
    [userRules],
  );
  const missing = uncategorized.reduce((sum, m) => sum + m.amount, 0);

  return (
    <section className="panel" aria-labelledby="category-title">
      <div className="panel-head">
        <h2 id="category-title">3. 가맹점 분류</h2>
      </div>

      {uncategorized.length === 0 ? (
        <p className="ok">모든 가맹점의 업종을 정했습니다.</p>
      ) : (
        <>
          <p>
            업종을 모르는 가맹점이 <strong>{uncategorized.length}곳</strong>(
            <span className="num">{won(missing)}</span>) 있습니다. 미분류 결제는 어떤 혜택에도 걸리지 않지만
            실적에는 들어갑니다. 금액이 큰 곳부터 정해 주세요.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">가맹점</th>
                  <th scope="col" className="num">
                    건수
                  </th>
                  <th scope="col" className="num">
                    금액
                  </th>
                  <th scope="col">업종</th>
                </tr>
              </thead>
              <tbody>
                {uncategorized.map((m) => (
                  <tr key={m.merchant}>
                    <th scope="row">{m.merchant}</th>
                    <td className="num">{m.count}</td>
                    <td className="num">{won(m.amount)}</td>
                    <td>
                      <CategorySelect
                        label={`${m.merchant} 업종`}
                        value={UNCATEGORIZED}
                        onChange={(c) => onAssign(m.merchant, c)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <details open={showAll} onToggle={(e) => setShowAll(e.currentTarget.open)}>
        <summary>분류된 가맹점도 고치기 ({merchants.length}곳)</summary>
        {showAll && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">가맹점</th>
                  <th scope="col" className="num">
                    건수
                  </th>
                  <th scope="col" className="num">
                    금액
                  </th>
                  <th scope="col">업종</th>
                </tr>
              </thead>
              <tbody>
                {merchants.map((m) => (
                  <tr key={m.merchant}>
                    <th scope="row">
                      {m.merchant}
                      {userPatterns.has(normalizeMerchant(m.merchant)) && <span className="tag">직접 지정</span>}
                    </th>
                    <td className="num">{m.count}</td>
                    <td className="num">{won(m.amount)}</td>
                    <td>
                      <CategorySelect
                        label={`${m.merchant} 업종`}
                        value={m.category}
                        onChange={(c) => onAssign(m.merchant, c)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>

      {userRules.length > 0 && (
        <details>
          <summary>내가 정한 규칙 {userRules.length}개 (이 브라우저에 저장됨)</summary>
          <ul className="rule-list">
            {userRules.map((r) => (
              <li key={r.id}>
                <span>
                  {r.pattern} → {categoryLabel(r.category)}
                </span>
                <button type="button" className="link" onClick={() => onRemoveRule(r.id)}>
                  지우기
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
