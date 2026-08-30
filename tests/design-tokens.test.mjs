import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";

const foundation = await readFile("src/foundation.css", "utf8");
const insights = await readFile("src/insights.css", "utf8");
const root = foundation.match(/:root\s*\{(?<tokens>[\s\S]*?)\}/)?.groups?.tokens ?? "";
const cssPaths = [];
for await (const path of glob("src/*.css")) cssPaths.push(path);
const applicationCss = (await Promise.all(cssPaths.map((path) => readFile(path, "utf8")))).join("\n");

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
  const value = root.match(new RegExp(`--${name}:\\s*#([\\da-f]{6});`, "i"))?.[1];
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

test("공통 임상 토큰은 밝은 녹색 표면과 짙은 숲색 계층을 제공한다", () => {
  assert.match(root, /--surface: #fafbfa;/);
  assert.match(root, /--surface-soft: #f1f3f1;/);
  assert.match(root, /--surface-inverse: #1b5e20;/);
  assert.match(root, /--on-inverse: #f8fcf8;/);
  assert.match(root, /--ink: #20261f;/);
  assert.match(root, /--accent: #1b5e20;/);
  assert.match(root, /--accent-mid: #66bb6a;/);
  assert.match(root, /--accent-soft: #a5d6a7;/);
  assert.match(root, /--accent-wash: #e8f5e9;/);
  assert.match(root, /--data-lime: #477a43;/);
  assert.match(root, /--status-success-text: #2f6b34;/);
  assert.match(root, /--status-success-on-dark: #a5d6a7;/);
  assert.match(root, /--data-amber: #b66b12;/);
  assert.match(root, /--urgent: #b4232d;/);
});

test("공통 임상 토큰은 기존의 밝은 코럴 및 보라 그림자 팔레트를 제거한다", () => {
  assert.doesNotMatch(root, /#f05a47|#8b72e8|0 24px 70px/i);
  assert.match(root, /--shadow-panel: 0 10px 30px color-mix\(in srgb, var\(--ink\) 8%, transparent\);/);
});

test("타입·간격·반경·테두리·고도·밀도 토큰은 선언되고 실제 기반 규칙에서 소비된다", () => {
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
    assert.match(root, new RegExp(`--${token}:`), `${token} 선언`);
    assert.ok(
      applicationCss.includes(`var(--${token})`),
      `${token} 소비`,
    );
  }
});

test("컨트롤 경계·포커스·어두운 표면 경고 토큰은 비텍스트 및 소형 텍스트 대비를 충족한다", () => {
  assert.match(root, /--line-strong: #7d8a7e;/);
  assert.match(root, /--focus-ring: var\(--accent\);/);
  assert.match(root, /--status-amber-on-dark: #f2c66d;/);
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
  assert.match(applicationCss, /outline: 3px solid var\(--focus-ring\)/);
  assert.match(applicationCss, /border: 1px solid var\(--line-strong\)/);
});

test("질문 브리프의 대기 배지와 빈 상태 번호는 렌더링 대비 기준을 충족한다", () => {
  assert.match(
    insights,
    /\.insight-status \.connection-badge\s*\{[\s\S]*?color: color-mix\(in srgb, var\(--muted\) 82%, var\(--ink\)\);/,
  );
  assert.match(
    insights,
    /\.brief-empty__index\s*\{[\s\S]*?color: var\(--line-strong\);/,
  );

  const badgeForeground = mixHex(tokenHex("muted"), tokenHex("ink"), 0.82);
  const badgeBackground = mixHex(tokenHex("line"), tokenHex("surface"), 0.58);
  assert.ok(contrast(badgeForeground, badgeBackground) >= 4.5);
  assert.ok(contrast(tokenHex("line-strong"), tokenHex("surface-raised")) >= 3);
});
