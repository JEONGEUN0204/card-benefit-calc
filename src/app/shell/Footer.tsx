import { version } from '../../../package.json';

interface Props {
  /** 저장한 처방 입력을 지운다. */
  onReset: () => void;
}

/**
 * 푸터.
 *
 * 상용 도구로 쓰려면 "이 숫자를 어디까지 믿어도 되는가"가 화면에 적혀 있어야 한다.
 * 계산 방식, 지금 실린 규칙의 한계, 저장하는 것과 저장하지 않는 것을 여기서 밝힌다.
 */
export function Footer({ onReset }: Props) {
  return (
    <footer className="footer">
      <div className="wrap footer-inner">
        <p>
          <strong>이 계산은 참고용입니다.</strong> 실제 청구액은 카드사의 승인 순서, 집계 기준,
          진행 중인 이벤트에 따라 달라질 수 있습니다. 카드를 고르기 전에 약관과 상품설명서를
          확인하세요.
        </p>
        <ul>
          <li>
            화면에 뜨는 금액은 모두 결제 시간순으로 한도를 소진하는 방식(FIFO)으로 계산합니다.
            실제 카드사가 승인 순서대로 한도를 쓰는 방식과 같습니다. 배분은 제안일 뿐이고,
            금액은 그 배분을 실제로 실행했을 때 받는 액수입니다.
          </li>
          <li>
            매달 같은 방식으로 쓴다고 보고 계산합니다. 지출이 들쭉날쭉한 달에는 전월실적이
            모자라 구간이 깨질 수 있습니다. 구간 문턱에 딱 맞추지 말고 여유를 두세요.
          </li>
          <li>
            카드 규칙은 카드사의 <strong>혜택 안내 페이지</strong>를 읽어 옮긴 것이고,
            상품설명서로 대조하지 않았습니다. 안내에 없던 조건은 빠져 있을 수 있으니, 금액이
            중요한 판단이라면 약관을 함께 확인하세요.
          </li>
          <li>
            아무것도 서버로 보내지 않습니다. 이 브라우저에 남는 것은 고른 카드와 적어 주신 월
            예산·항목별 지출 상한뿐입니다.{' '}
            <button type="button" className="link" onClick={onReset}>
              저장한 값 지우기
            </button>
          </li>
        </ul>
        <p className="meta">
          <span>순할인 v{version}</span>
          <span>계산 엔진은 순수 함수로 분리되어 있고 골든 케이스로 검증합니다</span>
          {/* 소개 페이지는 스크립트 없는 정적 HTML이라 앱 라우팅을 거치지 않는다. */}
          <a href="../">순할인이 무엇을 계산하나</a>
        </p>
      </div>
    </footer>
  );
}
