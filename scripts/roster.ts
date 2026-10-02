/**
 * 가맹점 키워드 명부 — 부분일치가 엉뚱한 가맹점을 잡는지 감시한다.
 *
 *   npm run roster            # 픽스처를 다시 만들고 무엇이 달라졌는지 보여준다
 *
 * 왜 필요한가: `src/core/match.ts`의 가맹점명 비교는 **부분일치**다. 명세서의 가맹점명에
 * 지점명이 제각각 붙기 때문에 그래야 하지만, 짧거나 흔한 키워드를 적으면 의도하지 않은
 * 가맹점까지 잡는다. 지금까지 네 번 걸렸다.
 *
 *   "UT"(택시)      → YOUTUBE, OUTBACK, OUTLET   ("youtube"가 "ut"를 품는다)
 *   "우버"(택시)     → 우버이츠                    (배달인데 택시 할인이 붙었다)
 *   "카카오페이"      → 카카오페이지                 (웹툰인데 간편결제 할인이 붙었다)
 *   "KT"(통신)      → KTM모바일, KT스카이라이프      (알뜰폰·위성방송은 대상이 아니다)
 *
 * 전부 사람이 손으로 훑어서 찾았다. 오류가 나지 않고 할인액만 늘어나는 종류라, 새 카드가
 * 들어올 때마다 다시 훑지 않으면 놓친다. 그래서 명부를 픽스처로 못 박고 테스트가 지킨다.
 *
 * 명부는 지어낸 이름이 아니라 **모든 카드 규칙에 적힌 가맹점 키워드를 모은 것**이다. 그래서
 * 한 카드의 키워드가 다른 카드의 브랜드명에 걸리는 것까지 잡힌다 — "UT"가 그렇게 걸렸다.
 * 토스 신한 규칙 안에는 YOUTUBE가 없고, 그 이름은 다른 세 카드의 키워드였다.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchesBenefit } from '../src/core/index.js';
import { parseCardRule } from '../src/core/parseCardRule.js';
import type { Benefit, CardRule, PaymentType, Transaction, Weekday } from '../src/core/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ROSTER_FIXTURE = join(ROOT, 'fixtures', 'keyword-roster.json');

export interface RosterSnapshot {
  /** 모든 카드 규칙에서 모은 가맹점 키워드. 가나다·ASCII 순. */
  roster: string[];
  /** `cardId/benefitId` → 이 혜택이 실제로 걸리는 명부 이름들. */
  matches: Record<string, string[]>;
}

/** 번들된 카드와 골든 케이스용 가상 카드를 모두 읽는다. */
export function loadRules(): CardRule[] {
  const out: CardRule[] = [];
  for (const dir of [join(ROOT, 'fixtures', 'cards'), join(ROOT, 'fixtures', 'testcards')]) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      const parsed = parseCardRule(JSON.parse(readFileSync(join(dir, file), 'utf8')));
      if (!parsed.ok) {
        throw new Error(`${file}: ${parsed.issues.map((i) => `${i.path} ${i.message}`).join(', ')}`);
      }
      out.push(parsed.card);
    }
  }
  return out;
}

/** 2026년에 그 요일인 날짜. 요일 조건이 붙은 혜택도 가맹점 차원을 재려면 날짜를 맞춰야 한다. */
const DATE_FOR: Record<Weekday, string> = {
  thu: '2026-01-01',
  fri: '2026-01-02',
  sat: '2026-01-03',
  sun: '2026-01-04',
  mon: '2026-01-05',
  tue: '2026-01-06',
  wed: '2026-01-07',
};

const PAYMENT_TYPES: PaymentType[] = ['lump', 'installment', 'interestFreeInstallment'];

/**
 * 가맹점명 말고 다른 조건은 모두 통과하는 거래를 만든다.
 *
 * 업종·해외·요일·시간·결제유형을 혜택에 맞춰 채워 두면 매칭 결과가 **가맹점명 하나로만**
 * 갈린다. 조건을 안 맞추면 요일 혜택이 늘 안 걸려 명부가 빈 칸으로 남고, 그러면 감시가
 * 되지 않는다.
 */
function probe(benefit: Benefit, merchant: string): Transaction {
  const m = benefit.match;
  const weekday = m.weekdays?.[0];
  const tx: Transaction = {
    id: 'probe',
    date: (weekday === undefined ? undefined : DATE_FOR[weekday]) ?? '2026-01-15',
    // 건당 최소금액에 걸리지 않을 만큼 크게. 매칭은 금액을 보지 않지만 분명히 해 둔다.
    amount: 1_000_000,
    merchant,
    category: m.categories?.[0] ?? 'etc',
    paymentType: PAYMENT_TYPES.find((t) => !(m.excludePaymentTypes ?? []).includes(t)) ?? 'lump',
  };
  if (m.overseas !== undefined) tx.overseas = m.overseas;
  // `from` 포함이라 그 시가 조건을 만족한다. 자정을 넘는 구간도 마찬가지다.
  if (m.hours !== undefined) tx.time = `${String(m.hours.from).padStart(2, '0')}:00`;
  return tx;
}

export function buildRoster(cards: readonly CardRule[]): RosterSnapshot {
  const roster = [
    ...new Set(
      cards.flatMap((card) =>
        card.benefits.flatMap((b) => [
          ...(b.match.merchants ?? []),
          ...(b.match.excludeMerchants ?? []),
        ]),
      ),
    ),
  ].sort();

  const matches: Record<string, string[]> = {};
  for (const card of cards) {
    for (const b of card.benefits) {
      // 가맹점명으로 맞추지 않는 혜택은 명부와 무관하다.
      if ((b.match.merchants ?? []).length === 0) continue;
      matches[`${card.id}/${b.id}`] = roster.filter((name) => matchesBenefit(probe(b, name), b));
    }
  }
  return { roster, matches };
}

function main(): void {
  const built = buildRoster(loadRules());
  let before: RosterSnapshot | null = null;
  try {
    before = JSON.parse(readFileSync(ROSTER_FIXTURE, 'utf8')) as RosterSnapshot;
  } catch {
    before = null;
  }

  if (before === null) {
    console.log('픽스처가 없어 새로 만듭니다.');
  } else {
    const keys = [...new Set([...Object.keys(before.matches), ...Object.keys(built.matches)])].sort();
    let changed = 0;
    for (const key of keys) {
      const was = new Set(before.matches[key] ?? []);
      const now = new Set(built.matches[key] ?? []);
      const added = [...now].filter((n) => !was.has(n));
      const removed = [...was].filter((n) => !now.has(n));
      if (added.length === 0 && removed.length === 0) continue;
      changed += 1;
      console.log(`\n${key}`);
      if (added.length > 0) console.log(`  + ${added.join(', ')}`);
      if (removed.length > 0) console.log(`  - ${removed.join(', ')}`);
    }
    if (changed === 0) console.log('달라진 것이 없습니다.');
    else {
      console.log(
        `\n혜택 ${changed}개가 달라졌습니다. 늘어난 이름(+)이 그 혜택의 대상인지 하나씩 보세요.`,
      );
      console.log('대상이 아니면 규칙의 excludeMerchants로 끊고, 왜 그랬는지 sourceNote에 적으세요.');
    }
  }

  writeFileSync(ROSTER_FIXTURE, `${JSON.stringify(built, null, 2)}\n`, 'utf8');
  console.log(
    `\nfixtures/keyword-roster.json — 명부 ${built.roster.length}개, 혜택 ${Object.keys(built.matches).length}개`,
  );
}

// CLI로 직접 돌릴 때만 픽스처를 쓴다. 테스트는 buildRoster만 가져다 쓴다.
if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main();
}
