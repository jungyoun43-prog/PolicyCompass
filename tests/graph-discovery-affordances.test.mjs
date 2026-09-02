import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { declarationsFor, hasRule, stylesheet } from "./helpers/css.mjs";
import { renderPage } from "./helpers/render.mjs";

/** The HTML the server sends for a route's page (effects do not run). */
/** The first rendered element carrying `attribute`, as an opening tag string. */
function openingTagWith(html, attribute) {
  return html.match(new RegExp(`<[a-z]+ [^>]*\\b${attribute}(?:="[^"]*")?[^>]*>`))?.[0] ?? "";
}

const source = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

const [mapHtml, connectionsHtml, mapCss, explorerCss, portalCss, brandCss, connectionsJs, appJs] = await Promise.all([
  renderPage("/map"),
  renderPage("/connections"),
  stylesheet("src/body-map.css"),
  stylesheet("src/explorer.css"),
  stylesheet("src/portal.css"),
  stylesheet("src/brand-signals.css"),
  source("src/connections.js"),
  source("src/app.js"),
]);

function assertDiscoveryContract(html, route) {
  assert.match(html, new RegExp(`data-graph-discovery="${route}"`));
  for (const attribute of [
    "data-graph-legend",
    "data-graph-instructions",
    "data-relationship-meaning",
    "data-selection-state",
    "data-next-action",
  ]) {
    assert.notEqual(openingTagWith(html, attribute), "", `${route}: ${attribute}`);
  }
}

test("Health Map은 기록, 추론, 선택 상태와 다음 행동을 한 흐름에서 설명한다", () => {
  assertDiscoveryContract(mapHtml, "map");
  assert.match(mapHtml, /지도 사용법/);
  assert.match(mapHtml, /기록 신호/);
  assert.match(mapHtml, /추론 관계/);
  assert.match(mapHtml, /진단 아님/);
  assert.match(mapHtml, /현재 선택/);
  assert.match(openingTagWith(mapHtml, "data-selection-state"), /role="status" aria-live="polite"/);
  assert.match(mapHtml, /<a class="primary-button" href="\/connections"[^>]*data-next-action(?:="[^"]*")?[^>]*>다음: 관계와 근거 확인하기<\/a>/);
  assert.equal(declarationsFor(mapCss, ".body-hotspot.is-current::after").content, '"✓"');
  // source-check: the selected-hotspot caption and status text are written by the map controller on click, which needs a document.
  assert.match(appJs, /현재 선택됨/);
  assert.match(appJs, /선택됨 ·/);
});

test("Health Map 관계 미리보기는 합성 표기 예시와 provenance 경계를 분명히 구분한다", () => {
  const preview = mapHtml.match(/<div class="connection-preview">[\s\S]*?<\/div>/)?.[0] ?? "";

  assert.notEqual(preview, "");
  assert.match(preview, /class="preview-node preview-node--recorded/);
  assert.match(preview, /class="preview-node preview-node--inferred/);
  assert.match(preview, /<p class="connection-preview__notice">표기 예시 · 실제 환자 기록 아님<\/p>/);
  assert.doesNotMatch(preview, /고혈압|당뇨병|편두통|이상지질혈증/);
  assert.match(preview, /class="preview-connection preview-connection--inferred"/);
  assert.match(preview, /파일 표시 · 출처 미검증/);
  assert.match(preview, /의료진 확인 안 됨/);
  assert.match(preview, /문헌 관계 · 기록 아님/);
  assert.equal(declarationsFor(portalCss, ".preview-node--recorded > circle").fill, "var(--preview-tone)");
  const inferredNode = declarationsFor(portalCss, ".preview-node--inferred > circle");
  assert.equal(inferredNode.fill, "var(--surface)");
  assert.ok(inferredNode["stroke-dasharray"], "inferred preview nodes are dashed outlines");
  assert.ok(declarationsFor(portalCss, ".preview-connection--inferred")["stroke-dasharray"], "inferred preview connections are dashed");
});

test("Health Map 관계 안내는 제목 아래 설명을 들여 쓰고 한국어 어절을 보존한다", () => {
  assert.match(mapHtml, /<div class="connection-support">/);
  assert.match(mapHtml, /<p class="connection-description"><span>기록과 문헌 관계를 구분/);
  assert.match(mapHtml, /<span class="connection-actions__status" role="status" aria-live="polite">/);
  assert.match(declarationsFor(portalCss, ".connection-support")["margin-left"], /^clamp\(/);
  assert.equal(declarationsFor(portalCss, ".connection-description")["word-break"], "keep-all");
  assert.equal(
    declarationsFor(portalCss, ".connection-support", { container: "@media (max-width: 620px)" })["margin-left"],
    "0",
  );
});

test("Connections는 실제 조작과 일치하는 선택, 확대, 이동 안내를 제공한다", () => {
  assertDiscoveryContract(connectionsHtml, "connections");
  assert.match(connectionsHtml, /클릭·Enter: 선택/);
  assert.match(connectionsHtml, /빈 공간 드래그/);
  assert.match(connectionsHtml, /방향키: 화면 이동/);
  assert.match(connectionsHtml, /휠·−\/\+: 확대·축소/);
  assert.match(connectionsHtml, /<output id="zoomLevel" aria-label="현재 확대 비율">100%<\/output>/);
  assert.match(connectionsHtml, /<p class="visually-hidden" id="sceneInteractionHelp">[\s\S]*?<div class="scene-controls"/);
  assert.equal(declarationsFor(explorerCss, ".explorer-first-use.context-disclosure > summary").color, "var(--ink)");
  const scene = connectionsHtml.match(/<svg class="network-scene"[^>]*>/)?.[0] ?? "";
  assert.match(scene, /id="networkScene"/);
  assert.match(scene, /tabindex="0"/);
  assert.match(scene, /aria-describedby="sceneInteractionHelp relationshipMeaning"/);
  // source-check: pointer, keyboard, pan and zoom handlers attach to the live SVG inside the connections controller, which needs a document.
  assert.match(connectionsJs, /elements\.scene\.addEventListener\("pointerdown"/);
  assert.match(connectionsJs, /elements\.scene\.addEventListener\("keydown"/);
  assert.match(connectionsJs, /event\.key === "ArrowLeft"/);
  assert.match(connectionsJs, /function setPan/);
  assert.match(connectionsJs, /function setZoom/);
});

test("Connections는 개인 기록 근거와 문헌 기반 추론 관계를 시각·텍스트로 구분한다", () => {
  const legend = connectionsHtml.match(/<div class="scene-legend"[\s\S]*?<\/div>/)?.[0] ?? "";

  assert.match(legend, /data-graph-legend/);
  assert.match(legend, /<i class="legend-dot condition-dot" aria-hidden="true"><\/i>파일 표시 · 발행기관·변조 미검증/);
  assert.match(legend, /<i class="legend-dot declared-dot" aria-hidden="true"><\/i>본인 선택 · 의료진 미확인/);
  assert.ok(hasRule(explorerCss, ".legend-dot.declared-dot"), "the declared-by-patient legend dot has its own style");
  assert.doesNotMatch(connectionsHtml, /입력 신호에서 찾은 후보/);
  assert.match(legend, /<span id="relationshipMeaning" data-relationship-meaning(?:="[^"]*")?><i class="legend-line legend-line--inferred" aria-hidden="true"><\/i>점선 · 문헌 추론, 기록 아님<\/span>/);
  // source-check: node provenance (sample / clinical-import / patient) is resolved per node by the connections controller when it builds the SVG scene at runtime.
  assert.match(connectionsJs, /function conditionProvenance\(id\)/);
  assert.match(connectionsJs, /state\.clinicalConditionIds\.includes\(id\)/);
  assert.match(connectionsJs, /source: "clinical-import"/);
  assert.match(connectionsJs, /파일에 의료진 확정으로 표시 · 발행기관·변조 미검증/);
  assert.match(connectionsJs, /source: "patient"/);
  assert.match(connectionsJs, /환자 직접 확인 · 건강 지도에서 직접 선택한 항목 · 의료진 확정 진단 아님/);
  assert.match(connectionsJs, /if \(state\.isDemo\)/);
  assert.match(connectionsJs, /source: "sample"/);
  assert.match(connectionsJs, /합성 예시 · 실제 기록 아님/);
  assert.match(connectionsJs, /data-evidence-kind/);
  assert.match(connectionsJs, /"data-evidence-kind": provenance\.kind/);
  assert.match(connectionsJs, /"data-evidence-source": provenance\.source/);
  assert.match(connectionsJs, /elements\.evidenceKind\.dataset\.provenance = provenance\.source/);
  const clinicalProvenance = connectionsJs.match(
    /if \(state\.clinicalConditionIds\.includes\(id\)\) \{[\s\S]*?\n {2}\}/,
  )?.[0] ?? "";
  assert.match(clinicalProvenance, /파일에 의료진 확정으로 표시/);
  assert.doesNotMatch(clinicalProvenance, /진단(?:으로 기록된 사실이| 사실) 아님|확정 진단 아님/);
  // source-check: the selection ring and "✓ 선택됨" badge are SVG children created by the controller for each node at runtime.
  assert.match(connectionsJs, /node-selection-ring/);
  assert.match(connectionsJs, /✓ 선택됨/);
  assert.ok(declarationsFor(explorerCss, ".scene-edge.is-inferred")["stroke-dasharray"], "inferred edges are dashed");
  assert.equal(declarationsFor(explorerCss, ".network-node.is-selected .node-selection-ring").opacity, "1");
  assert.match(connectionsHtml, /<a class="primary-button" href="\/insights" data-next-action(?:="[^"]*")?>다음: 진료 준비 질문 만들기<\/a>/);
});

test("연결된 생명 신호 모티프는 두 그래프 화면이 공유하는 코드 기반 브랜드 문법이다", async () => {
  for (const html of [mapHtml, connectionsHtml]) {
    assert.match(html, /<span class="signal-thread" aria-hidden="true"><svg\b/);
    assert.match(html, /<path class="signal-thread__line signal-thread__line--inferred"/);
    assert.match(html, /<circle class="signal-thread__node signal-thread__node--recorded"/);
  }
  // source-check: layouts import next/headers through RootShell, which Node cannot render outside a Next request, so the stylesheet import is read from source.
  for (const layout of ["app/(map)/layout.jsx", "app/(connections)/layout.jsx"]) {
    assert.match(await source(layout), /^import "[^"]*\/brand-signals\.css";$/m, layout);
  }
  for (const selector of [
    ".signal-kicker",
    ".signal-thread",
    ".signal-thread__line",
    ".signal-thread__line--inferred",
    ".signal-thread__node",
    ".signal-thread__node--recorded",
    ".signal-thread__node--inferred",
  ]) {
    assert.ok(hasRule(brandCss, selector), selector);
  }
  assert.doesNotMatch(`${mapHtml}\n${connectionsHtml}`, /\b(?:DNA|ECG)\b|스파클|반짝이/i);
});
