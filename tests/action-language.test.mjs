import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { emrMarkup, pageMarkup } from "./helpers/markup.mjs";

const [controls, mapHtml, mapScript, connections, insights, insightsCss, journey, journeyCss, landing, gateway, gatewayCss, shellCss, _emr, emrCss] = await Promise.all([
  readFile("src/controls.css", "utf8"),
  pageMarkup("/map"),
  readFile("src/app.js", "utf8"),
  pageMarkup("/connections"),
  pageMarkup("/insights"),
  readFile("src/insights.css", "utf8"),
  pageMarkup("/journey"),
  readFile("src/journey.css", "utf8"),
  pageMarkup("/patient"),
  pageMarkup("/"),
  readFile("src/gateway.css", "utf8"),
  readFile("src/shell.css", "utf8"),
  emrMarkup(),
  readFile("src/emr.css", "utf8"),
]);

test("공통 액션 언어는 주요·보조·텍스트 동작과 상태 표시를 서로 다른 형태로 구분한다", () => {
  assert.match(controls, /Action language/);
  assert.match(controls, /:is\([\s\S]*?\.primary-button[\s\S]*?background: var\(--ink\)/);
  assert.match(controls, /:is\([\s\S]*?\.secondary-button[\s\S]*?background: var\(--surface-raised\)/);
  assert.match(controls, /\.clinical-button:where\(:not\(\.clinical-button--primary\):not\(\.clinical-button--confirm\):not\(\.clinical-button--danger\)\)/);
  assert.match(controls, /:is\(\.text-action, \.status-refresh\)[\s\S]*?text-decoration: underline/);
  assert.match(controls, /\.danger-button\s*\{[\s\S]*?color: var\(--urgent\)/);
  assert.match(controls, /\.action-note\s*\{[\s\S]*?color: var\(--muted\)/);
  assert.match(controls, /\.mini-condition-list span\s*\{[\s\S]*?border-radius: 6px[\s\S]*?pointer-events: none/);
  assert.match(insights, /<p class="action-note" id="exportClinicalSnapshot">/);
  assert.doesNotMatch(insights, /<button[^>]*id="exportClinicalSnapshot"/);
  assert.match(journey, /class="secondary-button danger-button journey-clear" id="clearJourney"/);
  assert.ok(controls.indexOf(".danger-button {") > controls.indexOf("background: var(--surface-raised)"));
});

test("부가 설명은 네이티브 disclosure로 접고 핵심 안전 경고는 해당 동작 가까이에 남긴다", () => {
  for (const [html, marker] of [
    [landing, /기록이 어떻게 이동하는지 보기/],
    [gateway, /주요 기능 보기/],
    [mapHtml, /파일 확인 시 주의사항/],
    [connections, /문헌 근거 보기/],
    [insights, /최근 변화를 더해 질문 다듬기/],
    [journey, /백업 및 기록 관리/],
  ]) {
    assert.match(html, /<details/);
    assert.match(html, marker);
    assert.equal((html.match(/<details\b/g) ?? []).length, (html.match(/<summary\b/g) ?? []).length);
  }
  assert.match(controls, /\.context-disclosure:not\(\[open\]\) > :not\(summary\)/);
  assert.match(mapHtml, /현재 지도에서 아직 Journey에 저장하지 않은 기록은 가져온 내용으로 교체/);
  assert.match(journey, /복원하면 현재 Journey 전체를 교체하고, 전체 삭제는 되돌릴 수 없습니다/);
});

test("환자 기록 가져오기는 기본 화면에서 접히고 직접 진입할 때 자동으로 열린다", () => {
  const importSummary = mapHtml.match(/<summary class="import-heading">[\s\S]*?<\/summary>/)?.[0] ?? "";

  assert.match(mapHtml, /<details class="import-box" id="import-record"/);
  assert.match(importSummary, /<summary class="import-heading">\s*<span class="import-heading__title-group">/);
  assert.doesNotMatch(importSummary, /<(?:div|h[1-6])\b/);
  assert.doesNotMatch(mapHtml, /<details class="import-box"[^>]*\bopen\b/);
  assert.match(mapScript, /function revealImportFromHash\(\)/);
  assert.match(mapScript, /window\.location\.hash === "#import-record"/);
  assert.match(mapScript, /elements\.importBox\.open = true/);
  assert.match(mapScript, /window\.addEventListener\("hashchange", revealImportFromHash\)/);
  assert.doesNotMatch(shellCss, /\.import-box__body > p\s*\{\s*display:\s*none/);
  assert.doesNotMatch(gatewayCss, /\.role-card__features\s*\{\s*display:\s*none/);
  assert.match(controls, /\.role-card--clinical :is\(\.role-action, \.role-card__details > summary\):focus-visible\s*\{[\s\S]*?outline-color: var\(--on-inverse\)/);
  assert.match(controls, /\.role-card--clinical \.role-action:focus-visible\s*\{[\s\S]*?outline-color: var\(--ink\)/);
});

test("작은 임상 보조 동작도 최소 44px 목표 크기와 키보드 포커스를 유지한다", () => {
  assert.match(emrCss, /\.clinical-body-record__action\s*\{[\s\S]*?min-height: 44px/);
  assert.match(emrCss, /\.claim-search__field button\s*\{[\s\S]*?min-height: 44px/);
  assert.match(emrCss, /\.rule-version-actions input\s*\{[\s\S]*?min-height: 44px/);
  assert.match(emrCss, /\.claim-rule-trust__link\s*\{[\s\S]*?min-height: 44px/);
  assert.match(journeyCss, /\.journey-first-action\s*\{[\s\S]*?border: 1px solid var\(--line-strong\)/);
  assert.match(controls, /\.context-disclosure > summary\s*\{[\s\S]*?min-height: 44px/);
  assert.match(controls, /\.context-disclosure > summary:focus-visible[\s\S]*?outline: 3px solid/);
  assert.match(insightsCss, /\.method-card\.context-disclosure > summary\s*\{[\s\S]*?color: var\(--surface\)/);
  assert.match(insightsCss, /\.method-card\.context-disclosure > summary:focus-visible\s*\{[\s\S]*?outline-color: var\(--surface\)/);
  assert.match(shellCss, /\.import-box__body > \.import-warning\s*\{[\s\S]*?font-size: 0\.75rem/);
});
