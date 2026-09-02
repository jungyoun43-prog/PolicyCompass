import assert from "node:assert/strict";
import test from "node:test";
import { glob } from "node:fs/promises";

import { declarationsFor, stylesheet } from "./helpers/css.mjs";

// Design tokens are declared on `:root`; later `:root` blocks extend the set.
const foundation = await stylesheet("src/foundation.css");
const insights = await stylesheet("src/insights.css");
const tokens = declarationsFor(foundation, ":root");

const sheets = [];
for await (const path of glob("src/*.css")) sheets.push(await stylesheet(path));

/** Every declaration in every application stylesheet, so consumption checks are structural. */
function everyDeclaration() {
  const declarations = [];
  for (const sheet of sheets) sheet.walkDecls((decl) => declarations.push(decl));
  return declarations;
}

function somethingDeclares(prop, value) {
  return everyDeclaration().some((decl) => decl.prop === prop && decl.value === value);
}

function relativeLuminance(hex) {
  const channels = hex.match(/[\da-f]{2}/gi).map((value) => Number.parseInt(value, 16) / 255);
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(left, right) {
  const values = [relativeLuminance(left), relativeLuminance(right)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function tokenHex(name) {
  const value = tokens[`--${name}`]?.match(/^#([\da-f]{6})$/i)?.[1];
  assert.ok(value, `${name} 색상 토큰`);
  return value;
}

function mixHex(left, right, leftWeight) {
  const channels = [left, right].map((hex) => (
    hex.match(/[\da-f]{2}/gi).map((value) => Number.parseInt(value, 16))
  ));
  return channels[0].map((value, index) => (
    Math.round(value * leftWeight + channels[1][index] * (1 - leftWeight))
      .toString(16)
      .padStart(2, "0")
  )).join("");
}

/**
 * Resolves a declared CSS colour (a hex literal, a token reference or a
 * two-colour sRGB `color-mix` of tokens) to a hex string, so contrast checks
 * follow whatever the stylesheet actually says rather than a copied weight.
 */
function resolveHex(value) {
  const literal = value.match(/^#([\da-f]{6})$/i);
  if (literal) return literal[1];
  const reference = value.match(/^var\(--([\w-]+)\)$/);
  if (reference) return tokenHex(reference[1]);
  const mix = value.match(/^color-mix\(in srgb,\s*(?<left>[^,]+?)\s+(?<weight>\d+)%,\s*(?<right>.+)\)$/);
  assert.ok(mix, `해석 가능한 색상 값: ${value}`);
  return mixHex(resolveHex(mix.groups.left), resolveHex(mix.groups.right), Number(mix.groups.weight) / 100);
}

test("공통 임상 토큰은 밝은 녹색 표면과 짙은 숲색 계층을 제공한다", () => {
  assert.equal(tokens["--surface"], "#fafbfa");
  assert.equal(tokens["--surface-soft"], "#f1f3f1");
  assert.equal(tokens["--surface-inverse"], "#1b5e20");
  assert.equal(tokens["--on-inverse"], "#f8fcf8");
  assert.equal(tokens["--ink"], "#20261f");
  assert.equal(tokens["--accent"], "#1b5e20");
  assert.equal(tokens["--accent-mid"], "#66bb6a");
  assert.equal(tokens["--accent-soft"], "#a5d6a7");
  assert.equal(tokens["--accent-wash"], "#e8f5e9");
  assert.equal(tokens["--data-lime"], "#477a43");
  assert.equal(tokens["--status-success-text"], "#2f6b34");
  assert.equal(tokens["--status-success-on-dark"], "#a5d6a7");
  assert.equal(tokens["--data-amber"], "#b66b12");
  assert.equal(tokens["--urgent"], "#b4232d");
});

test("공통 임상 토큰은 기존의 밝은 코럴 및 보라 그림자 팔레트를 제거한다", () => {
  for (const [name, value] of Object.entries(tokens)) {
    assert.doesNotMatch(value, /#f05a47|#8b72e8|0 24px 70px/i, name);
  }
  assert.equal(tokens["--shadow-panel"], "0 10px 30px color-mix(in srgb, var(--ink) 8%, transparent)");
});

test("타입·간격·반경·테두리·고도·밀도 토큰은 선언되고 실제 기반 규칙에서 소비된다", () => {
  const declarations = everyDeclaration();
  for (const token of [
    "font-sans",
    "font-size-body",
    "line-height-body",
    "space-4",
    "radius-control",
    "radius-panel",
    "border-subtle",
    "shadow-panel",
    "density-header",
  ]) {
    assert.ok(`--${token}` in tokens, `${token} 선언`);
    assert.ok(
      declarations.some((decl) => decl.prop !== `--${token}` && decl.value.includes(`var(--${token})`)),
      `${token} 소비`,
    );
  }
});

test("컨트롤 경계·포커스·어두운 표면 경고 토큰은 비텍스트 및 소형 텍스트 대비를 충족한다", () => {
  assert.equal(tokens["--line-strong"], "#7d8a7e");
  assert.equal(tokens["--focus-ring"], "var(--accent)");
  assert.equal(tokens["--status-amber-on-dark"], "#f2c66d");
  assert.ok(contrast("7d8a7e", "fafbfa") >= 3);
  assert.ok(contrast("7d8a7e", "f1f3f1") >= 3);
  assert.ok(contrast("1b5e20", "fafbfa") >= 3);
  assert.ok(contrast("2f6b34", "fafbfa") >= 4.5);
  assert.ok(contrast("2f6b34", "f1f3f1") >= 4.5);
  assert.ok(contrast("477a43", "fafbfa") >= 4.5);
  assert.ok(contrast("477a43", "f1f3f1") >= 4.5);
  assert.ok(contrast("a5d6a7", "20261f") >= 3);
  assert.ok(contrast("66bb6a", "20261f") >= 3);
  assert.ok(contrast("f2c66d", "1b5e20") >= 4.5);
  assert.ok(somethingDeclares("outline", "3px solid var(--focus-ring)"), "포커스 링 소비");
  assert.ok(somethingDeclares("border", "1px solid var(--line-strong)"), "강한 경계선 소비");
});

test("질문 브리프의 대기 배지와 빈 상태 번호는 렌더링 대비 기준을 충족한다", () => {
  const badge = declarationsFor(insights, ".insight-status .connection-badge");
  const emptyIndex = declarationsFor(insights, ".brief-empty__index");
  assert.equal(badge.color, "color-mix(in srgb, var(--muted) 82%, var(--ink))");
  assert.equal(emptyIndex.color, "var(--line-strong)");

  // Contrast is computed from the colours the rules actually declare.
  assert.ok(contrast(resolveHex(badge.color), resolveHex(badge.background)) >= 4.5);
  assert.ok(contrast(resolveHex(emptyIndex.color), tokenHex("surface-raised")) >= 3);
});
