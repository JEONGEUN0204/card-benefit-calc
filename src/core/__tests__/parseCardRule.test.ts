import { describe, expect, it } from 'vitest';
import { parseCardRule } from '../parseCardRule.js';
import type { CardRule } from '../types.js';
import { benefit, card } from './helpers.js';

/** 검사 대상은 파일에서 온 값이다. 객체를 그대로 넘기면 타입이 붙어 검사를 통과해 버린다. */
function asJson(value: CardRule): unknown {
  return JSON.parse(JSON.stringify(value));
}

const VALID = card({
  id: 'sample',
  name: '샘플카드',
  issuer: '테스트은행',
  annualFee: 10_000,
  tiers: [{ min: 0 }, { min: 300_000 }],
  benefits: [
    benefit({
      id: 'cafe',
      label: '카페 10%',
      monthlyCapByTier: { '0': 0, '300000': 10_000 },
      excludeFromSpending: 'full',
    }),
  ],
});

/** 유효한 규칙에서 한 곳만 비틀어, 그 한 곳 때문에 떨어지는지 본다. */
function broken(mutate: (draft: Record<string, unknown>) => void): unknown {
  const draft = asJson(VALID) as Record<string, unknown>;
  mutate(draft);
  return draft;
}

function issuesOf(value: unknown): string[] {
  const result = parseCardRule(value);
  return result.ok ? [] : result.issues.map((issue) => issue.path);
}

describe('parseCardRule', () => {
  it('올바른 규칙을 통과시키고 값을 그대로 돌려준다', () => {
    const result = parseCardRule(asJson(VALID));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.card.id).toBe('sample');
    expect(result.card.benefits[0]?.monthlyCapByTier['300000']).toBe(10_000);
  });

  it('객체가 아니면 떨어진다', () => {
    expect(parseCardRule(null).ok).toBe(false);
    expect(parseCardRule('{}').ok).toBe(false);
    expect(parseCardRule([]).ok).toBe(false);
  });

  it('id·name·issuer가 비면 떨어진다', () => {
    expect(issuesOf(broken((d) => (d['id'] = '')))).toContain('id');
    expect(issuesOf(broken((d) => (d['name'] = '  ')))).toContain('name');
    expect(issuesOf(broken((d) => delete d['issuer']))).toContain('issuer');
  });

  /* 규칙 3 — 금액은 정수 원 단위다. 소수가 섞이면 할인액도 소수가 된다. */
  it('금액이 정수가 아니면 떨어진다', () => {
    expect(issuesOf(broken((d) => (d['annualFee'] = 10_000.5)))).toContain('annualFee');
    expect(issuesOf(broken((d) => (d['annualFee'] = -1)))).toContain('annualFee');
  });

  it('절사 방식이 정해진 셋 중 하나가 아니면 떨어진다', () => {
    expect(issuesOf(broken((d) => (d['rounding'] = 'floor100')))).toContain('rounding');
  });

  it('구간이 없거나 중복되면 떨어진다', () => {
    expect(issuesOf(broken((d) => (d['tiers'] = [])))).toContain('tiers');
    expect(issuesOf(broken((d) => (d['tiers'] = [{ min: 0 }, { min: 0 }])))).toContain('tiers');
  });

  it('혜택이 없거나 id가 겹치면 떨어진다', () => {
    expect(issuesOf(broken((d) => (d['benefits'] = [])))).toContain('benefits');

    const twins = asJson(VALID) as { benefits: unknown[] };
    twins.benefits = [...twins.benefits, ...twins.benefits];
    expect(issuesOf(twins)).toContain('benefits');
  });

  /*
   * 가장 조용히 틀리는 자리다. 엔진은 없는 구간 키를 0으로 읽으므로, 키를 빠뜨린 혜택은
   * 오류 없이 "그 구간에서는 혜택 없음"이 되어 할인액만 줄어든다.
   */
  it('혜택의 구간별 한도에 구간 키가 빠지면 떨어진다', () => {
    const missing = broken((d) => {
      d['benefits'] = [{ ...(VALID.benefits[0] as object), monthlyCapByTier: { '0': 0 } }];
    });
    expect(issuesOf(missing)).toContain('benefits[0].monthlyCapByTier');
  });

  it('혜택의 구간별 한도에 구간에 없는 키가 있으면 떨어진다', () => {
    const extra = broken((d) => {
      d['benefits'] = [
        {
          ...(VALID.benefits[0] as object),
          monthlyCapByTier: { '0': 0, '300000': 10_000, '700000': 20_000 },
        },
      ];
    });
    expect(issuesOf(extra)).toContain('benefits[0].monthlyCapByTier');
  });

  it('할인율이 0 이하이거나 1을 넘으면 떨어진다', () => {
    const rate = (r: number) =>
      broken((d) => {
        d['benefits'] = [{ ...(VALID.benefits[0] as object), discount: { type: 'rate', rate: r } }];
      });
    expect(issuesOf(rate(0))).toContain('benefits[0].discount');
    expect(issuesOf(rate(1.2))).toContain('benefits[0].discount');
    expect(parseCardRule(rate(1)).ok).toBe(true);
  });

  it('정액 할인이 정수가 아니면 떨어진다', () => {
    const amount = broken((d) => {
      d['benefits'] = [
        { ...(VALID.benefits[0] as object), discount: { type: 'amount', amount: 500.5 } },
      ];
    });
    // 어느 칸이 틀렸는지까지 짚어 준다. 경로가 `discount`에서 끊기면 사용자가 다시 찾아야 한다.
    expect(issuesOf(amount)).toContain('benefits[0].discount.amount');
  });

  it('실적 제외 방식이 정해진 셋 중 하나가 아니면 떨어진다', () => {
    const wrong = broken((d) => {
      d['benefits'] = [{ ...(VALID.benefits[0] as object), excludeFromSpending: 'half' }];
    });
    expect(issuesOf(wrong)).toContain('benefits[0].excludeFromSpending');
  });

  it('통합 한도의 구간 키가 구간과 어긋나면 떨어진다', () => {
    expect(issuesOf(broken((d) => (d['totalMonthlyCapByTier'] = { '0': 0 })))).toContain(
      'totalMonthlyCapByTier',
    );
    expect(
      parseCardRule(broken((d) => (d['totalMonthlyCapByTier'] = { '0': 0, '300000': 15_000 }))).ok,
    ).toBe(true);
  });

  it('실적 제외 항목의 종류가 정해진 셋 중 하나가 아니면 떨어진다', () => {
    const wrong = broken((d) => (d['spendingExclusions'] = [{ kind: 'mcc', values: ['1234'] }]));
    expect(issuesOf(wrong)).toContain('spendingExclusions[0].kind');
  });

  it('문제가 여러 곳이면 한 번에 모아서 돌려준다', () => {
    const paths = issuesOf(
      broken((d) => {
        d['id'] = '';
        d['annualFee'] = -1;
        d['rounding'] = 'nope';
      }),
    );
    expect(paths).toEqual(expect.arrayContaining(['id', 'annualFee', 'rounding']));
  });

  /* 겉모습은 계산에 쓰이지 않지만, 값이 이상하면 화면에서 조용히 무시되는 편이 낫지 않다. */
  it('카드 겉모습은 없어도 되고, 색은 #rrggbb 형식이어야 한다', () => {
    expect(parseCardRule(asJson(VALID)).ok).toBe(true);
    expect(parseCardRule(broken((d) => (d['art'] = { bg: '#0a2a5e', fg: '#ffffff' }))).ok).toBe(
      true,
    );
    expect(issuesOf(broken((d) => (d['art'] = { bg: 'navy' })))).toContain('art.bg');
  });
});
