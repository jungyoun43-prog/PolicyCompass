import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { pageMarkup } from "./helpers/markup.mjs";

const [shell, controls, gateway, landing, insights, insightsCss, insightsScript, mapHtml, mapCss, hierarchyCss, connections, explorerCss, journey, journeyCss, captureScript] = await Promise.all([
  readFile("src/shell.css", "utf8"),
  readFile("src/controls.css", "utf8"),
  readFile("src/gateway.css", "utf8"),
  readFile("src/landing.css", "utf8"),
  pageMarkup("/insights"),
  readFile("src/insights.css", "utf8"),
  readFile("src/insights.js", "utf8"),
  pageMarkup("/map"),
  readFile("src/body-map.css", "utf8"),
  readFile("src/clinician-hierarchy.css", "utf8"),
  pageMarkup("/connections"),
  readFile("src/explorer.css", "utf8"),
  pageMarkup("/journey"),
  readFile("src/journey.css", "utf8"),
  readFile("scripts/visual-layout-capture.mjs", "utf8"),
]);

test("동급 Personal 화면은 72px 이하의 공통 hero 위계와 한 흐름의 설명을 사용한다", () => {
  assert.match(shell, /\.page-hero h1\s*\{[\s\S]*?font-size: clamp\(2\.5rem, 4\.4vw, 4\.35rem\)/);
  assert.match(gateway, /\.gateway-intro h1\s*\{[\s\S]*?font-size: clamp\(2\.75rem, 4\.6vw, 4\.5rem\)/);

  for (const html of [mapHtml, connections, insights, journey]) {
    const hero = html.match(/<section class="page-hero[\s\S]*?<\/section>/)?.[0] ?? "";
    assert.match(hero, /<h1[^>]*>[\s\S]*?<\/h1>\s*<p class="page-hero__lead"/);
  }
});

test("질문 목록은 핵심 질문과 선택만 먼저 보이고 질문별 근거는 개별 disclosure로 연다", () => {
  assert.match(insightsScript, /detailDisclosure\.className = "question-detail-disclosure context-disclosure context-disclosure--compact"/);
  assert.match(insightsScript, /createTextElement\("summary", "", "질문 근거 보기"\)/);
  assert.match(insightsScript, /detailSummary\.setAttribute\("aria-label", `\$\{item\.question\} · 질문 근거 보기`\)/);
  assert.match(insightsScript, /copy\.append\(detailDisclosure, selectControl\)/);
  assert.match(insights, /<details class="signal-card context-disclosure"/);
  assert.match(insights, /class="question-safety-boundary">진료 준비용 질문 · 진단·처방·응급 판단 아님/);
  assert.match(insightsCss, /@media print[\s\S]*?\.question-detail-disclosure:not\(\[open\]\) > \.question-detail\s*\{[\s\S]*?display: grid/);
});

test("시각 캡처 route 필터는 오타를 성공으로 처리하지 않는다", () => {
  assert.match(captureScript, /unknownRouteNames[\s\S]*?throw new Error\(`Unknown VISUAL_CAPTURE_ROUTES:/);
  assert.match(captureScript, /unknownViewportNames[\s\S]*?throw new Error\(`Unknown VISUAL_CAPTURE_VIEWPORTS:/);
  assert.match(captureScript, /focusedOnly && routes\.some[\s\S]*?supported only for the map route/);
  assert.match(captureScript, /scrollIntoView\(\{ block: 'center' \}\)[\s\S]*?dataset\.body3dState === 'ready'[\s\S]*?focusedPath/);
});

test("모바일 건강 지도는 핵심 업데이트와 3D 본문을 위로 당기되 설명은 접근성 트리에 남긴다", () => {
  assert.match(shell, /\.map-page \.input-panel \.session-badge \{ display: none; \}/);
  assert.match(shell, /\.map-page \.field-hint\s*\{[\s\S]*?clip-path: inset\(50%\)/);
  assert.match(shell, /\.map-page \.body-stage \{ order: 2; \}/);
  assert.match(shell, /\.map-page \.body-key \{ order: 3; \}/);
  assert.match(shell, /\.map-page \.map-first-use \{ order: 4; \}/);
  assert.match(shell, /\.map-page \.department-disclosure \{ order: 7; \}/);
  assert.match(mapHtml, /<details class="department-disclosure context-disclosure context-disclosure--compact">/);
  assert.match(mapHtml, /<\/form>\s*<section class="safety-banner safety-banner--input"/);
  assert.match(mapHtml, /aria-describedby="inputHint formError"/);
});

test("건강 지도 hero는 카드 경계와 충분한 안쪽 여백을 두고 태블릿에서 한 열로 전환한다", () => {
  assert.match(
    controls,
    /\.map-page \.map-hero\s*\{[^}]*gap: clamp\(var\(--space-6\), 4vw, var\(--space-12\)\)[^}]*margin: 0 0 var\(--space-5\)[^}]*padding: clamp\(var\(--space-6\), 3\.2vw, var\(--space-10\)\)/,
  );
  assert.match(
    controls,
    /@media \(max-width: 800px\)\s*\{[\s\S]*?\.map-page \.map-hero,[\s\S]*?grid-template-columns: 1fr/,
  );
});

test("지도 사용법 제목과 보조 순서는 한 줄 요약 뒤에 내용이 이어진다", () => {
  assert.match(mapCss, /\.map-first-use\s*\{[^}]*grid-template-columns: 1fr[^}]*gap: var\(--space-3\)/);
  assert.match(mapCss, /\.map-first-use > summary\s*\{[^}]*width: 100%/);
  assert.match(mapCss, /\.map-first-use > summary small\s*\{[^}]*white-space: nowrap/);
});

test("Insights 보조 레일은 외곽 카드가 아니라 내부 카드의 면과 그림자로 구분한다", () => {
  const borderedGroups = hierarchyCss.match(/\.clinician-hierarchy__groups :where\([^)]*\)\s*\{\s*border:/)?.[0] ?? "";
  assert.ok(borderedGroups);
  assert.doesNotMatch(borderedGroups, /\.brief-rail/);
  assert.match(insightsCss, /\.question-panel,\s*\.snapshot-card,\s*\.signal-card,\s*\.method-card\s*\{[^}]*background: var\(--surface-raised\)[^}]*box-shadow: var\(--shadow-panel\)/);
  assert.match(insightsCss, /@media \(max-width: 800px\)[\s\S]*?\.brief-rail > \.snapshot-card\s*\{[^}]*grid-column: 1 \/ -1/);
  assert.match(insightsCss, /@media \(max-width: 620px\)[\s\S]*?\.brief-rail > \.snapshot-card\s*\{[^}]*grid-column: auto/);
});

test("태블릿 역할 선택은 두 카드를 비교하고 모바일에서만 한 열로 전환한다", () => {
  const tabletBlock = gateway.slice(gateway.indexOf("@media (max-width: 800px)"), gateway.indexOf("@media (max-width: 620px)"));
  const mobileBlock = gateway.slice(gateway.indexOf("@media (max-width: 620px)"));
  assert.doesNotMatch(tabletBlock, /\.role-grid[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(mobileBlock, /\.role-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
});

test("환자 랜딩의 다음 핵심 구간은 상단 정렬과 짧은 section rhythm을 사용한다", () => {
  assert.match(landing, /\.outcome,[\s\S]*?\.closing\s*\{[\s\S]*?padding: clamp\(40px, 4vw, 56px\) 0/);
  assert.match(landing, /\.outcome\s*\{[\s\S]*?align-items: start/);
});

test("비동작 정보는 버튼이나 선택 chip의 면을 사용하지 않는다", () => {
  assert.match(explorerCss, /\.edge-caption__surface\s*\{[^}]*fill: none[^}]*stroke: none/);
  assert.match(explorerCss, /\.edge-caption\.is-active \.edge-caption__surface\s*\{[^}]*fill: none[^}]*stroke: none/);
  assert.match(explorerCss, /\.edge-caption__text\s*\{[^}]*paint-order: stroke fill/);
  const explorerMediumBlock = explorerCss.slice(explorerCss.indexOf("@media (max-width: 1080px)"), explorerCss.indexOf("@media (max-width: 800px)"));
  assert.match(explorerMediumBlock, /\.explorer-first-use\s*\{[^}]*grid-template-columns: 1fr/);
  assert.match(explorerMediumBlock, /\.edge-caption__text\s*\{[^}]*stroke-width: 8px[^}]*font-size: 20px/);
  const explorerTabletBlock = explorerCss.slice(explorerCss.indexOf("@media (max-width: 800px)"), explorerCss.indexOf("@media (max-width: 620px)"));
  assert.match(explorerTabletBlock, /\.edge-caption__text\s*\{[^}]*stroke-width: 10px[^}]*font-size: 24px/);
  assert.match(gateway, /\.gateway-header__status\s*\{[^}]*border: 0[^}]*border-radius: 0/);
  assert.match(gateway, /\.gateway-header__status::before\s*\{[^}]*border-radius: 50%/);
  assert.match(landing, /\.brief-preview__signals span\s*\{[^}]*border: 0[^}]*border-radius: 0[^}]*background: transparent[^}]*padding: 0[^}]*pointer-events: none/);
});

test("내용이 짧은 넓은 hero는 정보량에 맞는 최대 폭을 사용한다", () => {
  assert.match(gateway, /\.gateway-intro\s*\{[^}]*width: min\(100%, 58rem\)/);
  assert.match(journeyCss, /\.journey-page \.journey-intro\s*\{[^}]*width: min\(100%, 64rem\)/);
});
