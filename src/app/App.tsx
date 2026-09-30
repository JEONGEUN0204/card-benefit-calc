import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveChoices, simulate } from '../core/index.js';
import type { Won } from '../core/index.js';
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
import { BUILT_IN_CARDS } from './data.js';
import type { LoadedStatement } from './files.js';
import { CardPanel, CardPicker, ChoicePicker } from './panels/CardPanel.js';
import { CategoryPanel } from './panels/CategoryPanel.js';
import { FilesPanel } from './panels/FilesPanel.js';
import { RequiredSpendPanel } from './panels/RequiredSpendPanel.js';
import { SimulationPanel } from './panels/SimulationPanel.js';
import { AppBar } from './shell/AppBar.js';
import { Footer } from './shell/Footer.js';
import { Stepper } from './shell/Stepper.js';
import type { StepDef } from './shell/Stepper.js';
import { SummaryBar } from './shell/SummaryBar.js';
import { AlertIcon } from './shell/icons.js';
import { STORAGE_KEYS, loadString, parseSavedChoices, saveString } from './storage.js';
import { summarize } from './summary.js';

/*
 * 차례가 있는 네 단계. 화면에는 한 번에 하나만 선다.
 *
 * 셋은 이 도구가 답하는 세 가지 질문이고(구간별 최대 할인 → 내 명세서의 실제 할인 → 목표
 * 구간에 필요한 사용액), 명세서 올리기가 그 사이에 낀다. 가맹점 분류를 고치는 일은 차례가
 * 아니라 필요할 때 하는 일이라, 단계로 세지 않고 필요한 단계 안에서 연다.
 */
const STEP_IDS = ['card', 'files', 'result', 'required'] as const;
type StepId = (typeof STEP_IDS)[number];

/** 금액 입력칸. 콤마·"원"을 섞어 적어도 숫자만 읽는다. 비우면 null. */
function parseAmountInput(text: string): Won | null {
  const digits = text.replace(/[^0-9]/g, '');
  return digits === '' ? null : Number(digits);
}

/*
 * 고를 수 있는 카드는 번들된 규칙뿐이다.
 *
 * 브라우저에서 규칙 JSON을 받아들이는 길은 두지 않는다. 약관을 규칙으로 옮기는 일은
 * `add-card-rule` 스킬이 저장소에서 하고(골든 케이스까지 함께 만든다), 그 결과가
 * `fixtures/cards/`에 커밋되어 여기로 들어온다. 화면에 그 흐름을 열어 두면 스킬을 돌릴 수
 * 없는 사람에게 끝까지 갈 수 없는 길을 보여 주게 되고, 검증되지 않은 규칙이 검증된 카드와
 * 같은 표에 나란히 선다.
 */
export function App() {
  const cards = BUILT_IN_CARDS;
  const [cardId, setCardId] = useState(() => loadString(STORAGE_KEYS.cardId) ?? '');
  const [choices, setChoices] = useState(() => parseSavedChoices(loadString(STORAGE_KEYS.choices)));
  const [statements, setStatements] = useState<LoadedStatement[]>([]);
  const [defaultYear, setDefaultYear] = useState<number | null>(null);
  const [userRules, setUserRules] = useState<CategoryRule[]>(() =>
    parseUserRules(loadString(STORAGE_KEYS.userRules) ?? '[]'),
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [prevInput, setPrevInput] = useState('');
  const [step, setStep] = useState<StepId>('card');
  const [fixingCategories, setFixingCategories] = useState(false);

  useEffect(() => saveString(STORAGE_KEYS.cardId, cardId), [cardId]);
  useEffect(() => saveString(STORAGE_KEYS.choices, JSON.stringify(choices)), [choices]);
  useEffect(() => {
    saveString(
      STORAGE_KEYS.userRules,
      serializeUserRules(withUserRules(defaultRuleset(), userRules)),
    );
  }, [userRules]);

  // 저장된 id의 카드가 번들에서 빠졌거나 아직 고른 적이 없으면 목록의 첫 카드로 떨어진다.
  const picked = cards.find((c) => c.id === cardId) ?? cards[0];
  /*
   * 택1 선택지가 있는 카드는 여기서 하나로 좁힌 규칙만 아래로 내려보낸다. 계산 함수는 좁히지
   * 않은 규칙을 받으면 멈춘다(`assertResolved`) — 선택지가 모두 켜진 채 계산되면 할인이
   * 부푼다.
   */
  const card = useMemo(
    () => (picked === undefined ? undefined : resolveChoices(picked, choices[picked.id] ?? {})),
    [picked, choices],
  );
  const choose = (group: string, option: string) => {
    if (picked === undefined) return;
    setChoices((all) => ({ ...all, [picked.id]: { ...all[picked.id], [group]: option } }));
  };
  const ruleset = useMemo(() => withUserRules(defaultRuleset(), userRules), [userRules]);

  // 규칙이 바뀌면 원본 행렬부터 다시 읽는다. 분류는 파싱의 마지막 단계라 이 편이 가장
  // 단순하고, 화면이 들고 있는 거래와 파서 결과가 어긋날 일이 없다.
  const parsed = useMemo(
    () =>
      statements.map((statement, index) => {
        const options: ParseOptions = { ruleset, idPrefix: `f${index + 1}-` };
        if (statement.formatId !== null) options.formatId = statement.formatId;
        if (defaultYear !== null) options.defaultYear = defaultYear;
        return parseStatement(statement.rows, options);
      }),
    [statements, ruleset, defaultYear],
  );
  const merged = useMemo(() => mergeParseResults(parsed, ruleset.fallback), [parsed, ruleset]);

  const initialPrevSpending = parseAmountInput(prevInput);
  const months = useMemo(
    () =>
      card === undefined
        ? []
        : simulate(
            card,
            merged.transactions,
            initialPrevSpending === null ? {} : { initialPrevSpending },
          ),
    [card, merged.transactions, initialPrevSpending],
  );
  const summary = useMemo(
    () => (card === undefined ? null : summarize(card, months, merged.transactions)),
    [card, months, merged.transactions],
  );

  /*
   * 파일을 넣으면 결과 단계로 데려간다. 읽은 거래가 하나도 없으면 고칠 곳(명세서 단계)에
   * 그대로 둔다. 파일 수가 늘어나는 순간에만 움직인다 — 연도·포맷을 고쳐 거래가 생겼을 때
   * 따라 움직이면 연도 칸에 "2"를 치자마자 결과로 넘어가 버린다. 고친 뒤에는 사용자가 넘어간다.
   */
  const seenFiles = useRef(0);
  const txCount = merged.transactions.length;
  useEffect(() => {
    const before = seenFiles.current;
    seenFiles.current = statements.length;
    if (statements.length > before) setStep(txCount > 0 ? 'result' : 'files');
    // 파일이 늘어난 순간의 거래 수만 본다. 거래 수 변화로는 다시 돌지 않게 의존성에서 뺀다.
  }, [statements.length]);

  const addStatements = (incoming: LoadedStatement[]) => {
    const known = new Set(statements.map((s) => s.key));
    const fresh = incoming.filter((s) => !known.has(s.key));
    const skipped = incoming.length - fresh.length;
    setNotice(skipped > 0 ? `이미 올린 파일 ${skipped}개는 건너뛰었습니다.` : null);
    if (fresh.length > 0) setStatements([...statements, ...fresh]);
  };

  const assignCategory = (merchant: string, category: string) => {
    setUserRules((prev) =>
      addUserRule(withUserRules(defaultRuleset(), prev), {
        pattern: merchant,
        category,
        match: 'exact',
      }).user.slice(),
    );
  };
  const removeRule = (id: string) => {
    setUserRules((prev) => removeUserRule(withUserRules(defaultRuleset(), prev), id).user.slice());
  };

  const steps: StepDef[] = [
    {
      id: 'card',
      label: '카드 고르기',
      hint: '계산할 카드를 하나 고르세요. 구간별로 한 달에 최대 얼마까지 받을 수 있는지 먼저 봅니다.',
    },
    {
      id: 'files',
      label: '명세서 올리기',
      hint: '카드사에서 내려받은 이용대금명세서를 끌어다 놓으세요. 파일은 이 브라우저를 나가지 않습니다.',
      count: statements.length,
    },
    {
      id: 'result',
      label: '할인 결과',
      hint: '할인받은 결제가 다음 달 실적에서 빠지는 것까지 반영한, 달마다 실제로 남는 할인액입니다.',
      count: merged.uncategorized.length,
      alert: true,
    },
    {
      id: 'required',
      label: '구간 채우기',
      hint: '목표 구간을 채우려면 실제로 얼마를 써야 하는지 역산합니다. 명세서가 없어도 볼 수 있습니다.',
    },
  ];

  const index = STEP_IDS.indexOf(step);
  const go = (at: number) => {
    const id = STEP_IDS[at];
    if (id !== undefined) setStep(id);
  };

  const parsedNothing = statements.length > 0 && txCount === 0;

  /*
   * 카드가 없을 때 보여 주는 안내.
   *
   * 번들된 규칙이 하나도 없을 때만 선다 — 화면에서 카드를 들이는 길은 없으므로 사용자가
   * 할 수 있는 일도 없다. 그래도 빈 화면을 내놓지 않고 왜 비었는지 적는다.
   */
  const noCard = (
    <p className="callout danger">
      <AlertIcon />
      <span className="grow">계산할 카드가 아직 없습니다. 카드 규칙이 준비되면 목록에 뜹니다.</span>
    </p>
  );

  return (
    <div className="app">
      <a className="skip" href="#main">
        본문으로 건너뛰기
      </a>
      <AppBar />

      <main className="main" id="main">
        <Stepper steps={steps} index={index} onGo={go}>
          {step === 'card' &&
            (card === undefined ? (
              noCard
            ) : (
              <>
                <CardPicker cards={cards} card={card} onSelect={setCardId} />
                {picked?.choices !== undefined && (
                  <ChoicePicker
                    groups={picked.choices}
                    selection={choices[picked.id] ?? {}}
                    onChoose={choose}
                  />
                )}
                <CardPanel card={card} />
              </>
            ))}

          {step === 'files' && (
            <FilesPanel
              statements={statements}
              parsed={parsed}
              merged={merged}
              defaultYear={defaultYear}
              notice={notice}
              onYearChange={setDefaultYear}
              onChange={setStatements}
              onLoaded={addStatements}
              onError={setNotice}
            />
          )}

          {step === 'result' &&
            (card === undefined ? (
              noCard
            ) : (
              <>
                {parsedNothing && (
                  <p className="callout danger">
                    <AlertIcon />
                    <span className="grow">
                      올린 파일에서 거래를 하나도 읽지 못했습니다.{' '}
                      <button type="button" className="link" onClick={() => setStep('files')}>
                        2단계에서 포맷과 연도를 확인해
                      </button>{' '}
                      주세요.
                    </span>
                  </p>
                )}
                {summary !== null && summary.months > 0 && (
                  <SummaryBar
                    card={card}
                    summary={summary}
                    firstMonthAssumed={months[0]?.tierAssumed === true}
                  />
                )}
                <SimulationPanel
                  card={card}
                  months={months}
                  transactions={merged.transactions}
                  uncategorized={merged.uncategorized}
                  prevInput={prevInput}
                  onPrevInput={setPrevInput}
                  onFixCategories={() => setFixingCategories(true)}
                />
                {fixingCategories ? (
                  <CategoryPanel
                    transactions={merged.transactions}
                    uncategorized={merged.uncategorized}
                    userRules={userRules}
                    onAssign={assignCategory}
                    onRemoveRule={removeRule}
                  />
                ) : (
                  txCount > 0 && (
                    <p className="section-note">
                      가맹점이 엉뚱한 업종으로 잡혔나요?{' '}
                      <button
                        type="button"
                        className="link"
                        onClick={() => setFixingCategories(true)}
                      >
                        가맹점 분류 고치기
                      </button>
                    </p>
                  )
                )}
              </>
            ))}

          {step === 'required' &&
            (card === undefined ? (
              noCard
            ) : (
              <RequiredSpendPanel card={card} transactions={merged.transactions} />
            ))}
        </Stepper>
      </main>

      <Footer />
    </div>
  );
}
