/**
 * 배분 처방을 CSV 문자열로 만든다.
 *
 * 순수 문자열 함수다. 파일로 떨어뜨리는 일은 `download.ts`가 하고, 그것도 이 브라우저
 * 안에서 끝난다 — 어디로도 올리지 않는다 (CLAUDE.md 규칙 2).
 *
 * 처방은 매달 들고 다니며 "이번 결제는 어느 카드로"를 보는 표다. 그래서 카드별 합계가
 * 아니라 **항목 한 줄에 한 줄**로 적고, 건수와 건당 금액까지 넣는다 — 횟수 제한이 걸린
 * 혜택은 "얼마를 쓰나"만큼 "몇 번에 나눠 쓰나"가 중요하기 때문이다.
 *
 * 금액은 콤마 없는 정수로 적는다. `100,000`이라고 적으면 표 계산기가 문자열로 읽어
 * 합계를 못 낸다.
 */
import type { Allocation, CardRule, Won } from '../core/index.js';

const HEADER = ['카드', '항목', '월 금액', '건수', '건당 금액', '비고'];

/** 쉼표·인용부호·줄바꿈이 있으면 감싸고, 안의 인용부호는 겹친다 (RFC 4180). */
function cell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export interface PlanCsvOptions {
  /** 지출 풀 키 → 화면에 적은 이름. 없으면 키를 그대로 쓴다. */
  labels?: ReadonlyMap<string, string>;
  /** 할인이 붙지 않고 구간만 여는 풀의 키. 비고에 적어 둔다. */
  restPool?: string;
}

export function planCsv(
  cards: readonly CardRule[],
  allocation: Allocation,
  options: PlanCsvOptions = {},
): string {
  const name = (id: string): string => cards.find((c) => c.id === id)?.name ?? id;
  const label = (pool: string): string => options.labels?.get(pool) ?? pool;
  const rows: string[] = [HEADER.join(',')];

  for (const plan of allocation.plans) {
    if (!plan.used) {
      rows.push([name(plan.cardId), '쓰지 않음', 0, 0, 0, '연회비를 내고 얻을 것이 없다'].map(cell).join(','));
      continue;
    }

    const assigned = Object.entries(plan.byKey)
      .filter(([, at]) => at.amount > 0)
      .sort((a, b) => b[1].amount - a[1].amount);

    for (const [pool, at] of assigned) {
      rows.push(
        [
          name(plan.cardId),
          label(pool),
          at.amount,
          at.txCount,
          // 건당 금액은 할인액이 아니라 예산을 쪼갠 값이라 절사 규칙 밖이다(규칙 3).
          Math.floor(at.amount / at.txCount),
          pool === options.restPool ? '할인 없음, 구간을 여는 돈' : '',
        ]
          .map(cell)
          .join(','),
      );
    }

    const note =
      plan.excludedFromSpending > 0
        ? `할인받은 ${plan.excludedFromSpending}원이 실적에서 빠져 실적은 ${plan.monthlySpending}원`
        : '할인받은 결제도 실적에 남는다';
    rows.push(
      [
        name(plan.cardId),
        `합계 (${plan.tier?.label ?? '구간 없음'})`,
        plan.monthlySpend,
        '',
        '',
        `월 혜택 ${plan.monthlyDiscount}원 · ${note}`,
      ]
        .map(cell)
        .join(','),
    );
  }

  rows.push(
    ['전체', '월 혜택', allocation.monthlyDiscount, '', '', ''].map(cell).join(','),
    ['전체', '연 혜택', allocation.monthlyDiscount * 12, '', '', ''].map(cell).join(','),
    ['전체', '연회비', allocation.annualFeeTotal, '', '', '쓰는 카드만'].map(cell).join(','),
    [
      '전체',
      '연 순이익',
      allocation.annualNet,
      '',
      '',
      allocation.gap === 0 ? '이보다 나은 배분은 없다' : `이론 상한과 ${allocation.gap}원 차이`,
    ]
      .map(cell)
      .join(','),
  );

  return rows.join('\r\n');
}

/** 파일 이름. 카드 이름을 넣으면 내려받은 뒤에도 어느 구성인지 알 수 있다. */
export function planFilename(cards: readonly CardRule[], allocation: Allocation): string {
  const used = allocation.plans.filter((p) => p.used).map((p) => cards.find((c) => c.id === p.cardId)?.name ?? p.cardId);
  const who = used.length === 0 ? '배분' : used.join('+');
  const amount: Won = allocation.monthlyDiscount;
  return `순할인 처방 ${who} 월${amount}원.csv`;
}
