import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { maxDiscountByTier } from '../../core/index.js';
import type { CardRule, ChoiceGroup, SpendingExclusion } from '../../core/index.js';
import {
  EXCLUSION_LABEL,
  PAYMENT_TYPE_LABEL,
  benefitTag,
  categoryLabel,
  tierName,
  unboundedNote,
  won,
} from '../labels.js';
import { searchCards } from '../cardSearch.js';
import { CardPlate } from '../shell/CardPlate.js';
import { ChevronIcon } from '../shell/icons.js';

interface PickerProps {
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

/**
 * 1단계 — 카드 고르기. 이 단계의 주역이다.
 *
 * 닫혀 있을 때는 고른 카드 이름을 적은 흰 표면 한 장이다. 이 화면에서 상자는 이것 하나뿐이고
 * 아래 한도표는 배경 위 괘선으로 서므로, 지금 할 일이 어느 칸인지가 크기가 아니라 표면으로
 * 갈린다. 누르면 검색 칸과 카드사별 목록이 그 아래 붙는다 — 카드는 계속 늘어나므로 드롭다운
 * 한 줄로 훑거나 전부 펼쳐 두는 방식은 버티지 못한다.
 *
 * 칸 위에 "계산할 카드" 라벨을 눈에 보이게 적지는 않는다. 단계 제목이 이미 "카드 고르기"라
 * 같은 말이 두 번 서기 때문이고, 보조기술에는 라벨이 그대로 남는다.
 *
 * 브라우저 기본 `<select>`를 쓰지 않는 이유는 검색이 없고, 카드사 optgroup 머리글이
 * 브라우저마다 다르게 그려져 목록이 어색했기 때문이다. 대신 WAI-ARIA combobox 모양을 따라
 * 화살표·Enter·Esc가 동작하고, 보조기술이 지금 가리키는 카드를 읽는다.
 */
export function CardPicker({ cards, card, onSelect }: PickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();

  const groups = useMemo(() => searchCards(cards, query), [cards, query]);
  const flat = groups.flatMap(([, list]) => list);

  /*
   * 칸을 채우는 두 가지 — 이 카드가 무엇인지(혜택 배지)와 얼마까지 되는지(최상위 구간의
   * 월 최대). 카드 그림이 없는 자리를 이 둘이 대신 채운다. 아래 한도표의 마지막 칸과 같은
   * 값이라 눈이 그리로 이어진다.
   */
  const tags = useMemo(
    () => card.benefits.map((benefit) => ({ id: benefit.id, text: benefitTag(benefit) })),
    [card],
  );
  const top = useMemo(() => {
    const rows = maxDiscountByTier(card);
    return rows[rows.length - 1];
  }, [card]);

  useEffect(() => {
    if (open) search.current?.focus();
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    setQuery('');
    if (refocus) trigger.current?.focus();
  };

  const choose = (id: string) => {
    onSelect(id);
    close(true);
  };

  const openList = () => {
    const all = searchCards(cards, '').flatMap(([, list]) => list);
    setActive(Math.max(0, all.findIndex((c) => c.id === card.id)));
    setOpen(true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((at) => Math.min(at + 1, flat.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((at) => Math.max(at - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = flat[active];
      if (target !== undefined) choose(target.id);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    }
  };

  let index = -1;
  const optionId = (at: number) => `${listId}-${at}`;

  return (
    <div
      className="chooser"
      ref={root}
      onBlur={(event) => {
        if (open && !root.current?.contains(event.relatedTarget as Node | null)) close(false);
      }}
    >
      <p className="chooser-label sr-only" id={`${listId}-label`}>
        계산할 카드
      </p>
      <button
        type="button"
        ref={trigger}
        className="chooser-current"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${listId}-label ${listId}-current`}
        onClick={() => (open ? close(false) : openList())}
      >
        {/*
          이름 줄만 "카드 변경"과 폭을 나눈다. 배지와 최대치는 칸 전체 폭을 쓴다 — 셋을 한
          열에 묶으면 좁은 화면에서 남는 폭이 배지 하나보다 좁아져 배지가 한 줄에 하나씩
          쌓인다.
        */}
        <span className="chooser-top">
          <CardPlate card={card} />
          {/* 보조기술이 읽는 이름은 여기까지다. 배지와 최대치까지 라벨에 넣으면 칸 하나를
              읽는 데 문장 넷이 흐른다. */}
          <span className="chooser-id" id={`${listId}-current`}>
            <span className="chooser-name">{card.name}</span>
            <span className="chooser-meta">
              {card.issuer}, 연회비 {won(card.annualFee)}
            </span>
          </span>
          <span className="chooser-change" aria-hidden="true">
            {open ? '닫기' : '카드 변경'}
            <ChevronIcon size={15} />
          </span>
        </span>
        {tags.length > 0 && (
          <span className="chooser-tags">
            {tags.map((tag) => (
              <span key={tag.id}>{tag.text}</span>
            ))}
          </span>
        )}
        {top !== undefined && top.maxDiscount > 0 && (
          <span className="chooser-max">
            <span>{tierName(top.tier)} 쓰면 한 달 최대</span>
            <strong>{won(top.maxDiscount)}</strong>
            {top.unboundedBenefits.length > 0 && (
              <span>{unboundedNote(card, top.unboundedBenefits)}</span>
            )}
          </span>
        )}
      </button>

      {open && (
        <div className="chooser-pop">
          <input
            ref={search}
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={flat[active] === undefined ? undefined : optionId(active)}
            aria-label="카드 이름이나 카드사로 찾기"
            placeholder="카드 이름이나 카드사로 찾기"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <ul className="chooser-list" id={listId} role="listbox" aria-label="카드 목록">
            {groups.map(([issuer, list]) => (
              <li key={issuer} role="presentation">
                <p className="chooser-issuer" id={`${listId}-${issuer}`}>
                  {issuer}
                </p>
                <ul role="group" aria-labelledby={`${listId}-${issuer}`}>
                  {list.map((option) => {
                    index += 1;
                    const at = index;
                    return (
                      <li
                        key={option.id}
                        id={optionId(at)}
                        role="option"
                        aria-selected={option.id === card.id}
                        className={at === active ? 'active' : undefined}
                        // 누르는 순간 검색 칸의 포커스가 빠져 목록이 닫히지 않게 한다.
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setActive(at)}
                        onClick={() => choose(option.id)}
                      >
                        {option.name}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
          {flat.length === 0 && (
            <p className="chooser-empty">“{query}”에 맞는 카드가 목록에 없습니다.</p>
          )}
        </div>
      )}
    </div>
  );
}

interface ChoiceProps {
  groups: readonly ChoiceGroup[];
  selection: Readonly<Record<string, string>>;
  onChoose: (group: string, option: string) => void;
}

/**
 * 택1 선택지. "KB Pay/네이버페이/카카오페이/토스페이 중 택1"처럼 고객이 골라 쓰는 혜택이다.
 *
 * 카드를 고른 바로 아래에 둔다 — 무엇을 골랐느냐에 따라 아래 한도표와 이후 단계의 숫자가
 * 모두 바뀌므로, 카드와 한 묶음으로 읽혀야 한다. 저장된 값이 없거나 낡았으면 첫 선택지가
 * 켜진 것으로 보인다(`resolveChoices`와 같은 규칙).
 */
export function ChoicePicker({ groups, selection, onChoose }: ChoiceProps) {
  return (
    <div className="choice">
      {groups.map((group) => {
        const current =
          group.options.find((o) => o.id === selection[group.id])?.id ?? group.options[0]?.id;
        return (
          <fieldset key={group.id}>
            <legend>
              {group.label} <span className="muted">하나를 골라 씁니다</span>
            </legend>
            <div className="choice-options">
              {group.options.map((option) => (
                <label key={option.id}>
                  <input
                    type="radio"
                    name={`choice-${group.id}`}
                    value={option.id}
                    checked={option.id === current}
                    onChange={() => onChoose(group.id, option.id)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

/**
 * 기능 1 — 구간별 월 최대 할인. 거래 없이 규칙만으로 나온다.
 *
 * 고른 카드에 딸린 설명이다. 구간마다 한 달 최대 할인을 한 줄에 세우되, 숫자 크기는 고르는
 * 칸의 카드 이름 아래에 둔다 — 전에는 이 숫자가 더 커서 고르는 칸이 표의 머리글처럼 읽혔다.
 * 공동·통합 한도에 잘린 구간은 혜택 한도를 더한 값에 줄을 긋는다 — 할인 결과의 순액 원장과
 * 같은 표기다. 혜택별 표는 그 숫자의 내역이라 아래에 두고, 모든 혜택이 0인 구간 열은 뺀다.
 */
export function CardPanel({ card }: { card: CardRule }) {
  const rows = useMemo(() => maxDiscountByTier(card), [card]);
  const hasTotalCap = card.totalMonthlyCapByTier !== undefined;
  const groups = card.capGroups ?? [];
  // 혜택 이름 옆에 어느 공동 한도에 묶였는지 적는다. 이게 없으면 혜택별 한도를 더한 값과
  // 월 최대가 달라 표가 틀린 것처럼 읽힌다.
  const groupLabelOf = new Map(groups.map((g) => [g.id, g.label]));
  const openRows = rows.filter(
    (row) => row.sumOfBenefitCaps > 0 || row.unboundedBenefits.length > 0,
  );
  const rebates = card.monthlyRebateByTier;

  return (
    <section className="panel" aria-labelledby="card-title">
      <div className="panel-head">
        <h2 id="card-title">{card.name}의 구간별 월 최대 할인</h2>
      </div>
      <p className="panel-desc">
        전월실적 구간에 따라 한 달 한도가 달라집니다. 이만큼 받으려면 해당 업종에서 실제로 그만큼
        써야 하고, 할인받은 결제는 다음 달 실적에서 빠질 수 있습니다.
      </p>

      <ol className="tier-strip">
        {rows.map((row) => {
          const capped = row.cappedByGroup || row.cappedByTotal;
          return (
            <li key={row.tier.min}>
              <span className="tier-name">{tierName(row.tier)}</span>
              <span
                className={`tier-max${row.maxDiscount === 0 && row.unboundedBenefits.length === 0 ? ' zero' : ''}`}
              >
                {won(row.maxDiscount)}
              </span>
              {/* 월 최대는 한도 없는 혜택을 뺀 몫이다. 이 줄이 없으면 거기서 끝인 것처럼 읽힌다. */}
              {row.unboundedBenefits.length > 0 && (
                <span className="tier-nominal">{unboundedNote(card, row.unboundedBenefits)}</span>
              )}
              {capped && (
                <span className="tier-nominal">
                  <s>{won(row.sumOfBenefitCaps)}</s>{' '}
                  {row.cappedByTotal ? '통합 한도' : '공동 한도'}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <h3>혜택별 한도</h3>
      <div className="table-scroll boxed">
        <table>
          <thead>
            <tr>
              <th scope="col">혜택</th>
              {openRows.map((row) => (
                <th scope="col" className="num" key={row.tier.min}>
                  {tierName(row.tier)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {card.benefits.map((benefit) => (
              <tr key={benefit.id}>
                <th scope="row" title={benefit.sourceNote}>
                  {benefit.label}
                  <span className="benefit-meta">
                    {benefit.capGroup !== undefined &&
                      `${groupLabelOf.get(benefit.capGroup)} 공동 한도, `}
                    {benefit.stackable === true && '다른 할인과 중복, '}
                    {EXCLUSION_LABEL[benefit.excludeFromSpending]}
                  </span>
                </th>
                {openRows.map((row) => {
                  // null은 한도 없음이다. `?? 0`으로 읽으면 "—"로 찍혀 혜택이 없는 것처럼 보인다.
                  const cap = row.byBenefit[benefit.id];
                  if (cap === null) {
                    return (
                      <td className="num" key={row.tier.min}>
                        한도 없음
                      </td>
                    );
                  }
                  const amount = cap ?? 0;
                  return (
                    <td className={`num${amount === 0 ? ' muted' : ''}`} key={row.tier.min}>
                      {amount === 0 ? '—' : won(amount)}
                    </td>
                  );
                })}
              </tr>
            ))}
            {/* 월정액은 거래에 붙지 않아 혜택이 아니지만, 구간별 월 최대에 들어가므로 같은 표에 선다. */}
            {rebates !== undefined && (
              <tr>
                <th scope="row">
                  전월실적별 월정액 할인
                  <span className="benefit-meta">결제와 무관하게 구간에 따라 매달</span>
                </th>
                {openRows.map((row) => (
                  <td className={`num${row.rebate === 0 ? ' muted' : ''}`} key={row.tier.min}>
                    {row.rebate === 0 ? '—' : won(row.rebate)}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
          {(groups.length > 0 || hasTotalCap) && (
            <tfoot>
              {groups.map((group) => (
                <tr key={group.id}>
                  <th scope="row">{group.label} 공동 한도</th>
                  {openRows.map((row) => (
                    <td className="num" key={row.tier.min}>
                      {won(row.byGroup[group.id] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
              {hasTotalCap && (
                <tr>
                  <th scope="row">통합 할인 한도</th>
                  {openRows.map((row) => (
                    <td className="num" key={row.tier.min}>
                      {won(card.totalMonthlyCapByTier?.[String(row.tier.min)] ?? 0)}
                    </td>
                  ))}
                </tr>
              )}
            </tfoot>
          )}
        </table>
      </div>

      {/* 절사·실적 제외·약관 근거는 숫자를 의심할 때만 본다. 접어 두고 표를 앞에 세운다. */}
      <details>
        <summary>이 카드 규칙의 세부 조건</summary>
        <dl className="facts">
          <div>
            <dt>할인액 절사</dt>
            <dd>
              {card.rounding === 'floor1'
                ? '원 단위 절사'
                : card.rounding === 'floor10'
                  ? '10원 단위 절사'
                  : '10원 단위 반올림'}
            </dd>
          </div>
          <div>
            <dt>실적에서 빠지는 결제</dt>
            <dd>{card.spendingExclusions.map(describeExclusion).join(', ') || '없음'}</dd>
          </div>
        </dl>
        {card.sourceNote !== undefined && <p className="muted">{card.sourceNote}</p>}
      </details>
    </section>
  );
}
