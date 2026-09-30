import { useMemo, useState } from 'react';
import type { Transaction, Won } from '../../core/index.js';
import { CATEGORIES, UNCATEGORIZED, normalizeMerchant } from '../../import/index.js';
import type { CategoryRule, UncategorizedMerchant } from '../../import/index.js';
import { categoryLabel, won } from '../labels.js';
import { AlertIcon, CheckIcon, InboxIcon } from '../shell/icons.js';

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
      rows.set(tx.merchant, {
        merchant: tx.merchant,
        category: tx.category,
        count: 1,
        amount: tx.amount,
      });
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
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {value === UNCATEGORIZED && <option value={UNCATEGORIZED}>골라 주세요</option>}
      {CHOICES.map((category) => (
        <option key={category} value={category}>
          {categoryLabel(category)}
        </option>
      ))}
    </select>
  );
}

/** 혜택은 업종으로 걸린다. 업종을 모르는 가맹점이 남아 있으면 할인이 실제보다 적게 나온다. */
export function CategoryPanel({
  transactions,
  uncategorized,
  userRules,
  onAssign,
  onRemoveRule,
}: Props) {
  const [showAll, setShowAll] = useState(false);
  const merchants = useMemo(() => byMerchant(transactions), [transactions]);
  const userPatterns = useMemo(
    () => new Set(userRules.map((r) => normalizeMerchant(r.pattern))),
    [userRules],
  );
  const missing = uncategorized.reduce((sum, m) => sum + m.amount, 0);

  if (transactions.length === 0) {
    return (
      <section className="panel" aria-labelledby="category-title">
        <div className="panel-head">
          <h2 id="category-title">가맹점 분류</h2>
        </div>
        <div className="empty">
          <InboxIcon />
          <p>명세서를 올리면 업종을 모르는 가맹점을 여기서 정할 수 있습니다.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel" aria-labelledby="category-title">
      <div className="panel-head">
        <h2 id="category-title">가맹점 분류</h2>
        <p className="section-note">가맹점 {merchants.length}곳</p>
      </div>

      {uncategorized.length === 0 ? (
        <p className="callout info">
          <CheckIcon />
          <span className="grow">모든 가맹점의 업종을 정했습니다.</span>
        </p>
      ) : (
        <>
          <p className="callout warn">
            <AlertIcon />
            <span className="grow">
              업종을 모르는 가맹점이 <strong>{uncategorized.length}곳</strong>(
              {won(missing)}) 있습니다. 미분류 결제는 어떤 혜택에도 걸리지 않지만 실적에는
              들어갑니다. 금액이 큰 곳부터 정해 주세요.
            </span>
          </p>
          <div className="table-scroll">
            <table className="stack">
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
                {uncategorized.map((row) => (
                  <tr key={row.merchant}>
                    <th scope="row">{row.merchant}</th>
                    <td className="num" data-label="건수">
                      {row.count}
                    </td>
                    <td className="num" data-label="금액">
                      {won(row.amount)}
                    </td>
                    <td data-label="업종">
                      <CategorySelect
                        label={`${row.merchant} 업종`}
                        value={UNCATEGORIZED}
                        onChange={(category) => onAssign(row.merchant, category)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <details open={showAll} onToggle={(event) => setShowAll(event.currentTarget.open)}>
        <summary>이미 분류된 가맹점도 고치기 ({merchants.length}곳)</summary>
        {showAll && (
          <div className="table-scroll">
            <table className="stack">
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
                {merchants.map((row) => (
                  <tr key={row.merchant}>
                    <th scope="row">
                      {row.merchant}
                      {userPatterns.has(normalizeMerchant(row.merchant)) && (
                        <span className="tag">직접 지정</span>
                      )}
                    </th>
                    <td className="num" data-label="건수">
                      {row.count}
                    </td>
                    <td className="num" data-label="금액">
                      {won(row.amount)}
                    </td>
                    <td data-label="업종">
                      <CategorySelect
                        label={`${row.merchant} 업종`}
                        value={row.category}
                        onChange={(category) => onAssign(row.merchant, category)}
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
            {userRules.map((rule) => (
              <li key={rule.id}>
                <span>
                  {rule.pattern} → {categoryLabel(rule.category)}
                </span>
                <button type="button" className="link" onClick={() => onRemoveRule(rule.id)}>
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
