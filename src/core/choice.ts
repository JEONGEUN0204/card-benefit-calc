import type { CardRule } from './types.js';

/** 선택지 그룹 id → 고른 선택지 id. */
export type ChoiceSelection = Record<string, string>;

/**
 * 택1 선택지를 골라 혜택을 하나로 좁힌다.
 *
 * 고르지 않은 선택지의 혜택을 걸러 내고 `choices`를 지운 규칙을 돌려준다. 계산 함수는
 * `choices`가 남은 규칙을 받지 않으므로(`assertResolved`), 선택지가 있는 카드는 반드시
 * 여기를 거친다. 고르지 않은 그룹과 없는 선택지는 첫 선택지로 본다 — 화면이 저장해 둔
 * 값이 규칙 개정으로 낡았을 때도 계산은 이어져야 한다.
 */
export function resolveChoices(rule: CardRule, selection: ChoiceSelection): CardRule {
  if (rule.choices === undefined) return rule;

  const picked = new Map<string, string>();
  for (const group of rule.choices) {
    const wanted = selection[group.id];
    const option = group.options.find((o) => o.id === wanted) ?? group.options[0];
    if (option !== undefined) picked.set(group.id, option.id);
  }

  const { choices: _dropped, ...rest } = rule;
  return {
    ...rest,
    benefits: rule.benefits.filter(
      (b) => b.choice === undefined || picked.get(b.choice.group) === b.choice.option,
    ),
  };
}

/**
 * 선택지를 고르지 않은 규칙이면 멈춘다.
 *
 * 그대로 계산하면 택1 혜택이 모두 켜져 할인이 부풀고, 오류 없이 그럴듯한 숫자가 나온다.
 * 이 도구에서 가장 나쁜 실패라서 조용히 넘기지 않는다.
 */
export function assertResolved(rule: CardRule): void {
  if (rule.choices !== undefined) {
    throw new Error(
      `${rule.name}: 선택지(${rule.choices.map((c) => c.label).join(', ')})를 고르지 않은 규칙입니다. resolveChoices를 먼저 거칩니다.`,
    );
  }
}
