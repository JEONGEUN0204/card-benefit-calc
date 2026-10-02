import { useEffect, useMemo, useState } from 'react';
import {
  allocate,
  comparePortfolios,
  resolveChoices,
  spendQuestions,
} from '../core/index.js';
import type { CardConstraint, CardRule, Won } from '../core/index.js';
import { BUILT_IN_CARDS } from './data.js';
import { questionViews } from './questions.js';
import { CardsPanel } from './panels/CardsPanel.js';
import type { CardConstraintInput } from './panels/CardsPanel.js';
import { ComparePanel } from './panels/ComparePanel.js';
import { PlanPanel } from './panels/PlanPanel.js';
import { SpendPanel } from './panels/SpendPanel.js';
import { AppBar } from './shell/AppBar.js';
import { Footer } from './shell/Footer.js';
import { Stepper } from './shell/Stepper.js';
import type { StepDef } from './shell/Stepper.js';
import { AlertIcon } from './shell/icons.js';
import {
  STORAGE_KEYS,
  clearAll,
  loadString,
  parseSavedAmounts,
  parseSavedChoices,
  parseSavedConstraints,
  parseSavedIds,
  parseSavedNumber,
  saveString,
} from './storage.js';

/*
 * 차례가 있는 네 단계. 화면에는 한 번에 하나만 선다.
 *
 * 카드를 고르고 → 항목별로 얼마까지 쓸 수 있는지 적고 → 배분 처방을 보고 → 구성끼리
 * 견준다. 앞 단계를 끝내야 다음으로 넘어가게 막지는 않는다 — 지출을 적지 않아도 카드의
 * 혜택과 구간은 볼 수 있다.
 */
const STEP_IDS = ['cards', 'spend', 'plan', 'compare'] as const;
type StepId = (typeof STEP_IDS)[number];

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
  const all = BUILT_IN_CARDS;

  const [cardIds, setCardIds] = useState<string[]>(() => {
    const saved = parseSavedIds(loadString(STORAGE_KEYS.cardIds));
    const known = saved.filter((id) => all.some((c) => c.id === id));
    // 처음 오는 사람에게 빈 화면을 주지 않는다. 첫 카드를 골라 두면 할 일이 보인다.
    return known.length > 0 ? known : all.slice(0, 1).map((c) => c.id);
  });
  const [choices, setChoices] = useState(() => parseSavedChoices(loadString(STORAGE_KEYS.choices)));
  const [budget, setBudget] = useState<Won | null>(() =>
    parseSavedNumber(loadString(STORAGE_KEYS.budget)),
  );
  const [ceilings, setCeilings] = useState<Record<string, Won>>(() =>
    parseSavedAmounts(loadString(STORAGE_KEYS.ceilings)),
  );
  const [constraints, setConstraints] = useState<Record<string, CardConstraintInput>>(() =>
    parseSavedConstraints(loadString(STORAGE_KEYS.constraints)),
  );
  const [step, setStep] = useState<StepId>('cards');

  useEffect(() => saveString(STORAGE_KEYS.cardIds, JSON.stringify(cardIds)), [cardIds]);
  useEffect(() => saveString(STORAGE_KEYS.choices, JSON.stringify(choices)), [choices]);
  useEffect(
    () => saveString(STORAGE_KEYS.budget, budget === null ? '' : String(budget)),
    [budget],
  );
  useEffect(() => saveString(STORAGE_KEYS.ceilings, JSON.stringify(ceilings)), [ceilings]);
  useEffect(
    () => saveString(STORAGE_KEYS.constraints, JSON.stringify(constraints)),
    [constraints],
  );

  /*
   * 택1 선택지가 있는 카드는 여기서 하나로 좁힌 규칙만 아래로 내려보낸다. 계산 함수는 좁히지
   * 않은 규칙을 받으면 멈춘다(`assertResolved`) — 선택지가 모두 켜진 채 계산되면 월 최대가
   * 몇 배로 부푼다.
   */
  const cards = useMemo(
    () =>
      cardIds
        .map((id) => all.find((c) => c.id === id))
        .filter((c): c is CardRule => c !== undefined)
        .map((c) => resolveChoices(c, choices[c.id] ?? {})),
    [all, cardIds, choices],
  );

  const questions = useMemo(
    () => spendQuestions(cards, budget === null ? {} : { budget }),
    [cards, budget],
  );
  const views = useMemo(() => questionViews(questions, cards), [questions, cards]);

  /** 적지 않은 항목은 0으로 본다. 보수적으로 안전하다 — 처방이 작게 나온다. */
  const byKey = useMemo(() => {
    const out: Record<string, Won> = {};
    for (const question of questions) out[question.pool] = ceilings[question.pool] ?? 0;
    return out;
  }, [questions, ceilings]);

  /** 월 예산을 적지 않으면 항목별 상한의 합으로 본다. */
  const effectiveBudget = useMemo(() => {
    if (budget !== null) return budget;
    return Object.values(byKey).reduce((sum, v) => sum + v, 0);
  }, [budget, byKey]);

  const allocateInput = useMemo(() => {
    const list: CardConstraint[] = [];
    for (const card of cards) {
      const at = constraints[card.id];
      if (at === undefined) continue;
      const one: CardConstraint = { cardId: card.id };
      if (at.min !== undefined) one.minMonthlySpend = at.min;
      if (at.max !== undefined) one.maxMonthlySpend = at.max;
      if (one.minMonthlySpend !== undefined || one.maxMonthlySpend !== undefined) list.push(one);
    }
    return {
      cards,
      ceilings: { byKey, monthlyBudget: effectiveBudget },
      ...(list.length > 0 ? { constraints: list } : {}),
    };
  }, [cards, byKey, effectiveBudget, constraints]);

  const allocation = useMemo(
    () => (cards.length === 0 ? null : allocate(allocateInput)),
    [cards.length, allocateInput],
  );

  /*
   * 구성 비교는 카드 조합마다 배분을 다시 풀어 카드 다섯 장이면 몇 초가 걸린다. 그 단계를
   * 보고 있을 때만 계산한다 — 2단계에서 금액을 한 글자 칠 때마다 돌면 입력이 끊긴다.
   */
  const portfolios = useMemo(
    () => (step === 'compare' && cards.length > 0 ? comparePortfolios(allocateInput) : []),
    [step, cards.length, allocateInput],
  );

  const toggleCard = (id: string) => {
    setCardIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const choose = (cardId: string, group: string, option: string) => {
    setChoices((prev) => ({ ...prev, [cardId]: { ...prev[cardId], [group]: option } }));
  };
  const setConstraint = (cardId: string, patch: CardConstraintInput) => {
    setConstraints((prev) => {
      const next = { ...prev };
      if (patch.min === undefined && patch.max === undefined) delete next[cardId];
      else next[cardId] = patch;
      return next;
    });
  };
  const setCeiling = (pool: string, value: Won | null) => {
    setCeilings((prev) => {
      const next = { ...prev };
      if (value === null) delete next[pool];
      else next[pool] = value;
      return next;
    });
  };
  const reset = () => {
    clearAll();
    setCardIds(all.slice(0, 1).map((c) => c.id));
    setChoices({});
    setBudget(null);
    setCeilings({});
    setConstraints({});
    setStep('cards');
  };

  const answered = Object.values(byKey).filter((v) => v > 0).length;
  const steps: StepDef[] = [
    {
      id: 'cards',
      label: '카드 고르기',
      hint: '지금 가진 카드와 새로 견줄 카드를 함께 고르세요. 세 장까지 권합니다.',
      count: cards.length,
    },
    {
      id: 'spend',
      label: '지출 적기',
      hint: '고른 카드의 혜택이 가리키는 항목마다 한 달에 얼마까지 쓸 수 있는지 적으세요.',
      count: answered,
    },
    {
      id: 'plan',
      label: '배분 처방',
      hint: '어느 카드로 무엇을 얼마씩 결제하면 가장 많이 받는지, 연회비까지 빼고 보여줍니다.',
    },
    {
      id: 'compare',
      label: '구성 비교',
      hint: '카드 조합을 바꿔 가며 한 해에 얼마가 남는지 견줍니다.',
    },
  ];

  const index = STEP_IDS.indexOf(step);
  const go = (at: number) => {
    const id = STEP_IDS[at];
    if (id !== undefined) setStep(id);
  };

  const noCard = (
    <p className="callout danger">
      <AlertIcon />
      <span className="grow">카드를 하나 이상 골라 주세요.</span>
    </p>
  );
  const noSpend = (
    <p className="callout">
      <AlertIcon />
      <span className="grow">
        2단계에서 항목별 지출 상한을 적으면 배분이 나옵니다. 적지 않은 항목은 쓰지 않는 것으로
        봅니다.
      </span>
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
          {step === 'cards' && (
            <CardsPanel
              cards={all}
              selected={cardIds}
              choices={choices}
              constraints={constraints}
              onToggle={toggleCard}
              onChoose={choose}
              onConstraint={setConstraint}
            />
          )}

          {step === 'spend' &&
            (cards.length === 0 ? (
              noCard
            ) : (
              <SpendPanel
                views={views}
                budget={budget}
                ceilings={ceilings}
                onBudget={setBudget}
                onCeiling={setCeiling}
              />
            ))}

          {step === 'plan' &&
            (cards.length === 0 ? (
              noCard
            ) : effectiveBudget === 0 ? (
              noSpend
            ) : allocation === null ? (
              noCard
            ) : (
              <PlanPanel
                cards={cards}
                allocation={allocation}
                views={views}
                ceilings={byKey}
                budget={effectiveBudget}
              />
            ))}

          {step === 'compare' &&
            (cards.length === 0 ? (
              noCard
            ) : effectiveBudget === 0 ? (
              noSpend
            ) : (
              <ComparePanel cards={cards} options={portfolios} />
            ))}
        </Stepper>
      </main>

      <Footer onReset={reset} />
    </div>
  );
}
