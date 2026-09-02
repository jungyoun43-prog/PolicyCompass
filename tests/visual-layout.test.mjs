import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ConnectionsPage from "../app/(connections)/connections/page.jsx";
import InsightsPage from "../app/(insights)/insights/page.jsx";
import JourneyPage from "../app/(journey)/journey/page.jsx";
import MapPage from "../app/(map)/map/page.jsx";
import { declarationsFor, rulesFor, selectorsMatching, stylesheet } from "./helpers/css.mjs";
import { renderComponent } from "./helpers/render.mjs";

const [shell, controls, gateway, landing, insightsCss, insightsScript, mapCss, hierarchyCss, explorerCss, journeyCss, captureScript] = await Promise.all([
  stylesheet("src/shell.css"),
  stylesheet("src/controls.css"),
  stylesheet("src/gateway.css"),
  stylesheet("src/landing.css"),
  stylesheet("src/insights.css"),
  readFile("src/insights.js", "utf8"),
  stylesheet("src/body-map.css"),
  stylesheet("src/clinician-hierarchy.css"),
  stylesheet("src/explorer.css"),
  stylesheet("src/journey.css"),
  readFile("scripts/visual-layout-capture.mjs", "utf8"),
]);
const insights = renderComponent(InsightsPage);
const mapHtml = renderComponent(MapPage);
const connections = renderComponent(ConnectionsPage);
const journey = renderComponent(JourneyPage);

const TABLET = "@media (max-width: 800px)";
const MOBILE = "@media (max-width: 620px)";
const MEDIUM = "@media (max-width: 1080px)";

/**
 * Declarations of the top-level rule whose selector list names every one of
 * `selectors` together (the shared treatment), or {} when no such rule exists.
 */
function sharedRuleDeclarations(sheet, selectors) {
  const [first, ...rest] = selectors;
  const rule = rulesFor(sheet, first).find((candidate) => {
    const list = candidate.selectors.map((selector) => selector.replace(/\s+/g, " ").trim());
    return rest.every((selector) => list.includes(selector));
  });
  const declarations = {};
  rule?.walkDecls((decl) => { declarations[decl.prop] = decl.value; });
  return declarations;
}

/** The first element with `className` in its class list, from its opening tag to its closing tag (no nesting of the same tag assumed). */
function elementWithClass(html, tag, className) {
  const pattern = new RegExp(`<${tag} class="(?:[^"]* )?${className}(?: [^"]*)?"[^>]*>[\\s\\S]*?<\\/${tag}>`);
  return html.match(pattern)?.[0] ?? "";
}

test("동급 Personal 화면은 72px 이하의 공통 hero 위계와 한 흐름의 설명을 사용한다", () => {
  assert.equal(declarationsFor(shell, ".page-hero h1")["font-size"], "clamp(2.5rem, 4.4vw, 4.35rem)");
  assert.equal(declarationsFor(gateway, ".gateway-intro h1")["font-size"], "clamp(2.75rem, 4.6vw, 4.5rem)");

  for (const html of [mapHtml, connections, insights, journey]) {
    const hero = elementWithClass(html, "section", "page-hero");
    assert.ok(hero, "각 화면은 page-hero 섹션으로 시작해야 한다");
    assert.match(hero, /<h1[^>]*>[\s\S]*?<\/h1>\s*<p class="page-hero__lead"/);
  }
});

test("질문 목록은 핵심 질문과 선택만 먼저 보이고 질문별 근거는 개별 disclosure로 연다", () => {
  // source-check: insights.js builds each question's disclosure in the browser at render time; SSR ships an empty list, so only the controller source shows the per-question disclosure structure.
  assert.match(insightsScript, /detailDisclosure\.className = "question-detail-disclosure context-disclosure context-disclosure--compact"/);
  assert.match(insightsScript, /createTextElement\("summary", "", "질문 근거 보기"\)/);
  assert.match(insightsScript, /detailSummary\.setAttribute\("aria-label", `\$\{item\.question\} · 질문 근거 보기`\)/);
  assert.match(insightsScript, /copy\.append\(detailDisclosure, selectControl\)/);
  assert.match(insights, /<details class="signal-card context-disclosure"/);
  assert.match(insights, /class="question-safety-boundary">진료 준비용 질문 · 진단·처방·응급 판단 아님</);
  assert.equal(
    declarationsFor(insightsCss, "body.insights-page .question-detail-disclosure:not([open]) > .question-detail", { container: "@media print" }).display,
    "grid",
  );
});

test("시각 캡처 route 필터는 오타를 성공으로 처리하지 않는다", () => {
  // source-check: the capture script is a browser automation entry point; its argument validation only runs with a real browser attached.
  assert.match(captureScript, /unknownRouteNames[\s\S]*?throw new Error\(`Unknown VISUAL_CAPTURE_ROUTES:/);
  assert.match(captureScript, /unknownViewportNames[\s\S]*?throw new Error\(`Unknown VISUAL_CAPTURE_VIEWPORTS:/);
  assert.match(captureScript, /focusedOnly && routes\.some[\s\S]*?supported only for the map route/);
  assert.match(captureScript, /scrollIntoView\(\{ block: 'center' \}\)[\s\S]*?dataset\.body3dState === 'ready'[\s\S]*?focusedPath/);
});

test("모바일 건강 지도는 핵심 업데이트와 3D 본문을 위로 당기되 설명은 접근성 트리에 남긴다", () => {
  const mobile = (selector) => declarationsFor(shell, selector, { container: MOBILE });
  assert.equal(mobile(".map-page .input-panel .session-badge").display, "none");
  assert.equal(mobile(".map-page .field-hint")["clip-path"], "inset(50%)");
  assert.notEqual(mobile(".map-page .field-hint").display, "none", "입력 힌트는 숨기되 접근성 트리에는 남아야 한다");
  assert.equal(mobile(".map-page .body-stage").order, "2");
  assert.equal(mobile(".map-page .body-key").order, "3");
  assert.equal(mobile(".map-page .map-first-use").order, "4");
  assert.equal(mobile(".map-page .department-disclosure").order, "7");
  assert.match(mapHtml, /<details class="department-disclosure context-disclosure context-disclosure--compact">/);
  assert.match(mapHtml, /<\/form>\s*<section class="safety-banner safety-banner--input"/);
  assert.match(mapHtml, /aria-describedby="inputHint formError"/);
});

test("건강 지도 hero는 카드 경계와 충분한 안쪽 여백을 두고 태블릿에서 한 열로 전환한다", () => {
  const hero = declarationsFor(controls, ".map-page .map-hero");
  assert.equal(hero.gap, "clamp(var(--space-6), 4vw, var(--space-12))");
  assert.equal(hero.margin, "0 0 var(--space-5)");
  assert.equal(hero.padding, "clamp(var(--space-6), 3.2vw, var(--space-10))");
  assert.equal(declarationsFor(controls, ".map-page .map-hero", { container: TABLET })["grid-template-columns"], "1fr");
});

test("지도 사용법 제목과 보조 순서는 한 줄 요약 뒤에 내용이 이어진다", () => {
  const firstUse = declarationsFor(mapCss, ".map-first-use");
  assert.equal(firstUse["grid-template-columns"], "1fr");
  assert.equal(firstUse.gap, "var(--space-3)");
  assert.equal(declarationsFor(mapCss, ".map-first-use > summary").width, "100%");
  assert.equal(declarationsFor(mapCss, ".map-first-use > summary small")["white-space"], "nowrap");
});

test("Insights 보조 레일은 외곽 카드가 아니라 내부 카드의 면과 그림자로 구분한다", () => {
  const borderedGroups = selectorsMatching(hierarchyCss, /^\.clinician-hierarchy__groups :where\(/)
    .filter((selector) => declarationsFor(hierarchyCss, selector).border);
  assert.ok(borderedGroups.length > 0);
  for (const selector of borderedGroups) assert.doesNotMatch(selector, /\.brief-rail/);
  // 네 카드가 공유하는 면 처리: 밝은 면과 패널 그림자. (.method-card는 뒤에서 어두운 카드로 덮어쓴다.)
  const cards = [".question-panel", ".snapshot-card", ".signal-card", ".method-card"];
  const shared = sharedRuleDeclarations(insightsCss, cards);
  assert.equal(shared.background, "var(--surface-raised)");
  assert.equal(shared["box-shadow"], "var(--shadow-panel)");
  for (const selector of cards.slice(0, 3)) {
    const card = declarationsFor(insightsCss, selector);
    assert.equal(card.background, "var(--surface-raised)", selector);
    assert.equal(card["box-shadow"], "var(--shadow-panel)", selector);
  }
  assert.equal(declarationsFor(insightsCss, ".brief-rail > .snapshot-card", { container: TABLET })["grid-column"], "1 / -1");
  assert.equal(declarationsFor(insightsCss, ".brief-rail > .snapshot-card", { container: MOBILE })["grid-column"], "auto");
});

test("태블릿 역할 선택은 두 카드를 비교하고 모바일에서만 한 열로 전환한다", () => {
  assert.notEqual(declarationsFor(gateway, ".role-grid", { container: TABLET })["grid-template-columns"], "1fr");
  assert.equal(declarationsFor(gateway, ".role-grid", { container: MOBILE })["grid-template-columns"], "1fr");
});

test("환자 랜딩의 다음 핵심 구간은 상단 정렬과 짧은 section rhythm을 사용한다", () => {
  // 세 구간이 공유하는 짧은 section rhythm. (.closing은 뒤에서 카드 안쪽 여백으로 덮어쓴다.)
  assert.equal(sharedRuleDeclarations(landing, [".outcome", ".workflow", ".closing"]).padding, "clamp(40px, 4vw, 56px) 0");
  const outcome = declarationsFor(landing, ".outcome");
  assert.equal(outcome.padding, "clamp(40px, 4vw, 56px) 0");
  assert.equal(outcome["align-items"], "start");
});

test("비동작 정보는 버튼이나 선택 chip의 면을 사용하지 않는다", () => {
  for (const selector of [".edge-caption__surface", ".edge-caption.is-active .edge-caption__surface"]) {
    const surface = declarationsFor(explorerCss, selector);
    assert.equal(surface.fill, "none", selector);
    assert.equal(surface.stroke, "none", selector);
  }
  assert.equal(declarationsFor(explorerCss, ".edge-caption__text")["paint-order"], "stroke fill");
  assert.equal(declarationsFor(explorerCss, ".explorer-first-use", { container: MEDIUM })["grid-template-columns"], "1fr");
  const mediumCaption = declarationsFor(explorerCss, ".edge-caption__text", { container: MEDIUM });
  assert.equal(mediumCaption["stroke-width"], "8px");
  assert.equal(mediumCaption["font-size"], "20px");
  const tabletCaption = declarationsFor(explorerCss, ".edge-caption__text", { container: TABLET });
  assert.equal(tabletCaption["stroke-width"], "10px");
  assert.equal(tabletCaption["font-size"], "24px");
  const status = declarationsFor(gateway, ".gateway-header__status");
  assert.equal(status.border, "0");
  assert.equal(status["border-radius"], "0");
  assert.equal(declarationsFor(gateway, ".gateway-header__status::before")["border-radius"], "50%");
  const signal = declarationsFor(landing, ".brief-preview__signals span");
  assert.equal(signal.border, "0");
  assert.equal(signal["border-radius"], "0");
  assert.equal(signal.background, "transparent");
  assert.equal(signal.padding, "0");
  assert.equal(signal["pointer-events"], "none");
});

test("내용이 짧은 넓은 hero는 정보량에 맞는 최대 폭을 사용한다", () => {
  assert.equal(declarationsFor(gateway, ".gateway-intro").width, "min(100%, 58rem)");
  assert.equal(declarationsFor(journeyCss, ".journey-page .journey-intro").width, "min(100%, 64rem)");
});
