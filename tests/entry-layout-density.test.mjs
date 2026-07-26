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

test("개인 홈은 데이터 경계를 독립 섹션 대신 개인 보관 안내에 압축한다", async () => {
  const [html, css] = await Promise.all([
    readFile("src/landing.html", "utf8"),
    readFile("src/landing.css", "utf8"),
  ]);

  const personalCopy = html.match(/<section class="beta"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.doesNotMatch(html, /<section class="data-boundary"/);
  assert.match(personalCopy, /class="beta__copy"[\s\S]*?<\/div>\s*<div class="beta__aside">/);
  assert.match(personalCopy, /class="beta__boundary" id="data-boundary"/);
  assert.match(personalCopy, /class="beta__aside"[\s\S]*?class="beta__boundary"[\s\S]*?내 연결 기록 확인/);
  assert.match(personalCopy, /정제 JSON은 환자가 직접 선택해 보관하는 사본입니다/);
  assert.match(personalCopy, /병원 연결을 위한 업로드 파일이 아니며/);
  assert.match(personalCopy, /프론티어 AI 전송은 별도 동의 없이는 실행되지 않습니다/);
  assert.match(css, /\.beta\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 0\.9fr\) minmax\(0, 1\.1fr\)/);
  assert.match(css, /\.beta\s*\{[\s\S]*?border:\s*1px solid var\(--line\)/);
  assert.match(css, /\.beta\s*\{[\s\S]*?box-shadow:\s*var\(--shadow-panel\)/);
  assert.match(css, /\.beta__copy\s*\{[\s\S]*?min-height:\s*380px[\s\S]*?padding:/);
  assert.match(css, /\.beta__aside\s*\{[\s\S]*?max-width:\s*none[\s\S]*?justify-self:\s*stretch/);
  assert.match(css, /\.beta__aside \.landing-button\s*\{[\s\S]*?width:\s*100%/);
  assert.match(css, /@media \(max-width: 800px\)[\s\S]*?\.beta\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
  assert.doesNotMatch(css, /\.data-boundary\s*\{/);
});

test("다음 진료 CTA는 제목과 분리된 균형 잡힌 열에서 반응형으로 흐른다", async () => {
  const css = await readFile("src/landing.css", "utf8");

  assert.match(css, /\.closing\s*\{[\s\S]*?grid-template-columns:\s*1fr[\s\S]*?justify-items:\s*center/);
  assert.match(css, /\.closing\s*\{[\s\S]*?border:\s*1px solid var\(--line\)/);
  assert.match(css, /\.closing \.landing-actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.closing \.landing-actions\s*\{[\s\S]*?justify-self:\s*center/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*?\.closing \.landing-actions\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
  assert.doesNotMatch(css, /\.closing h2\s*\{[\s\S]*?white-space:\s*nowrap/);
});

test("개인 홈의 아래 섹션은 동작 줄이기를 존중하는 스크롤 리빌을 사용한다", async () => {
  const [html, css, script, build] = await Promise.all([
    readFile("src/landing.html", "utf8"),
    readFile("src/landing.css", "utf8"),
    readFile("src/landing.js", "utf8"),
    readFile("scripts/build.mjs", "utf8"),
  ]);

  assert.equal((html.match(/\sdata-reveal(?:\s|>)/g) ?? []).length, 6);
  assert.match(html, /<script type="module" src="\/landing\.js"><\/script>/);
  assert.match(css, /\.reveal-ready \[data-reveal\]/);
  assert.match(css, /prefers-reduced-motion:\s*reduce[\s\S]*?\[data-reveal\]/);
  assert.match(script, /IntersectionObserver/);
  assert.match(script, /observer\.unobserve\(entry\.target\)/);
  assert.match(script, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)/);
  assert.match(build, /route:\s*"\/landing\.js",\s*file:\s*"src\/landing\.js"/);
});

test("역할 선택 카드는 데스크톱에서 같은 열 너비와 같은 세로 리듬을 사용한다", async () => {
  const css = await readFile("src/gateway.css", "utf8");

  assert.match(css, /\.role-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.role-grid\s*\{[\s\S]*?align-items:\s*stretch/);
  assert.match(css, /\.role-card\s*\{[\s\S]*?gap:\s*var\(--space-5\)/);
  assert.match(css, /@media \(max-width: 800px\)[\s\S]*?\.role-grid[\s\S]*?grid-template-columns:\s*1fr/);
});

test("Journey 첫 기록 안내는 작업 공간 전체를 쓰고 큰 행동·단계 카드로 전환된다", async () => {
  const [html, css] = await Promise.all([
    readFile("src/journey.html", "utf8"),
    readFile("src/journey.css", "utf8"),
  ]);

  assert.match(html, /class="journey-empty"[\s\S]*?class="journey-first-actions"[\s\S]*?class="journey-first-steps"/);
  assert.match(html, /class="journey-empty__visual"[\s\S]*?src="\/assets\/patient-journey-bridge\.webp"/);
  assert.match(css, /\.journey-empty\s*\{[\s\S]*?width:\s*100%[\s\S]*?max-width:\s*none/);
  assert.match(css, /\.journey-empty\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, \.78fr\) minmax\(30rem, 1\.22fr\)/);
  assert.match(css, /\.journey-empty__visual\s*\{[\s\S]*?grid-column:\s*2[\s\S]*?min-height:\s*280px/);
  assert.match(css, /\.journey-first-action\s*\{[\s\S]*?min-height:\s*92px/);
  assert.match(css, /\.journey-first-steps li\s*\{[\s\S]*?min-height:\s*118px/);
  assert.match(css, /@media \(max-width: 1100px\)[\s\S]*?\.journey-empty\s*\{ grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.doesNotMatch(css, /\.journey-empty\s*\{\s*max-width:\s*(?:580|980)px/);
});

test("Journey 변화 비교는 제목을 전체 너비 상단에 두고 세부 내용을 아래에 펼친다", async () => {
  const [html, css] = await Promise.all([
    readFile("src/journey.html", "utf8"),
    readFile("src/journey.css", "utf8"),
  ]);

  assert.match(html, /<section class="journey-comparison"[\s\S]*?<div class="journey-comparison__header">[\s\S]*?<div class="comparison-detail">/);
  assert.match(css, /\.journey-comparison\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(css, /\.journey-comparison__header\s*\{[\s\S]*?width:\s*100%/);
  assert.match(css, /\.comparison-detail\s*\{[\s\S]*?display:\s*grid/);
  assert.doesNotMatch(css, /\.journey-comparison\s*\{[^}]*grid-template-columns:\s*\.7fr 1\.3fr/);
});
