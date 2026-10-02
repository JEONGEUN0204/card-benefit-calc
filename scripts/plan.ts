/**
 * 배분 처방을 눈으로 대조하기 위한 CLI.
 *
 * 테스트는 "기대값과 같은가"만 답한다. 배분이 말이 되는지는 사람이 봐야 알 수 있어서,
 * 카드별로 어느 항목에 얼마를 몇 건 쓰는지 표로 펼쳐 보여준다.
 *
 *   npm run plan -- --card bnk-pot --card woori-every1
 *       지출 항목(풀)이 무엇인지 먼저 보여준다. 상한을 적지 않으면 여기서 끝난다.
 *
 *   npm run plan -- --card bnk-pot --card woori-every1 --budget 1000000 \
 *     --pool m:네이버시리즈=75000 --pool c:delivery=50000 --pool c:convenience=40000 \
 *     --pool m:starbucks=20000 --pool m:disney=15000 --pool rest=800000
 *
 *   --min woori-every1=100000   적금 우대 조건처럼 반드시 써야 하는 월 최소 결제액
 *   --max bnk-pot=400000        이 카드에 몰아줄 수 있는 월 최대
 *   --choice pay=naverpay       택1 선택지가 있는 카드에서 고른 값
 *
 * 금액은 모두 `applyDiscounts` + `calcSpending`을 거친 값이다(불변규칙 4). 최적화기는
 * 배분안만 제안한다.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allocate } from '../src/core/allocate.js';
import { resolveChoices } from '../src/core/choice.js';
import { REST_POOL, scopeGroups, spendPools } from '../src/core/scope.js';
import type { CardConstraint } from '../src/core/allocate.js';
import type { ChoiceSelection } from '../src/core/choice.js';
import type { CardRule, Won } from '../src/core/types.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const won = (n: Won): string => `${n.toLocaleString('ko-KR')}원`;
/** 한글은 두 칸을 먹으므로 폭을 글자 폭으로 센다. */
const pad = (s: string, width: number): string =>
  s +
  ' '.repeat(
    Math.max(
      0,
      width - [...s].reduce((w, c) => w + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0),
    ),
  );

function loadCardById(id: string): CardRule {
  for (const dir of [join(ROOT, 'fixtures', 'cards'), join(ROOT, 'fixtures', 'testcards')]) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const rule = JSON.parse(readFileSync(resolve(join(dir, file)), 'utf8')) as CardRule;
      if (rule.id === id) return rule;
    }
  }
  throw new Error(`fixtures/cards·testcards 에서 카드를 찾지 못했다: ${id}`);
}

interface Args {
  cardIds: string[];
  choices: ChoiceSelection;
  budget: Won | null;
  pools: Record<string, Won>;
  constraints: CardConstraint[];
}

function parseArgs(argv: readonly string[]): Args {
  const out: Args = { cardIds: [], choices: {}, budget: null, pools: {}, constraints: [] };
  const upsert = (cardId: string): CardConstraint => {
    const seen = out.constraints.find((c) => c.cardId === cardId);
    if (seen !== undefined) return seen;
    const fresh: CardConstraint = { cardId };
    out.constraints.push(fresh);
    return fresh;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--card' && value !== undefined) {
      out.cardIds.push(value);
      i += 1;
    } else if (flag === '--budget' && value !== undefined) {
      out.budget = Number(value.replace(/[^0-9]/g, ''));
      i += 1;
    } else if (flag === '--pool' && value !== undefined) {
      const at = value.lastIndexOf('=');
      if (at < 0) throw new Error(`--pool 은 키=금액 형식이다: ${value}`);
      out.pools[value.slice(0, at)] = Number(value.slice(at + 1).replace(/[^0-9]/g, ''));
      i += 1;
    } else if ((flag === '--min' || flag === '--max') && value !== undefined) {
      const at = value.lastIndexOf('=');
      if (at < 0) throw new Error(`${flag} 은 카드id=금액 형식이다: ${value}`);
      const amount = Number(value.slice(at + 1).replace(/[^0-9]/g, ''));
      const target = upsert(value.slice(0, at));
      if (flag === '--min') target.minMonthlySpend = amount;
      else target.maxMonthlySpend = amount;
      i += 1;
    } else if (flag === '--choice' && value !== undefined) {
      const [group, option] = value.split('=');
      if (group === undefined || option === undefined) {
        throw new Error(`--choice 은 그룹=선택지 형식이다: ${value}`);
      }
      out.choices[group] = option;
      i += 1;
    } else {
      throw new Error(`알 수 없는 인자: ${flag}`);
    }
  }
  return out;
}

function describePool(key: string, groups: ReturnType<typeof scopeGroups>): string {
  if (key === REST_POOL) return '나머지 결제 (위 항목에 없는 평범한 지출)';
  const group = groups.find((g) => g.key === key);
  if (group === undefined) return key;
  const parts: string[] = [];
  if (group.categories.length > 0) parts.push(`업종 ${group.categories.join('·')}`);
  if (group.merchants.length > 0) {
    const head = group.merchants.slice(0, 4).join('·');
    parts.push(`가맹점 ${head}${group.merchants.length > 4 ? ` 외 ${group.merchants.length - 4}곳` : ''}`);
  }
  if (group.overseas) parts.push('해외 결제');
  const who = group.members.map((m) => `${m.cardId}/${m.benefitId}`).join(', ');
  return `${parts.join(' + ')}  [${who}]`;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.cardIds.length === 0) {
    console.error('카드를 하나 이상 고르세요: --card <id>');
    process.exit(1);
  }

  const cards = args.cardIds.map((id) => resolveChoices(loadCardById(id), args.choices));
  const groups = scopeGroups(cards);
  const pools = spendPools(groups);

  console.log(`\n=== 고른 카드 ${cards.length}장 ===`);
  for (const card of cards) {
    console.log(`  ${pad(card.name, 24)} ${card.issuer}, 연회비 ${won(card.annualFee)}`);
  }

  console.log(`\n=== 지출 항목 ${pools.length}개 ===`);
  for (const key of pools) {
    const given = args.pools[key];
    const mark = given === undefined ? '(상한 없음 → 0으로 봄)' : won(given);
    console.log(`  ${pad(key, 20)} ${pad(mark, 16)} ${describePool(key, groups)}`);
  }

  if (Object.keys(args.pools).length === 0) {
    console.log('\n--pool 키=금액 으로 항목별 월 상한을 적으면 배분을 계산합니다.');
    console.log('예: --pool rest=800000 --pool c:delivery=50000 --budget 1000000');
    return;
  }

  const ceilings = {
    byKey: args.pools,
    monthlyBudget:
      args.budget ?? Object.values(args.pools).reduce((sum, v) => sum + v, 0),
  };

  const result = allocate({
    cards,
    ceilings,
    ...(args.constraints.length > 0 ? { constraints: args.constraints } : {}),
  });

  console.log(`\n=== 배분 처방 (월 예산 ${won(ceilings.monthlyBudget)}) ===`);
  for (const plan of result.plans) {
    const card = cards.find((c) => c.id === plan.cardId);
    if (card === undefined) continue;
    if (!plan.used) {
      console.log(`\n  ${card.name} — 쓰지 않는다 (연회비를 내고 얻을 것이 없다)`);
      continue;
    }
    console.log(
      `\n  ${card.name} — ${won(plan.monthlySpend)} / 구간 ${plan.tier?.label ?? plan.tier?.min ?? '없음'}` +
        `${plan.oscillates ? ' ← 달마다 구간이 왕복한다' : ''}`,
    );
    for (const key of pools) {
      const at = plan.byKey[key];
      if (at === undefined || at.amount <= 0) continue;
      const each = Math.floor(at.amount / at.txCount);
      console.log(
        `      ${pad(key, 20)} ${pad(won(at.amount), 14)} ${at.txCount}건 × 약 ${won(each)}`,
      );
    }
    console.log(`      ─ 월 혜택 ${won(plan.monthlyDiscount)} / 이 달 실적 ${won(plan.monthlySpending)}`);
    if (plan.excludedFromSpending > 0) {
      /*
       * "순할인"이 말하는 뺄셈. 할인받은 결제가 실적에서 빠지면 같은 구간을 지키는 데
       * 더 많은 돈이 든다. 카드마다 다르므로 한 줄로 적어 둔다.
       */
      console.log(
        `      ─ 할인받은 결제 ${won(plan.excludedFromSpending)}이 실적에서 빠졌다 — ` +
          `${won(plan.monthlySpend)}을 써서 실적은 ${won(plan.monthlySpending)}이다`,
      );
    }
  }

  console.log(`\n=== 합계 ===`);
  console.log(`  월 혜택        ${won(result.monthlyDiscount)}`);
  console.log(`  연 혜택        ${won(result.monthlyDiscount * 12)}`);
  console.log(`  연회비         ${won(result.annualFeeTotal)}`);
  console.log(`  연 순이익      ${won(result.annualNet)}`);
  if (result.leftover > 0) console.log(`  남은 예산      ${won(result.leftover)}`);
  console.log(
    `  이론 상한      ${won(result.upperBound)}` +
      (result.gap === 0 ? '  ← 이보다 나은 배분은 없다' : `  (차이 ${won(result.gap)})`),
  );

  if (result.warnings.length > 0) {
    console.log(`\n=== 알림 ===`);
    for (const w of result.warnings) {
      console.log(`  ${w.cardId === undefined ? '' : `[${w.cardId}] `}${w.message}`);
    }
  }
}

main();
