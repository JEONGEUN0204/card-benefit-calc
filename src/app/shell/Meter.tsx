import type { Won } from '../../core/index.js';

interface Props {
  value: Won;
  /** 상한. 0이면 그릴 것이 없다. */
  max: Won;
  /** 막대 아래에 붙는 설명. 값을 읽는 것은 이 글자이고 막대는 장식이다. */
  caption?: string;
  /** 표 칸에 넣는 한 줄 형태. */
  inline?: boolean;
}

/**
 * 한도 대비 얼마를 썼는지 보여주는 미터.
 *
 * 막대는 `aria-hidden`이고, 값은 옆·아래의 글자와 같은 행의 숫자 칸이 읽어 준다. 색은
 * 한 가지 색조(--mark)이고 트랙은 같은 색조의 옅은 단계다. 기준선(왼쪽)은 각지게,
 * 데이터 끝만 둥글게 둔다.
 */
export function Meter({ value, max, caption, inline = false }: Props) {
  if (max <= 0) return inline ? <span className="muted">—</span> : null;

  // 금액이 아니라 비율이다. 할인액 절사 규칙(CLAUDE.md 규칙 3)의 대상이 아니고,
  // 계산에 되먹이지 않고 화면에만 쓴다.
  const ratio = Math.min(1, value / max);
  const percent = `${(ratio * 100).toFixed(0)}%`;

  if (inline) {
    return (
      <div className="meter meter-inline">
        <div className="meter-track" aria-hidden="true">
          <div className="meter-fill" style={{ width: percent }} />
        </div>
        <span className="meter-pct">{percent}</span>
      </div>
    );
  }

  return (
    <div className="meter">
      <div className="meter-track" aria-hidden="true">
        <div className="meter-fill" style={{ width: percent }} />
      </div>
      {caption !== undefined && <p className="meter-caption">{caption}</p>}
    </div>
  );
}
