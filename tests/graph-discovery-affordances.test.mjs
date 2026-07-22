import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [mapHtml, connectionsHtml, mapCss, explorerCss, connectionsJs, appJs, brandCss] = await Promise.all([
  readFile("src/index.html", "utf8"),
  readFile("src/connections.html", "utf8"),
  readFile("src/body-map.css", "utf8"),
  readFile("src/explorer.css", "utf8"),
  readFile("src/connections.js", "utf8"),
  readFile("src/app.js", "utf8"),
  readFile("src/brand-signals.css", "utf8"),
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
    assert.match(html, new RegExp(attribute), `${route}: ${attribute}`);
  }
}

test("Health Map은 기록, 추론, 선택 상태와 다음 행동을 한 흐름에서 설명한다", () => {
  assertDiscoveryContract(mapHtml, "map");
  assert.match(mapHtml, /처음이라면 이렇게 보세요/);
  assert.match(mapHtml, /기록 신호/);
  assert.match(mapHtml, /추론 관계/);
  assert.match(mapHtml, /진단 아님/);
  assert.match(mapHtml, /현재 선택/);
  assert.match(mapHtml, /다음: 관계와 근거 확인하기/);
  assert.match(mapCss, /\.body-hotspot\.is-current::after[\s\S]*?content: "✓"/);
  assert.match(appJs, /현재 선택됨/);
  assert.match(appJs, /선택됨 ·/);
});

test("Connections는 실제 조작과 일치하는 선택, 확대, 이동 안내를 제공한다", () => {
  assertDiscoveryContract(connectionsHtml, "connections");
  assert.match(connectionsHtml, /노드 클릭·Enter: 선택/);
  assert.match(connectionsHtml, /빈 공간 드래그/);
  assert.match(connectionsHtml, /방향키: 화면 이동/);
  assert.match(connectionsHtml, /휠이나 −\/\+: 확대·축소/);
  assert.match(connectionsHtml, /id="zoomLevel"/);
  assert.match(connectionsHtml, /tabindex="0"[\s\S]*?aria-describedby="sceneInteractionHelp relationshipMeaning"/);
  assert.match(connectionsJs, /elements\.scene\.addEventListener\("pointerdown"/);
  assert.match(connectionsJs, /elements\.scene\.addEventListener\("keydown"/);
  assert.match(connectionsJs, /event\.key === "ArrowLeft"/);
  assert.match(connectionsJs, /function setPan/);
  assert.match(connectionsJs, /function setZoom/);
});

test("Connections는 개인 기록 근거와 문헌 기반 추론 관계를 시각·텍스트로 구분한다", () => {
  assert.match(connectionsHtml, /직접 선택·가져온 질환/);
  assert.match(connectionsHtml, /입력 신호에서 찾은 후보/);
  assert.match(connectionsHtml, /문헌 기반 추론 관계 · 환자 기록 사실 아님/);
  assert.match(connectionsJs, /data-evidence-kind/);
  assert.match(connectionsJs, /isRecorded \? "recorded" : "inferred"/);
  assert.match(connectionsJs, /진단으로 기록된 사실이 아님/);
  assert.match(connectionsJs, /node-selection-ring/);
  assert.match(connectionsJs, /✓ 선택됨/);
  assert.match(explorerCss, /\.scene-edge\.is-inferred[\s\S]*?stroke-dasharray/);
  assert.match(explorerCss, /\.network-node\.is-selected \.node-selection-ring/);
  assert.match(connectionsHtml, /다음: 진료 준비 질문 만들기/);
});

test("연결된 생명 신호 모티프는 두 그래프 화면이 공유하는 코드 기반 브랜드 문법이다", () => {
  for (const html of [mapHtml, connectionsHtml]) {
    assert.match(html, /href="\/brand-signals\.css"/);
    assert.match(html, /class="signal-thread"/);
    assert.match(html, /signal-thread__line--inferred/);
    assert.match(html, /signal-thread__node--recorded/);
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
    assert.ok(brandCss.includes(selector), selector);
  }
  assert.doesNotMatch(`${mapHtml}\n${connectionsHtml}`, /\b(?:DNA|ECG|AI)\b|스파클|반짝이/i);
});
