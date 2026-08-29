import assert from "node:assert/strict";
import test from "node:test";
import {
  assertEncounterSignReviewContext,
  assertEncounterSignReviewFingerprint,
  assertEncounterSignReviewReady,
  buildEncounterSignReview,
  encounterSignReviewFingerprint,
  encounterSignReviewIdentity,
} from "../src/emr-sign-review.js";

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

test("서명 전 검토 UI는 전체 항목과 진료 재개 correction path를 노출한다", async () => {
  const { componentMarkup } = await import("./helpers/markup.mjs");
  const encounter = await componentMarkup("components/emr/tabs/encounter-tab.jsx");

  assert.match(encounter, /id="encounterSignReview"/);
  assert.match(encounter, /서명 전 전체 기록 검토/);
  assert.match(encounter, /id="encounterSignReviewTitle" tabindex=\{-1\}/);
  assert.match(encounter, /id="encounterSignReviewAcknowledged"/);
  assert.match(encounter, /buildEncounterSignReview/);
  assert.match(encounter, /reopenEncounter/);
  for (const label of ["알레르기", "활성 약물", "외부·미검증 알레르기", "외부·미검증 활성 약물", "이번 진료 측정·활력징후", "새 처방", "SOAP", "KCD 진단", "오더"]) {
    assert.match(encounter, new RegExp(label));
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
  const { componentMarkup } = await import("./helpers/markup.mjs");
  const encounter = await componentMarkup("components/emr/tabs/encounter-tab.jsx");

  assert.match(encounter, /disabled=\{blockers\.length > 0 \|\| !acknowledged\}/);
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
