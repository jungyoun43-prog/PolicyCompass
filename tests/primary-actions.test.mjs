import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { Tabs as TabsPrimitive } from "radix-ui";

import InsightsPage from "../app/(insights)/insights/page.jsx";
import MapPage from "../app/(map)/map/page.jsx";
import { ClinicalHeader } from "../components/emr/chrome.jsx";
import { DataUtilities } from "../components/emr/data-utilities.jsx";
import { PatientRail } from "../components/emr/patient-rail.jsx";
import { WorkspaceHeader } from "../components/emr/workspace-header.jsx";
import { BodyTab } from "../components/emr/tabs/body-tab.jsx";
import { ChartTab } from "../components/emr/tabs/chart-tab.jsx";
import { ClaimsTab } from "../components/emr/tabs/claims-tab.jsx";
import { DataTab } from "../components/emr/tabs/data-tab.jsx";
import { EncounterTab } from "../components/emr/tabs/encounter-tab.jsx";
import { JourneyTab } from "../components/emr/tabs/journey-tab.jsx";
import { OverviewTab } from "../components/emr/tabs/overview-tab.jsx";
import { claimEvaluationsFor, currentEncounterFor } from "../lib/emr/selectors.js";
import { createDemoEmrState } from "../src/emr-demo-state.js";
import { declarationsFor, hasRule, stylesheet } from "./helpers/css.mjs";
import { openingTag, renderComponent } from "./helpers/render.mjs";

const script = await readFile(new URL("../scripts/primary-action-smoke.mjs", import.meta.url), "utf8");

/** The opening tag of the element carrying `id`, or "" when it is not rendered. */
const attributeOf = (tag, name) => tag.match(new RegExp(`\\b${name}(?:="([^"]*)")?(?=[\\s>/])`))?.[1] ?? null;
const hasAttribute = (tag, name) => new RegExp(`\\b${name}(?:="[^"]*")?(?=[\\s>/])`).test(tag);
const count = (markup, needle) => markup.split(needle).length - 1;

/**
 * The whole EMR workspace as the server renders it: chrome, patient rail,
 * data utilities and every tab panel. Dialogs are closed and the visit slot is
 * absent, so nothing portals.
 */
function renderEmrWorkspace(state) {
  const patient = state.patients.find(({ id }) => id === state.selectedPatientId) ?? null;
  const encounter = currentEncounterFor(patient, { viewedEncounterId: "", selectedEncounterId: state.selectedEncounterId ?? "" });
  const store = { applyMutation: async () => {}, replaceState: async () => {}, setStatus: () => {}, setSavedState: () => {}, bumpGeneration: () => {}, savedState: state, busy: false };
  const tabProps = {
    state,
    patient,
    encounter,
    evaluations: patient ? claimEvaluationsFor(patient, state.rules) : [],
    preflightEvaluations: patient ? claimEvaluationsFor(patient, state.rules, { includeCurrentDraft: true, encounterId: encounter?.id ?? "" }) : [],
    ai: { checked: true, configured: false, copilot: false, mode: "none", detail: "미연결" },
    store,
    viewedEncounterId: "",
    setViewedEncounterId: () => {},
    selectTab: () => {},
    dirtyGuardsRef: { current: { encounter: () => false, composer: () => false, patientForm: () => false, manualEvent: () => false } },
    blockClinicalContextChange: () => false,
    fhirReport: null,
    setFhirReport: () => {},
    visitSlot: null,
    active: false,
  };
  const rail = renderComponent(PatientRail, {
    patients: state.patients,
    selectedPatientId: state.selectedPatientId,
    demo: state.demo,
    updatedAt: state.updatedAt,
    onSelectPatient: () => {},
    onLoadDemo: () => {},
    onSavePatient: () => {},
    onEditPatient: () => {},
    editRequest: null,
    visitSlotRef: null,
  });
  const header = renderComponent(ClinicalHeader, {
    demo: state.demo,
    ai: tabProps.ai,
    utilities: createElement(DataUtilities, tabProps),
    nav: patient ? createElement(TabsPrimitive.Root, { value: "encounter" }, createElement(WorkspaceHeader, { onSelectTab: () => {} })) : null,
  });
  const panels = patient
    ? [EncounterTab, OverviewTab, ChartTab, BodyTab, ClaimsTab, JourneyTab, DataTab].map((Tab) => renderComponent(Tab, tabProps))
    : [];
  return [header, rail, ...panels].join("\n");
}

test("primary-action browser contract activates every originating route", () => {
  // source-check: the smoke script drives a real browser over CDP; its route list and probes can only be read from the script itself here.
  for (const route of ["/", "/patient", "/map", "/connections", "/insights", "/journey", "/emr"]) {
    assert.ok(script.includes(`from: ${JSON.stringify(route)}`) || script.includes(`navigate(${JSON.stringify(route)})`));
  }
  assert.match(script, /querySelector\(\$\{selector\}\)\.click\(\)/);
  assert.match(script, /location\.pathname/);
  assert.match(script, /location\.hash/);
  assert.match(script, /formError/);
  assert.match(script, /patientList/);
  assert.match(script, /checkInPatient/);
  assert.match(script, /__printInvoked/);
  assert.match(script, /question-select/);
  assert.match(script, /visit question selection was not preserved/);
  assert.match(script, /__journeyScrollBehavior === 'auto'/);
  assert.match(script, /cancelled delete changed saved records/);
  assert.match(script, /activatedEmrAction/);
  assert.match(script, /expectedStatus/);
  assert.match(script, /Network\.setBlockedURLs/);
  assert.match(script, /Emulation\.setTimezoneOverride/);
  assert.match(script, /Emulation\.setLocaleOverride/);
  assert.match(script, /prefers-reduced-motion/);
  assert.match(script, /Date\.now=\(\)=>1735689600000;Math\.random=\(\)=>0\.5/);
});

test("Insights 질문은 하나의 명시적 선택 동작과 복원 가능한 상태를 제공한다", async () => {
  const [html, client, css] = await Promise.all([
    renderComponent(InsightsPage),
    readFile(new URL("../src/insights.js", import.meta.url), "utf8"),
    stylesheet("src/insights.css"),
  ]);

  const selectionStatus = openingTag(html, "questionSelectionStatus");
  assert.equal(attributeOf(selectionStatus, "role"), "status");
  assert.equal(attributeOf(selectionStatus, "aria-live"), "polite");
  assert.ok(hasAttribute(selectionStatus, "hidden"), "선택 상태는 질문이 렌더링되기 전까지 숨겨져야 한다");
  const questions = openingTag(html, "questions");
  assert.equal(attributeOf(questions, "role"), "radiogroup");
  assert.equal(attributeOf(questions, "aria-describedby"), "questionSelectionStatus");
  // source-check: insights.js is a page controller that renders questions into the DOM and talks to sessionStorage on load; without a browser only its source shows the selection key, the fingerprint guard and the radio semantics.
  assert.match(client, /const selectedQuestionKey = "policycompass-selected-visit-question"/);
  assert.match(client, /function sceneFingerprint\(session\)/);
  assert.match(client, /sessionStorage\.setItem\(selectedQuestionKey, JSON\.stringify/);
  assert.match(client, /renderQuestions\(brief\.questions, readSelectedQuestionId\(fingerprint\), fingerprint\)/);
  assert.match(client, /radio\.type = "radio"/);
  assert.match(client, /radio\.name = "visit-question"/);
  assert.equal(declarationsFor(css, ".question-select")["min-height"], "44px");
  assert.ok(hasRule(css, ".question-selected-badge"));
  assert.equal(declarationsFor(css, ".question-list > li.is-selected .question-selected-badge").display, "inline-flex");
  const printedSelection = declarationsFor(css, "body.insights-page .question-list > li.is-selected", { container: "@media print" });
  assert.equal(printedSelection.border, "2px solid var(--ink)");
});

test("건강 지도 입력은 선택 가능한 질환 뒤에 제출 동작을 제공한다", async () => {
  const [html, css] = await Promise.all([
    renderComponent(MapPage),
    stylesheet("src/controls.css"),
  ]);
  assert.ok(
    html.indexOf('id="loadDemo"') < html.indexOf('id="healthForm"'),
    "예시 기록 버튼은 입력 폼보다 위의 패널 헤더에 있어야 한다",
  );
  const headingActions = html.match(/<div class="input-panel__heading-actions">[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.ok(openingTag(headingActions, "loadDemo"), "예시 기록 버튼은 패널 헤더 동작 묶음 안에 있어야 한다");
  assert.ok(headingActions.indexOf('id="loadDemo"') < headingActions.indexOf('class="session-badge"'));
  assert.equal(declarationsFor(css, ".input-panel__heading-actions")["justify-items"], "end");
  assert.ok(html.indexOf('class="signal-fieldset"') < html.indexOf('id="analyzeButton"'));
  assert.ok(html.indexOf('id="analyzeButton"') < html.indexOf('id="import-record"'));
  assert.equal(attributeOf(openingTag(html, "analyzeButton"), "type"), "submit");
  assert.ok(openingTag(html, "transferCode"));
  assert.equal(attributeOf(openingTag(html, "fhirFile"), "type"), "file");
  assert.equal(attributeOf(openingTag(html, "selectRecordFile"), "aria-controls"), "fhirFile");
  assert.ok(hasAttribute(openingTag(html, "importRecordButton"), "disabled"));
});

test("빈 EMR은 하나의 명시적 예시 환자 동작만 제공한다", () => {
  const demoState = createDemoEmrState("2026-09-02T00:00:00.000Z");
  const emptyState = { ...demoState, demo: false, patients: [], selectedPatientId: "", selectedEncounterId: "" };
  for (const html of [renderEmrWorkspace(emptyState), renderEmrWorkspace(demoState)]) {
    assert.equal(count(html, 'id="loadDemo"'), 1);
    // 감사 기록은 같은 문구를 데이터로 표시할 수 있으므로, 동작(버튼)만 하나여야 한다.
    const demoActions = html.match(/<(button|a)\b[^>]*>(?:<[^>]+>)*예시 환자 불러오기(?:<\/[^>]+>)*<\/\1>/g) ?? [];
    assert.equal(demoActions.length, 1);
    assert.match(demoActions[0], /\bid="loadDemo"/);
  }
  const emptyRail = renderEmrWorkspace(emptyState);
  const emptyNotice = emptyRail.match(/<div class="rail-empty" id="patientListEmpty"[^>]*>[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.ok(openingTag(emptyNotice, "loadDemo"), "예시 환자 동작은 빈 환자 목록 안내 안에 있어야 한다");
  assert.ok(!hasAttribute(openingTag(emptyRail, "patientListEmpty"), "hidden"), "환자가 없으면 안내가 보여야 한다");
  assert.ok(hasAttribute(openingTag(renderEmrWorkspace(demoState), "patientListEmpty"), "hidden"), "환자가 있으면 안내는 숨겨진다");
});
