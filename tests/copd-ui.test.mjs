import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { Tabs as TabsPrimitive } from "radix-ui";

import { renderComponent } from "./helpers/render.mjs";
import { declarationsFor, hasRule, stylesheet } from "./helpers/css.mjs";

import { createDemoEmrState } from "../src/emr-demo-state.js";
import {
  DISEASE_ASSESSMENT_PROGRAMS,
  evaluateDiseaseAssessment,
  getCombinedDiseaseClaimProfile,
  getDiseaseAssessmentOptions,
  getPreferredDiseaseAssessmentId,
} from "../src/disease-assessment.js";
import { GOLD_COPD_2026_RULESET, HIRA_COPD_2026_RULESET } from "../src/copd-assessment.js";
import { HIRA_PNEUMONIA_2026_RULESET, KDCA_PNEUMONIA_2026_GUIDELINE } from "../src/pneumonia-assessment.js";
import {
  CLAIM_PRESENTATION_STATES,
  latestFinalAdjudication,
  resolveClaimAdjudicationPresentation,
  resolveClaimPreflightPresentation,
} from "../src/claim-presentation.js";
import { searchClaimIndex } from "../src/claim-search.js";
import {
  buildClaimSearchIndex,
  claimAttentionEntries,
  claimReviewEvaluationsForPatients,
  priorityClaimAttentionEntries,
} from "../lib/emr/claims.js";
import { claimEvaluationsFor, confirmedActiveConditions, currentEncounterFor } from "../lib/emr/selectors.js";
import { ClinicalHeader } from "../components/emr/chrome.jsx";
import { WorkspaceHeader } from "../components/emr/workspace-header.jsx";
import { DataUtilities } from "../components/emr/data-utilities.jsx";
import { PatientRail } from "../components/emr/patient-rail.jsx";
import { PatientSummaryCard } from "../components/emr/patient-summary.jsx";
import { DiseaseAssessmentCard } from "../components/emr/claims/disease-assessment.jsx";
import { ClaimsTab } from "../components/emr/tabs/claims-tab.jsx";
import { EncounterTab } from "../components/emr/tabs/encounter-tab.jsx";
import { OverviewTab } from "../components/emr/tabs/overview-tab.jsx";
import { ChartTab } from "../components/emr/tabs/chart-tab.jsx";
import { BodyTab } from "../components/emr/tabs/body-tab.jsx";
import { JourneyTab } from "../components/emr/tabs/journey-tab.jsx";
import { DataTab } from "../components/emr/tabs/data-tab.jsx";

const sheet = await stylesheet("src/emr.css");
const demo = createDemoEmrState("2026-09-02T00:00:00.000Z");
const store = { applyMutation: async () => {}, setStatus: () => {} };
const noop = () => {};

const selected = demo.patients.find(({ id }) => id === demo.selectedPatientId);
/** The one demo patient enrolled in both disease programs. */
const dual = demo.patients.find((patient) => getDiseaseAssessmentOptions(patient).length > 1);

const renderClaimsTab = (patient) => renderComponent(ClaimsTab, { state: demo, patient, store });
const renderAssessment = (patient, selectedDiseaseId = "") => renderComponent(DiseaseAssessmentCard, { state: demo, patient, selectedDiseaseId, onSelectDisease: noop });
const claimsByPatient = new Map(demo.patients.map((patient) => [patient, renderClaimsTab(patient)]));
const allClaims = [...claimsByPatient.values()].join("\n");

/**
 * Every clinician-facing EMR surface, rendered the way the server does for the
 * selected demo patient (dialog bodies live in portals and are not part of it).
 */
function renderEmrSurfaces() {
  const encounter = currentEncounterFor(selected, { viewedEncounterId: "", selectedEncounterId: demo.selectedEncounterId });
  const evaluations = claimEvaluationsFor(selected, demo.rules);
  const ai = { checked: true, configured: true, copilot: false, mode: "frontier", detail: "GPT-5.6" };
  const tabProps = {
    state: demo, patient: selected, encounter, evaluations, preflightEvaluations: evaluations, ai,
    store: { ...store, busy: false, withTransition: async (operation) => operation(), bumpGeneration: noop, setSavedState: noop, savedState: demo, replaceState: async () => {} },
    viewedEncounterId: "", setViewedEncounterId: noop, selectTab: noop, dirtyGuardsRef: { current: {} },
    blockClinicalContextChange: () => false, fhirReport: null, setFhirReport: noop, visitSlot: null,
  };
  const nav = createElement(TabsPrimitive.Root, { value: "encounter" }, createElement(WorkspaceHeader, { onSelectTab: noop }));
  return [
    renderComponent(ClinicalHeader, { demo: true, onExitDemo: noop, ai, nav, utilities: createElement(DataUtilities, tabProps) }),
    renderComponent(PatientRail, {
      patients: demo.patients, selectedPatientId: demo.selectedPatientId, demo: true, updatedAt: demo.updatedAt,
      onEditPatient: noop, onSelectPatient: noop, onLoadDemo: noop, onSavePatient: noop, editRequest: null, onFormStateChange: noop, visitSlotRef: noop,
    }),
    renderComponent(EncounterTab, tabProps),
    renderComponent(OverviewTab, tabProps),
    renderComponent(ChartTab, tabProps),
    renderComponent(BodyTab, { ...tabProps, active: false }),
    renderComponent(JourneyTab, tabProps),
    renderComponent(DataTab, tabProps),
    allClaims,
  ].join("\n");
}

const count = (html, needle) => html.split(needle).length - 1;
/** Text of the rendered element whose opening tag carries `id`. */
const textOfId = (html, id) => html.match(new RegExp(`\\bid="${id}"[^>]*>([^<]*)<`))?.[1] ?? "";
/** The active 질환 tab's data-disease-assessment-id. */
const activeDiseaseTab = (html) => html.match(/<button[^>]*role="tab"[^>]*aria-selected="true"[^>]*data-disease-assessment-id="([a-z]+)"/)?.[1];
/** The claim attention entries the 급여 보드 renders for this patient. */
function attentionFor(patient) {
  const evaluations = claimReviewEvaluationsForPatients(demo, [patient]).filter(({ patientId }) => patientId === patient.id);
  return claimAttentionEntries(patient, evaluations, getCombinedDiseaseClaimProfile(patient));
}

test("급여 주의와 질환별 적정성·진단 근거는 독립된 summary-first 패널이다", () => {
  for (const [patient, html] of claimsByPatient) {
    for (const id of [
      "claimBoardKpis",
      "claimRuleTrust",
      "claimAttentionSummary",
      "claimAttentionList",
      "claimAdjudicationSummary",
      "claimAdjudicationList",
      "diseaseAssessmentTabs",
      "diseaseAssessmentPanel",
      "diseaseQualitySummary",
      "diseaseQualityMetrics",
      "diseaseQualityDetails",
      "diseaseAssessmentMeta",
      "diseaseAssessmentSources",
      "claimWorkflowDisclosure",
      // 진단 정합성 요약·상세는 질환 변형마다 정의되지만 런타임에는 하나만 렌더된다.
      "diseaseDiagnosticSummary",
      "diseaseDiagnosticDetails",
    ]) {
      assert.equal(count(html, `id="${id}"`), 1, `${patient.name} ${id}`);
    }
    // 그 외 항목 disclosure는 우선 항목 밖의 주의사항이 있을 때만, 그때도 한 번만 렌더된다.
    const entries = attentionFor(patient);
    const others = entries.length - priorityClaimAttentionEntries(entries).length;
    for (const id of ["claimAttentionAllDisclosure", "claimAttentionAllList"]) {
      assert.equal(count(html, `id="${id}"`), others > 0 ? 1 : 0, `${patient.name} ${id}`);
    }
  }
  assert.ok(demo.patients.some((patient) => claimsByPatient.get(patient).includes('id="claimAttentionAllDisclosure"')));

  const html = claimsByPatient.get(selected);
  assert.match(html, /질환을 선택해 평가대상 여부와 지표별 충족 예상만 먼저 보고/);
  assert.match(html, /기관 질 지표 예상/);
  assert.match(html, /개별 청구 조정과 별개의 기관 평가입니다/);
  assert.match(html, /공식 기관 점수·등급이나 가산금액을 계산하지 않으며/);
  assert.match(html, /<details class="claim-overview-disclosure/);
  // 지표 목록은 평가 지표 disclosure 안에, 다음 disclosure(진단 정합성) 앞에 놓인다.
  const disclosureAt = html.indexOf('id="diseaseQualityDisclosure"');
  const metricsAt = html.indexOf('id="diseaseQualityMetrics"');
  const diagnosticAt = html.indexOf('id="diseaseDiagnosticDisclosure"');
  assert.ok(disclosureAt > -1 && disclosureAt < metricsAt && metricsAt < diagnosticAt);
  assert.match(html, /<details class="quality-diagnostic-panel" id="diseaseDiagnosticDisclosure"/);
  assert.match(html, /<details class="claim-workflow-disclosure" id="claimWorkflowDisclosure"/);
  assert.doesNotMatch(allClaims, /id="copd(?:Quality|Diagnostic|Assessment)/);
});

test("질환 선택은 환자별 관련 프로그램만 렌더하고 전환해도 전체 청구 요약을 유지한다", async () => {
  assert.ok(dual, "두 질환 프로그램에 모두 연결된 예시 환자가 있다");
  const programIds = Object.keys(DISEASE_ASSESSMENT_PROGRAMS);
  for (const patient of demo.patients) {
    const options = getDiseaseAssessmentOptions(patient);
    assert.ok(options.length >= 1, patient.name);
    assert.ok(options.every(({ id }) => programIds.includes(id)), patient.name);
    assert.equal(getPreferredDiseaseAssessmentId(patient), options[0].id, patient.name);
    // 탭은 Radix Tabs 프리미티브(role=tablist/tab)이며 이 환자에게 연결된 질환만 렌더한다.
    const html = renderAssessment(patient);
    const tablist = html.match(/<div[^>]*role="tablist"[^>]*id="diseaseAssessmentTabs"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
    const tabIds = [...tablist.matchAll(/<button[^>]*role="tab"[^>]*data-disease-assessment-id="([a-z]+)"/g)].map((match) => match[1]);
    assert.deepEqual(tabIds, options.map(({ id }) => id), patient.name);
    assert.equal(activeDiseaseTab(html), options[0].id, patient.name);
    assert.ok(evaluateDiseaseAssessment(patient, options[0].id), patient.name);
  }

  // 선택을 바꾸면 활성 탭·프로그램 제목이 그 질환으로 바뀌고, 모르는 선택은 첫 프로그램으로 돌아간다.
  for (const id of ["copd", "pneumonia"]) {
    const html = renderAssessment(dual, id);
    assert.equal(activeDiseaseTab(html), id);
    assert.equal(textOfId(html, "diseaseProgramTitle"), DISEASE_ASSESSMENT_PROGRAMS[id].label);
  }
  assert.equal(activeDiseaseTab(renderAssessment(dual, "unknown-disease")), getDiseaseAssessmentOptions(dual)[0].id);

  // 왼쪽 급여 주의사항은 두 질환의 청구 항목을 함께 담은 전체 질환 기준이다.
  const combined = getCombinedDiseaseClaimProfile(dual);
  assert.deepEqual([...combined.assessmentIds].sort(), ["copd", "pneumonia"]);
  const claims = claimsByPatient.get(dual);
  for (const id of ["copd", "pneumonia"]) {
    const labels = combined.claimItems.filter(({ assessmentId }) => assessmentId === id).map(({ label }) => label);
    assert.ok(labels.length > 0, id);
    assert.ok(labels.some((label) => claims.includes(`<strong>${label}</strong>`)), `${id} 청구 항목이 급여 주의사항에 있다`);
  }
  assert.match(claims, /id="diseaseAssessmentLive" role="status" aria-live="polite"/);
  // source-check: 질환 전환 안내 문구는 탭 클릭 핸들러가 라이브 영역에 써 넣으므로 SSR 마크업으로는 볼 수 없다.
  const claimsTabSource = await readFile(new URL("../components/emr/tabs/claims-tab.jsx", import.meta.url), "utf8");
  assert.match(claimsTabSource, /왼쪽 급여 주의사항은 전체 질환 기준으로 유지됩니다/);
  // source-check: 질환 선택은 환자 id를 키로 한 인메모리 Map(useState)에만 남으므로 SSR 마크업으로는 환자별 유지를 관찰할 수 없다.
  assert.match(claimsTabSource, /selectedDiseaseByPatientId\.get\(patient\.id\)/);
  assert.match(claimsTabSource, /new Map\(current\)\.set\(patient\.id, diseaseId\)/);
  assert.equal(declarationsFor(sheet, ".disease-assessment-tab")["min-height"], "48px");
});

test("선택 환자 헤더는 확정 활성 질환을 별도 목록으로 렌더한다", () => {
  const patient = {
    id: "patient-conditions",
    name: "조건 환자",
    events: [
      { id: "kept", type: "condition", date: "2026-05-01", code: "J45.9", system: "urn:kr:kcd", label: "천식", recordStatus: "final", status: "active", certainty: "confirmed" },
      { id: "draft", type: "condition", date: "2026-05-02", code: "I10", system: "urn:kr:kcd", label: "고혈압 초안", recordStatus: "draft", status: "active", certainty: "confirmed" },
      { id: "resolved", type: "condition", date: "2026-05-03", code: "J18.9", system: "urn:kr:kcd", label: "폐렴 완치", recordStatus: "final", status: "resolved", certainty: "confirmed" },
      { id: "provisional", type: "condition", date: "2026-05-04", code: "E11", system: "urn:kr:kcd", label: "당뇨 의증", recordStatus: "final", status: "active", certainty: "provisional" },
      { id: "demo-code", type: "condition", date: "2026-05-05", code: "DEMO-COPD", system: "urn:kr:kcd", label: "예시 코드 질환", recordStatus: "final", status: "active", certainty: "confirmed" },
      { id: "demo-system", type: "condition", date: "2026-05-06", code: "X1", system: "urn:policycompass:demo", label: "예시 체계 질환", recordStatus: "final", status: "active", certainty: "confirmed" },
    ],
  };
  assert.deepEqual(confirmedActiveConditions(patient).map(({ id }) => id), ["kept"]);

  const html = renderComponent(PatientSummaryCard, { patient, demo: true, updatedAt: demo.updatedAt, onEditPatient: noop });
  const list = html.match(/<div[^>]*id="selectedPatientConditions"[^>]*>([\s\S]*?)<\/div>/);
  assert.ok(list, "확정 활성 질환 목록이 렌더된다");
  assert.match(list[0], /^<div[^>]*id="selectedPatientConditions" role="list"/);
  assert.match(list[0], /aria-label="확정 활성 질환: 천식"/);
  assert.deepEqual([...list[1].matchAll(/<strong>([^<]+)<\/strong>/g)].map((match) => match[1]), ["천식"]);
  assert.doesNotMatch(list[1], /고혈압 초안|폐렴 완치|당뇨 의증|예시 코드 질환|예시 체계 질환/);

  // 확정 질환이 없으면 목록은 비어 있다는 항목 하나만 담는다.
  const empty = renderComponent(PatientSummaryCard, { patient: { ...patient, events: [] }, demo: true, updatedAt: demo.updatedAt, onEditPatient: noop });
  assert.match(empty, /id="selectedPatientConditions"[^>]*aria-label="확정 활성 질환 없음"[^>]*>[\s\S]*?<span class="patient-condition-summary__empty" role="listitem">확정 활성 질환 없음<\/span>/);
});

test("공개 EMR UI는 공모전·DEMO 배지를 노출하지 않는다", () => {
  const html = renderEmrSurfaces();
  assert.ok(html.length > 50_000, "EMR 화면 전체가 렌더된다");
  assert.doesNotMatch(html, /<b>예시<\/b>/);
  assert.doesNotMatch(html, />\s*DEMO\s*</i);
  assert.doesNotMatch(html, /\bcontest\b|공모전/i);
  assert.doesNotMatch(html, /claim-synthetic-badge/);
  assert.doesNotMatch(html, /합성 공모전 데모|합성 데모/);
});

test("COPD와 폐렴은 평가 지표와 임상 정합성을 서로 섞지 않는다", () => {
  const copd = renderAssessment(dual, "copd");
  const pneumonia = renderAssessment(dual, "pneumonia");

  // 각 질환 화면은 자기 규칙 버전·출처만 인용한다.
  const metaOf = (html) => html.match(/id="diseaseAssessmentMeta"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "";
  const copdMeta = metaOf(copd);
  assert.match(copdMeta, new RegExp(HIRA_COPD_2026_RULESET.version));
  assert.match(copdMeta, new RegExp(GOLD_COPD_2026_RULESET.version));
  assert.doesNotMatch(copdMeta, new RegExp(HIRA_PNEUMONIA_2026_RULESET.version));
  const pneumoniaMeta = metaOf(pneumonia);
  assert.match(pneumoniaMeta, new RegExp(HIRA_PNEUMONIA_2026_RULESET.version));
  assert.match(pneumoniaMeta, new RegExp(KDCA_PNEUMONIA_2026_GUIDELINE.version));
  assert.doesNotMatch(pneumoniaMeta, new RegExp(HIRA_COPD_2026_RULESET.version));

  assert.match(copd, /post-BD 기준/);
  assert.match(copd, /정확히 0\.70/);
  assert.match(copd, /자동 입력·삭제하지 않으며/);
  assert.doesNotMatch(copd, /흉부 영상|CURB-65|혈액배양/);

  assert.match(pneumonia, /흉부 영상/);
  assert.match(pneumonia, /CURB-65·PSI는 중증도를 확인하는 도구/);
  assert.match(pneumonia, /혈액배양을 시행하지 않은 사례/);
  assert.match(pneumonia, /개별 진료비 삭감 확정과 같지 않습니다/);
  assert.doesNotMatch(pneumonia, /post-BD 기준|정확히 0\.70/);

  // 출처 링크는 새 창으로 열리는 안전한 외부 링크로 렌더된다.
  for (const [html, rule] of [[copd, HIRA_COPD_2026_RULESET], [copd, GOLD_COPD_2026_RULESET], [pneumonia, HIRA_PNEUMONIA_2026_RULESET], [pneumonia, KDCA_PNEUMONIA_2026_GUIDELINE]]) {
    const href = rule.sourceUrl.replaceAll("&", "&amp;");
    assert.ok(html.includes(`<a class="quality-source-link" href="${href}" target="_blank" rel="noreferrer">${rule.sourceLabel} ↗</a>`), rule.sourceLabel);
  }
});

test("청구 색상은 내부 규칙 상태와 지급·심사 경계를 텍스트로 함께 표시한다", () => {
  const html = claimsByPatient.get(selected);
  assert.match(html, /빨강 · 내부 규칙상 근거 누락/);
  assert.match(html, /주황 · 등록 규칙 확인 필요/);
  assert.match(html, /초록 · 등록 규칙 조건 일치/);
  assert.match(html, /보라 · 자료 부족/);
  assert.match(html, /지급·급여·심사 결과 보장 아님/);
  assert.match(html, /ADJUDICATION RESULT[\s\S]*?>심사 결과</);
  assert.doesNotMatch(allClaims, /[0-9]\. 청구 전 점검|[0-9]\. 심사 결과|[0-9]\. 적정성 평가/);

  // 사전점검 표시는 규칙 상태를 네 가지 상태와 지급 경계 문구로 바꾼다.
  const preflight = {
    notApplicable: resolveClaimPreflightPresentation({ evaluation: { status: "not-applicable" } }),
    risk: resolveClaimPreflightPresentation({ evaluation: { status: "missing-evidence" }, claimItem: { riskConfirmed: true, riskReason: "근거 누락" } }),
    review: resolveClaimPreflightPresentation({ evaluation: { status: "due-soon", explanation: "기간 확인" } }),
    verified: resolveClaimPreflightPresentation({ evaluation: { status: "ready", calculationAvailable: true, missingEvidence: [] } }),
  };
  assert.equal(preflight.notApplicable.state, "insufficient");
  assert.equal(preflight.risk.state, "high-risk");
  assert.equal(preflight.review.state, "needs-review");
  assert.equal(preflight.verified.state, "verified");
  for (const presentation of Object.values(preflight)) {
    assert.equal(presentation.label, CLAIM_PRESENTATION_STATES[presentation.state].label);
    assert.match(presentation.paymentBoundary, /않습니다|아닙니다/);
  }
  assert.match(preflight.verified.paymentBoundary, /지급·급여 인정·심사 결과를 보장하지 않습니다/);

  // 심사 결과는 최종 확정된 결정만 인정·조정으로 표시하고 지급 경계를 함께 붙인다.
  const pending = { claimItemId: "line-1", sourceId: "hira", decidedAt: "2026-08-01T00:00:00.000Z", reasonCode: "A1", status: "pending", outcome: "reduced" };
  const final = { ...pending, decidedAt: "2026-08-02T00:00:00.000Z", status: "final", outcome: "approved" };
  assert.equal(latestFinalAdjudication([pending], "line-1"), null);
  assert.equal(latestFinalAdjudication([pending, final], "line-1"), final);
  const recognized = resolveClaimAdjudicationPresentation(final);
  assert.equal(recognized.state, "recognized");
  assert.match(recognized.paymentBoundary, /청구 전 자동점검과 별도로 표시합니다/);
  assert.equal(resolveClaimAdjudicationPresentation({ ...final, outcome: "reduced", claimedAmount: 100, allowedAmount: 0 }).label, "전액 불인정");

  // 우선 항목은 조치가 필요한 상태를 먼저, 최대 3건까지만 고른다.
  const entry = (state, title) => ({ id: title, title, presentation: { state } });
  const entries = [entry("verified", "v"), entry("insufficient", "i"), entry("high-risk", "h1"), entry("needs-review", "n1"), entry("high-risk", "h2"), entry("needs-review", "n2")];
  assert.deepEqual(priorityClaimAttentionEntries(entries).map(({ id }) => id), ["h1", "n1", "h2"]);
  assert.deepEqual(priorityClaimAttentionEntries([entry("verified", "v"), entry("insufficient", "i")]).map(({ id }) => id), ["v", "i"]);
  // 해당 없음(not-applicable) 규칙 판정은 청구 전 점검 행이 되지 않는다.
  assert.deepEqual(claimAttentionEntries(selected, [{ id: "na", status: "not-applicable", sourceKind: "rule", title: "해당 없음", rule: {} }], null), []);

  // 렌더된 행은 같은 상태·문구를 쓰고, 요약 헤드라인은 가장 급한 상태의 건수를 말한다.
  let insufficientHeadlineSeen = false;
  for (const [patient, markup] of claimsByPatient) {
    const attention = attentionFor(patient);
    const counts = { "high-risk": 0, "needs-review": 0, insufficient: 0, verified: 0 };
    for (const { presentation } of attention) counts[presentation.state] += 1;
    for (const row of markup.matchAll(/<li class="claim-attention-item" data-claim-state="([a-z-]+)">[\s\S]*?<span class="claim-attention-item__status">([^<]+)<\/span>/g)) {
      assert.equal(row[2], CLAIM_PRESENTATION_STATES[row[1]].label, `${patient.name} ${row[1]}`);
    }
    const headline = markup.match(/id="claimAttentionSummary"[^>]*>[\s\S]*?<strong>([^<]+)<\/strong>/)?.[1] ?? "";
    const expected = counts["high-risk"]
      ? `내부 규칙상 근거 누락 ${counts["high-risk"]}건을 먼저 확인하세요.`
      : counts["needs-review"]
        ? `급여기준을 확인할 항목 ${counts["needs-review"]}건이 있습니다.`
        : counts.insufficient
          ? `판정 자료를 보완할 항목 ${counts.insufficient}건이 있습니다.`
          : counts.verified ? "확인된 자료 범위에서 즉시 발견된 위험은 없습니다." : "현재 자료로는 청구 위험을 판정하기 어렵습니다.";
    assert.equal(headline, expected, patient.name);
    if (headline.includes("판정 자료를 보완할 항목")) insufficientHeadlineSeen = true;
    for (const item of markup.matchAll(/<li class="claim-adjudication-item" data-adjudication-state="([a-z-]+)"[\s\S]*?<small class="claim-adjudication-item__boundary">([^<]+)<\/small>/g)) {
      assert.match(item[2], /청구 전 자동점검과 별도로 표시합니다/, `${patient.name} ${item[1]}`);
    }
  }
  assert.ok(insufficientHeadlineSeen, "자료 부족만 있는 환자는 보완 항목 헤드라인을 본다");

  for (const selector of [
    '.claim-attention-item[data-claim-state="high-risk"]',
    '.claim-attention-item[data-claim-state="needs-review"]',
    '.claim-adjudication-item[data-adjudication-state="recognized"]',
    '.claim-attention-item[data-claim-state="verified"]',
  ]) {
    assert.ok(hasRule(sheet, selector), selector);
  }
});

test("반응형 평가 패널은 좁은 화면에서 1열이며 새 모듈을 모두 배포한다", () => {
  const grid = declarationsFor(sheet, ".claim-overview-grid");
  assert.equal(grid["grid-template-columns"], "minmax(0, 1.16fr) minmax(370px, 0.84fr)");
  assert.equal(declarationsFor(sheet, ".quality-program-metrics")["grid-template-columns"], "1fr");
  assert.equal(declarationsFor(sheet, ".claim-overview-grid", { container: "@media (max-width: 1180px)" })["grid-template-columns"], "1fr");
  assert.ok(hasRule(sheet, ".quality-program-metrics", { container: "@media (max-width: 620px)" }));
  assert.equal(declarationsFor(sheet, "#panel-claims details:not([open]) > :not(summary)").display, "none");
  assert.notEqual(grid["overflow-x"], "auto");
  assert.notEqual(grid.overflow, "auto");

  // 질환 평가 모듈: COPD·폐렴 예시 데이터와 평가 규칙이 하나의 프로그램 목록으로 연결된다.
  const programsSeen = new Set(demo.patients.flatMap((patient) => getDiseaseAssessmentOptions(patient).map(({ id }) => id)));
  assert.deepEqual([...programsSeen].sort(), ["copd", "pneumonia"]);
  assert.equal(evaluateDiseaseAssessment(dual, "copd").quality.rule.id, HIRA_COPD_2026_RULESET.id);
  assert.equal(evaluateDiseaseAssessment(dual, "pneumonia").quality.rule.id, HIRA_PNEUMONIA_2026_RULESET.id);
  assert.equal(evaluateDiseaseAssessment(dual, "nope"), null);

  // 급여 보드는 청구 표시·통합 검색·질환 평가 모듈을 실제로 사용한다.
  const html = claimsByPatient.get(dual);
  assert.match(html, /<small>등록 규칙 조건 일치<\/small>/);
  assert.match(html, /<input id="claimSearch" type="search"/);
  const index = buildClaimSearchIndex(demo, dual, claimReviewEvaluationsForPatients(demo, [dual]), getCombinedDiseaseClaimProfile(dual));
  const qualityHits = searchClaimIndex(index, DISEASE_ASSESSMENT_PROGRAMS.pneumonia.label, 12);
  assert.ok(qualityHits.some((hit) => hit.target?.targetType === "quality" && hit.target.diseaseId === "pneumonia"));
  assert.equal(textOfId(html, "diseaseProgramTitle"), DISEASE_ASSESSMENT_PROGRAMS[getPreferredDiseaseAssessmentId(dual)].label);
});

test("급여·적정성의 핵심 판정은 근거 문구보다 큰 위계로 읽힌다", () => {
  let hierarchyComment = false;
  sheet.walkComments((comment) => { if (comment.text.startsWith("EMR review hierarchy")) hierarchyComment = true; });
  assert.ok(hierarchyComment, "검토 위계 섹션이 스타일시트에 있다");
  assert.equal(declarationsFor(sheet, ".claim-attention-summary__content > strong")["font-size"], "1.05rem");
  assert.equal(declarationsFor(sheet, ".quality-program-score b")["font-size"], "1.35rem");
  assert.match(declarationsFor(sheet, ".claim-intro .card-heading h3")["font-size"], /^clamp\(1\.15rem/);
  assert.match(declarationsFor(sheet, ".claim-board-kpi > strong")["font-size"], /^clamp\(1\.45rem/);
  assert.match(declarationsFor(sheet, ".claim-card__details-header h5")["font-size"], /^clamp\(1\.45rem/);
  assert.match(claimsByPatient.get(selected), /진료일·청구 항목별로 조치가 필요한 조건만 먼저 보여 줍니다/);
  assert.doesNotMatch(allClaims, /claim-attention-item__reason/);

  // Claims workbench 섹션부터는 3px 왼쪽 띠 대신 그라데이션 배경으로 상태를 표시한다.
  let inWorkbench = false;
  const stripes = [];
  sheet.walk((node) => {
    if (node.type === "comment" && node.text.startsWith("Claims workbench:")) inWorkbench = true;
    if (!inWorkbench || node.type !== "decl") return;
    if ((node.prop === "border-left" && /^3px/.test(node.value)) || (node.prop === "box-shadow" && /^inset 3px/.test(node.value))) {
      stripes.push(`${node.parent.selector} { ${node.prop}: ${node.value} }`);
    }
  });
  assert.ok(inWorkbench, "Claims workbench 섹션이 스타일시트에 있다");
  assert.deepEqual(stripes, []);
  assert.match(declarationsFor(sheet, ".claim-attention-list > li").background, /^linear-gradient/);
  assert.match(declarationsFor(sheet, "button.claim-attention-item__summary:hover").background, /^linear-gradient/);
  assert.match(declarationsFor(sheet, ".quality-program-metric__detail").background, /^linear-gradient/);
});
