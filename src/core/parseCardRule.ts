/**
 * 바깥에서 들어온 값을 `CardRule`로 확인한다.
 *
 * 번들된 규칙은 빌드가 타입으로 지켜 주지만, 사용자가 올린 규칙 JSON에는 아무 타입도
 * 붙어 있지 않다. 이 계산기의 실패 방식은 오류가 아니라 **그럴듯한 숫자**라서, 틀린 규칙을
 * 그대로 받으면 사용자는 틀린 줄도 모른다. 그래서 의심스러운 값을 통과시키지 않고,
 * 어디가 왜 문제인지 전부 모아서 돌려준다.
 *
 * 특히 `monthlyCapByTier`의 구간 키 누락은 엔진에서 0으로 읽혀 "그 구간엔 혜택 없음"이
 * 되므로, 오류가 아니라 조용한 할인액 감소로 나타난다. 여기서 막는다. `capGroup`이 없는
 * 그룹을 가리키는 경우는 반대로 한도가 통째로 사라져 할인액이 조용히 늘어난다. 같이 막는다.
 */
import type {
  CapGroup,
  CardArt,
  CardRule,
  ChoiceGroup,
  DiscountSpec,
  MatchRule,
  PaymentType,
  Won,
} from './types.js';

export interface CardRuleIssue {
  /** 문제가 난 자리. `benefits[0].discount`처럼 JSON 안의 경로다. */
  path: string;
  message: string;
}

export type ParseCardRuleResult =
  | { ok: true; card: CardRule }
  | { ok: false; issues: CardRuleIssue[] };

const ROUNDING = ['floor10', 'floor1', 'round10'] as const;
const EXCLUSION_MODE = ['full', 'discountOnly', 'none'] as const;
const EXCLUSION_KIND = ['category', 'merchant', 'paymentType'] as const;
const COUNT_PERIOD = ['month', 'day'] as const;
const PAYMENT_TYPES = ['lump', 'installment', 'interestFreeInstallment'] as const satisfies readonly PaymentType[];
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 규칙 3 — 금액은 정수 원 단위다. 소수가 들어오면 할인액도 소수가 된다. */
function isWon(value: unknown): value is Won {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

class Checker {
  readonly issues: CardRuleIssue[] = [];

  fail(path: string, message: string): void {
    this.issues.push({ path, message });
  }

  text(value: unknown, path: string): string {
    if (typeof value !== 'string' || value.trim() === '') {
      this.fail(path, '비어 있지 않은 문자열이어야 합니다.');
      return '';
    }
    return value;
  }

  won(value: unknown, path: string): Won {
    if (!isWon(value)) {
      this.fail(path, '0 이상의 정수(원)여야 합니다.');
      return 0;
    }
    return value;
  }

  oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
      this.fail(path, `${allowed.join(' · ')} 중 하나여야 합니다.`);
      return allowed[0] as T;
    }
    return value as T;
  }

  /** 구간별 금액표. 카드의 구간과 키가 정확히 같아야 한다. */
  capsByTier(value: unknown, path: string, tierKeys: readonly string[]): Record<string, Won> {
    if (!this.tierKeysMatch(value, path, tierKeys)) return {};
    const caps: Record<string, Won> = {};
    for (const [key, amount] of Object.entries(value)) caps[key] = this.won(amount, `${path}.${key}`);
    return caps;
  }

  /**
   * 혜택별 한도표. `null`은 "그 구간에서 한도 없음"이다. 혜택 한도에만 허용한다 — 공동·통합
   * 한도가 없으면 표 자체를 두지 않으면 되고, 거기 `null`이 들어오면 오타일 가능성이 크다.
   */
  capsOrUnlimited(
    value: unknown,
    path: string,
    tierKeys: readonly string[],
  ): Record<string, Won | null> {
    if (!this.tierKeysMatch(value, path, tierKeys)) return {};
    const caps: Record<string, Won | null> = {};
    for (const [key, amount] of Object.entries(value)) {
      caps[key] = amount === null ? null : this.won(amount, `${path}.${key}`);
    }
    return caps;
  }

  private tierKeysMatch(
    value: unknown,
    path: string,
    tierKeys: readonly string[],
  ): value is Record<string, unknown> {
    if (!isObject(value)) {
      this.fail(path, '구간별 금액을 담은 객체여야 합니다.');
      return false;
    }

    const keys = Object.keys(value);
    const missing = tierKeys.filter((key) => !keys.includes(key));
    const unknownKeys = keys.filter((key) => !tierKeys.includes(key));
    if (missing.length > 0) {
      this.fail(path, `구간 ${missing.join(', ')}의 한도가 빠졌습니다. 0원이라면 0을 적습니다.`);
    }
    if (unknownKeys.length > 0) {
      this.fail(path, `구간에 없는 키: ${unknownKeys.join(', ')}`);
    }
    return true;
  }

  discount(value: unknown, path: string): DiscountSpec {
    if (isObject(value) && value['type'] === 'rate') {
      const rate = value['rate'];
      if (typeof rate !== 'number' || !(rate > 0) || rate > 1) {
        this.fail(path, '할인율은 0 초과 1 이하의 숫자여야 합니다. 10%는 0.1입니다.');
        return { type: 'rate', rate: 0.1 };
      }
      return { type: 'rate', rate };
    }
    if (isObject(value) && value['type'] === 'amount') {
      return { type: 'amount', amount: this.won(value['amount'], `${path}.amount`) };
    }
    this.fail(path, "{ type: 'rate', rate } 또는 { type: 'amount', amount } 여야 합니다.");
    return { type: 'amount', amount: 0 };
  }
}

/** 값이 있을 때만 검사하고, 없으면 필드 자체를 만들지 않는다(`exactOptionalPropertyTypes`). */
function optionalWon(check: Checker, value: unknown, path: string): { value?: Won } {
  if (value === undefined) return {};
  return { value: check.won(value, path) };
}

function parseArt(check: Checker, value: unknown): CardArt | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) {
    check.fail('art', '객체여야 합니다.');
    return undefined;
  }

  const art: CardArt = {};
  if (value['image'] !== undefined) art.image = check.text(value['image'], 'art.image');
  for (const key of ['bg', 'fg'] as const) {
    const color = value[key];
    if (color === undefined) continue;
    if (typeof color !== 'string' || !HEX_COLOR.test(color)) {
      check.fail(`art.${key}`, '#rrggbb 형식의 색이어야 합니다.');
      continue;
    }
    art[key] = color;
  }
  return art;
}

export function parseCardRule(value: unknown): ParseCardRuleResult {
  const check = new Checker();

  if (!isObject(value)) {
    return { ok: false, issues: [{ path: '', message: '카드 규칙은 JSON 객체여야 합니다.' }] };
  }

  const id = check.text(value['id'], 'id');
  const name = check.text(value['name'], 'name');
  const issuer = check.text(value['issuer'], 'issuer');
  const annualFee = check.won(value['annualFee'], 'annualFee');
  const rounding = check.oneOf(value['rounding'], 'rounding', ROUNDING);

  const rawTiers = value['tiers'];
  const tiers = Array.isArray(rawTiers) ? rawTiers : [];
  if (tiers.length === 0) check.fail('tiers', '구간이 최소 하나는 있어야 합니다.');

  const parsedTiers = tiers.map((tier, index) => {
    const path = `tiers[${index}]`;
    if (!isObject(tier)) {
      check.fail(path, '객체여야 합니다.');
      return { min: 0 };
    }
    const min = check.won(tier['min'], `${path}.min`);
    const label = tier['label'];
    if (label === undefined) return { min };
    return { min, label: check.text(label, `${path}.label`) };
  });

  const tierKeys = parsedTiers.map((tier) => String(tier.min));
  if (new Set(tierKeys).size !== tierKeys.length) {
    check.fail('tiers', '같은 하한(min)을 가진 구간이 둘 이상입니다.');
  }

  const rawCapGroups = value['capGroups'];
  if (rawCapGroups !== undefined && !Array.isArray(rawCapGroups)) {
    check.fail('capGroups', '배열이어야 합니다.');
  }
  const capGroupList = Array.isArray(rawCapGroups) ? rawCapGroups : [];
  const parsedCapGroups: CapGroup[] = capGroupList.map((raw, index) => {
    const path = `capGroups[${index}]`;
    if (!isObject(raw)) {
      check.fail(path, '객체여야 합니다.');
      return { id: '', label: '', monthlyCapByTier: {} };
    }
    return {
      id: check.text(raw['id'], `${path}.id`),
      label: check.text(raw['label'], `${path}.label`),
      monthlyCapByTier: check.capsByTier(
        raw['monthlyCapByTier'],
        `${path}.monthlyCapByTier`,
        tierKeys,
      ),
    };
  });

  const capGroupIds = parsedCapGroups.map((group) => group.id);
  if (new Set(capGroupIds).size !== capGroupIds.length) {
    check.fail('capGroups', '같은 id를 가진 그룹이 둘 이상입니다.');
  }

  const rawChoices = value['choices'];
  if (rawChoices !== undefined && !Array.isArray(rawChoices)) {
    check.fail('choices', '배열이어야 합니다.');
  }
  const parsedChoices: ChoiceGroup[] = (Array.isArray(rawChoices) ? rawChoices : []).map(
    (raw, index) => {
      const path = `choices[${index}]`;
      if (!isObject(raw)) {
        check.fail(path, '객체여야 합니다.');
        return { id: '', label: '', options: [] };
      }
      const rawOptions = Array.isArray(raw['options']) ? raw['options'] : [];
      // 선택지가 하나면 고를 것이 없다. 대개 나머지 선택지를 빠뜨린 것이다.
      if (rawOptions.length < 2) check.fail(`${path}.options`, '선택지가 둘 이상이어야 합니다.');
      const options = rawOptions.map((option, i) => {
        const at = `${path}.options[${i}]`;
        if (!isObject(option)) {
          check.fail(at, '객체여야 합니다.');
          return { id: '', label: '' };
        }
        return { id: check.text(option['id'], `${at}.id`), label: check.text(option['label'], `${at}.label`) };
      });
      const ids = options.map((o) => o.id);
      if (new Set(ids).size !== ids.length) check.fail(`${path}.options`, '같은 id를 가진 선택지가 둘 이상입니다.');
      return { id: check.text(raw['id'], `${path}.id`), label: check.text(raw['label'], `${path}.label`), options };
    },
  );

  const rawBenefits = value['benefits'];
  const benefits = Array.isArray(rawBenefits) ? rawBenefits : [];
  if (benefits.length === 0) check.fail('benefits', '혜택이 최소 하나는 있어야 합니다.');

  const parsedBenefits = benefits.map((raw, index) => {
    const path = `benefits[${index}]`;
    if (!isObject(raw)) {
      check.fail(path, '객체여야 합니다.');
      return null;
    }

    const rawMatch = raw['match'];
    const match: MatchRule = {};
    if (rawMatch !== undefined) {
      if (!isObject(rawMatch)) check.fail(`${path}.match`, '객체여야 합니다.');
      else {
        for (const key of ['categories', 'merchants', 'excludeMerchants', 'excludeCategories'] as const) {
          const list = rawMatch[key];
          if (list === undefined) continue;
          if (!Array.isArray(list)) {
            check.fail(`${path}.match.${key}`, '문자열 배열이어야 합니다.');
            continue;
          }
          match[key] = list.map((item, i) => check.text(item, `${path}.match.${key}[${i}]`));
        }
        const overseas = rawMatch['overseas'];
        if (overseas !== undefined) {
          if (typeof overseas === 'boolean') match.overseas = overseas;
          else check.fail(`${path}.match.overseas`, 'true 또는 false여야 합니다.');
        }
        const types = rawMatch['excludePaymentTypes'];
        if (types !== undefined) {
          if (!Array.isArray(types)) {
            check.fail(`${path}.match.excludePaymentTypes`, '결제유형 배열이어야 합니다.');
          } else {
            match.excludePaymentTypes = types.map((item, i) =>
              check.oneOf(item, `${path}.match.excludePaymentTypes[${i}]`, PAYMENT_TYPES),
            );
          }
        }
      }
    }

    const rawCount = raw['countLimit'];
    let countLimit: { period: 'month' | 'day'; max: number } | undefined;
    if (rawCount !== undefined) {
      if (!isObject(rawCount)) check.fail(`${path}.countLimit`, '객체여야 합니다.');
      else {
        const max = rawCount['max'];
        if (typeof max !== 'number' || !Number.isInteger(max) || max < 1) {
          check.fail(`${path}.countLimit.max`, '1 이상의 정수여야 합니다.');
        }
        countLimit = {
          period: check.oneOf(rawCount['period'], `${path}.countLimit.period`, COUNT_PERIOD),
          max: typeof max === 'number' && Number.isInteger(max) && max >= 1 ? max : 1,
        };
      }
    }

    const priority = raw['priority'];
    if (priority !== undefined && typeof priority !== 'number') {
      check.fail(`${path}.priority`, '숫자여야 합니다.');
    }

    /*
     * 그룹 id 오타는 가장 조용한 실수다. 엔진이 "그룹 없음"으로 읽어 한도가 사라지고,
     * 할인액이 오류 없이 늘어난다. 구간 키 누락의 거울상이다.
     */
    const capGroup = raw['capGroup'];
    if (capGroup !== undefined) {
      const id = check.text(capGroup, `${path}.capGroup`);
      if (id !== '' && !capGroupIds.includes(id)) {
        check.fail(`${path}.capGroup`, `capGroups에 없는 그룹입니다: ${id}`);
      }
    }

    const monthlyCapByTier = check.capsOrUnlimited(
      raw['monthlyCapByTier'],
      `${path}.monthlyCapByTier`,
      tierKeys,
    );
    /*
     * 공동 한도에 든 혜택의 개별 한도를 비워 두면 최대 할인표가 그 혜택을 어디에 셀지 정할 수
     * 없다. 약관에 개별 한도가 따로 없으면 그룹 한도와 같은 값을 적는다(토스 삼성카드처럼).
     */
    if (capGroup !== undefined && Object.values(monthlyCapByTier).includes(null)) {
      check.fail(
        `${path}.monthlyCapByTier`,
        '공동 한도에 든 혜택은 한도를 비울 수 없습니다. 개별 한도가 없으면 공동 한도와 같은 값을 적습니다.',
      );
    }

    /*
     * 없는 선택지를 가리키는 혜택은 어떤 선택으로도 켜지지 않는다. 오류 없이 할인이 사라지는
     * 자리라 막는다.
     */
    const rawChoice = raw['choice'];
    let choice: { group: string; option: string } | undefined;
    if (rawChoice !== undefined) {
      const group = isObject(rawChoice) ? parsedChoices.find((c) => c.id === rawChoice['group']) : undefined;
      const option = isObject(rawChoice) ? rawChoice['option'] : undefined;
      if (group === undefined || !group.options.some((o) => o.id === option)) {
        check.fail(`${path}.choice`, 'choices에 없는 그룹이나 선택지입니다.');
      } else {
        choice = { group: group.id, option: option as string };
      }
    }

    const stackable = raw['stackable'];
    if (stackable !== undefined && typeof stackable !== 'boolean') {
      check.fail(`${path}.stackable`, 'true 또는 false여야 합니다.');
    }

    const minTransaction = optionalWon(check, raw['minTransaction'], `${path}.minTransaction`);
    const perTransactionCap = optionalWon(check, raw['perTransactionCap'], `${path}.perTransactionCap`);

    return {
      id: check.text(raw['id'], `${path}.id`),
      label: check.text(raw['label'], `${path}.label`),
      match,
      discount: check.discount(raw['discount'], `${path}.discount`),
      monthlyCapByTier,
      excludeFromSpending: check.oneOf(
        raw['excludeFromSpending'],
        `${path}.excludeFromSpending`,
        EXCLUSION_MODE,
      ),
      ...(minTransaction.value === undefined ? {} : { minTransaction: minTransaction.value }),
      ...(perTransactionCap.value === undefined
        ? {}
        : { perTransactionCap: perTransactionCap.value }),
      ...(countLimit === undefined ? {} : { countLimit }),
      ...(typeof capGroup === 'string' ? { capGroup } : {}),
      ...(choice === undefined ? {} : { choice }),
      ...(typeof stackable === 'boolean' ? { stackable } : {}),
      ...(typeof priority === 'number' ? { priority } : {}),
      ...(raw['sourceNote'] === undefined
        ? {}
        : { sourceNote: check.text(raw['sourceNote'], `${path}.sourceNote`) }),
    };
  });

  const benefitIds = parsedBenefits.map((benefit) => benefit?.id ?? '');
  if (new Set(benefitIds).size !== benefitIds.length) {
    check.fail('benefits', '같은 id를 가진 혜택이 둘 이상입니다.');
  }

  const rawExclusions = value['spendingExclusions'];
  if (rawExclusions !== undefined && !Array.isArray(rawExclusions)) {
    check.fail('spendingExclusions', '배열이어야 합니다.');
  }
  const exclusions = Array.isArray(rawExclusions) ? rawExclusions : [];
  const parsedExclusions = exclusions.map((raw, index) => {
    const path = `spendingExclusions[${index}]`;
    if (!isObject(raw)) {
      check.fail(path, '객체여야 합니다.');
      return { kind: 'category' as const, values: [] };
    }
    const list = raw['values'];
    if (!Array.isArray(list)) check.fail(`${path}.values`, '문자열 배열이어야 합니다.');
    return {
      kind: check.oneOf(raw['kind'], `${path}.kind`, EXCLUSION_KIND),
      values: Array.isArray(list)
        ? list.map((item, i) => check.text(item, `${path}.values[${i}]`))
        : [],
    };
  });

  const totalCaps =
    value['totalMonthlyCapByTier'] === undefined
      ? undefined
      : check.capsByTier(value['totalMonthlyCapByTier'], 'totalMonthlyCapByTier', tierKeys);

  const rebates =
    value['monthlyRebateByTier'] === undefined
      ? undefined
      : check.capsByTier(value['monthlyRebateByTier'], 'monthlyRebateByTier', tierKeys);

  const art = parseArt(check, value['art']);

  if (check.issues.length > 0) return { ok: false, issues: check.issues };

  return {
    ok: true,
    card: {
      id,
      name,
      issuer,
      annualFee,
      tiers: parsedTiers,
      benefits: parsedBenefits.filter((benefit) => benefit !== null),
      ...(rawCapGroups === undefined ? {} : { capGroups: parsedCapGroups }),
      ...(rawChoices === undefined ? {} : { choices: parsedChoices }),
      spendingExclusions: parsedExclusions,
      rounding,
      ...(totalCaps === undefined ? {} : { totalMonthlyCapByTier: totalCaps }),
      ...(rebates === undefined ? {} : { monthlyRebateByTier: rebates }),
      ...(value['sourceNote'] === undefined
        ? {}
        : { sourceNote: check.text(value['sourceNote'], 'sourceNote') }),
      ...(art === undefined ? {} : { art }),
    },
  };
}
