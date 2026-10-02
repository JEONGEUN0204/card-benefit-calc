import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROSTER_FIXTURE, buildRoster, loadRules } from '../../../scripts/roster.js';
import type { RosterSnapshot } from '../../../scripts/roster.js';

/*
 * 가맹점 키워드가 엉뚱한 가맹점을 잡는지 감시한다.
 *
 * `match.ts`의 가맹점명 비교는 부분일치다. 명세서의 가맹점명에 지점명이 제각각 붙어
 * 그래야 하지만, 짧거나 흔한 키워드를 적으면 의도하지 않은 가맹점까지 잡힌다. 지금까지
 * 네 번 걸렸고 전부 사람이 손으로 훑어 찾았다 — 오류가 나지 않고 할인액만 늘어나는
 * 종류라서, 새 카드가 들어올 때마다 다시 훑지 않으면 놓친다.
 *
 * 그래서 "어떤 혜택이 어떤 이름에 걸리는가"를 픽스처로 못 박는다. 규칙을 고치거나 카드를
 * 넣어 이 표가 달라지면 테스트가 깨지고, 사람이 늘어난 이름을 하나씩 봐야 한다.
 *
 *   npm run roster     # 무엇이 달라졌는지 보여주고 픽스처를 다시 쓴다
 *
 * vitest의 자동 스냅샷(`-u`)을 쓰지 않는 이유는 불변규칙 7이다 — 테스트가 결과에 맞춰
 * 저절로 바뀌면 픽스처가 앵커 역할을 잃는다. 재생성은 사람이 명령을 쳐야 한다.
 */
describe('가맹점 키워드 명부', () => {
  const built = buildRoster(loadRules());
  const committed = JSON.parse(readFileSync(ROSTER_FIXTURE, 'utf8')) as RosterSnapshot;

  it('명부가 픽스처와 같다', () => {
    expect(built.roster).toEqual(committed.roster);
  });

  it('혜택마다 걸리는 이름이 픽스처와 같다', () => {
    // 혜택 단위로 비교해야 어느 혜택이 달라졌는지 바로 보인다.
    const keys = [...new Set([...Object.keys(committed.matches), ...Object.keys(built.matches)])].sort();
    for (const key of keys) {
      expect(built.matches[key], `${key} — npm run roster로 무엇이 달라졌는지 확인하세요`).toEqual(
        committed.matches[key],
      );
    }
  });

  it('픽스처가 비어 있지 않다', () => {
    expect(committed.roster.length).toBeGreaterThan(50);
    expect(Object.keys(committed.matches).length).toBeGreaterThan(10);
  });

  it('모든 혜택은 적어도 자기 키워드에는 걸린다', () => {
    /*
     * 자기 키워드에조차 안 걸리면 그 혜택은 어떤 결제에도 붙지 않는다는 뜻이다. 업종과
     * 가맹점명을 함께 적어 AND가 되는 바람에 아무것도 안 잡히는 실수가 여기서 걸린다.
     */
    for (const rule of loadRules()) {
      for (const b of rule.benefits) {
        const own = b.match.merchants ?? [];
        if (own.length === 0) continue;
        const hits = built.matches[`${rule.id}/${b.id}`] ?? [];
        expect(hits.length, `${rule.id}/${b.id}이 자기 키워드에도 안 걸린다`).toBeGreaterThan(0);
      }
    }
  });

  it('지금까지 걸린 네 가지 오탐이 되살아나지 않는다', () => {
    /*
     * 픽스처 비교만으로도 잡히지만, 무엇을 막고 있는지 이름으로 적어 둔다 — 픽스처를
     * 재생성할 때 이 네 줄이 사람에게 "이런 걸 보라"고 알려 준다.
     */
    const forbidden: Array<[string, string]> = [
      ['shinhan-toss-mrlife/night-taxi', 'YOUTUBE'],
      ['shinhan-toss-mrlife/night-taxi', '우버이츠'],
      ['shinhan-toss-mrlife/bill', 'KTM모바일'],
      ['shinhan-toss-mrlife/bill', 'KT스카이라이프'],
      ['toss-samsung/online-pay', '카카오페이지'],
      ['kb-need-pay/kakaopay', '카카오페이지'],
      ['bnk-pot/simple-pay', '카카오페이지'],
    ];
    for (const [key, name] of forbidden) {
      const hits = built.matches[key] ?? [];
      expect(hits, `${key}이 "${name}"에 걸린다`).not.toContain(name);
    }
  });
});
