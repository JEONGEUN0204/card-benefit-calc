# 순할인 (sunhalin)

전월실적 제외까지 반영해 신용카드 혜택을 시뮬레이션하는 도구. 이름은 명목 "최대 할인"이
아니라, 실적에서 빠지는 대가까지 뺀 뒤 실제로 남는 금액을 뜻한다. 카드사 안내문이
알려주지 않는 세 가지에 답한다.

1. 전월실적 구간별로 이 카드에서 한 달에 최대 얼마를 할인받을 수 있는가
2. 할인받은 건이 실적에서 빠지는 걸 감안하면, 목표 구간을 채우는 데 실제로 얼마를 써야 하는가
3. 내 3개월 사용내역이라면 실제로 얼마를 할인받는가

## 불변 규칙

이 일곱 가지는 기능을 추가할 때도 유지한다.

1. **LLM은 약관을 JSON으로 구조화하는 데만 쓴다.** 할인·실적 계산은 전부 `src/core/`의 순수
   함수로 한다. LLM이 계산까지 하면 같은 입력에 매번 다른 숫자가 나와 신뢰를 잃는다.
2. **결제내역은 서버로 보내지 않는다.** 파싱·계산·저장을 전부 브라우저에서 한다. 네트워크
   호출을 추가할 때는 payload에 거래 데이터가 섞이지 않는지 확인한다.
3. **금액은 정수 원 단위 `number`다.** 정률 할인이 만든 소수는 `src/core/rounding.ts`의
   `roundDiscount`를 즉시 거쳐 정수로 되돌린다. 이 모듈 밖에서 **할인액**에 `Math.floor`나
   `Math.round`를 직접 쓰지 않는다. 가상 거래의 예산을 쪼개는 것처럼 할인이 아닌 계산은
   예외이고, 그 자리에 왜 예외인지 한 줄 남긴다.
4. **할인 배정은 거래 시간순(FIFO)이 기본이다.** 실제 카드사가 승인 순서대로 한도를 소진한다.
   "어떻게 쓰면 최대로 받나"는 성격이 다른 문제이므로 기본 경로에 섞지 않는다.
5. **`src/core/`는 DOM·파일시스템·네트워크에 의존하지 않는다.** UI가 어떤 프레임워크로 가든
   계산 엔진은 그대로 남는다.
6. **테스트를 먼저 쓴다.** 계산 로직을 추가할 때는 기대값을 담은 테스트를 작성해 실패를
   확인한 뒤 구현한다. 할인 계산은 틀려도 그럴듯한 숫자가 나와 조용히 틀리기 때문에,
   구현을 보고 나서 쓴 테스트는 구현의 버그를 그대로 옮겨 적는다.
7. **규칙 JSON을 바꾸면 골든 케이스를 함께 갱신한다.** 테스트가 결과에 맞춰 바뀌기 시작하면
   골든 픽스처는 앵커 역할을 잃는다.

## 구조

```
src/core/             계산 엔진 (순수 함수)
src/import/           명세서 파서 + 가맹점 카테고리 매핑
index.html            홈. 서비스 소개 페이지이고 스크립트가 없다
app/index.html        계산기 진입점. 여기부터 React 앱(`/app/`)이다
src/app/              브라우저 화면 (React + Vite). 계산은 core·import 함수만 부른다
  shell/              앱 셸 — 상단 바, 단계 진행(`Stepper`), 순액 원장, 카드 플레이트,
                      미터, 푸터
  panels/             단계 하나에 패널 하나. 카드 고르기·명세서·할인 결과·구간 채우기와,
                      단계 안에서 여는 가맹점 분류
  tokens.css          색·모서리 토큰. 소개 페이지와 앱이 함께 읽는 단일 출처
src/landing/          소개 페이지 스타일
fixtures/cards/       화면에 실리는 카드 규칙 JSON. 여기 있는 것만 카드 목록에 뜬다
fixtures/cards/images/ 카드 이미지(선택). 규칙의 `art.image`가 파일 이름으로 가리킨다
fixtures/testcards/   골든 케이스 전용 가상 카드. 목록에 뜨지 않고 검사는 똑같이 받는다
fixtures/cases/       손으로 계산한 기대값을 담은 골든 케이스
fixtures/statements/  카드사별 샘플 명세서
scripts/sim.ts        결과를 눈으로 대조하는 CLI
scripts/import.ts     명세서를 거래 목록으로 옮기는 CLI
```

계산 흐름: 전월실적 → `selectTier` → `applyDiscounts`(건별 할인 + 한도 차감) →
`calcSpending`(실적 제외 반영) → 다음 달 구간. `simulate`가 이 고리를 월별로 돌린다.

**한도는 세 층으로 겹친다.** 혜택별 한도(`monthlyCapByTier`) → 혜택 여럿이 나눠 쓰는 공동
한도(`capGroups` + `Benefit.capGroup`) → 카드 전체 통합 한도(`totalMonthlyCapByTier`).
가운데 층이 필요한 이유는 할인율이 다른 혜택이 한 한도를 쓰는 카드가 있기 때문이다 — 토스
삼성카드의 "토스페이 15%"와 "온라인 10%"가 하나의 통합 월 할인한도를 나눠 쓴다. 혜택마다
같은 한도를 따로 주면 월 최대가 두 배로 부풀고, 오류 없이 그럴듯한 숫자가 나온다. 세 층
모두 좁은 쪽부터 겹쳐 적용하므로 `cappedBy`에는 실제로 잘라낸 한도가 남는다.

혜택별 한도 자리의 `null`은 **한도 없음**이다(키가 없으면 여전히 0). 큰 수로 대신하면 구간별
최대 할인표에 그 수가 그대로 뜨기 때문에 따로 적는다. `maxDiscountByTier`는 그 혜택을 뺀 몫만
`maxDiscount`에 담고 `unboundedBenefits`로 알리며, 화면은 "+ 1% 한도 없음"을 붙인다. 순액
원장에서는 그 몫의 상한을 **실제로 받은 만큼**으로 봐서(`summary.ts`의 `monthCeiling`) 뺄셈이
그대로 맞는다. 거래에 붙지 않고 구간에 붙는 월정액 할인(`monthlyRebateByTier`)은 세 층 밖이다 —
어느 한도에도 잡히지 않고 실적도 건드리지 않으며, `MonthResult.rebate`로 따로 남긴 뒤
`totalDiscount`에 더한다.

**택1 선택지는 계산 전에 하나로 좁힌다.** "KB Pay/네이버페이/카카오페이/토스페이 중 택1"처럼
고객이 고르는 혜택은 `CardRule.choices` + `Benefit.choice`로 적고, `resolveChoices`(`src/core/choice.ts`)가
고르지 않은 혜택을 걸러 낸다. 선택지가 남은 규칙을 계산 함수에 넘기면 `assertResolved`가 멈춘다 —
모두 켜진 채 계산되면 월 최대가 몇 배로 부푸는데 오류는 나지 않기 때문이다. 화면은 카드별로 고른
선택지를 저장하고(`storage.ts`), 좁힌 규칙만 패널에 내려보낸다. 골든 케이스는 `choices` 필드로,
`sim`은 `--choice 그룹=선택지`로 고른다.

**중복 적용**(`Benefit.stackable`)은 "간편결제 할인과 중복 적용 가능" 같은 혜택이다. 한 거래에는
일반 혜택 하나가 붙고 중복 혜택은 그 위에 각자 붙어, 한도는 혜택마다 따로 깎인다. 일반 혜택을 먼저
장부에 적으므로 공동·통합 한도는 일반 혜택이 먼저 가져간다. `TxResult.discount`는 합계이고 겹친 몫은
`stacked`에 남는다. 실적 제외는 붙은 혜택 중 가장 엄한 쪽을 따른다.

가져오기 흐름: 파일 → 문자열 행렬(`parseCsv` / `readWorkbookRows`) → 포맷 감지 → 컬럼
매핑 → 행별 정규화 → 취소 상쇄 → 시간순 정렬 → 카테고리 → `Transaction[]`.

`src/import/`도 파일을 직접 읽지 않는다. 행렬을 받는 순수 함수라 파일 읽기는 호출자
(브라우저 File API, `scripts/import.ts`)의 몫이고, 규칙 2가 이 경계 위에 서 있다.
화면(`src/app/`)만 DOM 타입을 본다. 루트 tsconfig는 `src/app`을 빼고 DOM lib 없이 돌기 때문에
`src/core`·`src/import`가 브라우저 API에 기대면 `npm run typecheck`가 잡는다(규칙 5). 규칙 2는
빌드 CSP(`vite.config.ts`의 `connect-src 'none'`)가 한 번 더 막는다. 화면이 저장하는 것은
사용자 카테고리 규칙, 고른 카드, 카드별로 고른 택1 선택지뿐이고 거래 내역은 저장하지 않는다.
결과 CSV 내려받기도 Blob으로 이 탭 안에서 만든다.

**카드를 늘리는 일은 저장소에서만 한다.** 화면에는 카드를 들이는 길이 없고, 고를 수 있는
카드는 `fixtures/cards/`에 커밋된 규칙뿐이다(`src/app/data.ts`가 glob으로 번들한다). 약관 →
규칙 JSON → 골든 케이스는 `add-card-rule` 스킬이 저장소에서 한 번 거친다. 브라우저에 그 길을
두지 않는 이유는 둘이다. 약관 해석을 브라우저에서 하면 바깥으로 요청을 보내야 해서 규칙 1·2가
함께 깨지고(CSP `connect-src 'none'`이 어차피 막는다), 스킬을 돌릴 수 없는 사람에게 **끝까지 갈
수 없는 길**을 보여 주게 된다 — 요청문을 복사해 줘도 스킬이 없으면 규칙 JSON이 돌아오지 않고,
돌아온다 해도 골든 케이스로 검증되지 않은 규칙이 검증된 카드와 같은 표에 나란히 선다. 그래서
"목록에 없는 카드를 넣어 달라"는 접수 칸도 두지 않는다. CSP가 `form-action 'none'`·
`connect-src 'none'`이라 화면이 보낼 수 있는 곳이 애초에 없다.

번들된 규칙에는 `parseCardRule`(`src/core/`) 검사를 골든 테스트로 건다 — 가장 잘 숨는 실수인
`monthlyCapByTier`의 구간 키 누락은 엔진이 0으로 읽어 오류 없이 할인액만 줄이기 때문이다.
카드 이미지는 번들된 파일만 쓴다. CSP가
`img-src 'self' data:`라 카드사 서버의 URL은 어차피 뜨지 않는다. 파일이 없으면 카드 그림을
아예 그리지 않는다 — 색으로 지은 카드 모양은 실제 카드와 닮지 않아 알아보는 데 돕지 못하고,
카드가 늘면 목록을 덮는다. `art.bg`/`fg`는 스키마에 남아 있지만 지금 화면은 읽지 않는다.

홈(`index.html`)은 계산하지 않는다. 숫자를 적을 일이 있으면 `npm run sim` 출력에서 가져와
본문에 박고, 어느 픽스처에서 나온 값인지 함께 적는다. 소개 페이지가 직접 다시 계산하면
화면과 갈라진다. 색도 `src/app/tokens.css`만 읽는다. 인라인 `<style>`·`style` 속성은 쓸 수
없다 — 빌드 CSP가 `style-src 'self'`라서 적용되지 않는다. 계산기로 가는 링크는 상대 경로 `app/`이고(앱 푸터의 홈 링크는 `../`),
이 경로를 바꾸면 소개 페이지의 버튼 네 개를 함께 고친다. 절대 경로 `/app/`으로 되돌리면
GitHub Pages(`/card-benefit-calc/` 아래)에서 404가 난다.

**배포**는 `.github/workflows/deploy.yml`이 맡는다. `main`에 푸시하면 테스트·타입 검사를
통과한 빌드만 GitHub Pages(https://jeongeun0204.github.io/card-benefit-calc/)에 올라간다.
하위 경로는 `BASE_PATH` 환경변수로 `vite.config.ts`의 `base`에 넘긴다.

**디자인을 고칠 때는 빌드 CSP가 먼저다.** `frontend-design`·`web-design-guidelines`·
`make-interfaces-feel-better`·`emil-design-eng`·`mobile-native`·`ui-ux-pro-max` 같은 외부 디자인
스킬(사용자 전역)은 이 제약을 모르고, 제안이 dev 서버에서는 멀쩡하다가 빌드본에서만 조용히 깨진다. HTML에 적은 `style="…"`
속성과 `<style>` 태그를 끼워 넣는 런타임 CSS-in-JS(styled-components·emotion)는
`style-src 'self'`에 막힌다. React의 `style` prop은 CSSOM으로 값을 넣어 통과하므로 미터 폭이나
카드 색처럼 데이터에서 나오는 값에만 쓴다. 글꼴은 파일을
`src/app/fonts/`에 넣어 함께 실어야 하고(`font-src 'self'`, Google Fonts·CDN 불가), 이미지는
번들 파일이나 `data:`만 뜬다. 색·모서리·그림자는 `src/app/tokens.css`에서만 정한다 — Tailwind
테마처럼 색을 따로 정의하는 도구를 들이면 출처가 둘로 갈라진다. 바꾼 뒤에는 dev 서버가 아니라
`npm run build && npm run preview`로 확인한다.

외부 디자인 스킬이 자주 내놓는 제안 중 **이 저장소에서 쓸 수 없는 것**: Tailwind 유틸리티
클래스(`focus-visible:ring-*` 같은 제안은 CSS로 옮겨 적는다), `<link>`로 부르는 Google Fonts,
CDN 스크립트, 인라인 `<style>`. 반대로 그대로 받아도 되는 것: capability 미디어 쿼리
(`(hover: hover)`·`(pointer: coarse)`), `env(safe-area-inset-*)`, `dvh`, `touch-action`,
ARIA 속성 — 전부 CSS·HTML 표준이라 CSP와 무관하다.

**화면에는 한 번에 한 단계만 선다**(`src/app/shell/Stepper.tsx`). 단계 이름을 모두 늘어놓으면
지금 할 일이 이름들 사이에 묻히기 때문에, 위에는 점만 남기고 이름은 본문 제목으로 한 번만
크게 적는다. 단계는 `App.tsx`의 `STEP_IDS` 하나가 순서를 쥔다 — 카드 고르기 → 명세서 →
할인 결과 → 구간 채우기. 앞 단계를 끝내야 다음으로 넘어가게 막지는 않는다(명세서 없이도
한도표와 구간 계산기는 볼 수 있다). 차례가 없는 일 — 가맹점 분류 고치기 — 은 단계로 세지
않고 필요한 단계 안에서 연다. 단계를 늘리려면 `STEP_IDS`와 `steps`
배열을 함께 고치고, 그 일이 정말 **모두가 지나는 차례**인지 먼저 따진다.

`src/app/summary.ts`는 `simulate` 결과를 더하는 집계만 한다. 월평균처럼 할인액을 나눠야
하는 자리는 `roundDiscount`를 거치므로 화면 코드에도 `Math.floor`/`Math.round`가 없다(규칙 3).

카드사를 추가할 때는 `src/import/formats/`에 포맷 파일을 하나 더 만들어 레지스트리에
넣는다. 계산 엔진도 카테고리 매핑도 건드릴 일이 없다. 명세서가 해외 결제를 적는다면(우리카드
`매출구분`의 `국외일시불`) 포맷의 `isOverseas`로 알려 준다. 그러면 거래에 `overseas: true`가 붙고
`MatchRule.overseas`로 "해외 가맹점 2%"·"국내 가맹점 이용 시 제공"을 가른다. 표기가 없는 명세서는
전부 국내로 읽는다 — 짐작으로 붙이면 해외 할인이 엉뚱한 결제에 붙는다.

## 검증

```bash
npm test                                                    # 유닛 + 골든
npm run typecheck                                           # core + app (app만 DOM)
npm run build && npm run preview                            # CSP가 들어간 빌드로 홈(/)·계산기(/app/) 확인
npm run sim -- fixtures/cases/07-three-month.json           # 월별 흐름
npm run sim -- fixtures/cases/08-toss-group-cap.json        # 공동 한도를 나눠 쓰는 달
npm run sim -- --max fixtures/cards/woori-every1.json       # 한도 없는 1% + 월정액 할인
npm run sim -- --max fixtures/cards/kb-need-pay.json        # 택1 선택지마다 한 번씩 (--choice pay=naverpay로 하나만)
npm run sim -- fixtures/cases/12-need-pay-kb-stack.json     # 중복 적용이 붙는 달
npm run sim -- --max fixtures/cards/toss-samsung.json       # 구간별 최대 할인 (공동 한도 포함)
npm run sim -- --required fixtures/testcards/simple-cafe.json --tier 300000
npm run import -- fixtures/statements/shinhan-3months.csv    # 명세서 파싱 결과
```

## 하네스

**트리거:** 계산 엔진이나 규칙 스키마를 고친 뒤에는 `verify-calc` 스킬을, 새 카드 약관을 규칙
JSON으로 옮길 때는 `add-card-rule` 스킬을 쓴다.

에이전트 팀은 아직 구성하지 않았다. 실제 카드는 이제 세 장(토스 삼성카드, 카드의정석 EVERY 1,
KB국민 NEED Pay)이고, 전부 혜택 안내 페이지만 읽어 옮긴 것이다. `약관 → 규칙 JSON → 골든 케이스 →
검증` 절차가 세 바퀴 돌았는데 세 번 모두 스키마를 넓히며 끝났다 — 스키마가 아직 굳지 않았다는
뜻이라, 파이프라인으로 묶는 일은 카드 한두 장이 스키마 변경 없이 들어온 뒤로 미룬다.

**규칙 JSON을 쓰다 스키마에 자리가 없으면 멈춘다.** 지금까지 막힌 자리는
`.claude/skills/add-card-rule/SKILL.md` 5절에 모아 둔다. 거기 적힌 것을 엔진에 넣기로
했다면 `verify-calc`를 거치고 골든 케이스를 함께 만든다 — 공동 한도가 그렇게 들어왔다.

**변경 이력:**

| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-09-22 | 초기 구성 | CLAUDE.md, verify-calc, add-card-rule | 계산 엔진 코어 착수. 에이전트 팀은 도메인 모델이 굳은 뒤로 미룸 |
| 2026-09-22 | 구조·검증에 명세서 가져오기 추가 | CLAUDE.md | `src/import/` 신설. 파싱 경계와 포맷 추가 절차를 적어둠 |
| 2026-09-23 | 구조·검증에 화면 추가 | CLAUDE.md | `src/app/` 신설. DOM 타입 분리와 빌드 CSP로 규칙 2·5를 강제 |
| 2026-09-27 | 구조에 화면 셸·집계 경계 추가 | CLAUDE.md | 화면을 셸+탭으로 개편하며 `src/app/shell/`·`summary.ts` 신설. 화면에서도 할인액 나눗셈은 `roundDiscount`만 쓴다는 선을 적어둠 |
| 2026-09-27 | 서비스 이름을 순할인으로 확정, 소개 페이지 추가 | CLAUDE.md, src/app/tokens.css | 이름을 화면·문서·패키지에 반영. 소개 페이지가 앱과 색을 공유하도록 토큰을 한 파일로 분리하고, 소개 페이지는 계산하지 않고 `sim` 출력값을 인용한다는 선을 적어둠 |
| 2026-09-27 | 홈을 소개 페이지로, 계산기를 `/app/`으로 | CLAUDE.md, index.html, app/index.html, vite.config.ts | 처음 오는 사람이 보는 화면과 명세서를 올리는 화면을 분리. 진입점이 둘이라 `rollupOptions.input`에 두 HTML을 둔다 |
| 2026-09-27 | 카드 고르기를 1단계로, 규칙 JSON 불러오기 추가 | CLAUDE.md, src/core/types.ts, src/core/parseCardRule.ts, src/app/ | 상단 바 드롭다운을 단계 안으로 옮기고 `art`로 카드를 생김새로 알아보게 함. 목록에 없는 카드를 받는 경계를 규칙 JSON으로 그어 규칙 1·2를 지키고, 들어오는 규칙과 번들된 픽스처에 같은 검사를 건다 |
| 2026-09-27 | 카드 자료 넣기를 1단계로 신설 | CLAUDE.md, index.html, package.json, src/app/ | 카드를 고르는 일보다 내 카드를 들이는 일이 먼저라 단계를 하나 앞에 둠. 혜택 링크·상품설명서 PDF를 받아 `add-card-rule` 요청문까지 만들고, PDF 글자는 pdf.js로 이 탭 안에서만 뽑아 규칙 1·2를 그대로 둔다. 못 뽑은 PDF는 원문을 붙이지 않고 파일을 첨부하라고 적는다 |
| 2026-09-27 | 카드 자료 단계에서 PDF 추출 제거 | CLAUDE.md, index.html, package.json, src/app/cardSource.ts, src/app/panels/CardSource.tsx, src/app/pdf.ts(삭제) | 브라우저 pdf.js 추출이 표를 줄로 풀어 구간별 한도를 가장 나쁜 형태로 넘기고 있었다. PDF는 요청문과 함께 스킬에 그대로 첨부하는 쪽이 정확하다. `pdfjs-dist` 의존성과 `pdfText`·`textQuality` 약 150줄이 함께 빠졌고, 요청문에는 스키마로 표현할 수 없는 조건을 끼워 맞추지 말라는 당부를 넣었다 |
| 2026-09-27 | 화면을 단계 마법사로, 카드 자료에서 PDF 제거 | CLAUDE.md, README.md, index.html, .claude/skills/add-card-rule/SKILL.md, src/app/ | 상단에 히어로·요약 타일이 상시로 서 있고 그 아래 탭이 여섯 칸이라 지금 할 일이 보이지 않았다. `Tabs`·`Hero`를 지우고 `Stepper` 하나만 남겨 네 단계를 한 번에 하나씩 보여 준다. 카드 자료 넣기는 단계에서 빠져 1단계 안의 접이식 흐름이 되고, 요약 타일은 할인 결과 안으로, 가맹점 분류도 그 안에서 연다. 요청문의 PDF 첨부 요구는 걷어냈다 — 화면이 받는 자료가 링크뿐인데 첨부를 요구하면 스킬이 없는 자료를 기다리며 멈춘다. 대신 링크에 없는 값을 지어내지 말라는 당부를 넣고, 자료 요청은 스킬 0절이 맡는다 |
| 2026-09-28 | 카드 고르기를 드롭다운으로, 카드 넣기를 별도 화면으로, 본문 글꼴 Pretendard | CLAUDE.md, README.md, index.html, src/app/ | 1단계에 카드 그림·한도표·링크 칸이 한꺼번에 서 있어 지금 할 일이 보이지 않았다. 고르는 칸 하나만 가운데 두고 카드사는 optgroup 라벨로, 카드 이름은 옵션으로 정확히 적는다. 목록에 없는 카드를 넣는 일은 접이식이 아니라 화면을 통째로 바꾸는 이동으로 뺐다 — 차례가 아닌 일이 단계 안에 끼면 모두가 지나가야 하는 것처럼 보인다. 폰트 파일은 저장소에 넣어 함께 실어 나른다(빌드 CSP가 `font-src 'self'`). 서브셋이 아니라 전체 커버리지 가변 폰트(2.0MB)를 쓰는 이유는 화면이 명세서에서 읽은 가맹점명을 그대로 보여 주기 때문이다 |
| 2026-09-28 | 공동 한도(capGroup) 추가, 토스 삼성카드 규칙 | CLAUDE.md, src/core/(types·tier·discount·maxDiscount·parseCardRule·simulate), scripts/sim.ts, src/app/, fixtures/cards/toss-samsung.json, fixtures/cases/08·09 | 첫 실제 카드를 옮기다 막혔다. 할인율이 다른 혜택 둘이 한 한도를 나눠 쓰는데 스키마에 적을 자리가 없어, 따로 주면 월 최대가 두 배가 됐다. `Benefit.capGroup` + `CardRule.capGroups`로 한 층을 넣고 사유 `groupCapReached`·`cappedBy: 'group'`을 붙였다. 그룹 id 오타는 한도가 통째로 사라져 할인액이 조용히 늘어나므로 `parseCardRule`이 막는다. 골든 케이스 둘은 손으로 계산했고, 60만원 구간 케이스는 합계가 구간별 월 최대와 같아 표와 배정이 어긋나지 않는지도 함께 못 박는다 |
| 2026-09-28 | 가상 카드를 `fixtures/testcards/`로 분리 | CLAUDE.md, README.md, index.html, src/app/data.ts, src/core/__tests__/golden.test.ts, src/import/__tests__/integration.test.ts, scripts/sim.ts | 화면 목록에 쓸 수 없는 가상 카드가 뜨는 문제. 파일을 지우면 골든 케이스 7개가 통째로 사라지므로 지우지 않고 앱이 번들하는 경로 밖으로 옮겼다. 골든 테스트·`sim`은 두 폴더를 함께 뒤지고, `parseCardRule` 검사도 양쪽에 똑같이 건다 |
| 2026-09-28 | 디자인 작업의 CSP 제약 명시 | CLAUDE.md | `frontend-design` 스킬(사용자 전역)을 들였다. 외부 스킬은 CSP를 모르고 인라인 스타일·외부 폰트를 제안하는데, 이는 빌드본에서만 깨져 dev 서버로는 드러나지 않는다 |
| 2026-09-28 | 할인 결과 첫머리를 순액 원장으로, 색을 통장 종이와 인주로 | CLAUDE.md, index.html, app/index.html, src/app/(tokens.css·styles.css·summary.ts·shell/SummaryBar.tsx·panels/SimulationPanel.tsx·App.tsx) | 큰 숫자 타일 넷이 "총 할인"만 보여 줘 서비스 이름이 말하는 뺄셈이 화면에 없었다. 안내문 최대(최상위 구간 월 최대 × 달 수) − 구간이 낮아 잃은 몫 − 못 쓴 한도 = 순할인을 한 줄씩 적고, 세 값은 `summarize`가 내서 언제나 정확히 떨어진다(테스트로 못 박음). 빼는 값은 새 토큰 `--seal`(인주)로만 칠하고 입력 경고(`--warn`)와 갈랐다. 배경은 미색 대신 통장 종이의 푸른 회색 |
| 2026-09-28 | 구간 채우기 결과를 같은 원장으로 | CLAUDE.md, src/app/(styles.css·panels/RequiredSpendPanel.tsx) | 문장 속 강조 숫자와 사실 상자 셋으로 흩어져 있던 답을 "실적으로 남는 몫 + 빠지는 몫 = 실제로 써야 하는 금액"으로 세웠다. `requiredSpendFor`가 `excludedAmount`를 필요액 − 실적으로 내므로 덧셈이 언제나 맞는다. 맨 아래는 써야 하는 돈이라 초록이 아니라 잉크색이다 — 초록은 순할인에만 쓴다. 단계 제목과 겹치던 패널 제목은 보조기술에만 남겼다 |
| 2026-09-28 | 소개 페이지 첫 화면에 순액 원장 | CLAUDE.md, index.html, src/landing/landing.css, src/app/__tests__/summary.test.ts | 제목 위 라벨을 걷고 제목 옆에 계산기와 같은 뺄셈(45,000 − 30,000 − 4,500 = 10,500)을 같은 줄 이름으로 세웠다. 숫자는 골든 케이스 07을 `sim`으로 돌린 값이고, 소개 페이지는 계산하지 않으므로 `summary.test.ts`가 같은 값을 못 박아 엔진이 바뀌면 소개 페이지도 고치라고 알린다. 원장의 실적 제외·필요 결제액의 빠지는 몫도 경고색에서 인주색으로 |
| 2026-09-28 | 셸 정리: 상자를 괘선으로, 장식 문구 걷기 | CLAUDE.md, index.html, src/app/(tokens.css·styles.css·App.tsx·shell/·panels/), src/landing/landing.css | 모든 패널이 같은 둥근 상자·그림자에 들어 있어 위계가 없었다. 패널과 표는 괘선으로 나누고 상자는 손으로 다루는 것(드롭존·파일·알림)에만 남겼다. 반경은 6px/10px 두 단계. 1단계 카드 선택 칸은 가운데 정렬을 풀어 제목과 같은 왼쪽 선에 둔다(이 칸만 가운데라 떠 보였다). `BETA`→"시험판", 버튼 끝 화살표는 "이전:/다음:"으로, 메타 문구의 가운뎃점은 쉼표로. 변환을 뜻하는 화살표(패턴 → 업종)는 남겼다. 소개 페이지의 "45,000 → 10,500" 상자는 첫 화면과 같은 말이라 뺐다 |
| 2026-09-28 | 카드 고르기를 검색되는 선택 칸으로, 구간별 월 최대를 한 줄로 | CLAUDE.md, src/app/(cardSearch.ts·panels/CardPanel.tsx·shell/CardPlate.tsx·styles.css), src/app/__tests__/cardSearch.test.ts | 드롭다운이 고른 카드를 작은 글자 한 줄로 줄여 눈에 들어오지 않았고, optgroup 머리글은 브라우저마다 어색하게 그려졌다. 카드는 계속 늘어나므로 전부 펼치는 라디오 목록도 버티지 못한다. 닫힌 상태는 고른 카드 이름을 크게 적은 버튼, 열면 검색 칸과 카드사별 목록(ARIA combobox)이다. 거르기·정렬은 `searchCards`로 떼어 테스트했다(한국어 정렬이라 한글 카드사가 영문보다 앞). 구간별 월 최대는 표 맨 아래 줄에서 올려 구간마다 크게 세우고, 공동 한도에 잘린 구간은 알약 배지 대신 혜택 한도 합에 줄을 긋는다 — 배지가 칸 폭에 눌려 "원"이 잘렸다. 표에서는 전부 0인 구간 열과 반복되던 실적 제외 열을 뺐다. 카드 그림은 번들 이미지가 있을 때만 그린다 |
| 2026-09-28 | 외부 디자인 스킬 6종 도입과 터치·접근성 보정 | CLAUDE.md, index.html, app/index.html, src/app/(styles.css·main.tsx·App.tsx·shell/CardPlate.tsx·panels/CardPanel.tsx·panels/CardSource.tsx·panels/SimulationPanel.tsx·panels/FilesPanel.tsx), src/landing/landing.css | 디자인·접근성 스킬을 사용자 전역에 들이고(`web-design-guidelines`·`make-interfaces-feel-better`·`ui-ux-pro-max`·emilkowalski 10종), 그 체크리스트로 화면을 훑었다. 가장 큰 구멍은 터치였다 — `:hover` 9곳이 capability 쿼리 없이 걸려 있어 폰에서 한 번 누르면 상태가 눌러붙고, 누른 티(`:active`)는 어디에도 없었다. hover는 전부 `(hover: hover) and (pointer: fine)`로 제자리에서 감싸고(파일 끝으로 모으면 캐스케이드가 바뀐다) `:active`와 `touch-action: manipulation`을 넣었다. 본문이 15px이라 iOS가 입력에 초점이 갈 때 화면을 확대하던 것은 `(pointer: coarse)`에서만 16px로 올려 막았다(`user-scalable=no`는 쓰지 않는다). `viewport-fit=cover`가 없어 랜딩 `.bar`의 `env(safe-area-inset-top)`이 여태 0으로 읽히고 있었다. 앱 셸은 `100dvh`, 앱에도 본문 건너뛰기 링크와 `scroll-margin-top`(고정 단계 바가 포커스를 덮었다). `app/index.html`의 `<noscript>` 인라인 style은 CSP가 막아 적용된 적이 없어 클래스로 옮겼고, 그 김에 styles.css를 main.tsx의 import에서 HTML `<link>`로 옮겼다 — 자바스크립트가 꺼지면 CSS가 아예 오지 않던 자리다 |
| 2026-09-29 | 1단계를 고르는 칸 하나가 주역인 화면으로 | CLAUDE.md, src/app/styles.css, src/app/panels/CardPanel.tsx, src/app/shell/icons.tsx | 카드 고르기와 한도표가 같은 무게로 서 있었다. 구간별 월 최대 숫자(1.75rem)가 카드 이름(1.35rem)보다 커서 고르는 칸이 표의 머리글처럼 읽혔다. 숫자를 1.3rem으로 낮추고 이름을 1.6rem으로 올려 읽는 차례를 되돌렸다. 처음에는 고르는 칸만 흰 표면으로 올렸는데 **구분이 되지 않았다** — 종이 배경(#f3f5f3)과 흰 표면(#ffffff)은 대비가 3%뿐이라 이 팔레트에서 면끼리는 갈리지 않는다. 그래서 반대로 설명을 한 겹 가라앉혔다: 아래 영역을 `--surface-sunken` 판으로 깔고 본문 폭 끝까지 음수 마진으로 넓혀, 좌우 끝까지 이어지는 경계선이 구역의 시작을 알린다. 고르는 칸은 `shadow-md`로 실제로 띄우고, 제목에 카드 이름을 넣어(`{card.name}의 구간별 월 최대 할인`) 말로도 종속시켰다. 붙박이 표 머리글은 그 판 위에서 같은 배경을 쓴다. 칸 폭 48rem은 한도표(본문 폭)보다 좁으면 위계가 뒤집히고 끝까지 늘리면 이름과 "바꾸기"가 한 줄로 안 읽히는 사이의 값이다. 눈에 보이던 "계산할 카드" 라벨은 단계 제목과 같은 말이라 보조기술에만 남겼고, 목록 여닫기에 갈매기와 160ms ease-out 등장을 붙였다 |
| 2026-09-29 | 회색에서 초록빛을 걷고 강조색 대비를 규격으로 | CLAUDE.md, src/app/tokens.css, index.html, app/index.html | 사용자가 "전체 인상이 촌스럽다"고 했다. 원인은 배경·글자·괘선(#f3f5f3 · #1c211e · #dfe4e0)이 모두 초록 쪽으로 기울어 화면 전체가 한 색에 잠겨 뿌옇던 것. 회색은 중성으로 돌리고(#f4f5f6 · #14161a · #e5e7ea) 초록은 브랜드와 할인액에만 남겼다. 강조색은 대비를 계산해 잡았다 — 전의 #0a6b52는 6.5:1로 과하게 어두웠고, 눈으로 고른 #0f9960은 3.65:1로 글자에 못 쓴다. 글자로 쓸 수 있는 하한(4.5:1) 바로 위인 #0b8659(4.60:1)와 --mark #0a8456(4.72:1)으로 정했다. **기존 --mark #0b8a68도 4.33:1로 미달이었다** — 이 계열은 눈으로 고르면 반드시 하한을 넘으므로 바꿀 때마다 계산한다. theme-color 메타 두 쌍도 함께 옮겼다 |
| 2026-09-29 | 고르는 칸을 혜택 배지로 채우고 한도표를 박스로 | CLAUDE.md, src/app/labels.ts, src/app/panels/CardPanel.tsx, src/app/styles.css, src/app/__tests__/labels.test.ts | 칸을 띄우고 팔레트를 고쳐도 1단계는 밋밋했다. 진짜 이유는 카드 고르는 화면에 카드도, 고를 판단 재료도 없다는 것이었다 — 이름·발급사·연회비 두 줄이 전부였다. 카드 이미지는 넣을 수 없어(사용자가 파일을 구할 수 없다) 글자로 채운다: 혜택 배지 네 개와 "100만원 이상 쓰면 한 달 최대 45,000원". 배지 문구는 `benefitTag`가 규칙에서 만든다 — 라벨 끝의 할인 표기를 뒤에서부터 떼고(앞에서 첫 숫자를 찾으면 "GS25 5%"가 "GS 5%"가 된다) 대상이 여럿이면 첫 대상만 남기며, 퍼센트는 문장이 아니라 `discount`에서 읽는다. 테스트를 먼저 써서 7개가 실패하는 걸 보고 구현했다. 이름 줄만 "카드 변경"과 폭을 나누고 배지·최대치는 칸 전체 폭을 쓴다 — 셋을 한 열에 묶으면 좁은 화면에서 남는 폭이 배지 하나보다 좁아져 배지가 한 줄에 하나씩 쌓인다. 한도표는 사용자 요청으로 박스에 담았고, 칸 사이 선은 테두리가 아니라 1px 간격으로 낸다(테두리로 그으면 좁은 화면에서 2열로 접힐 때 둘째 줄 첫 칸에 선이 남는다). "바꾸기"는 "카드 변경"으로 |
| 2026-09-30 | 화면에서 카드 넣기 경로 제거 | CLAUDE.md, README.md, index.html, .claude/skills/add-card-rule/SKILL.md, src/app/(App.tsx·main.tsx·storage.ts·download.ts·styles.css·panels/CardPanel.tsx), src/app/cardSource.ts·panels/CardSource.tsx·panels/AddCard.tsx·userCards.ts·__tests__/cardSource.test.ts(삭제) | 요청문을 만들어 주는 흐름은 `add-card-rule` 스킬을 돌릴 수 있는 사람 — 저장소를 clone하고 Claude Code를 켠 사람 — 만 끝까지 갈 수 있는데, 화면은 그 길을 모두에게 보여 주고 있었다. 요청문 자체가 `fixtures/cards/`·`fixtures/cases/` 같은 저장소 경로를 말하고 스키마는 담지 않아, 바깥 대화에 붙여넣으면 없는 폴더에 파일을 만들라는 말이 된다. 통과해 들어온 규칙도 골든 케이스가 없어 검증된 카드와 같은 표에 나란히 선다. "카드를 넣어 달라"는 접수 칸도 두지 않았다 — CSP가 `form-action 'none'`·`connect-src 'none'`이라 화면이 보낼 곳이 애초에 없고, 아무 데도 닿지 않는 버튼보다 목록이 곧 전부라고 적는 편이 정직하다. 남아 있던 `sunhalin:user-cards`는 `storage.ts`의 `dropObsolete`가 앱이 뜰 때 지운다 |
| 2026-09-30 | 한도 없음·월정액 할인·할인 대상 제외, 카드의정석 EVERY 1 규칙 | CLAUDE.md, README.md, index.html, .claude/skills/(add-card-rule·verify-calc)/SKILL.md, src/core/(types·tier·match·maxDiscount·simulate·requiredSpend·parseCardRule), scripts/sim.ts, src/app/(summary.ts·export.ts·labels.ts·panels/CardPanel.tsx·panels/SimulationPanel.tsx), fixtures/cards/woori-every1.json, fixtures/cases/10·11 | 두 번째 실제 카드가 스키마의 빈자리 셋에 한꺼번에 걸렸다 — "전월실적·할인한도 없이 1%", "전월실적별 매월 최대 2만원", "무이자할부 할인 제외". 혜택 한도의 `null`을 한도 없음으로(키 누락 = 0은 그대로), 카드에 `monthlyRebateByTier`를, `MatchRule`에 `excludeCategories`·`excludePaymentTypes`를 넣었다. 무한대를 숫자로 내보내면 화면이 그대로 찍으므로 `maxDiscountByTier`는 한도 있는 몫만 `maxDiscount`에 담고 `unboundedBenefits`로 알린다. 순액 원장은 한도 없는 몫의 상한을 실제로 받은 만큼으로 봐서 뺄셈이 계속 맞는다. 월정액은 거래가 아니라 결과 CSV에 줄로 따로 낸다 — 빠뜨리면 할인액 열의 합이 화면과 어긋난다. 타입 검사가 못 잡는 자리 하나: 한도표가 `byBenefit[id] ?? 0`으로 읽어 한도 없음을 "—"로 찍고 있었다. 할인받은 매출의 실적 제외는 안내 페이지에 문구가 없어 `none`으로 가정했다(`full`이면 1%가 모든 결제에 붙어 어느 구간에도 오를 수 없다) |
| 2026-09-30 | 택1 선택지와 중복 적용, KB국민 NEED Pay 규칙 | CLAUDE.md, README.md, index.html, .claude/skills/(add-card-rule·verify-calc)/SKILL.md, src/core/(types·choice·discount·spending·simulate·maxDiscount·requiredSpend·parseCardRule·index), scripts/sim.ts, src/app/(App.tsx·storage.ts·labels.ts·styles.css·panels/CardPanel.tsx), fixtures/cards/kb-need-pay.json, fixtures/cases/12·13 | 세 번째 실제 카드가 두 곳에서 막혔다. "KB Pay 15% / 네이버·카카오·토스페이 10% 중 택1"을 네 혜택으로 다 켜면 월 최대가 부풀고, "패션몰 5%는 간편결제 할인(KB Pay)과 중복 적용 가능"은 한 거래에 할인 하나만 주는 엔진으로는 적게 나온다. 사용자가 둘 다 엔진에서 풀기로 정했다. 선택지는 계산 전에 `resolveChoices`로 좁히고, 좁히지 않은 규칙은 `assertResolved`가 멈춘다 — 조용히 부푸는 것보다 멈추는 편이 낫다. 화면은 카드 고르는 칸 바로 아래 알약 라디오로 고르고 카드별로 저장한다. 중복은 `Benefit.stackable`로, 일반 혜택 하나 위에 각자 붙고 한도는 따로 깎이며 합은 결제액을 넘지 않는다. 해외 2%·전월실적 채워드림·신규 실적유예는 넣지 않았다(규칙의 `sourceNote`). 'KB Pay로 결제'는 명세서에 결제수단이 찍히지 않을 가능성이 커 가맹점명으로만 맞춘다 — 실제 KB 명세서로 확인해야 한다 |
| 2026-09-30 | 해외 결제 구분, 해외 2% 할인 복원 | CLAUDE.md, .claude/skills/add-card-rule/SKILL.md, src/core/(types·match·parseCardRule), src/import/(types·statement·formats/woori), src/app/panels/SimulationPanel.tsx, fixtures/cards/(toss-samsung·kb-need-pay).json, fixtures/cases/14·15 | 사용자가 우리카드 명세서의 `국외일시불` 행을 보여 줬다. 파서는 원화 금액을 고르느라 이미 이 칸을 읽고 있었는데 그 사실을 거래에 남기지 않아, 토스·NEED Pay의 해외 2%를 "가를 수 없다"며 빼 두었던 것이다. `Transaction.overseas`·`StatementFormat.isOverseas`·`MatchRule.overseas`를 넣고 두 카드에 해외 2%를 되살렸다(한도 없음, 전월실적 조건 없음). NEED Pay 간편결제는 "국내 가맹점 이용 시 제공"이라 `overseas: false`. 토스의 해외 2%는 전월 이용금액 제외 목록에 없어 `excludeFromSpending: none`이다 — NEED Pay(전 혜택 제외)와 반대라 골든 케이스 둘로 나눠 못 박았다. 실제 명세서(거래 106건)에서 해외 1건이 원화 33,170원으로 잡히는 것도 확인했다. 결과 상세의 업종 칸에 `해외` 표시 |
| 2026-09-30 | 구간 채우기를 실제 거래 표본으로 | CLAUDE.md, src/core/(types·pattern·requiredSpend·index), src/core/__tests__/(requiredSpend·pattern).test.ts, src/app/panels/RequiredSpendPanel.tsx | 실제 카드 세 장 모두 "할인받아 빠지는 몫"이 언제나 0원이었다. 가상 거래가 업종 비중으로만 만들어져 가맹점명 자리에 업종 이름이 들어가고 해외 표시도 없어서, 가맹점명·해외로 붙는 혜택이 한 건도 걸리지 않았다 — 업종으로 맞추는 가상 카드로만 테스트해 드러나지 않았다. `SpendingPattern.samples`를 넣어 내 명세서의 거래를 가맹점·해외·결제유형 그대로 순서대로 되풀이한다(금액을 비율로 늘리면 건당 최소금액이 틀어진다). 예시 패턴은 업종만 담으므로 그런 혜택이 있는 카드에서는 계산에 들어가지 않는다고 화면에 적는다. 빠지는 몫이 0원일 때 할인이 없어서인지, 할인받아도 실적에 넣는 혜택이라서인지(EVERY 1) 문구를 갈랐다 |
| 2026-10-01 | GitHub Pages 배포 | CLAUDE.md, .github/workflows/deploy.yml, vite.config.ts, index.html, src/app/shell/Footer.tsx | 무료로 공개하려고 GitHub Pages를 골랐다(저장소가 이미 공개라 추가 계정이 필요 없다). 사이트가 `/card-benefit-calc/` 아래에 서므로 `base`를 `BASE_PATH`로 받고, 페이지 사이 절대 링크(`/app/`, `/`)를 상대 경로로 바꿨다. 워크플로는 `npm test`·`typecheck`를 통과해야 배포한다 |
