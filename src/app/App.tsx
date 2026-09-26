import { useEffect, useMemo, useState } from 'react';
import {
  addUserRule,
  defaultRuleset,
  mergeParseResults,
  parseStatement,
  parseUserRules,
  removeUserRule,
  serializeUserRules,
  withUserRules,
} from '../import/index.js';
import type { CategoryRule, ParseOptions } from '../import/index.js';
import { CARDS } from './data.js';
import type { LoadedStatement } from './files.js';
import { CardPanel } from './panels/CardPanel.js';
import { CategoryPanel } from './panels/CategoryPanel.js';
import { ImportPanel } from './panels/ImportPanel.js';
import { RequiredSpendPanel } from './panels/RequiredSpendPanel.js';
import { SimulationPanel } from './panels/SimulationPanel.js';
import { STORAGE_KEYS, loadString, saveString } from './storage.js';

function initialCardId(): string {
  const saved = loadString(STORAGE_KEYS.cardId);
  return CARDS.some((c) => c.id === saved) && saved !== null ? saved : (CARDS[0]?.id ?? '');
}

export function App() {
  const [cardId, setCardId] = useState(initialCardId);
  const [statements, setStatements] = useState<LoadedStatement[]>([]);
  const [defaultYear, setDefaultYear] = useState<number | null>(null);
  const [userRules, setUserRules] = useState<CategoryRule[]>(() =>
    parseUserRules(loadString(STORAGE_KEYS.userRules) ?? '[]'),
  );

  useEffect(() => saveString(STORAGE_KEYS.cardId, cardId), [cardId]);
  useEffect(() => {
    saveString(STORAGE_KEYS.userRules, serializeUserRules(withUserRules(defaultRuleset(), userRules)));
  }, [userRules]);

  const card = CARDS.find((c) => c.id === cardId) ?? CARDS[0];
  const ruleset = useMemo(() => withUserRules(defaultRuleset(), userRules), [userRules]);

  // 규칙이 바뀌면 원본 행렬부터 다시 읽는다. 분류는 파싱의 마지막 단계라 이 편이 가장
  // 단순하고, 화면이 들고 있는 거래와 파서 결과가 어긋날 일이 없다.
  const parsed = useMemo(
    () =>
      statements.map((s, index) => {
        const options: ParseOptions = { ruleset, idPrefix: `f${index + 1}-` };
        if (s.formatId !== null) options.formatId = s.formatId;
        if (defaultYear !== null) options.defaultYear = defaultYear;
        return parseStatement(s.rows, options);
      }),
    [statements, ruleset, defaultYear],
  );
  const merged = useMemo(() => mergeParseResults(parsed, ruleset.fallback), [parsed, ruleset]);

  const assignCategory = (merchant: string, category: string) => {
    setUserRules((prev) =>
      addUserRule(withUserRules(defaultRuleset(), prev), { pattern: merchant, category, match: 'exact' })
        .user.slice(),
    );
  };
  const removeRule = (id: string) => {
    setUserRules((prev) => removeUserRule(withUserRules(defaultRuleset(), prev), id).user.slice());
  };

  if (card === undefined) {
    return <main className="page">fixtures/cards/ 에 카드 규칙이 없습니다.</main>;
  }

  return (
    <main className="page">
      <header className="masthead">
        <div>
          <h1>카드 혜택 계산기</h1>
          <p className="lede">
            전월실적 제외까지 반영해, 이 카드로 실제로 얼마를 할인받는지 계산합니다.
          </p>
        </div>
        <p className="privacy" role="note">
          <span aria-hidden="true">🔒</span> 명세서는 이 브라우저 안에서만 읽고 계산합니다. 어디로도
          전송하지 않고, 탭을 닫으면 거래 내역은 사라집니다.
        </p>
      </header>

      <CardPanel cards={CARDS} card={card} onSelect={setCardId} />

      <ImportPanel
        statements={statements}
        parsed={parsed}
        merged={merged}
        defaultYear={defaultYear}
        onYearChange={setDefaultYear}
        onChange={setStatements}
      />

      {merged.transactions.length > 0 && (
        <CategoryPanel
          transactions={merged.transactions}
          uncategorized={merged.uncategorized}
          userRules={userRules}
          onAssign={assignCategory}
          onRemoveRule={removeRule}
        />
      )}

      <SimulationPanel card={card} transactions={merged.transactions} uncategorized={merged.uncategorized} />

      <RequiredSpendPanel card={card} transactions={merged.transactions} />
    </main>
  );
}
