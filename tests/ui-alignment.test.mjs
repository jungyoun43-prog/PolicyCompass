import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("공통 헤더와 보조 버튼은 44px 클릭 영역을 로고 주변에만 둔다", async () => {
  const [shell, foundation] = await Promise.all([
    readFile("src/shell.css", "utf8"),
    readFile("src/foundation.css", "utf8"),
  ]);

  assert.match(shell, /\.app-brand\s*\{[\s\S]*?width:\s*fit-content[\s\S]*?min-height:\s*44px[\s\S]*?justify-self:\s*start/);
  assert.match(shell, /\.app-nav a\s*\{[\s\S]*?min-width:\s*44px[\s\S]*?min-height:\s*44px/);
  assert.match(shell, /\.skip-link\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(foundation, /\.text-button\s*\{[\s\S]*?min-height:\s*44px/);
});

test("연결 탐색은 그래프와 근거를 위아래로 분리하고 근거 링크에 충분한 클릭 영역을 둔다", async () => {
  const [html, css] = await Promise.all([
    readFile("src/connections.html", "utf8"),
    readFile("src/explorer.css", "utf8"),
  ]);

  assert.match(html, /class="explorer-detail__identity"/);
  assert.match(html, /class="explorer-detail__guidance"/);
  assert.match(html, /class="explorer-detail__evidence"/);
  assert.match(css, /\.explorer-workspace\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(css, /\.explorer-detail\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 0\.82fr\)/);
  assert.match(css, /\.evidence-card a\s*\{[\s\S]*?min-height:\s*44px/);
});

test("Journey는 비교 전에는 긴 변화 상세를 숨기고 모바일 백업 버튼 폭을 제한한다", async () => {
  const [html, css, script] = await Promise.all([
    readFile("src/journey.html", "utf8"),
    readFile("src/journey.css", "utf8"),
    readFile("src/journey.js", "utf8"),
  ]);

  assert.match(html, /id="journeyComparisonDetail" hidden/);
  assert.match(script, /elements\.comparisonDetail\.hidden = journey\.length < 2/);
  assert.match(css, /\.comparison-detail\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(css, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
});

test("EMR 모바일은 서명 전에 급여 점검을 보여 주고 스크롤 목록 경계를 알린다", async () => {
  const [html, css, script] = await Promise.all([
    readFile("src/emr.html", "utf8"),
    readFile("src/emr.css", "utf8"),
    readFile("src/emr.js", "utf8"),
  ]);

  const mobileClaimIndex = html.indexOf('class="clinical-card encounter-mobile-claim"');
  const saveBarIndex = html.indexOf('class="encounter-save-bar"');
  assert.ok(mobileClaimIndex > 0 && mobileClaimIndex < saveBarIndex);
  assert.match(html, /id="completeEncounter"[^>]*clinical-button--primary|clinical-button--primary" id="completeEncounter"/);
  assert.match(html, /clinical-button--confirm" id="signEncounter"/);
  assert.match(css, /\.text-action\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(css, /\.patient-list\s*\{[\s\S]*?scroll-snap-type:\s*x proximity/);
  assert.match(css, /\.workspace-tabs\[data-scroll-position="middle"\]/);
  assert.match(script, /function updateHorizontalScrollPosition\(container\)/);
  assert.match(script, /centerSelectedPatientCard\(button\.dataset\.patientId\)/);
});
