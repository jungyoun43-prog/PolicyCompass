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
  assert.match(mapHtml, /지도 사용법/);
  assert.match(mapHtml, /기록 신호/);
  assert.match(mapHtml, /추론 관계/);
  assert.match(mapHtml, /진단 아님/);
  assert.match(mapHtml, /현재 선택/);
  assert.match(mapHtml, /다음: 관계와 근거 확인하기/);
  assert.match(mapCss, /\.body-hotspot\.is-current::after[\s\S]*?content: "✓"/);
  assert.match(appJs, /현재 선택됨/);
  assert.match(appJs, /선택됨 ·/);
});

test("Health Map 관계 미리보기는 합성 표기 예시와 provenance 경계를 분명히 구분한다", async () => {
  const portalCss = await readFile("src/portal.css", "utf8");

  assert.match(mapHtml, /preview-node preview-node--recorded/);
  assert.match(mapHtml, /preview-node preview-node--inferred/);
  assert.match(mapHtml, /표기 예시 · 실제 환자 기록 아님/);
  assert.doesNotMatch(mapHtml.match(/<div class="connection-preview">[\s\S]*?<\/div>/)?.[0] ?? "", /고혈압|당뇨병|편두통|이상지질혈증/);
  assert.match(mapHtml, /preview-connection preview-connection--inferred/);
  assert.match(mapHtml, /파일 표시 · 출처 미검증/);
  assert.match(mapHtml, /의료진 확인 안 됨/);
  assert.match(mapHtml, /문헌 관계 · 기록 아님/);
  assert.match(portalCss, /\.preview-node--recorded > circle[\s\S]*?fill:\s*var\(--preview-tone\)/);
  assert.match(portalCss, /\.preview-node--inferred > circle[\s\S]*?fill:\s*var\(--surface\)[\s\S]*?stroke-dasharray/);
  assert.match(portalCss, /\.preview-connection--inferred[\s\S]*?stroke-dasharray/);
});

test("Health Map 관계 안내는 제목 아래 설명을 들여 쓰고 한국어 어절을 보존한다", async () => {
  const portalCss = await readFile("src/portal.css", "utf8");

  assert.match(mapHtml, /class="connection-support"/);
  assert.match(mapHtml, /class="connection-description"[\s\S]*?<span>기록과 문헌 관계를 구분/);
  assert.match(mapHtml, /class="connection-actions__status" role="status" aria-live="polite"/);
  assert.match(portalCss, /\.connection-support\s*\{[\s\S]*?margin-left:\s*clamp/);
  assert.match(portalCss, /\.connection-description\s*\{[\s\S]*?word-break:\s*keep-all/);
  assert.match(portalCss, /@media \(max-width: 620px\)[\s\S]*?\.connection-support\s*\{[\s\S]*?margin-left:\s*0/);
});

test("Connections는 실제 조작과 일치하는 선택, 확대, 이동 안내를 제공한다", () => {
  assertDiscoveryContract(connectionsHtml, "connections");
  assert.match(connectionsHtml, /클릭·Enter: 선택/);
  assert.match(connectionsHtml, /빈 공간 드래그/);
  assert.match(connectionsHtml, /방향키: 화면 이동/);
  assert.match(connectionsHtml, /휠·−\/\+: 확대·축소/);
  assert.match(connectionsHtml, /id="zoomLevel"/);
  assert.match(connectionsHtml, /class="visually-hidden" id="sceneInteractionHelp"[\s\S]*?class="scene-controls"/);
  assert.match(explorerCss, /\.explorer-first-use\.context-disclosure > summary\s*\{[\s\S]*?color: var\(--ink\)/);
  assert.match(connectionsHtml, /tabindex="0"[\s\S]*?aria-describedby="sceneInteractionHelp relationshipMeaning"/);
  assert.match(connectionsJs, /elements\.scene\.addEventListener\("pointerdown"/);
  assert.match(connectionsJs, /elements\.scene\.addEventListener\("keydown"/);
  assert.match(connectionsJs, /event\.key === "ArrowLeft"/);
  assert.match(connectionsJs, /function setPan/);
  assert.match(connectionsJs, /function setZoom/);
});

test("Connections는 개인 기록 근거와 문헌 기반 추론 관계를 시각·텍스트로 구분한다", () => {
  assert.match(connectionsHtml, /파일 표시 · 발행기관·변조 미검증/);
  assert.match(connectionsHtml, /본인 선택 · 의료진 미확인/);
  assert.match(explorerCss, /\.legend-dot\.declared-dot/);
  assert.doesNotMatch(connectionsHtml, /입력 신호에서 찾은 후보/);
  assert.match(connectionsHtml, /점선 · 문헌 추론, 기록 아님/);
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
    /if \(state\.clinicalConditionIds\.includes\(id\)\) \{[\s\S]*?\n  \}/,
  )?.[0] ?? "";
  assert.match(clinicalProvenance, /파일에 의료진 확정으로 표시/);
  assert.doesNotMatch(clinicalProvenance, /진단(?:으로 기록된 사실이| 사실) 아님|확정 진단 아님/);
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
  assert.doesNotMatch(`${mapHtml}\n${connectionsHtml}`, /\b(?:DNA|ECG)\b|스파클|반짝이/i);
});
