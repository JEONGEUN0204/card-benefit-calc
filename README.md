# 순할인

전월실적 제외까지 반영해 신용카드 혜택을 시뮬레이션하는 도구.

카드사 안내문은 "월 최대 2만원 할인"이라고만 적는다. 정작 알고 싶은 건 따로 있다.
할인받은 결제 건이 다음 달 실적에서 통째로 빠진다면, 구간을 유지하려면 얼마를 더 써야 하나?
내 실제 소비 패턴이면 결국 얼마를 받나?

이름은 여기서 왔다. 안내문의 "최대 할인"은 명목값이고, 실적에서 빠지는 대가까지 뺀 뒤
실제로 남는 금액이 **순할인**이다.

## 지금 있는 것

계산 엔진, 명세서 파서, 골든 테스트, 브라우저 화면. 약관을 읽어 숫자로 옮기는 일은 화면이
하지 않는다 — 저장소에서 `add-card-rule` 스킬이 규칙 JSON과 골든 케이스를 함께 만들어
`fixtures/cards/`에 커밋하고, 화면은 거기 실린 카드만 보여 준다. 그래서 카드를 늘리는 일은
이 저장소를 가진 사람만 할 수 있다.

| 기능 | 모듈 |
|------|------|
| 구간별 월 최대 할인 | `src/core/maxDiscount.ts` |
| 목표 구간을 채우는 데 필요한 사용액 | `src/core/requiredSpend.ts` |
| 사용내역 기반 월별 할인 예측 | `src/core/simulate.ts` |
| 카드사 명세서(CSV·엑셀) → 거래 목록 | `src/import/statement.ts` |
| 가맹점명 → 카테고리 매핑 | `src/import/category/` |
| 여러 달 명세서 합치기 (겹친 거래 제거) | `src/import/merge.ts` |
| 화면 (카드 고르기 → 명세서 → 할인 결과 → 구간 채우기) | `src/app/` |
| 홈 = 서비스 소개 (정적 HTML, 스크립트 없음) | `index.html` + `src/landing/` |

## 써보기

```bash
npm install
npm test

# 브라우저 화면 — 홈(/)은 서비스 소개, 계산기는 /app/
# 명세서를 끌어다 놓거나 가상 샘플 버튼으로 바로 볼 수 있다
npm start

# 3개월 시뮬레이션 — 2월에 혜택을 챙긴 대가로 3월에 구간이 떨어지는 장면
npm run sim -- fixtures/cases/07-three-month.json

# 구간별 월 최대 할인 (통합 한도에 잘리는 지점이 드러난다)
npm run sim -- --max fixtures/cards/toss-samsung.json

# 30만원 구간을 채우려면 실제로 얼마를 써야 하는가
npm run sim -- --required fixtures/testcards/simple-cafe.json --tier 300000

# 카드사 명세서 읽기 — 취소 거래 상쇄, 미분류 가맹점까지 같이 보여준다
npm run import -- fixtures/statements/shinhan-3months.csv

# 명세서 → 거래 목록 → 시뮬레이션으로 이어 돌리기
npm run import -- fixtures/statements/shinhan-3months.csv --card simple-cafe --out case.json
npm run sim -- case.json
```

## 설계

- **계산은 전부 코드로 한다.** LLM은 약관을 JSON 스키마로 구조화하는 데만 쓴다. LLM이 계산하면
  같은 입력에 매번 다른 숫자가 나온다.
- **결제내역은 브라우저를 벗어나지 않는다.** 계산 엔진은 순수 함수라 서버가 필요 없다.
  빌드 결과물에는 CSP `connect-src 'none'`이 들어가 페이지가 네트워크 요청 자체를 보내지 못한다.
- **기대값은 손으로 계산해 `fixtures/cases/`에 박아둔다.** 약관 해석이 틀렸는지 알려주는 건
  결국 이 골든 케이스뿐이다.
- **카드사마다 포맷 파일을 따로 둔다.** 컬럼 이름도, 취소를 적는 방식도 카드사마다 다르다.
  `src/import/formats/`에 한 장씩 선언해두고 공통 파이프라인이 그걸 읽는다.
- **소개 페이지와 앱이 색을 공유한다.** 디자인 토큰은 `src/app/tokens.css` 한 곳에 있고 두
  페이지가 같이 읽는다. 소개 페이지에 색을 복사해두면 반드시 갈라진다.
- **카테고리 매핑은 사용자가 덮어쓴다.** 기본 매핑은 반드시 틀린다. 어디에도 안 걸린
  가맹점은 `etc`로 뭉개지 않고 `uncategorized`로 남겨 고칠 지점을 드러낸다.

자세한 규칙과 작업 절차는 [CLAUDE.md](./CLAUDE.md) 참고.

## 상태

`fixtures/cards/`에는 화면에 실리는 실제 카드만 둔다. 지금은 토스 삼성카드, 카드의정석 EVERY 1,
KB국민 NEED Pay, 삼성 iD SELECT ALL, 토스 신한카드 Mr.Life 다섯 장이고, 카드사의 혜택 안내 페이지를
읽어 옮긴 것이라 상품설명서에만 있는 조건은 빠져 있을 수 있다
(규칙 JSON의 `sourceNote`에 무엇이 빠졌는지 적어 둔다). 특히 Mr.Life는 안내 페이지에 "할인받은
이용금액은 실적에서 제외" 문구가 없어 할인이 실적을 줄이지 않는 것으로 뒀는데, 필요 결제액이 크게
달라지는 자리라 상품설명서로 확인이 필요하다.

`fixtures/testcards/`의 두 장은 엔진의 경계를 좁게 검증하려고 만든 **가상 카드**다. 골든
케이스가 이 둘을 쓰고, 화면 목록에는 뜨지 않는다.
