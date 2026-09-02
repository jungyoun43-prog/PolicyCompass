import assert from "node:assert/strict";
import test from "node:test";

import { cleanText, textCleaner } from "../src/text.js";

const NUL = String.fromCharCode(0);
const TAB = String.fromCharCode(9);
const DEL = String.fromCharCode(0x7f);
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

test("cleanText는 문자열만 다듬고 나머지는 fallback을 돌려준다", () => {
  assert.equal(cleanText("  안녕  "), "안녕");
  assert.equal(cleanText(42), "");
  assert.equal(cleanText(null, { fallback: "없음" }), "없음");
  assert.equal(cleanText("abcdef", { maxLength: 3 }), "abc");
  assert.equal(cleanText(" a   b\n c ", { collapseWhitespace: true }), "a b c");
});

test("제어 문자 처리는 모드별로 줄바꿈 보존·C0 제거·비가시 문자 제거를 구분한다", () => {
  const dirty = `a${NUL}b${TAB}c${DEL}`;
  assert.equal(cleanText(dirty, { stripControl: "keep-line-breaks", controlReplacement: "" }), `ab${TAB}c`);
  assert.equal(cleanText(dirty, { stripControl: "c0", collapseWhitespace: true }), "a b c");
  assert.equal(
    cleanText(`ｆ${ZERO_WIDTH_SPACE}ull`, { normalizeUnicode: true, stripControl: "invisible", collapseWhitespace: true }),
    "f ull",
  );
  assert.equal(cleanText(dirty), dirty.trim(), "기본값은 제어 문자를 건드리지 않는다");
});

test("textCleaner는 모듈별 기본값을 고정하고 두 가지 호출 형태를 지원한다", () => {
  const bounded = textCleaner({ maxLength: 4, collapseWhitespace: true });
  assert.equal(bounded(" ab   cdef "), "ab c");
  assert.equal(bounded("abcdef", 2), "ab");
  assert.equal(bounded(undefined), "");

  const withFallback = textCleaner({ fallbackSecond: true, maxLength: 5 });
  assert.equal(withFallback(undefined, "기본"), "기본");
  assert.equal(withFallback("abcdefgh", "", 3), "abc");
  assert.equal(withFallback("abcdefgh"), "abcde");
});

test("배열 콜백으로 직접 넘기면 인덱스가 길이 제한이 되므로 래핑해야 한다", () => {
  const clean = textCleaner();
  // 이 동작이 함정이라는 것을 기록한다: 첫 요소는 인덱스 0 때문에 빈 문자열이 된다.
  assert.deepEqual(["a", "bb"].map(clean), ["", "b"]);
  assert.deepEqual(["a", "bb"].map((value) => clean(value)), ["a", "bb"]);
});
