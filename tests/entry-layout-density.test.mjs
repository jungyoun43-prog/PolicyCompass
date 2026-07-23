import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("개인 홈은 핵심 제목을 두 의미 단위로 고정하고 첫 화면 높이를 제한한다", async () => {
  const [html, css] = await Promise.all([
    readFile("src/landing.html", "utf8"),
    readFile("src/landing.css", "utf8"),
  ]);

  const title = html.match(/<h1 id="landingTitle">[\s\S]*?<\/h1>/)?.[0] ?? "";
  assert.equal((title.match(/<span>/g) ?? []).length, 2);
  assert.match(title, /<span>내 건강 기록을<\/span>/);
  assert.match(title, /<span><em>내가 이어 보는<\/em> 공간\.<\/span>/);
  assert.match(css, /\.landing-hero h1 > span\s*\{[\s\S]*?display:\s*block/);
  assert.match(css, /min-height:\s*clamp\(480px,\s*35vw,\s*520px\)/);
  assert.match(css, /\.landing-page \.landing-shell\s*\{[\s\S]*?padding-top:\s*var\(--space-6\)/);
  assert.doesNotMatch(css, /min-height:\s*650px/);
  assert.doesNotMatch(css, /padding:\s*112px 0/);
});

test("첫 사용 안내는 데스크톱에서 압축된 두 열, 모바일에서 한 열로 흐른다", async () => {
  const css = await readFile("src/landing.css", "utf8");

  assert.match(css, /\.patient-start-path ol\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*?\.patient-start-path ol\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
});

test("역할 선택 카드는 데스크톱에서 같은 열 너비와 같은 세로 리듬을 사용한다", async () => {
  const css = await readFile("src/gateway.css", "utf8");

  assert.match(css, /\.role-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.role-grid\s*\{[\s\S]*?align-items:\s*stretch/);
  assert.match(css, /\.role-card\s*\{[\s\S]*?gap:\s*var\(--space-5\)/);
  assert.match(css, /@media \(max-width: 800px\)[\s\S]*?\.role-grid[\s\S]*?grid-template-columns:\s*1fr/);
});
