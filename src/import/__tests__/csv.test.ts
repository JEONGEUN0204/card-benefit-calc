import { describe, expect, it } from 'vitest';
import { parseCsv } from '../csv.js';

describe('parseCsv', () => {
  it('콤마로 나눈 행렬을 돌려준다', () => {
    expect(parseCsv('이용일자,가맹점,금액\n2026-01-05,스타벅스,5500')).toEqual([
      ['이용일자', '가맹점', '금액'],
      ['2026-01-05', '스타벅스', '5500'],
    ]);
  });

  it('따옴표 안의 콤마는 구분자가 아니다', () => {
    // 금액에 천단위 콤마가 있는 명세서가 흔하다. 이걸 못 다루면 컬럼이 통째로 밀린다.
    expect(parseCsv('a,"12,340",b')).toEqual([['a', '12,340', 'b']]);
  });

  it('따옴표 안의 두 겹 따옴표는 따옴표 하나다', () => {
    expect(parseCsv('a,"스타벅스 ""강남점""",b')).toEqual([['a', '스타벅스 "강남점"', 'b']]);
  });

  it('따옴표 안의 개행은 셀 안에 남는다', () => {
    expect(parseCsv('a,"1\n2"\nc,d')).toEqual([['a', '1\n2'], ['c', 'd']]);
  });

  it('CRLF 줄바꿈을 처리한다', () => {
    expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('BOM을 걷어낸다', () => {
    // 카드사 CSV는 엑셀에서 열리도록 BOM을 붙여 내려주는 경우가 많다.
    expect(parseCsv('﻿이용일자,금액')).toEqual([['이용일자', '금액']]);
  });

  it('마지막 줄바꿈이 빈 행을 만들지 않는다', () => {
    expect(parseCsv('a,b\n')).toEqual([['a', 'b']]);
  });

  it('셀 앞뒤 공백을 걷어낸다', () => {
    expect(parseCsv(' 2026-01-05 , 스타벅스 ')).toEqual([['2026-01-05', '스타벅스']]);
  });

  it('탭이 콤마보다 많으면 탭 구분자로 본다', () => {
    expect(parseCsv('a\tb\tc\n1\t2\t3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  it('구분자를 직접 지정할 수 있다', () => {
    expect(parseCsv('a|b', { delimiter: '|' })).toEqual([['a', 'b']]);
  });

  it('빈 문자열은 빈 배열이다', () => {
    expect(parseCsv('')).toEqual([]);
  });
});
