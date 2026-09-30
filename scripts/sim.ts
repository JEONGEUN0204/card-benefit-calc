/**
 * 계산 결과를 눈으로 대조하기 위한 CLI.
 *
 * 테스트는 "기대값과 같은가"만 답한다. 새 카드 규칙을 넣었을 때 숫자가 말이 되는지는
 * 사람이 봐야 알 수 있어서, 월별 흐름을 표로 펼쳐 보여준다.
 *
 *   npm run sim -- fixtures/cases/07-three-month.json
 *   npm run sim -- --max fixtures/cards/toss-samsung.json
 *   npm run sim -- --required fixtures/testcards/simple-cafe.json --tier 300000
 *   npm run sim -- --max fixtures/cards/kb-need-pay.json --choice pay=naver
 *
 * 택1 선택지가 있는 카드는 `--choice 그룹=선택지`로 고른다. `--max`에서 고르지 않으면 선택지마다
 * 한 번씩 펼치고, 나머지 모드에서는 첫 선택지를 쓴다. 골든 케이스는 `choices` 필드로 고른다.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveChoices } from '../src/core/choice.js';
import type { ChoiceSelection } from '../src/core/choice.js';
import { maxDiscountByTier } from '../src/core/maxDiscount.js';
import { requiredSpendFor } from '../src/core/requiredSpend.js';
import { simulate } from '../src/core/simulate.js';
import type { CardRule, DiscountReason, Transaction, Won } from '../src/core/types.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const REASON_LABEL: Record<DiscountReason, string> = {
  ok: '할인',
  noMatch: '해당 혜택 없음',
  belowMin: '건당 최소금액 미달',
  benefitCapReached: '혜택 월 한도 소진',
  groupCapReached: '묶인 혜택의 공동 한도 소진',
  totalCapReached: '통합 한도 소진',
  countLimit: '횟수 제한 초과',
  roundedToZero: '절사되어 0원',
  tierLocked: '실적 구간 미달',
};

const CAPPED_LABEL: Record<string, string> = {
  benefit: '혜택 한도',
  group: '공동 한도',
  total: '통합 한도',
  perTransaction: '건당 한도',
};

const won = (n: Won): string => `${n.toLocaleString('ko-KR')}원`;
const pad = (s: string, width: number): string =>
  s + ' '.repeat(Math.max(0, width - [...s].reduce((w, c) => w + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0)));

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), 'utf8')) as T;
}

/** 화면에 실리는 카드와 골든 전용 가상 카드를 함께 뒤진다. 골든 케이스는 둘 다 쓴다. */
function loadCardById(id: string): CardRule {
  const dirs = [join(ROOT, 'fixtures', 'cards'), join(ROOT, 'fixtures', 'testcards')];
  for (const dir of dirs) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const rule = readJson<CardRule>(join(dir, file));
      if (rule.id === id) return rule;
    }
  }
  throw new Error(`fixtures/cards·testcards 에서 카드를 찾지 못했다: ${id}`);
}

function printSimulation(card: CardRule, transactions: Transaction[], initialPrevSpending?: Won): void {
  console.log(`\n=== ${card.name} (${card.issuer}) ===`);
  const months = simulate(
    card,
    transactions,
    initialPrevSpending === undefined ? {} : { initialPrevSpending },
  );

  for (const m of months) {
    const tierText = m.tier === null ? '구간 없음' : (m.tier.label ?? won(m.tier.min));
    const prevText = m.prevSpending === null ? '알 수 없음(가정)' : won(m.prevSpending);
    console.log(`\n[${m.month}] 전월실적 ${prevText} → 구간: ${tierText}${m.tierAssumed ? ' (가정)' : ''}`);

    for (const t of m.transactions) {
      const tx = transactions.find((x) => x.id === t.txId);
      const capped = t.cappedBy === undefined ? '' : ` (${CAPPED_LABEL[t.cappedBy]}에 잘림)`;
      const stacked = (t.stacked ?? []).map((s) => ` (중복 ${s.benefitId} ${won(s.discount)} 포함)`).join('');
      const detail = t.discount > 0 ? `${won(t.discount)} 할인${capped}${stacked}` : REASON_LABEL[t.reason];
      console.log(
        `  ${pad(t.txId, 12)} ${pad(tx?.merchant ?? '', 16)} ${pad(won(tx?.amount ?? 0), 12)}` +
          ` → ${pad(detail, 28)} 실적 ${won(t.countedSpending)}`,
      );
    }

    if (m.rebate > 0) console.log(`  ─ 월정액 할인 ${won(m.rebate)} (구간에 붙는 몫)`);
    console.log(`  ─ 할인 합계 ${won(m.totalDiscount)} / 이 달 실적 ${won(m.countedSpending)}`);
    if (Object.keys(m.capUsage).length > 0) {
      const usage = Object.entries(m.capUsage).map(([id, v]) => `${id} ${won(v)}`).join(', ');
      console.log(`  ─ 한도 소진: ${usage}`);
    }
  }

  const total = months.reduce((a, m) => a + m.totalDiscount, 0);
  console.log(`\n총 할인 ${won(total)} / 연회비 ${won(card.annualFee)}`);
}

function printMaxDiscount(card: CardRule): void {
  console.log(`\n=== ${card.name} — 구간별 월 최대 할인 ===\n`);
  const groupOf = new Map(
    card.benefits.filter((b) => b.capGroup !== undefined).map((b) => [b.id, b.capGroup as string]),
  );

  for (const row of maxDiscountByTier(card)) {
    const label = row.tier.label ?? `${won(row.tier.min)} 이상`;
    // 혜택 한도의 단순 합과 실제 상한이 왜 다른지 한 줄로 밝힌다. 이 줄이 없으면 아래
    // 혜택별 숫자를 더한 값과 맞지 않아 표가 틀린 것처럼 보인다.
    const cut: string[] = [];
    if (row.cappedByGroup) cut.push('공동 한도');
    if (row.cappedByTotal) cut.push('통합 한도');
    const note =
      cut.length === 0
        ? ''
        : ` ← 혜택 한도 합 ${won(row.sumOfBenefitCaps)}이지만 ${cut.join('·')}에 잘림`;
    // 한도 없는 혜택이 있으면 최대치는 그 혜택을 뺀 몫이다. 뒤에 붙여 끝이 열려 있다고 밝힌다.
    const open = row.unboundedBenefits.length === 0 ? '' : ` + 한도 없음(${row.unboundedBenefits.join(', ')})`;
    console.log(`  ${pad(label, 14)} 최대 ${pad(won(row.maxDiscount), 12)}${open}${note}`);

    for (const [id, cap] of Object.entries(row.byBenefit)) {
      const group = groupOf.get(id);
      const tag = group === undefined ? '' : `  (${group} 공동)`;
      if (cap === null) console.log(`      · ${pad(id, 20)} ${pad('한도 없음', 10)}${tag}`);
      else if (cap > 0) console.log(`      · ${pad(id, 20)} ${pad(won(cap), 10)}${tag}`);
    }
    if (row.rebate > 0) console.log(`      + ${pad('월정액 할인', 20)} ${won(row.rebate)}`);
    for (const [id, cap] of Object.entries(row.byGroup)) {
      if (cap > 0) console.log(`      = ${pad(`${id} 공동 한도`, 20)} ${won(cap)}`);
    }
  }
}

function printRequiredSpend(card: CardRule, targetMin: Won): void {
  const tier = card.tiers.find((t) => t.min === targetMin);
  if (tier === undefined) throw new Error(`이 카드에 없는 구간이다: ${targetMin}`);

  // 사용내역이 없을 때 쓰는 대략적인 소비 패턴. 실제로는 3개월 내역에서 뽑아낸다.
  const pattern = {
    weights: { cafe: 1, convenience: 1, mart: 3, transport: 1, delivery: 1, etc: 3 },
    defaultTicket: 15_000,
    ticketSize: { cafe: 5_000, convenience: 6_000, transport: 1_500 },
  };
  const got = requiredSpendFor(card, tier, pattern);

  console.log(`\n=== ${card.name} — ${tier.label ?? won(tier.min)} 구간을 채우려면 ===\n`);
  if (got.requiredTotalSpend === null) {
    console.log('  이 소비 패턴으로는 목표 실적에 도달할 수 없다.');
    return;
  }
  console.log(`  필요 결제액   ${won(got.requiredTotalSpend)}`);
  console.log(`  그때의 실적   ${won(got.resultingSpending)} (목표 ${won(tier.min)})`);
  console.log(`  실적 제외액   ${won(got.excludedAmount)}`);
  console.log(`  받는 할인     ${won(got.expectedDiscount)}`);
  console.log('  카테고리별 결제액:');
  for (const [category, amount] of Object.entries(got.breakdown)) {
    console.log(`      · ${pad(category, 14)} ${won(amount)}`);
  }
}

/** `--choice pay=naver`를 여러 번 받을 수 있다. */
function choiceArgs(args: readonly string[]): ChoiceSelection {
  const selection: ChoiceSelection = {};
  args.forEach((arg, i) => {
    if (arg !== '--choice') return;
    const [group, option] = (args[i + 1] ?? '').split('=');
    if (group !== undefined && option !== undefined) selection[group] = option;
  });
  return selection;
}

/** 고르지 않은 그룹마다 선택지를 하나씩 펼친 조합. 선택지가 없는 카드는 규칙 하나다. */
function expand(card: CardRule, fixed: ChoiceSelection): { label: string; rule: CardRule }[] {
  let combos: ChoiceSelection[] = [{ ...fixed }];
  for (const group of card.choices ?? []) {
    if (fixed[group.id] !== undefined) continue;
    combos = combos.flatMap((c) => group.options.map((o) => ({ ...c, [group.id]: o.id })));
  }
  return combos.map((selection) => ({
    label: Object.entries(selection).map(([g, o]) => `${g}=${o}`).join(', '),
    rule: resolveChoices(card, selection),
  }));
}

function main(): void {
  const args = process.argv.slice(2);
  const target = args.find(
    (a) => !a.startsWith('--') && !['--tier', '--choice'].includes(args[args.indexOf(a) - 1] ?? ''),
  );
  const selection = choiceArgs(args);

  if (target === undefined) {
    console.error('사용법: npm run sim -- <case.json | --max card.json | --required card.json --tier N>');
    process.exit(1);
  }

  if (args.includes('--max')) {
    for (const { label, rule } of expand(readJson<CardRule>(target), selection)) {
      if (label !== '') console.log(`
--- 선택: ${label}`);
      printMaxDiscount(rule);
    }
    return;
  }

  if (args.includes('--required')) {
    const tierArg = args[args.indexOf('--tier') + 1];
    printRequiredSpend(resolveChoices(readJson<CardRule>(target), selection), Number(tierArg ?? 0));
    return;
  }

  const testCase = readJson<{
    card: string;
    transactions: Transaction[];
    initialPrevSpending?: Won;
    choices?: ChoiceSelection;
  }>(target);
  const card = resolveChoices(loadCardById(testCase.card), { ...testCase.choices, ...selection });
  printSimulation(card, testCase.transactions, testCase.initialPrevSpending);
}

main();
