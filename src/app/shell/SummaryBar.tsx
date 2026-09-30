import type { CardRule, Won } from '../../core/index.js';
import { won } from '../labels.js';
import type { BenefitSummary } from '../summary.js';
import { CardPlate } from './CardPlate.js';

interface Props {
  card: CardRule;
  summary: BenefitSummary;
  /** 첫 달 전월실적을 몰라 가장 낮은 구간으로 셌는지. 그 몫이 "구간이 낮아 잃은 몫"에 섞인다. */
  firstMonthAssumed: boolean;
}

/** 0.0143 → "1.43%". 비율이라 원 단위 절사 규칙과 무관하다. */
function percent(ratio: number): string {
  return `${(ratio * 100).toFixed(2)}%`;
}

/** 빼는 값. 하이픈이 아니라 빼기 기호(U+2212)라 숫자 폭과 맞는다. */
const minus = (n: Won): string => (n === 0 ? won(0) : `−${won(n)}`);

/**
 * 할인 결과 단계의 첫머리 — 순액 원장.
 *
 * 카드사 안내문의 "월 최대"에서 시작해 빠지는 몫을 한 줄씩 빼고, 남은 순할인을 맨 아래에
 * 가장 크게 적는다. 이 뺄셈이 서비스 이름(순할인)이 말하는 것이고, 화면에서 힘을 싣는
 * 곳은 여기 한 군데다. 세 줄은 `summarize`가 낸 값이라 언제나 정확히 순할인으로 떨어진다.
 *
 * 월평균·연회비·할인율은 순할인을 읽는 데 필요한 맥락이라 옆에 작게 둔다. 연환산은 월평균이
 * 계속된다는 가정이므로 그렇게 적는다.
 */
export function SummaryBar({ card, summary, firstMonthAssumed }: Props) {
  const lostSome = summary.totalDiscount < summary.advertisedCeiling;
  const period =
    summary.firstMonth === null || summary.lastMonth === null
      ? ''
      : summary.firstMonth === summary.lastMonth
        ? `${summary.firstMonth} 한 달`
        : `${summary.firstMonth}부터 ${summary.lastMonth}까지`;

  return (
    <section className="net" aria-label="순할인 요약">
      <div className="net-for">
        <CardPlate card={card} />
        <p>
          <strong>{card.name}</strong>
          <span className="muted">
            {period}, 결제 {summary.txCount}건
          </span>
        </p>
      </div>

      <dl className="net-ledger">
        <div className="net-row">
          <dt>안내문대로라면 {summary.months}개월 최대</dt>
          <dd className={lostSome ? 'nominal' : undefined}>{won(summary.advertisedCeiling)}</dd>
        </div>
        <div className={`net-row loss${summary.tierShortfall === 0 ? ' zero' : ''}`}>
          <dt>
            구간이 낮아 잃은 몫
            <small>
              전월실적이 모자란 달. 할인받은 결제가 실적에서 빠진 탓도 여기 들어갑니다.
              {firstMonthAssumed &&
                ' 첫 달은 전월실적을 몰라 가장 낮은 구간으로 셌습니다. 아래에 입력하면 줄어듭니다.'}
            </small>
          </dt>
          <dd>{minus(summary.tierShortfall)}</dd>
        </div>
        <div className={`net-row loss${summary.unusedCap === 0 ? ' zero' : ''}`}>
          <dt>
            열린 한도를 다 못 쓴 몫
            <small>혜택 업종 결제가 한도만큼 없었던 달.</small>
          </dt>
          <dd>{minus(summary.unusedCap)}</dd>
        </div>
        <div className="net-row result">
          <dt>순할인</dt>
          <dd>{won(summary.totalDiscount)}</dd>
        </div>
      </dl>

      <dl className="net-facts">
        <div>
          <dt>월평균</dt>
          <dd>{won(summary.monthlyAverage)}</dd>
        </div>
        <div>
          <dt>1년 이어지면, 연회비 {won(card.annualFee)} 빼고</dt>
          <dd className={summary.annualNet < 0 ? 'loss' : undefined}>
            {summary.annualNet < 0 ? minus(-summary.annualNet) : won(summary.annualNet)}
          </dd>
        </div>
        <div>
          <dt>결제 {won(summary.totalSpend)} 대비</dt>
          <dd>{percent(summary.discountRate)}</dd>
        </div>
      </dl>
    </section>
  );
}
