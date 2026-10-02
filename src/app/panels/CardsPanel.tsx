import { useMemo, useState } from 'react';
import { maxDiscountByTier, resolveChoices } from '../../core/index.js';
import type { CardRule, Won } from '../../core/index.js';
import { formatAmountInput, parseAmountInput } from '../amount.js';
import { searchCards } from '../cardSearch.js';
import { benefitTag, tierName, unboundedNote, won } from '../labels.js';
import { CardPlate } from '../shell/CardPlate.js';
import { AlertIcon } from '../shell/icons.js';

/** 이 수를 넘으면 질문이 열여덟 개까지 늘고 구성 비교가 몇 초씩 걸린다. */
const COMFORTABLE_CARDS = 3;

export interface CardConstraintInput {
  min?: Won;
  max?: Won;
}

interface Props {
  cards: readonly CardRule[];
  /** 고른 카드 id. 순서를 지킨다. */
  selected: readonly string[];
  /** 카드 id → (선택지 그룹 id → 고른 선택지 id). */
  choices: Readonly<Record<string, Record<string, string>>>;
  constraints: Readonly<Record<string, CardConstraintInput>>;
  onToggle: (id: string) => void;
  onChoose: (cardId: string, group: string, option: string) => void;
  onConstraint: (cardId: string, patch: CardConstraintInput) => void;
}

/**
 * 1단계 — 가진 카드와 견줄 카드를 고른다.
 *
 * 단일 선택 드롭다운이 아니라 발급사별 체크박스 목록이다. 여러 장을 고르는 일에는 열고
 * 닫는 칸이 맞지 않고(고른 것을 보면서 더 고르게 된다), 카드가 여섯 장이라 다 펼쳐도
 * 길지 않다. 거르기·묶기는 `searchCards`가 그대로 해 준다.
 */
export function CardsPanel({
  cards,
  selected,
  choices,
  constraints,
  onToggle,
  onChoose,
  onConstraint,
}: Props) {
  const [query, setQuery] = useState('');
  const groups = useMemo(() => searchCards(cards, query), [cards, query]);
  const picked = selected
    .map((id) => cards.find((c) => c.id === id))
    .filter((c): c is CardRule => c !== undefined);

  return (
    <>
      <section className="panel" aria-labelledby="cards-list">
        <div className="panel-head">
          <h2 id="cards-list">고를 수 있는 카드</h2>
          <p className="panel-desc">
            지금 가진 카드와 새로 견줄 카드를 함께 고르세요. 목록에 있는 것이 전부입니다 — 카드
            규칙은 저장소에 커밋된 것만 씁니다.
          </p>
        </div>

        <div className="field">
          <label htmlFor="card-query">카드 찾기</label>
          <input
            id="card-query"
            type="search"
            value={query}
            placeholder="카드 이름이나 카드사"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {groups.length === 0 && <p className="chooser-empty">찾는 카드가 없습니다.</p>}

        {groups.map(([issuer, list]) => (
          <div key={issuer} className="pick-group">
            <p className="chooser-issuer">{issuer}</p>
            <ul className="pick-list">
              {list.map((card) => {
                const on = selected.includes(card.id);
                return (
                  <li key={card.id}>
                    <label className={on ? 'pick on' : 'pick'}>
                      <input type="checkbox" checked={on} onChange={() => onToggle(card.id)} />
                      <span className="pick-name">{card.name}</span>
                      <span className="pick-fee">연회비 {won(card.annualFee)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>

      {selected.length > COMFORTABLE_CARDS && (
        <p className="callout">
          <AlertIcon />
          <span className="grow">
            카드가 {selected.length}장이면 물어볼 지출 항목이 많아지고 구성 비교가 몇 초씩
            걸립니다. {COMFORTABLE_CARDS}장까지 고르는 것을 권합니다.
          </span>
        </p>
      )}

      {picked.length === 0 ? (
        <p className="empty">카드를 하나 이상 고르면 여기에 혜택과 구간이 뜹니다.</p>
      ) : (
        picked.map((card) => (
          <PickedCard
            key={card.id}
            card={card}
            choices={choices[card.id] ?? {}}
            constraint={constraints[card.id] ?? {}}
            onChoose={(group, option) => onChoose(card.id, group, option)}
            onConstraint={(patch) => onConstraint(card.id, patch)}
          />
        ))
      )}
    </>
  );
}

interface PickedProps {
  card: CardRule;
  choices: Readonly<Record<string, string>>;
  constraint: CardConstraintInput;
  onChoose: (group: string, option: string) => void;
  onConstraint: (patch: CardConstraintInput) => void;
}

function PickedCard({ card, choices, constraint, onChoose, onConstraint }: PickedProps) {
  /*
   * 택1을 좁힌 규칙으로 혜택을 보여 준다. 좁히지 않은 규칙을 계산 함수에 넘기면
   * `assertResolved`가 멈춘다 — 선택지가 모두 켜진 채 계산되면 월 최대가 몇 배로 부풀기
   * 때문이다. 라디오는 원본 규칙에만 있는 `choices`를 읽어야 하므로 둘 다 들고 있는다.
   */
  const resolved = useMemo(() => resolveChoices(card, choices), [card, choices]);

  /*
   * 카드를 알아보게 하는 두 가지 — 혜택 배지와 최상위 구간의 월 최대. 카드 그림이 없는
   * 자리를 이 둘이 채운다. 이 숫자는 명목이라 실제로 받는 액수와 다르다. 내 소비로
   * 얼마가 차는지는 3단계가 답한다.
   */
  const top = useMemo(() => {
    const rows = maxDiscountByTier(resolved);
    return rows[rows.length - 1];
  }, [resolved]);
  const tags = useMemo(() => resolved.benefits.map((b) => benefitTag(b)), [resolved]);

  return (
    <section className="panel picked" aria-labelledby={`picked-${card.id}`}>
      <div className="panel-head">
        <h2 id={`picked-${card.id}`}>{card.name}</h2>
        <p className="panel-desc">
          {card.issuer}, 연회비 {won(card.annualFee)}
        </p>
      </div>

      <CardPlate card={card} />

      <ul className="chooser-tags">
        {tags.map((text, at) => (
          <li key={`${card.id}-tag-${at}`} className="tag">
            {text}
          </li>
        ))}
      </ul>

      {top !== undefined && (
        <p className="chooser-max">
          {tierName(top.tier)} 쓰면 안내문 기준 한 달 최대 {won(top.maxDiscount)}
          {top.unboundedBenefits.length > 0 && (
            <> {unboundedNote(resolved, top.unboundedBenefits)}</>
          )}
        </p>
      )}

      {card.choices !== undefined &&
        card.choices.map((group) => (
          <fieldset key={group.id} className="choice">
            <legend>{group.label}</legend>
            <div className="choice-options">
              {group.options.map((option) => (
                <label key={option.id}>
                  <input
                    type="radio"
                    name={`${card.id}-${group.id}`}
                    checked={(choices[group.id] ?? group.options[0]?.id) === option.id}
                    onChange={() => onChoose(group.id, option.id)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}

      {/*
        카드 약관이 아니라 이 사용자의 사정이다. 적금 우대 조건처럼 카드 혜택과 무관한
        이유로 반드시 써야 하는 돈이 있으면 배분이 그것을 지켜야 한다.
      */}
      <div className="controls">
        <div className="field">
          <label htmlFor={`min-${card.id}`}>이 카드로 꼭 써야 하는 월 최소</label>
          <input
            id={`min-${card.id}`}
            type="text"
            inputMode="numeric"
            placeholder="예: 적금 우대 조건 100,000"
            value={formatAmountInput(constraint.min)}
            onChange={(e) => {
              const value = parseAmountInput(e.target.value);
              const next: CardConstraintInput = {};
              if (constraint.max !== undefined) next.max = constraint.max;
              if (value !== null) next.min = value;
              onConstraint(next);
            }}
          />
        </div>
        <div className="field">
          <label htmlFor={`max-${card.id}`}>이 카드에 몰아줄 월 최대</label>
          <input
            id={`max-${card.id}`}
            type="text"
            inputMode="numeric"
            placeholder="비우면 제한 없음"
            value={formatAmountInput(constraint.max)}
            onChange={(e) => {
              const value = parseAmountInput(e.target.value);
              const next: CardConstraintInput = {};
              if (constraint.min !== undefined) next.min = constraint.min;
              if (value !== null) next.max = value;
              onConstraint(next);
            }}
          />
        </div>
      </div>
    </section>
  );
}
