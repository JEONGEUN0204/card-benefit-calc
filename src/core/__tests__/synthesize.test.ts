import { describe, expect, it } from 'vitest';
import { synthesizeSlices } from '../synthesize.js';
import type { SpendSlice } from '../synthesize.js';

/**
 * 기대값은 전부 손으로 계산했다. 처방을 거래로 되돌리는 자리라 여기가 틀리면
 * FIFO 재현 검증이 엉뚱한 거래를 검증하게 되고, 할인액은 그럴듯하게 나온다.
 */
describe('synthesizeSlices', () => {
  const slice = (over: Partial<SpendSlice>): SpendSlice => ({
    key: 'k',
    category: 'online',
    merchant: '쿠팡',
    amount: 0,
    txCount: 0,
    ...over,
  });

  it('건수만큼 고르게 쪼갠다', () => {
    // 150,000 / 2건 → base = floor(75000) = 75000, 마지막 건이 남은 75,000
    const txs = synthesizeSlices([slice({ amount: 150_000, txCount: 2 })]);
    expect(txs.map((t) => t.amount)).toEqual([75_000, 75_000]);
  });

  it('나누어떨어지지 않으면 마지막 건이 나머지를 흡수한다', () => {
    // 100,000 / 3건 → base = 33,333. 앞 두 건 33,333, 마지막 100,000 − 66,666 = 33,334
    // 금액 내림차순으로 정렬되므로 33,334가 먼저 온다
    const txs = synthesizeSlices([slice({ amount: 100_000, txCount: 3 })]);
    expect(txs.map((t) => t.amount)).toEqual([33_334, 33_333, 33_333]);
    expect(txs.reduce((s, t) => s + t.amount, 0)).toBe(100_000);
  });

  it('큰 건이 먼저 온다 — 횟수 제한은 접수 순서대로 소진되므로', () => {
    const txs = synthesizeSlices([
      slice({ key: 'small', category: 'cafe', merchant: '스타벅스', amount: 20_000, txCount: 2 }),
      slice({ key: 'big', amount: 50_000, txCount: 1 }),
    ]);
    expect(txs.map((t) => t.amount)).toEqual([50_000, 10_000, 10_000]);
    expect(txs[0]?.merchant).toBe('쿠팡');
  });

  it('날짜가 금액 내림차순과 어긋나지 않는다', () => {
    const txs = synthesizeSlices([
      slice({ key: 'a', amount: 90_000, txCount: 3 }),
      slice({ key: 'b', category: 'cafe', merchant: '스타벅스', amount: 8_000, txCount: 4 }),
    ]);
    const dates = txs.map((t) => t.date);
    expect([...dates].sort()).toEqual(dates);
    // applyDiscounts가 날짜순으로 처리하므로 날짜가 단조 증가해야 큰 건 우선이 지켜진다
    const amounts = txs.map((t) => t.amount);
    expect([...amounts].sort((x, y) => y - x)).toEqual(amounts);
  });

  it('일 단위 횟수 제한이 걸리게 날짜를 흩뿌린다', () => {
    // 2건이면 28일을 반으로: floor(0*28/2)+1 = 1, floor(1*28/2)+1 = 15
    const txs = synthesizeSlices([slice({ amount: 150_000, txCount: 2 })]);
    expect(txs.map((t) => t.date)).toEqual(['2026-01-01', '2026-01-15']);
  });

  it('건당 금액이 0이 되는 건은 버리고 합계는 지킨다', () => {
    // 2원을 5건으로 → base = 0. 앞 네 건은 0원이라 버리고 마지막이 2원을 받는다
    const txs = synthesizeSlices([slice({ amount: 2, txCount: 5 })]);
    expect(txs).toHaveLength(1);
    expect(txs[0]?.amount).toBe(2);
  });

  it('금액이나 건수가 0 이하인 조각은 거래를 만들지 않는다', () => {
    expect(
      synthesizeSlices([
        slice({ amount: 0, txCount: 3 }),
        slice({ amount: 50_000, txCount: 0 }),
        slice({ amount: -1000, txCount: 1 }),
      ]),
    ).toEqual([]);
  });

  it('해외·결제유형을 거래에 옮긴다 — 혜택 매칭이 그 값으로 갈린다', () => {
    const txs = synthesizeSlices([
      slice({ amount: 30_000, txCount: 1, overseas: true, paymentType: 'installment' }),
    ]);
    expect(txs[0]?.overseas).toBe(true);
    expect(txs[0]?.paymentType).toBe('installment');
  });

  it('해외·결제유형을 안 적으면 거래에도 붙지 않는다 — 짐작으로 국내/해외를 가르지 않는다', () => {
    const txs = synthesizeSlices([slice({ amount: 30_000, txCount: 1 })]);
    expect('overseas' in (txs[0] ?? {})).toBe(false);
    expect('paymentType' in (txs[0] ?? {})).toBe(false);
  });

  it('거래 id가 유일하다 — applyDiscounts가 id로 장부를 만든다', () => {
    const txs = synthesizeSlices([
      slice({ key: 'a', amount: 90_000, txCount: 3 }),
      slice({ key: 'b', amount: 90_000, txCount: 3 }),
    ]);
    expect(new Set(txs.map((t) => t.id)).size).toBe(txs.length);
  });
});
