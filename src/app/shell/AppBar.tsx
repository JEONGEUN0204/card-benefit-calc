import { CardIcon, LockIcon } from './icons.js';

/**
 * 상단 바.
 *
 * 이름표와 개인정보 문구만 둔다. 계산할 카드는 1단계에서 고른다 — 모든 숫자를 바꾸는
 * 선택이라 화면 구석의 드롭다운보다 단계 안에서 카드를 보며 고르는 편이 낫다.
 * 개인정보 문구는 화면을 바꿔도 사라지지 않게 여기 붙인다. 결제내역을 다루는 도구에서
 * 이 약속이 가장 먼저 보여야 한다.
 */
export function AppBar() {
  return (
    <header className="appbar">
      <div className="wrap appbar-inner">
        <div className="wordmark">
          <CardIcon />
          순할인
          <span className="beta">시험판</span>
        </div>

        <p
          className="privacy-pill"
          title="명세서는 이 브라우저 안에서만 읽고 계산합니다. 어디로도 전송하지 않습니다."
        >
          <LockIcon />
          브라우저 안에서만 계산
        </p>
      </div>
    </header>
  );
}
