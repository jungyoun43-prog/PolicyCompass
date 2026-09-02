import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { Tabs as TabsPrimitive } from "radix-ui";

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
import { AUDIT_LABELS } from "../lib/emr/files.js";
import { claimEvaluationsFor, currentEncounterFor } from "../lib/emr/selectors.js";
import { createDemoEmrState } from "../src/emr-demo-state.js";
import { completeEncounter } from "../src/emr-encounter.js";
import { appendPatientEvent } from "../src/emr-model.js";
import { componentMarkup } from "./helpers/markup.mjs";
import { openingTag, renderComponent } from "./helpers/render.mjs";

const dataUtilities = await componentMarkup("components/emr/data-utilities.jsx");
const overview = await componentMarkup("components/emr/tabs/overview-tab.jsx");
const encounter = await componentMarkup("components/emr/tabs/encounter-tab.jsx");
const app = await componentMarkup("components/emr/emr-app.jsx");
const chart = await componentMarkup("components/emr/tabs/chart-tab.jsx");
const entryDialogs = await componentMarkup("components/emr/entry-dialogs.jsx");
const prescriptionDialog = await componentMarkup("components/emr/prescription-dialog.jsx");
const script = [dataUtilities, overview, encounter, app, chart].join("\n");

const state = createDemoEmrState("2026-09-02T00:00:00.000Z");
const store = { applyMutation: async () => {}, replaceState: async () => {}, setStatus: () => {}, setSavedState: () => {}, bumpGeneration: () => {}, savedState: state, busy: false };
const dirtyGuardsRef = { current: { encounter: () => false, composer: () => false, patientForm: () => false, manualEvent: () => false } };
const ai = { checked: true, configured: false, copilot: false, mode: "none", detail: "미연결" };

/** Props every tab receives from EmrApp, derived from a state the way the app derives them. */
function tabPropsFor(workspaceState, patientId = workspaceState.selectedPatientId, viewedEncounterId = "") {
  const patient = workspaceState.patients.find(({ id }) => id === patientId);
  const current = currentEncounterFor(patient, { viewedEncounterId, selectedEncounterId: workspaceState.selectedEncounterId });
  return {
    state: workspaceState,
    patient,
    encounter: current,
    evaluations: claimEvaluationsFor(patient, workspaceState.rules),
    preflightEvaluations: claimEvaluationsFor(patient, workspaceState.rules, { includeCurrentDraft: true, encounterId: current?.id ?? "" }),
    ai,
    store,
    viewedEncounterId,
    setViewedEncounterId: () => {},
    selectTab: () => {},
    dirtyGuardsRef,
    blockClinicalContextChange: () => false,
    fhirReport: null,
    setFhirReport: () => {},
    visitSlot: null,
  };
}

/**
 * The whole workspace as the server renders it for the selected patient:
 * chrome, patient rail, data utilities and every tab panel. Dialogs are closed
 * and the visit slot is absent, so nothing portals.
 */
function renderWorkspace(workspaceState = state) {
  const tabProps = tabPropsFor(workspaceState);
  const tabs = () => createElement(TabsPrimitive.Root, { value: "encounter" }, createElement(WorkspaceHeader, { onSelectTab: () => {} }));
  return [
    renderComponent(ClinicalHeader, { demo: workspaceState.demo, ai, utilities: createElement(DataUtilities, tabProps) }),
    renderComponent(tabs),
    renderComponent(PatientRail, {
      patients: workspaceState.patients,
      selectedPatientId: workspaceState.selectedPatientId,
      demo: workspaceState.demo,
      updatedAt: workspaceState.updatedAt,
      onSelectPatient: () => {},
      onLoadDemo: () => {},
      onSavePatient: () => {},
      onEditPatient: () => {},
      editRequest: null,
      visitSlotRef: null,
    }),
    ...[EncounterTab, OverviewTab, ChartTab, BodyTab, ClaimsTab, JourneyTab, DataTab].map((Tab) => renderComponent(Tab, { ...tabProps, active: false })),
  ].join("\n");
}

const html = renderWorkspace();

/** The opening tag of the element carrying `id`, or "" when it is not rendered. */
test("EMR은 환자·차트·신체 지도·코파일럿·급여 칸반·로컬 데이터 제어를 한 흐름에 둔다", () => {
  for (const id of [
    "patientList", "encounterForm", "soapSubjective", "encounterMobileClaimSummary", "eventForm", "eventSystem", "clinicalBodyTitle", "bodyVisitList",
    "bodyMedicationList", "copilotPanel", "claimBoard", "ruleServiceSystem", "ruleApplicabilitySystem",
    "fhirImport", "syncPersonalRecord", "personalSyncStatus", "exportEmr", "wipeEmr",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  // Every entry dialog owns a launcher slot in the encounter tab; the forms themselves live in Radix dialogs.
  for (const name of ["diagnoses", "prescriptions", "orders"]) {
    assert.match(html, new RegExp(`id="entryLauncher-${name}"`), name);
  }
  // source-check: Radix dialog content is portaled and mounts only on the client, so the entry forms never appear in server markup.
  assert.match(entryDialogs, /id="diagnosisForm"/);
  assert.match(prescriptionDialog, /id="prescriptionForm"/);
  assert.match(entryDialogs, /id="orderForm"/);

  assert.match(html, /환자 전달 파일 내보내기/);
  assert.match(html, /선택 환자의 이름과 일회성 확인 코드를 대조/);
  assert.match(html, /코드는 파일과 다른 경로로 환자에게 전달/);
  assert.match(html, /현재 기록만 교체되고 기존 Journey는 바뀌지 않습니다/);
  assert.match(openingTag(html, "syncPersonalRecord"), /aria-describedby="patientTransferGuidance"/);
  assert.doesNotMatch(html, /자동 연결|서명 처방.*Personal/);
  assert.match(html, /의료진 검토 전 확정 기록 아님/);

  // source-check: the FHIR file cap is applied inside the change handler of a file input; there is no file event under SSR.
  assert.match(dataUtilities, /readJsonFile\(file, 2 \* 1024 \* 1024\)/);
  // source-check: the stale-draft guard runs after a fetch round-trip; the fingerprint mismatch must be what discards the draft.
  assert.match(overview, /copilotRequestFingerprint\(currentRequest\) !== requestFingerprint[\s\S]*?오래된 로컬 AI 초안을 폐기/);
  // source-check: the transfer export runs on click through window.confirm; the package, filename, blocker and audit action are only reachable there.
  assert.match(dataUtilities, /createPatientTransferPackage\(patient, exportedAt\)/);
  assert.match(dataUtilities, /patientTransferFilename\(exportedAt\)/);
  assert.match(dataUtilities, /const blocker = currentExportBlocker\(\);[\s\S]*?createPatientTransferPackage/);
  assert.match(dataUtilities, /appendStateAudit\(current, "patient\.transfer\.exported"/);
  assert.equal(AUDIT_LABELS["patient.transfer.exported"], "환자용 PolicyCompass 전달");

  // Demo charts are memory-only: the data tab says so and the rail shows no save time; a stored chart shows both.
  assert.match(html, /<dt>저장 위치<\/dt><dd>메모리 전용 예시 환자<\/dd>/);
  assert.doesNotMatch(html, /id="lastSavedAt"/);
  const stored = renderWorkspace({ ...state, demo: false });
  assert.match(stored, /<dt>저장 위치<\/dt><dd>브라우저 localStorage<\/dd>/);
  assert.match(stored, /id="lastSavedAt">저장 /);

  // source-check: the absence of a cross-tab channel is a property of the code, not of any rendered state.
  assert.doesNotMatch(script, /publishClinicalSnapshot|syncSelectedClinicalSnapshot|syncPatientBriefFromCareBridge|publishPatientBrief/);
  assert.doesNotMatch(script, /readCareBridge|subscribeCareBridge|BroadcastChannel/);

  // A manually entered draft gets a review-and-confirm action in the chart; nothing else does.
  assert.doesNotMatch(html, /class="event-confirm"/);
  const withManual = appendPatientEvent(state, state.selectedPatientId, {
    type: "observation", label: "혈압", date: "2026-09-01", value: "130/80", unit: "mmHg",
    source: { kind: "manual", label: "직접 입력 · 검토 대기" },
  }, "2026-09-02T00:00:00.000Z");
  const reviewed = renderComponent(ChartTab, tabPropsFor(withManual));
  assert.match(reviewed, /<button class="event-confirm" type="button" aria-label="혈압 기록 검토 후 확정">검토·확정<\/button>/);
  assert.equal((reviewed.match(/class="event-confirm"/g) ?? []).length, 1);
});

test("EMR은 개인 앱 화면으로 직접 이동하는 링크를 노출하지 않는다", () => {
  const hrefs = [...html.matchAll(/\bhref="([^"]+)"/g)].map(([, href]) => href);
  assert.ok(hrefs.length > 0);
  for (const route of ["/patient", "/map", "/connections", "/insights", "/journey"]) {
    assert.equal(hrefs.includes(route), false, route);
  }
});

test("EMR은 환자·SOAP·임상 입력이 남은 새로고침과 페이지 이탈을 명시적으로 막는다", () => {
  // source-check: the guard is a window "beforeunload" listener installed by an effect; effects do not run under SSR and there is no window.
  assert.match(app, /addEventListener\("beforeunload"/);
  assert.match(app, /event\.preventDefault\(\)/);
  assert.match(app, /event\.returnValue = ""/);
});

test("서명 전 검토는 명시적 확인과 내용 fingerprint를 요구하고 완료 뒤 검토 제목으로 이동한다", () => {
  const draft = tabPropsFor(state);
  const completed = completeEncounter(state, draft.patient.id, draft.encounter.id, { soap: draft.encounter.soap }, "2026-09-02T09:00:00.000Z");
  const review = renderComponent(EncounterTab, tabPropsFor(completed, draft.patient.id, draft.encounter.id));

  assert.equal(openingTag(review, "encounterSignReviewTitle"), '<h3 id="encounterSignReviewTitle" tabindex="-1">');
  assert.match(openingTag(review, "encounterSignReviewAcknowledged"), /^<input type="checkbox"/);
  assert.doesNotMatch(openingTag(review, "encounterSignReviewAcknowledged"), /\bchecked/);
  // Until the reviewer acknowledges the current content, the sign button stays disabled and says why.
  const sign = openingTag(review, "signEncounter");
  assert.match(sign, /\bdisabled=""/);
  assert.doesNotMatch(sign, /\bhidden/);
  assert.match(sign, /title="(현재 환자·Encounter와 전체 기록을 확인한 뒤 검토 완료를 선택하세요\.|서명 전 누락·충돌 \d+건을 먼저 수정하세요\.)"/);
  // The draft encounter offers no sign-off review at all.
  assert.equal(openingTag(html, "encounterSignReviewTitle"), "");
  assert.match(openingTag(html, "signEncounter"), /\bhidden=""/);
  // source-check: the fingerprint is re-asserted inside the sign handler right before the mutation; handlers do not run under SSR.
  assert.match(encounter, /assertEncounterSignReviewFingerprint\(signAck\.fingerprint, latest\)/);
  // source-check: moving focus to the review title after 진료 완료 happens in a microtask against the live document.
  assert.match(encounter, /getElementById\("encounterSignReviewTitle"\)[\s\S]*?title\.focus\(\)/);
});

test("백업 복원은 전용 미검증 복원 경계로 저장하고 일반 save 우회를 사용하지 않는다", () => {
  // source-check: restore runs in a file-input change handler behind window.confirm; the boundary it saves through is only visible there.
  assert.match(dataUtilities, /saved = await restoreEmrBackupState\(parsed, persistedState, undefined, restoredAt\)/);
  // source-check: the general-save bypass is a flag only the code could pass; its absence is a property of the sources, not of any rendered state.
  assert.doesNotMatch(script, /allowSignedRecordReplacement/);
});
