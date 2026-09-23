# card-benefit-calc

전월실적 제외까지 반영해 신용카드 혜택을 시뮬레이션하는 도구.

카드사 안내문은 "월 최대 2만원 할인"이라고만 적는다. 정작 알고 싶은 건 따로 있다.
할인받은 결제 건이 다음 달 실적에서 통째로 빠진다면, 구간을 유지하려면 얼마를 더 써야 하나?
내 실제 소비 패턴이면 결국 얼마를 받나?

## 지금 있는 것

계산 엔진, 명세서 파서, 골든 테스트. UI와 약관 PDF 파싱은 아직 없다.

| 기능 | 모듈 |
|------|------|
| 구간별 월 최대 할인 | `src/core/maxDiscount.ts` |
| 목표 구간을 채우는 데 필요한 사용액 | `src/core/requiredSpend.ts` |
| 사용내역 기반 월별 할인 예측 | `src/core/simulate.ts` |
| 카드사 명세서(CSV·엑셀) → 거래 목록 | `src/import/statement.ts` |
| 가맹점명 → 카테고리 매핑 | `src/import/category/` |

## 써보기

```bash
npm install
npm test

# 3개월 시뮬레이션 — 2월에 혜택을 챙긴 대가로 3월에 구간이 떨어지는 장면
npm run sim -- fixtures/cases/07-three-month.json

# 구간별 월 최대 할인 (통합 한도에 잘리는 지점이 드러난다)
npm run sim -- --max fixtures/cards/complex-integrated.json

# 30만원 구간을 채우려면 실제로 얼마를 써야 하는가
npm run sim -- --required fixtures/cards/simple-cafe.json --tier 300000

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
- **기대값은 손으로 계산해 `fixtures/cases/`에 박아둔다.** 약관 해석이 틀렸는지 알려주는 건
  결국 이 골든 케이스뿐이다.
- **카드사마다 포맷 파일을 따로 둔다.** 컬럼 이름도, 취소를 적는 방식도 카드사마다 다르다.
  `src/import/formats/`에 한 장씩 선언해두고 공통 파이프라인이 그걸 읽는다.
- **카테고리 매핑은 사용자가 덮어쓴다.** 기본 매핑은 반드시 틀린다. 어디에도 안 걸린
  가맹점은 `etc`로 뭉개지 않고 `uncategorized`로 남겨 고칠 지점을 드러낸다.

자세한 규칙과 작업 절차는 [CLAUDE.md](./CLAUDE.md) 참고.

## 상태

`fixtures/cards/`의 두 카드는 실제 상품 구조를 본뜬 **가상 카드**다. 실제 약관을 확보하면
교체한다.
