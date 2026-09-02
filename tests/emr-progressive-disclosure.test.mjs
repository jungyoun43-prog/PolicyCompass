import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { Tabs as TabsPrimitive } from "radix-ui";

import { ClinicalHeader } from "../components/emr/chrome.jsx";
import { WorkspaceHeader } from "../components/emr/workspace-header.jsx";
import { PatientSummaryCard } from "../components/emr/patient-summary.jsx";
import { DiseaseAssessmentCard } from "../components/emr/claims/disease-assessment.jsx";
import { ChartTab } from "../components/emr/tabs/chart-tab.jsx";
import { EncounterTab } from "../components/emr/tabs/encounter-tab.jsx";
import { createDemoEmrState } from "../src/emr-demo-state.js";
import { getEncounterRecords } from "../src/emr-encounter.js";
import { currentEncounterFor } from "../lib/emr/selectors.js";
import { componentMarkup } from "./helpers/markup.mjs";
import { declarationsFor, stylesheet } from "./helpers/css.mjs";
import { renderComponent } from "./helpers/render.mjs";

const sheet = await stylesheet("src/emr.css");
const demo = createDemoEmrState("2026-09-02T00:00:00.000Z");
const patient = demo.patients.find(({ id }) => id === demo.selectedPatientId);
const encounter = currentEncounterFor(patient, { viewedEncounterId: "", selectedEncounterId: demo.selectedEncounterId });
const store = { applyMutation: async () => {}, setStatus: () => {} };
const noop = () => {};

/**
 * The encounter tab for today's in-progress demo visit, rendered the way the
 * server does. The 진료 기본정보 disclosure and the entry dialogs portal into
 * slots the rail hands over after mount, so with no slot they are not part of
 * this markup; everything else the clinician sees is.
 */
const renderEncounterTab = () => renderComponent(EncounterTab, {
  patient, encounter, preflightEvaluations: [], store,
  viewedEncounterId: "", setViewedEncounterId: noop, selectTab: noop,
  dirtyGuardsRef: { current: {} }, blockClinicalContextChange: () => false, visitSlot: null,
});
const renderWorkspaceHeader = () => renderComponent(() => createElement(TabsPrimitive.Root, { value: "encounter" }, createElement(WorkspaceHeader, { onSelectTab: noop })));
const renderAssessment = () => renderComponent(DiseaseAssessmentCard, { state: demo, patient, selectedDiseaseId: "", onSelectDisease: noop });

function isInsideDetails(html, index) {
  const preceding = html.slice(0, index);
  return preceding.lastIndexOf("<details") > preceding.lastIndexOf("</details>");
}

const disclosureNames = (html) => [...html.matchAll(/data-workflow-disclosure="([a-z-]+)"/g)].map((match) => match[1]);

test("EMR 안전 맥락과 최종 서명은 점진적 공개 밖에 남는다", () => {
  const summary = renderComponent(PatientSummaryCard, { patient, demo: true, updatedAt: demo.updatedAt, onEditPatient: noop });
  const header = renderWorkspaceHeader();
  const encounterHtml = renderEncounterTab();
  const persistent = summary.indexOf("data-safety-persistent");

  assert.ok(persistent > -1);
  // 환자 이름과 안전 알림은 항상 보이는 같은 섹션 안에 있고, 접히는 요소에 싸여 있지 않다.
  const persistentSection = summary.slice(summary.lastIndexOf("<section", persistent), summary.indexOf("</section>", persistent));
  for (const marker of ['id="selectedPatientName"', 'id="safetyAlerts"']) {
    assert.ok(persistentSection.indexOf(marker) > -1, marker);
    assert.equal(isInsideDetails(persistentSection, persistentSection.indexOf(marker)), false, marker);
  }
  assert.match(header, /role="tablist"[^>]*class="workspace-tabs"/);

  for (const marker of ['class="encounter-save-bar"', 'class="encounter-context-rail"']) {
    const index = encounterHtml.indexOf(marker);
    assert.ok(index > -1, marker);
    assert.equal(isInsideDetails(encounterHtml, index), false, marker);
  }
  assert.match(encounterHtml, /class="encounter-save-bar" aria-labelledby="encounterSignoffTitle"/);
  assert.match(encounterHtml, /id="encounterSignoffTitle">진료 최종 검토 및 서명/);
});

test("EMR 보조 입력은 이름 있는 네이티브 disclosure로 접힌다", async () => {
  const encounterHtml = renderEncounterTab();
  const encounterSource = await componentMarkup("components/emr/tabs/encounter-tab.jsx");
  const chart = renderComponent(ChartTab, { state: demo, patient, store, dirtyGuardsRef: { current: {} } });
  const expected = ["visit-context", "soap", "diagnoses", "prescriptions", "orders"];

  const rendered = [...new Set(disclosureNames(encounterHtml))].sort();
  assert.deepEqual(rendered, ["diagnoses", "orders", "prescriptions", "soap"]);
  // source-check: 진료 기본정보(visit-context)는 환자 레일의 슬롯으로 portal되므로 SSR 마크업에 없고, 그 이름은 소스에서만 확인한다.
  const portalFragment = encounterSource.slice(encounterSource.indexOf("createPortal("), encounterSource.indexOf(", visitSlot)"));
  assert.match(portalFragment, /<details class="clinical-card encounter-details workflow-disclosure"[^>]*data-workflow-disclosure="visit-context"/);
  assert.deepEqual([...new Set([...rendered, ...disclosureNames(portalFragment)])].sort(), [...expected].sort());
  // source-check: 사용자가 닫기 전에는 모든 단계가 열린 채 시작한다 — 접히는 유일한 단계가 portal 안의 visit-context라 렌더 결과로는 볼 수 없다.
  assert.match(encounterSource, /openDisclosures\.get\(disclosureKey\(name\)\) \?\? \(name !== "visit-context"\)/);
  assert.match(encounterHtml, /class="workflow-disclosure__summary"/);
  assert.match(chart, /<details[^>]*class="[^"]*workflow-disclosure[^"]*"[^>]*data-workflow-disclosure="historical-entry"/);
  // source-check: visit-context 요약 표시는 portal 안에 있다.
  assert.match(portalFragment, /data-disclosure-summary="visit-context"/);
  assert.match(encounterHtml, /data-disclosure-summary="soap"/);
});

test("처방 입력은 자동 검증하지 않는 임상 안전 범위를 팝업 안내에 유지한다", async () => {
  // source-check: 처방 팝업은 Radix Dialog.Portal 안에 렌더돼 서버 렌더러가 본문을 만들지 않으므로, 안내 문구와 폼 순서는 소스에서 확인한다.
  const dialog = await componentMarkup("components/emr/prescription-dialog.jsx");
  const notice = dialog.match(/notice="([^"]*)"/)?.[1] ?? "";

  assert.match(dialog, /noticeId="prescriptionNotice"/);
  assert.match(notice, /급여 인정이나 삭감을 확정하지 않습니다/);
  assert.match(notice, /최종 처방 결정은 의료진에게 있습니다/);
  assert.ok(dialog.indexOf('noticeId="prescriptionNotice"') < dialog.indexOf('id="prescriptionForm"'));
});

test("오늘 진료는 모든 단계를 펼친 채 열리고 사용자 선택은 메모리에만 유지된다", async () => {
  const encounterHtml = renderEncounterTab();
  const encounterSource = await componentMarkup("components/emr/tabs/encounter-tab.jsx");

  // 렌더된 네 단계는 모두 본문이 펼쳐진 채 나오고, 요약 칸은 실제 기록 건수를 말한다.
  const sections = [...encounterHtml.matchAll(/<section[^>]*data-workflow-disclosure="([a-z-]+)"[^>]*>([\s\S]*?)<div class="workflow-disclosure__body">/g)];
  assert.deepEqual(sections.map((match) => match[1]), ["soap", "diagnoses", "prescriptions", "orders"]);
  const records = getEncounterRecords(patient, encounter.id).slice(1);
  const summaryText = (name) => encounterHtml.match(new RegExp(`data-disclosure-summary="${name}"[^>]*>([^<]*)<`))?.[1];
  assert.equal(summaryText("diagnoses"), `${records.filter(({ type }) => type === "condition").length}건`);
  assert.equal(summaryText("prescriptions"), `${records.filter(({ type }) => type === "medication").length}건`);
  assert.equal(summaryText("orders"), `${records.filter(({ type }) => type === "service-request").length}건`);
  assert.match(summaryText("soap"), /^[0-4]\/4 작성$/);
  // source-check: 브라우저 저장소를 쓰지 않는다는 부정 계약은 마크업이 아니라 코드에서만 확인할 수 있다.
  assert.doesNotMatch(encounterSource, /localStorage|sessionStorage/);
  // source-check: 접힘 선택은 portal 안 visit-context details의 toggle에서 세션 메모리 Map에만 기록된다.
  assert.match(encounterSource, /data-workflow-disclosure="visit-context" open=\{disclosureOpen\("visit-context"\)\} onToggle=/);
});

test("EMR 첫 화면은 핵심 안전 상태만 짧게 유지하고 반복 영문 표제를 숨긴다", () => {
  const assessment = renderAssessment();
  const chrome = renderComponent(ClinicalHeader, { ai: { mode: "frontier", configured: true, detail: "GPT-5.6" } });

  // The header keeps the model status to one label and the model name.
  assert.match(chrome, /<b>모델<\/b><span[^>]*>GPT-5\.6<\/span>/);
  assert.doesNotMatch(chrome, /실제 환자 아님 · 미저장|평가용 · 인증된 EMR/);
  assert.equal(declarationsFor(sheet, ".emr-page .rail-eyebrow:not(#diseaseProgramEyebrow):not(#diseaseDiagnosticEyebrow)").display, "none");
  assert.match(assessment, /class="rail-eyebrow" id="diseaseProgramEyebrow"/);
  assert.match(assessment, /class="rail-eyebrow" id="diseaseDiagnosticEyebrow"/);
  const trustStrip = declarationsFor(sheet, ".trust-strip", { container: "@media (max-width: 620px)" });
  assert.equal(trustStrip.display, "grid");
  assert.equal(trustStrip["grid-template-columns"], "repeat(2, minmax(0, 1fr))");
});

test("진료 시작과 재개는 열린 SOAP 입력으로 초점을 옮긴다", async () => {
  // source-check: 초점 이동은 mutation 뒤 document.getElementById(...).focus()로 일어나는 DOM 동작이라 렌더 결과로 볼 수 없다.
  const encounterSource = await componentMarkup("components/emr/tabs/encounter-tab.jsx");

  assert.match(renderEncounterTab(), /<textarea id="soapSubjective"/);
  assert.match(encounterSource, /startEncounter\(current, patient\.id, encounter\.id\)[\s\S]*?getElementById\("soapSubjective"\)\?\.focus\(\)/);
  assert.match(encounterSource, /reopenEncounter\(current, patient\.id, encounter\.id\)[\s\S]*?getElementById\("soapSubjective"\)\?\.focus\(\)/);
});

test("EMR 헤더는 모든 뷰포트에서 60px 이하이다", () => {
  const heights = [];
  sheet.walkDecls("--header-height", (decl) => heights.push(Number(decl.value.match(/^(\d+)px$/)?.[1])));

  assert.ok(heights.length >= 1);
  assert.ok(heights.every((height) => Number.isFinite(height) && height <= 60), heights);
  const header = declarationsFor(sheet, ".clinical-header");
  assert.equal(header.height, "var(--header-height)");
  assert.equal(header["min-height"], "var(--header-height)");
});

test("EMR 헤더는 워크스페이스 여백에 맞춰 단일 로고 열을 정렬한다", () => {
  const inner = ".clinical-header .app-header__inner";

  // The winning declarations, not whichever rule happens to appear first.
  const desktop = declarationsFor(sheet, inner);
  assert.equal(desktop.width, "min(calc(100% - var(--space-6)), var(--emr-max-width))");
  assert.equal(desktop["grid-template-columns"], "minmax(0, 1fr)");
  const narrow = declarationsFor(sheet, inner, { container: "@media (max-width: 620px)" });
  assert.equal(narrow.width, "min(calc(100% - var(--space-4)), var(--emr-max-width))");
});

test("EMR 워크스페이스 탭과 질환 평가 탭은 각각 독립된 키보드 모델을 사용한다", () => {
  const header = renderWorkspaceHeader();
  const assessment = renderAssessment();

  assert.equal((header.match(/role="tablist"/g) ?? []).length, 1);
  assert.equal((assessment.match(/role="tablist"/g) ?? []).length, 1);
  assert.doesNotMatch(header + assessment, /data-tab-target/);
  // 화살표·Home·End 키보드 모델은 Radix Tabs 프리미티브가 제공한다: 각 목록은 방향을 알리고 탭은 role=tab 버튼이다.
  for (const html of [header, assessment]) {
    assert.match(html, /role="tablist" aria-orientation="horizontal"/);
    const tabs = [...html.matchAll(/<button type="button" role="tab" aria-selected="(true|false)"[^>]*data-orientation="horizontal"/g)];
    assert.ok(tabs.length >= 1);
    assert.equal(tabs.filter((match) => match[1] === "true").length, 1, "정확히 한 탭만 선택돼 있다");
  }
  assert.equal(declarationsFor(sheet, ".workspace-tabs button:focus").outline, "3px solid var(--focus-ring)");
});
