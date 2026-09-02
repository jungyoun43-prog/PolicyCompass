import test from "node:test";
import assert from "node:assert/strict";

import { BodyTab } from "../components/emr/tabs/body-tab.jsx";
import { ChartTab } from "../components/emr/tabs/chart-tab.jsx";
import { createDemoEmrState } from "../src/emr-demo-state.js";
import { CLINICAL_BODY_AREAS, createClinicalBodyAtlas } from "../src/emr-model.js";
import { componentMarkup } from "./helpers/markup.mjs";
import { declarationsFor, hasRule, selectorsMatching, stylesheet } from "./helpers/css.mjs";
import { renderComponent } from "./helpers/render.mjs";

const state = createDemoEmrState("2026-09-02T00:00:00.000Z");
const demoPatient = state.patients.find(({ id }) => id === state.selectedPatientId);

/**
 * A chart whose only visit is classified from its label (no department field,
 * no confirmed conditions) plus one visit no rule can place: the candidate-only
 * and unassigned states the demo charts never reach.
 */
const candidatePatient = {
  id: "syn-candidate",
  mrn: "SYN-1",
  name: "합성 환자",
  events: [
    { id: "syn-endo", type: "encounter", label: "내분비내과 외래", department: "", date: "2026-08-20", recordStatus: "final", status: "finished", source: { kind: "demo", label: "테스트" } },
    { id: "syn-unmapped", type: "encounter", label: "종합 외래", department: "", date: "2026-08-21", recordStatus: "final", status: "finished", source: { kind: "demo", label: "테스트" } },
    { id: "syn-med", type: "medication", label: "메트포르민", code: "MET", date: "2026-08-20", recordStatus: "final", status: "active", encounterId: "syn-endo", source: { kind: "demo", label: "테스트" } },
  ],
};

/** One declared-department visit with a prescription tied to it by encounter id. */
const declaredPatient = {
  id: "syn-declared",
  mrn: "SYN-2",
  name: "합성 환자 2",
  events: [
    { id: "syn-neuro", type: "encounter", label: "외래", department: "신경과", date: "2026-08-22", recordStatus: "final", status: "finished", source: { kind: "demo", label: "테스트" } },
    { id: "syn-neuro-med", type: "medication", label: "레보도파", code: "LDP", date: "2026-08-22", recordStatus: "final", status: "active", encounterId: "syn-neuro", source: { kind: "demo", label: "테스트" } },
  ],
};

const renderBody = (patient) => renderComponent(BodyTab, { patient, selectTab: () => {}, active: false });
const css = await stylesheet("src/emr.css");
const html = renderBody(demoPatient);
const atlas = createClinicalBodyAtlas(demoPatient);
const script = await componentMarkup("components/emr/tabs/body-tab.jsx");

/** Opening tags of the area controls (`body-hotspot` on the figure, `body-caption` in the index). */
function areaControls(markup, base) {
  return [...markup.matchAll(new RegExp(`<button class="${base}[^"]*"[^>]*>`, "g"))].map(([tag]) => tag);
}
const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? "";
const classesOf = (tag) => attribute(tag, "class").split(/\s+/);
const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("임상 관계 그래프는 제거되고 12개 영역의 신체·진료과 지도로 교체된다", () => {
  assert.doesNotMatch(html, /id="clinicalGraph"|graph-workspace|임상기록 관계 지도|data-graph-node/);
  assert.match(html, /id="clinicalBodyTitle">신체·진료과 기록 지도/);

  // 12개 영역: 전신 표식과 진료과 목록이 같은 영역 id를 같은 순서로 렌더링한다.
  const areaIds = CLINICAL_BODY_AREAS.map(({ id }) => id);
  assert.equal(areaIds.length, 12);
  const hotspots = areaControls(html, "body-hotspot ");
  const captions = areaControls(html, "body-caption");
  assert.deepEqual(hotspots.map((tag) => attribute(tag, "data-body-area")), areaIds);
  assert.deepEqual(captions.map((tag) => attribute(tag, "data-body-area")), areaIds);
  for (const tag of hotspots) {
    assert.ok(classesOf(tag).includes(`hotspot-${attribute(tag, "data-body-area")}`), tag);
  }
  assert.match(html, /src="\/assets\/body-atlas-v5\.webp"/);
  assert.match(html, /data-body-context="emr"/);
  assert.match(html, /data-body-model="\/assets\/body-atlas-3d-v4\.glb"/);
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
  // The counters are the patient's atlas totals, not decoration.
  assert.match(html, new RegExp(`id="bodyAreaCount">${atlas.totals.careAreas}개<`));
  assert.match(html, new RegExp(`id="bodyVisitCount">${atlas.totals.visits}건<`));
  assert.match(html, new RegExp(`id="bodyMedicationCount">${atlas.totals.medications}건<`));
  assert.match(html, new RegExp(`id="bodySignalAreaCount">${atlas.totals.signalAreas}개<`));
  assert.match(html, new RegExp(`id="bodyUnassignedMedicationCount">${atlas.totals.unassignedMedications}건<`));

  // A medication says how its encounter reached the area: a declared department or a label-based candidate.
  assert.match(renderBody(declaredPatient), /Encounter ID syn-neuro에 직접 연결 · 진료과 필드 확인/);
  assert.match(renderBody(candidatePatient), /Encounter ID syn-endo에 직접 연결 · 진료명 기반 진료과 분류 후보 · 진료과 이력 확정 아님/);

  assert.ok(atlas.totals.unassignedMedications > 0);
  assert.match(html, new RegExp(`id="bodyDetailBoundary">진료과 연결 정보가 없는 약물 ${atlas.totals.unassignedMedications}건은 임의로 배정하지 않아 이 목록에서 제외했습니다`));
  assert.match(renderBody(candidatePatient), /id="bodyDetailBoundary">진료과가 모호하거나 확인되지 않은 진료 1건은 임의로 배정하지 않아/);

  // Every listed record offers a jump to the chart row that carries its id.
  const selected = atlas.areas.find((area) => area.visits.some(({ lifecycle }) => lifecycle === "draft")) ?? atlas.areas.find((area) => area.visits.length);
  const records = [...selected.visits, ...selected.medications, ...selected.conditions];
  assert.ok(records.length > 0);
  for (const record of records) {
    assert.match(html, new RegExp(`aria-label="${escapeRegExp(record.label)} 차트 기록으로 이동"[^>]*>차트 기록으로 이동<`));
  }
  const chart = renderComponent(ChartTab, { state, patient: demoPatient, store: { applyMutation: async () => {}, setStatus: () => {} }, dirtyGuardsRef: { current: {} } });
  for (const record of records) {
    assert.match(chart, new RegExp(`<li class="event-row" data-event-id="${escapeRegExp(record.id)}" tabindex="-1"`));
  }
  // source-check: the jump itself runs on click (tab switch, then scroll/focus of the data-event-id row) and cannot be observed in static markup.
  assert.match(script, /querySelector\(`\[data-event-id="\$\{CSS\.escape\(eventId\)\}"\]`\)/);
});

test("신체 지도는 진료 연결·진료명 후보·질환 탐색 신호를 시각·문구로 구분한다", () => {
  assert.match(html, /진료 연결 영역[\s\S]{0,200}?id="bodyAreaCount"/);
  assert.match(html, /질환 기반 탐색 영역[\s\S]{0,200}?id="bodySignalAreaCount"/);
  assert.match(html, /진료 기록 연결/);
  assert.match(html, /진료명 기반 분류 후보/);
  assert.match(html, /질환 기반 탐색 영역 · 진료 이력 아님/);
  assert.match(html, /진료명 기반 분류 후보와 질환 기반 탐색 신호는 별도 윤곽으로 구분/);

  // Each area's state flags become the classes the stylesheet draws: on the figure hotspot and the index caption alike.
  const flagClasses = [
    ["careActive", "is-care-record"],
    ["candidateActive", "is-classification-candidate"],
    ["candidateOnly", "is-candidate-only"],
    ["signalActive", "is-condition-signal"],
    ["signalOnly", "is-signal-only"],
  ];
  const seen = new Set();
  for (const patient of [...state.patients, candidatePatient, declaredPatient]) {
    const markup = renderBody(patient);
    const controls = [...areaControls(markup, "body-hotspot "), ...areaControls(markup, "body-caption")];
    for (const area of createClinicalBodyAtlas(patient).areas) {
      for (const tag of controls.filter((control) => attribute(control, "data-body-area") === area.id)) {
        for (const [flag, className] of flagClasses) {
          assert.equal(classesOf(tag).includes(className), Boolean(area[flag]), `${patient.id} ${area.id} ${className}`);
          if (area[flag]) seen.add(className);
        }
      }
    }
  }
  assert.deepEqual([...seen].sort(), flagClasses.map(([, className]) => className).sort());
  assert.match(html, /<li class="clinical-body-list-group-label">진료과 필드로 확인<\/li>/);
  assert.match(renderBody(candidatePatient), /<li class="clinical-body-list-group-label">진료명 기반 분류 후보 · 진료과 이력 확정 아님<\/li>/);

  assert.ok(selectorsMatching(css, ".clinical-body-stage .body-hotspot.is-care-record").length > 0);
  assert.ok(hasRule(css, ".clinical-body-stage .body-hotspot.is-classification-candidate"));
  assert.ok(hasRule(css, ".clinical-department-index .body-caption.is-candidate-only"));
  assert.ok(selectorsMatching(css, ".clinical-body-stage .body-hotspot.is-condition-signal").length > 0);
  assert.ok(hasRule(css, ".clinical-department-index .body-caption.is-signal-only"));
  assert.ok(hasRule(css, ".clinical-body-list-group-label"));
});

test("신체 지도는 선택 상태·키보드 초점·좁은 화면 재배치를 제공한다", () => {
  assert.equal(declarationsFor(css, ".clinical-body-layout")["grid-template-columns"], "minmax(420px, 1.18fr) minmax(300px, 0.82fr)");
  const figure = declarationsFor(css, ".clinical-body-stage .human-figure");
  assert.equal(figure.inset, "auto");
  assert.equal(figure["margin-inline"], "auto");
  assert.equal(figure["inset-inline"], undefined);
  assert.ok(declarationsFor(css, ".clinical-department-index .body-caption:focus-visible").outline);
  assert.ok(hasRule(css, ".clinical-body-stage .body-hotspot:not(.is-care-record):not(.is-condition-signal):focus-visible"));
  assert.equal(declarationsFor(css, ".clinical-body-layout", { container: "@media (max-width: 760px)" })["grid-template-columns"], "1fr");

  // Exactly one area is selected: its hotspot and caption are pressed and current, every other one is not.
  const preferred = atlas.areas.find((area) => area.visits.some(({ lifecycle }) => lifecycle === "draft"))
    ?? atlas.areas.find((area) => area.visits.length);
  for (const base of ["body-hotspot ", "body-caption"]) {
    const controls = areaControls(html, base);
    assert.equal(controls.length, 12);
    for (const tag of controls) {
      const current = attribute(tag, "data-body-area") === preferred.id;
      assert.equal(attribute(tag, "aria-pressed"), String(current), tag);
      assert.equal(classesOf(tag).includes("is-current"), current, tag);
    }
  }
  assert.match(html, new RegExp(`aria-label="${escapeRegExp(preferred.department)}: [^"]*\\. 현재 선택됨"`));
  assert.equal((html.match(/\. 현재 선택됨"/g) ?? []).length, 1);
  assert.equal((html.match(/\. 상세 보기"/g) ?? []).length, 11);
  assert.match(html, new RegExp(`<h4 id="bodyDetailTitle">${escapeRegExp(preferred.title)}</h4><p id="bodyDetailDepartment">${escapeRegExp(preferred.department)}</p>`));
});
