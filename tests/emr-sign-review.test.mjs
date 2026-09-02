import assert from "node:assert/strict";
import test from "node:test";

import { componentMarkup } from "./helpers/markup.mjs";
import { openingTag, renderComponent } from "./helpers/render.mjs";

import {
  assertEncounterSignReviewContext,
  assertEncounterSignReviewFingerprint,
  assertEncounterSignReviewReady,
  buildEncounterSignReview,
  encounterSignReviewFingerprint,
  encounterSignReviewIdentity,
} from "../src/emr-sign-review.js";
import { createDemoEmrState } from "../src/emr-demo-state.js";
import { completeEncounter, getEncounterRecords } from "../src/emr-encounter.js";
import { EncounterTab } from "../components/emr/tabs/encounter-tab.jsx";

/**
 * Completes the demo patient's in-progress encounter (optionally with a SOAP
 * patch) and renders the encounter tab the way the server does. The tab has no
 * open dialogs and no visit slot, so nothing portals and the sign-off review
 * card renders in full.
 */
function renderCompletedEncounter(soapPatch = {}) {
  const state = createDemoEmrState("2026-09-02T00:00:00.000Z");
  const patient = state.patients.find(({ id }) => id === state.selectedPatientId);
  const draft = patient.events.find(({ id }) => id === state.selectedEncounterId);
  const completed = completeEncounter(state, patient.id, draft.id, { soap: { ...draft.soap, ...soapPatch } }, "2026-09-02T09:00:00.000Z");
  const completedPatient = completed.patients.find(({ id }) => id === patient.id);
  const encounter = completedPatient.events.find(({ id }) => id === draft.id);
  const review = buildEncounterSignReview(completedPatient, encounter, getEncounterRecords(completedPatient, encounter.id).slice(1));
  const html = renderComponent(EncounterTab, {
    patient: completedPatient,
    encounter,
    preflightEvaluations: [],
    store: { applyMutation: async () => {}, setStatus: () => {} },
    viewedEncounterId: "",
    setViewedEncounterId: () => {},
    selectTab: () => {},
    dirtyGuardsRef: { current: {} },
    blockClinicalContextChange: () => false,
    visitSlot: null,
  });
  return { html, review };
}

/** The opening tag of the element carrying `id`, or "" when it is not rendered. */
test("서명 전 검토는 환자·Encounter 전체 맥락과 누락·충돌 수정 대상을 만든다", () => {
  const patient = {
    id: "patient-current",
    name: "테스트 환자",
    mrn: "SYN-100",
    events: [
      { id: "allergy", type: "allergy", label: "페니실린", status: "active" },
      { id: "active-med", type: "medication", label: "메트포르민", status: "active", encounterId: "prior" },
    ],
  };
  const encounter = {
    id: "enc-current",
    date: "2026-07-23",
    label: "외래 진료",
    department: "가정의학과",
    clinician: "테스트 의사",
    chiefComplaint: "두통",
    soap: { subjective: "증상", objective: "", assessment: "평가", plan: "계획" },
  };
  const records = [
    { id: "temperature", type: "observation", label: "체온", value: "37.1", unit: "Cel" },
    { id: "diagnosis", type: "condition", label: "고혈압", system: "urn:kr:kcd", code: "I10", diagnosisRole: "primary" },
    {
      id: "prescription",
      type: "medication",
      label: "페니실린",
      encounterId: "enc-current",
      prescription: {
        dose: 1,
        doseUnit: "정",
        route: "경구",
        frequency: "1일 1회",
        durationDays: 7,
        quantity: 7,
      },
    },
    { id: "order", type: "service-request", label: "혈액검사", code: "LAB-1", order: { kind: "laboratory" } },
  ];

  const review = buildEncounterSignReview(patient, encounter, records);

  assert.deepEqual(review.patient, { id: "patient-current", name: "테스트 환자", mrn: "SYN-100" });
  assert.equal(review.encounter.id, "enc-current");
  assert.equal(review.allergies.length, 1);
  assert.equal(review.activeMedications.length, 1);
  assert.equal(review.measurements.length, 1);
  assert.equal(review.prescriptions.length, 1);
  assert.equal(review.diagnoses.length, 1);
  assert.equal(review.orders.length, 1);
  assert.deepEqual(review.omissions, [{
    code: "soap-objective",
    message: "SOAP Objective가 비어 있습니다.",
    target: "soapObjective",
    action: "SOAP 수정",
  }]);
  assert.equal(review.conflicts[0].target, "medicationName");
  assert.match(review.conflicts[0].message, /알레르기 '페니실린'/);
});

test("서명 전 검토 UI는 전체 항목과 진료 재개 correction path를 노출한다", () => {
  // Given — Objective를 비운 채 완료해 누락 한 건이 남은 진료.
  const { html, review } = renderCompletedEncounter({ objective: "" });

  // Then — 검토 카드는 제목으로 이름 붙고 포커스를 받을 수 있으며 확인 체크박스를 갖는다.
  assert.match(html, /<section class="clinical-card sign-review" id="encounterSignReview" aria-labelledby="encounterSignReviewTitle">/);
  assert.match(html, /<h3 id="encounterSignReviewTitle" tabindex="-1">서명 전 전체 기록 검토<\/h3>/);
  assert.match(openingTag(html, "encounterSignReviewAcknowledged"), /type="checkbox"/);
  // 카드 내용은 buildEncounterSignReview가 만든 검토 그대로다.
  assert.match(html, new RegExp(`<strong>${review.patient.name}</strong><span>MRN ${review.patient.mrn}</span>`));
  assert.match(html, new RegExp(`Encounter ID ${review.encounter.id}`));
  assert.ok(review.allergies.length > 0 && review.activeMedications.length > 0, "예시 환자는 알레르기·활성 약물 기록을 가진다");
  for (const item of [...review.allergies, ...review.activeMedications, ...review.diagnoses]) {
    assert.ok(html.includes(`<li>${item.label}</li>`) || html.includes(`· ${item.label}</li>`), `${item.label} 항목이 검토 카드에 있다`);
  }
  assert.deepEqual(review.omissions.map(({ message }) => message), ["SOAP Objective가 비어 있습니다."]);
  // 누락·충돌마다 진료를 다시 열어 고칠 수 있는 correction path가 붙고, 재개 버튼은 완료 상태에서 보인다.
  assert.match(html, /<p>누락 · SOAP Objective가 비어 있습니다\.<\/p><button class="clinical-button" type="button">SOAP 수정 — 진료 재개<\/button>/);
  const reopen = openingTag(html, "reopenEncounter");
  assert.ok(reopen && !/\bhidden\b/.test(reopen), "서명 전 재개 버튼이 보인다");
  assert.match(html, /id="reopenEncounter"[^>]*>서명 전 재개<\/button>/);
  for (const label of ["알레르기", "활성 약물", "외부·미검증 알레르기", "외부·미검증 활성 약물", "이번 진료 측정·활력징후", "새 처방", "SOAP", "KCD 진단", "오더"]) {
    assert.match(html, new RegExp(`<section class="sign-review__group"><h4>${label}</h4>`));
  }
});

test("검토 뒤 환자 또는 Encounter 맥락이 바뀌면 로컬 서명을 차단한다", () => {
  const reviewedPatient = { id: "patient-a", mrn: "SYN-100" };
  const reviewedEncounter = { id: "encounter-a" };
  const reviewedIdentity = encounterSignReviewIdentity(reviewedPatient, reviewedEncounter);

  assert.deepEqual(
    assertEncounterSignReviewContext(reviewedIdentity, reviewedPatient, reviewedEncounter),
    reviewedIdentity,
  );
  assert.throws(
    () => assertEncounterSignReviewContext(reviewedIdentity, { id: "patient-b", mrn: "SYN-200" }, reviewedEncounter),
    /현재 맥락과 다릅니다/,
  );
  assert.throws(
    () => assertEncounterSignReviewContext(reviewedIdentity, reviewedPatient, { id: "encounter-b" }),
    /현재 맥락과 다릅니다/,
  );
  assert.throws(
    () => assertEncounterSignReviewContext(reviewedIdentity, { ...reviewedPatient, mrn: "SYN-CHANGED" }, reviewedEncounter),
    /현재 맥락과 다릅니다/,
  );
});

test("누락 또는 충돌이 남거나 검토 뒤 내용이 바뀌면 로컬 서명을 차단한다", () => {
  const clearReview = { omissions: [], conflicts: [], patient: { id: "p" } };
  assert.equal(assertEncounterSignReviewReady(clearReview), clearReview);
  const fingerprint = encounterSignReviewFingerprint(clearReview);
  assert.equal(assertEncounterSignReviewFingerprint(fingerprint, clearReview), fingerprint);
  assert.throws(
    () => assertEncounterSignReviewReady({
      omissions: [{ message: "SOAP Objective가 비어 있습니다." }],
      conflicts: [],
    }),
    /누락 1건·충돌 0건/,
  );
  assert.throws(
    () => assertEncounterSignReviewReady({
      omissions: [],
      conflicts: [{ message: "새 처방과 알레르기 이름이 일치합니다." }],
    }),
    /누락 0건·충돌 1건/,
  );
  assert.throws(
    () => assertEncounterSignReviewFingerprint(fingerprint, { ...clearReview, patient: { id: "changed" } }),
    /기록 내용이 변경/,
  );
});

test("무효·비활성 이력은 제외하고 외부 미검증 알레르기·약물은 신뢰 기록과 분리한다", () => {
  const patient = {
    id: "patient-a",
    name: "환자",
    mrn: "MRN-A",
    events: [
      { id: "trusted-allergy", type: "allergy", label: "페니실린", status: "active", recordStatus: "final", source: { kind: "manual", label: "직접 입력" } },
      { id: "void-allergy", type: "allergy", label: "무효 알레르기", status: "active", recordStatus: "entered-in-error", source: { kind: "manual" } },
      { id: "inactive-allergy", type: "allergy", label: "비활성 알레르기", status: "inactive", recordStatus: "final", source: { kind: "manual" } },
      { id: "external-allergy", type: "allergy", label: "외부 알레르기", status: "active", recordStatus: "final", source: { kind: "fhir", label: "FHIR 미검증" } },
      { id: "trusted-med", type: "medication", label: "활성 약", status: "active", recordStatus: "final", source: { kind: "manual" } },
      { id: "void-med", type: "medication", label: "무효 약", status: "active", recordStatus: "entered-in-error", source: { kind: "manual" } },
      { id: "stopped-med", type: "medication", label: "중단 약", status: "stopped", recordStatus: "final", source: { kind: "manual" } },
      { id: "external-med", type: "medication", label: "외부 약", status: "active", recordStatus: "final", source: { kind: "import", label: "백업 미검증" } },
    ],
  };
  const encounter = {
    id: "encounter-a",
    date: "2026-07-23",
    label: "외래",
    clinician: "의사",
    chiefComplaint: "추적",
    soap: { subjective: "S", objective: "O", assessment: "A", plan: "P" },
  };
  const records = [{
    id: "diagnosis",
    type: "condition",
    label: "진단",
    system: "urn:kr:kcd",
    code: "I10",
    diagnosisRole: "primary",
  }];

  const review = buildEncounterSignReview(patient, encounter, records);

  assert.deepEqual(review.allergies.map(({ id }) => id), ["trusted-allergy"]);
  assert.deepEqual(review.unverifiedAllergies.map(({ id }) => id), ["external-allergy"]);
  assert.deepEqual(review.activeMedications.map(({ id }) => id), ["trusted-med"]);
  assert.deepEqual(review.unverifiedActiveMedications.map(({ id }) => id), ["external-med"]);
});

test("서명 동작은 누락·충돌과 fingerprint 확인을 화면과 mutation 시점에 차단한다", async () => {
  // Given — 누락이 남은 진료와, 누락·충돌 없이 완료됐지만 아직 검토 완료를 누르지 않은 진료.
  const blocked = renderCompletedEncounter({ objective: "" });
  const clear = renderCompletedEncounter();
  const encounter = await componentMarkup("components/emr/tabs/encounter-tab.jsx");

  // Then — 누락·충돌이 남으면 서명 버튼과 검토 완료 체크박스가 모두 잠긴다.
  assert.equal(blocked.review.omissions.length + blocked.review.conflicts.length, 1);
  assert.match(openingTag(blocked.html, "signEncounter"), /\bdisabled=""/);
  assert.match(openingTag(blocked.html, "signEncounter"), /title="서명 전 누락·충돌 1건을 먼저 수정하세요\."/);
  assert.match(openingTag(blocked.html, "encounterSignReviewAcknowledged"), /\bdisabled=""/);
  assert.match(blocked.html, /id="encounterSignReviewAcknowledgementStatus" role="status">누락 1건·충돌 0건을 해결해야 검토를 완료할 수 있습니다\.</);
  // 누락·충돌이 없어도 현재 내용의 검토 완료를 확인하기 전에는 서명할 수 없다.
  assert.equal(clear.review.omissions.length + clear.review.conflicts.length, 0);
  assert.match(openingTag(clear.html, "signEncounter"), /\bdisabled=""/);
  assert.match(openingTag(clear.html, "signEncounter"), /title="현재 환자·Encounter와 전체 기록을 확인한 뒤 검토 완료를 선택하세요\."/);
  assert.doesNotMatch(openingTag(clear.html, "encounterSignReviewAcknowledged"), /\bdisabled\b/);
  assert.match(clear.html, /id="encounterSignReviewAcknowledgementStatus" role="status">전체 기록을 확인한 뒤 검토 완료를 선택하면 서명할 수 있습니다\.</);
  // source-check: 세 번째 분기 — 누락·충돌이 없고 검토 완료를 눌렀을 때 서명 버튼이 풀리는 것 — 는 `acknowledged`가
  // 체크박스 onChange로 바뀌는 useState(signAck)에서 나오는 클라이언트 상태라 서버 렌더로는 도달할 수 없다.
  // 위의 두 렌더 확인은 잠기는 분기만 보므로, disabled가 blockers와 acknowledged 둘 다에 걸려 있음을 원문으로 고정한다.
  assert.match(encounter, /id="signEncounter"[^>]*disabled=\{blockers\.length > 0 \|\| !acknowledged\}/);
  // source-check: 서명 클릭 핸들러와 mutation 안의 재검사는 브라우저 이벤트·confirm 뒤에만 실행되어 서버 렌더로 관찰할 수 없다.
  assert.match(encounter, /encounterSignReviewFingerprint\(review\)/);
  assert.equal(
    encounter.match(/assertEncounterSignReviewReady\(/g)?.length,
    2,
    "서명 확인 전과 mutation 직전에 누락·충돌을 검사해야 한다",
  );
  assert.equal(
    encounter.match(/assertEncounterSignReviewFingerprint\(/g)?.length,
    2,
    "서명 확인 전과 mutation 직전에 현재 내용 fingerprint를 재검사해야 한다",
  );
});
