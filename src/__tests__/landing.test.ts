/*
 * 소개 페이지(index.html)가 인용한 숫자가 엔진 값과 같은지 본다.
 *
 * `src/app/__tests__`가 아니라 여기 둔 이유는 파일시스템을 읽기 때문이다. 화면 코드는
 * DOM만 보고 node를 보지 않으므로(`src/app/tsconfig.json`의 types에 node가 없다), 그
 * 아래에 두면 타입 검사가 막는다. 이 테스트는 화면 모듈이 아니라 **문서와 엔진이 어긋나지
 * 않는지**를 보는 것이라 `src` 바로 아래가 맞다.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  REST_POOL,
  allocate,
  attainableByTier,
  comparePortfolios,
  parseCardRule,
  peakingCurve,
  scopeGroups,
} from '../core/index.js';
import type { CardRule, SpendCeilings } from '../core/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LANDING = readFileSync(join(ROOT, 'index.html'), 'utf8');

function load(file: string): CardRule {
  const parsed = parseCardRule(
    JSON.parse(readFileSync(join(ROOT, 'fixtures', 'cards', file), 'utf8')),
  );
  if (!parsed.ok) throw new Error(parsed.issues.map((i) => `${i.path}: ${i.message}`).join(', '));
  return parsed.card;
}

const pot = load('bnk-pot.json');
const every1 = load('woori-every1.json');

/** 소개 페이지가 말하는 사용자. 쇼핑을 많이 하지 않는 달이다. */
const ceilings: SpendCeilings = {
  byKey: {
    'm:네이버시리즈': 75_000,
    'c:delivery': 50_000,
    'c:convenience': 40_000,
    'm:starbucks': 20_000,
    'm:disney': 15_000,
    'm:11번가': 0,
    'm:셀픽스': 0,
    'm:경주월드': 0,
    [REST_POOL]: 800_000,
  },
  monthlyBudget: 1_000_000,
};

/** 소개 페이지에 그 금액이 적혀 있는지. 콤마까지 같은 꼴로 적는다. */
function quoted(amount: number): boolean {
  return LANDING.includes(amount.toLocaleString('ko-KR'));
}

/*
 * 소개 페이지는 계산하지 않는다.
 *
 * 숫자를 적을 일이 있으면 엔진 출력에서 가져와 본문에 박고, 그 값이 바뀌면 이 테스트가
 * 깨져 소개 페이지도 고치라고 알린다. 이 장치가 없으면 엔진과 소개 페이지가 조용히
 * 갈라지고, 처음 오는 사람이 보는 숫자가 틀린 채로 남는다.
 */
describe('소개 페이지가 인용한 숫자', () => {
  const allocation = allocate({ cards: [pot, every1], ceilings });

  it('첫 화면의 순액 원장이 엔진 값과 같다', () => {
    expect(allocation.monthlyDiscount).toBe(31_000);
    expect(allocation.monthlyDiscount * 12).toBe(372_000);
    expect(allocation.annualFeeTotal).toBe(22_000);
    expect(allocation.annualNet).toBe(350_000);

    expect(quoted(31_000)).toBe(true);
    expect(quoted(372_000)).toBe(true);
    expect(quoted(22_000)).toBe(true);
    expect(quoted(350_000)).toBe(true);
  });

  it('배분이 최적임이 증명된다 — 소개 페이지가 그렇게 적는다', () => {
    expect(allocation.gap).toBe(0);
  });

  it('카드별 배정이 "팟 40만원 + EVERY 1 60만원"이다', () => {
    const pick = (id: string) => allocation.plans.find((p) => p.cardId === id);
    expect(pick('bnk-pot')?.monthlySpend).toBe(400_000);
    expect(pick('woori-every1')?.monthlySpend).toBe(600_000);
    expect(LANDING).toContain('팟 카드 40만원 + EVERY 1 60만원');
  });

  it('구성 비교 표의 세 숫자가 엔진 값과 같다', () => {
    const options = comparePortfolios({ cards: [pot, every1], ceilings });
    const net = (ids: string) =>
      options.find((o) => o.cardIds.join('+') === ids)?.allocation.annualNet;

    expect(net('bnk-pot+woori-every1')).toBe(350_000);
    expect(net('bnk-pot')).toBe(266_000);
    expect(net('woori-every1')).toBe(144_000);

    expect(quoted(266_000)).toBe(true);
    expect(quoted(144_000)).toBe(true);
  });

  it('명목과 달성 가능의 차이가 엔진 값과 같다', () => {
    const rows = attainableByTier(pot, scopeGroups([pot, every1]), ceilings);
    const top = rows.find((r) => r.tier.min === 800_000);
    expect(top?.nominal).toBe(40_000);
    expect(top?.attainable).toBe(23_000);

    expect(quoted(40_000)).toBe(true);
    expect(quoted(23_000)).toBe(true);
  });

  it('한계 피킹률이 엔진 값과 같다', () => {
    const curve = peakingCurve(
      every1,
      { weights: { etc: 1 }, defaultTicket: 100_000 },
      [500_000, 600_000],
    );
    const at500 = curve[0];
    const at600 = curve[1];
    expect(at500?.rate).toBeCloseTo(0.02, 10);
    expect(at600?.marginalRate).toBeCloseTo(0.01, 10);

    expect(LANDING).toContain('평균 2.00%');
    expect(LANDING).toContain('한계 1.00%');
    expect(LANDING).toContain('1.83%');
  });

  it('실적 제외 예시가 엔진 값과 같다', () => {
    const toss = load('toss-samsung.json');
    const result = allocate({
      cards: [toss],
      ceilings: {
        byKey: {
          'm:11번가': 200_000,
          'm:starbucks': 30_000,
          'm:apple.com': 20_000,
          'm:토스쇼핑': 100_000,
          'o:1': 0,
          [REST_POOL]: 650_000,
        },
        monthlyBudget: 1_000_000,
      },
    });
    const plan = result.plans.find((p) => p.cardId === 'toss-samsung');
    expect(plan?.monthlySpend).toBe(300_000);
    expect(plan?.monthlyDiscount).toBe(10_000);
    expect(plan?.excludedFromSpending).toBe(100_000);
    expect(plan?.monthlySpending).toBe(200_000);

    expect(quoted(300_000)).toBe(true);
    expect(quoted(100_000)).toBe(true);
    expect(quoted(200_000)).toBe(true);
  });

  it('실린 카드 수를 틀리게 적지 않는다', () => {
    // 전에 "세 장"이라 적힌 채로 다섯 장이 된 적이 있다.
    expect(LANDING).toContain('여섯 장');
  });

  it('더는 받지 않는 명세서 업로드를 권하지 않는다', () => {
    expect(LANDING).not.toContain('끌어다 놓');
    expect(LANDING).not.toContain('명세서 파일');
  });
});
