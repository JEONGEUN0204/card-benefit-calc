import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

export interface StepDef {
  id: string;
  /** 단계 제목. 이 단계에서 하는 일을 그대로 적는다. */
  label: string;
  /** 제목 밑 한 줄. "무엇을 하면 되는지"를 말한다. */
  hint: string;
  /** 배지 숫자. 0이면 달지 않는다. */
  count?: number;
  /** 배지를 "확인 필요" 색으로 칠할지. */
  alert?: boolean;
}

interface Props {
  steps: readonly StepDef[];
  /** 지금 보고 있는 단계의 자리(0부터). */
  index: number;
  onGo: (index: number) => void;
  children: ReactNode;
}

/**
 * 단계 하나만 보여 주는 마법사 셸.
 *
 * 화면에 한 번에 한 단계만 둔다. 모든 단계의 이름을 늘어놓으면 지금 무엇을 해야 하는지가
 * 이름 여섯 개 사이에 묻히기 때문에, 제목은 지금 단계 하나만 크게 적고 나머지는 점으로만
 * 남긴다. 점은 누를 수 있어서 이미 지나온 자리로는 곧장 돌아갈 수 있다.
 *
 * 앞 단계를 끝내야 다음으로 넘어가게 막지는 않는다 — 명세서 없이도 구간별 한도표와 구간
 * 계산기는 볼 수 있다. 그래서 다음 버튼은 잠기지 않고, 마지막 단계에서만 사라진다.
 */
export function Stepper({ steps, index, onGo, children }: Props) {
  /*
   * 단계가 바뀌면 맨 위로 올린다. 한 화면에 한 단계만 서기 때문에, 앞 단계에서 내려온
   * 스크롤을 그대로 두면 새 단계의 제목과 할 일이 화면 위로 벗어난 채 나타난다.
   * 첫 렌더에서는 건드리지 않는다 — 들어오자마자 화면을 움직일 이유가 없다.
   */
  const shown = useRef(index);
  useEffect(() => {
    if (shown.current === index) return;
    shown.current = index;
    window.scrollTo({ top: 0 });
  }, [index]);

  const step = steps[index];
  if (step === undefined) return null;

  const prev = index > 0 ? steps[index - 1] : undefined;
  const next = index + 1 < steps.length ? steps[index + 1] : undefined;

  return (
    <>
      <div className="stepbar">
        <div className="wrap">
          <p className="step-count">
            {index + 1} / {steps.length} 단계
          </p>
          <ol className="step-dots">
            {steps.map((dot, at) => (
              <li key={dot.id}>
                <button
                  type="button"
                  className={at === index ? 'on' : at < index ? 'done' : ''}
                  aria-current={at === index ? 'step' : undefined}
                  aria-label={`${at + 1}단계 ${dot.label}`}
                  onClick={() => onGo(at)}
                />
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="wrap steppanel">
        <div className="step-head">
          <h1>
            {step.label}
            {step.count !== undefined && step.count > 0 && (
              <span className={`count${step.alert === true ? ' alert' : ''}`}>{step.count}</span>
            )}
          </h1>
          <p className="lede">{step.hint}</p>
        </div>

        <div className="stepbody">{children}</div>

        <nav className="step-nav" aria-label="단계 이동">
          {prev !== undefined && (
            <button type="button" onClick={() => onGo(index - 1)}>
              이전: {prev.label}
            </button>
          )}
          {next !== undefined && (
            <button type="button" className="primary" onClick={() => onGo(index + 1)}>
              다음: {next.label}
            </button>
          )}
        </nav>
      </div>
    </>
  );
}
