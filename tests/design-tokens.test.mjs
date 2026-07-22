import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";

const foundation = await readFile("src/foundation.css", "utf8");
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

test("공통 임상 토큰은 따뜻한 표면과 짙은 청록 계층을 제공한다", () => {
  assert.match(root, /--surface: #fbfaf7;/);
  assert.match(root, /--surface-soft: #f3f1eb;/);
  assert.match(root, /--ink: #123c3b;/);
  assert.match(root, /--accent: #0b6663;/);
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
  assert.match(root, /--line-strong: #758882;/);
  assert.match(root, /--focus-ring: var\(--accent\);/);
  assert.match(root, /--status-amber-on-dark: #e5a857;/);
  assert.ok(contrast("758882", "fbfaf7") >= 3);
  assert.ok(contrast("758882", "f3f1eb") >= 3);
  assert.ok(contrast("0b6663", "fbfaf7") >= 3);
  assert.ok(contrast("e5a857", "123c3b") >= 4.5);
  assert.match(applicationCss, /outline: 3px solid var\(--focus-ring\)/);
  assert.match(applicationCss, /border: 1px solid var\(--line-strong\)/);
});
