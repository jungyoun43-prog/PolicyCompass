import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, css, script] = await Promise.all([
  readFile(new URL("../src/emr.html", import.meta.url), "utf8"),
  readFile(new URL("../src/emr.css", import.meta.url), "utf8"),
  readFile(new URL("../src/emr.js", import.meta.url), "utf8"),
]);

test("임상 관계 그래프는 제거되고 12개 영역의 신체·진료과 지도로 교체된다", () => {
  assert.doesNotMatch(html, /id="clinicalGraph"|graph-workspace|임상기록 관계 지도/);
  assert.doesNotMatch(script, /createClinicalGraph|data-graph-node|selectGraphNode/);
  assert.match(html, /id="clinicalBodyTitle">신체·진료과 기록 지도/);
  assert.equal((html.match(/class="body-hotspot[^"]*" data-body-area=/g) ?? []).length, 12);
  assert.equal((html.match(/class="body-caption" data-body-area=/g) ?? []).length, 12);
  assert.match(html, /src="\/assets\/body-atlas-v4\.webp"/);
  assert.match(html, /data-body-context="emr"/);
  assert.match(html, /data-body-model="\/assets\/body-atlas-3d-v1\.glb"/);
});

test("진료과 선택은 진료·Encounter 연결 처방·활성 문제를 별도 목록으로 공개한다", () => {
  for (const id of [
    "bodyAreaCount",
    "bodyVisitCount",
    "bodyMedicationCount",
    "bodySignalAreaCount",
    "bodyUnassignedMedicationCount",
    "bodyVisitList",
    "bodyMedicationList",
    "bodyConditionList",
    "bodyDetailBoundary",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(script, /createClinicalBodyAtlas\(patient\)/);
  assert.match(script, /medication\.association\.encounterAreaKind/);
  assert.match(script, /진료과 연결 정보가 없는 약물/);
  assert.match(script, /dataset\.bodySourceEvent = eventId/);
  assert.match(script, /신체 지도에서 선택한 기록/);
  assert.match(script, /차트 기록으로 이동/);
  assert.match(script, /차트 기록으로 이동했습니다/);
  assert.match(html, /진료과가 모호하거나 연결 정보가 없는 기록은 임의로 배정하지 않습니다/);
});

test("신체 지도는 진료 연결·진료명 후보·질환 탐색 신호를 시각·문구로 구분한다", () => {
  assert.match(html, /<span>진료 연결 영역<\/span><strong id="bodyAreaCount">/);
  assert.match(html, /<span>질환 기반 탐색 영역<\/span><strong id="bodySignalAreaCount">/);
  assert.match(html, />진료 기록 연결<\/span>/);
  assert.match(html, />진료명 기반 분류 후보<\/span>/);
  assert.match(html, />질환 기반 탐색 영역 · 진료 이력 아님<\/span>/);
  assert.match(html, /진료명 기반 분류 후보와 질환 기반 탐색 신호는 별도 윤곽으로 구분/);
  assert.match(script, /is-care-record/);
  assert.match(script, /is-classification-candidate/);
  assert.match(script, /is-candidate-only/);
  assert.match(script, /is-condition-signal/);
  assert.match(script, /is-signal-only/);
  assert.match(script, /clinical-body-list-group-label/);
  assert.match(css, /\.clinical-body-stage \.body-hotspot\.is-care-record/s);
  assert.match(css, /\.clinical-body-stage \.body-hotspot\.is-classification-candidate/s);
  assert.match(css, /\.clinical-department-index \.body-caption\.is-candidate-only/s);
  assert.match(css, /\.clinical-body-stage \.body-hotspot\.is-condition-signal/s);
  assert.match(css, /\.clinical-department-index \.body-caption\.is-signal-only/s);
  assert.match(css, /\.clinical-body-list-group-label/s);
});

test("신체 지도는 선택 상태·키보드 초점·좁은 화면 재배치를 제공한다", () => {
  assert.match(css, /\.clinical-body-layout\s*\{[^}]*grid-template-columns:/s);
  assert.match(css, /\.clinical-body-stage \.human-figure\s*\{[^}]*inset:\s*auto[^}]*margin-inline:\s*auto/s);
  assert.doesNotMatch(css, /\.clinical-body-stage \.human-figure\s*\{[^}]*inset-inline:\s*(?:10|14)%/s);
  assert.match(css, /\.clinical-department-index \.body-caption:focus-visible\s*\{[^}]*outline:/s);
  assert.match(css, /\.clinical-body-stage \.body-hotspot:not\(\.is-care-record\):not\(\.is-condition-signal\):focus-visible/s);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.clinical-body-layout\s*\{\s*grid-template-columns:\s*1fr/s);
  assert.match(script, /control\.setAttribute\("aria-pressed", String\(isCurrent\)\)/);
  assert.match(script, /selectClinicalBodyArea\(control\.dataset\.bodyArea\)/);
});
