import assert from "node:assert/strict";
import test from "node:test";

import { getCopdDemoProfile } from "../src/copd-demo-data.js";
import { createDemoEmrState } from "../src/emr-model.js";

const EVALUATED_AT = "2026-11-01T09:00:00.000Z";
const PROFILE_IDS = ["demo-patient-lee", "demo-patient-park", "demo-patient-jung"];

function profiles() {
  return PROFILE_IDS.map((id) => getCopdDemoProfile(id));
}

test("기존 예시 환자 세 명에게만 의사용 합성 COPD 프로필을 연결한다", () => {
  const demoPatients = new Map(
    createDemoEmrState("2026-11-01T09:00:00.000Z").patients.map((patient) => [patient.id, patient.name]),
  );

  assert.deepEqual(
    PROFILE_IDS.map((id) => [id, demoPatients.get(id)]),
    [
      ["demo-patient-lee", "이준호"],
      ["demo-patient-park", "박여정"],
      ["demo-patient-jung", "정수진"],
    ],
  );
  for (const profile of profiles()) {
    assert.equal(profile.physicianOnly, true);
    assert.equal(profile.synthetic, true);
    assert.match(profile.syntheticNotice, /예시 환자/);
    assert.match(profile.syntheticNotice, /실제 환자 아님/);
    assert.match(profile.syntheticNotice, /공식 심사결과 아님/);
    assert.doesNotMatch(profile.syntheticNotice, /\bcontest\b|공모전|데모|\bDEMO\b/i);
    assert.equal(profile.evaluatedAt, EVALUATED_AT);
    assert.deepEqual(profile.evaluationPeriod, { start: "2026-01-01", end: "2026-12-31" });
    assert.ok(Object.values(profile.ruleVersions).every(Boolean));
  }

  assert.equal(getCopdDemoProfile({ id: "not-a-demo-patient" }), null);
  assert.equal(getCopdDemoProfile(null), null);
});

test("정상 COPD 흐름은 임상 맥락, 별도 시점 post-BD 검사, 세 차례 방문과 LAMA를 보존한다", () => {
  const profile = getCopdDemoProfile({ id: "demo-patient-lee", name: "이준호" });

  assert.equal(profile.scenario.kind, "NORMAL_STAGED");
  assert.equal(profile.patient.ageAtEvaluation, 67);
  assert.equal(profile.patient.sex, "male");
  assert.equal(profile.clinicalContext.exposure.packYears, 40);
  assert.deepEqual(
    profile.clinicalContext.symptoms.map(({ code }) => code),
    ["CHRONIC_DYSPNEA", "CHRONIC_COUGH", "CHRONIC_SPUTUM"],
  );
  assert.deepEqual(profile.visits.map(({ date }) => date), ["2026-01-05", "2026-05-12", "2026-10-07"]);

  assert.equal(profile.pftSessions.length, 2);
  assert.notEqual(profile.pftSessions[0].serviceDate, profile.pftSessions[1].serviceDate);
  assert.deepEqual(profile.pftSessions.map(({ postBronchodilator }) => postBronchodilator.fev1Fvc), [0.64, 0.65]);
  assert.ok(profile.pftSessions.every(({ postBronchodilator }) => postBronchodilator.fev1Fvc < 0.70));
  assert.ok(profile.pftSessions.every(({ procedureCode }) => ["F6001", "F6002", "F6013"].includes(procedureCode)));
  assert.ok(profile.pftSessions.every(({ eligibleQualityProcedure }) => eligibleQualityProcedure));

  assert.equal(profile.medications.length, 2);
  assert.ok(profile.medications.every(({ class: medicationClass }) => medicationClass === "LAMA"));
  assert.ok(profile.medications.every(({ route }) => route === "INHALED"));
  assert.ok(profile.medications.every(({ qualifiesTargetMedication }) => qualifiesTargetMedication));
  assert.ok(profile.medications.every(({ eligibleQualityMedication }) => eligibleQualityMedication));
});

test("검증된 PFT에는 환자 일치, 출처, 검토자와 검증 시각이 모두 있다", () => {
  const verifiedSessions = getCopdDemoProfile("demo-patient-lee").pftSessions;

  for (const session of verifiedSessions) {
    assert.equal(session.provenance.verificationStatus, "VERIFIED");
    assert.equal(session.provenance.patientMatch, "VERIFIED");
    assert.ok(session.provenance.sourceId);
    assert.ok(session.provenance.reviewerId);
    assert.match(session.provenance.verifiedAt, /^2026-/);
    assert.equal(session.provenance.synthetic, true);
  }
});

test("혼합 COPD 흐름은 반복 J44.9·결과 없는 PFT 시행 코드·경구약과 두 노랑 위험을 가진다", () => {
  const profile = getCopdDemoProfile("demo-patient-park");

  assert.equal(profile.scenario.kind, "MISSING_EVIDENCE");
  assert.equal(profile.clinicalContext.exposure, null);
  assert.deepEqual(profile.clinicalContext.symptoms, []);
  assert.equal(profile.pftSessions.length, 1);
  assert.equal(profile.pftSessions[0].procedureCode, "F6002");
  assert.equal(profile.pftSessions[0].eligibleQualityProcedure, true);
  assert.equal(profile.pftSessions[0].postBronchodilator, undefined);
  assert.equal(profile.diagnoses.filter(({ code }) => code === "J44.9").length, 3);
  assert.ok(profile.medications.every(({ route }) => route === "ORAL"));
  assert.ok(profile.medications.every(({ eligibleQualityMedication }) => !eligibleQualityMedication));
  assert.deepEqual(
    profile.claimItems.map(({ label }) => label),
    [
      "COPD 상병·경구약 급여조건 확인",
      "COPD 폐기능검사 자료 연결 확인",
      "COPD 추적 처방의 진단 근거 확인",
    ],
  );

  const confirmedYellowRisks = profiles().flatMap(({ claimItems }) => claimItems)
    .filter(({ preflight }) => preflight.status === "YELLOW" && preflight.riskConfirmed);
  assert.equal(confirmedYellowRisks.length, 2);
  assert.deepEqual(confirmedYellowRisks.map(({ id }) => id), ["park-claim-oral-2026-05", "park-claim-oral-2026-10"]);
  assert.ok(confirmedYellowRisks.every(({ preflight }) => /삭감 확정 아님/.test(preflight.disclaimer)));
});

test("타기관 PFT는 출처 검증 전에는 품질 근거와 확정 진단 근거가 아니다", () => {
  const profile = getCopdDemoProfile("demo-patient-jung");
  const [session] = profile.pftSessions;

  assert.equal(profile.scenario.kind, "EXTERNAL_UNVERIFIED");
  assert.equal(session.provenance.kind, "synthetic-external-document");
  assert.equal(session.provenance.verificationStatus, "UNVERIFIED");
  assert.equal(session.provenance.patientMatch, "UNCONFIRMED");
  assert.equal(session.provenance.reviewerId, "");
  assert.equal(session.provenance.verifiedAt, "");
  assert.equal(session.eligibleQualityProcedure, false);
  assert.equal(profile.claimItems[0].preflight.status, "GRAY");
  assert.match(profile.claimItems[0].preflight.disclaimer, /외부자료 미확인/);
  assert.match(profile.claimItems[0].preflight.disclaimer, /검사 미시행.*의미하지 않음/);
  assert.ok(profile.medications.some(({ class: medicationClass, eligibleQualityMedication }) => medicationClass === "LAMA" && eligibleQualityMedication));
});

test("빨강의 유일한 근거는 출처가 완전한 합성 FINAL 부분 삭감 결정이다", () => {
  const allProfiles = profiles();
  const decisions = allProfiles.flatMap(({ adjudications }) => adjudications);
  const finalPartialReductions = decisions.filter(
    ({ status, outcome }) => status === "FINAL" && outcome === "PARTIAL_REDUCTION",
  );

  assert.equal(finalPartialReductions.length, 1);
  const [decision] = finalPartialReductions;
  assert.equal(decision.synthetic, true);
  assert.equal(decision.physicianOnly, true);
  assert.ok(decision.sourceId);
  assert.ok(decision.decidedAt);
  assert.ok(decision.reasonCode);
  assert.ok(decision.claimItemId);
  assert.equal(decision.reductionAmount, decision.originalAmount - decision.allowedAmount);
  assert.equal(decision.provenance.verificationStatus, "VERIFIED");
  assert.equal(decision.provenance.sourceId, decision.sourceId);
  assert.ok(decision.provenance.reviewerId);
  assert.ok(decision.provenance.verifiedAt);

  const linkedClaim = allProfiles.flatMap(({ claimItems }) => claimItems)
    .find(({ id }) => id === decision.claimItemId);
  assert.ok(linkedClaim);
  assert.equal(linkedClaim.workflowStatus, "CLAIMED");
  assert.notEqual(linkedClaim.preflight.status, "RED");

  for (const claim of allProfiles.flatMap(({ claimItems }) => claimItems)) {
    assert.ok(["DRAFT", "PERFORMED", "CLAIMED"].includes(claim.workflowStatus));
    assert.notEqual(claim.workflowStatus, "RED");
    assert.notEqual(claim.preflight.status, "RED");
  }
  assert.ok(allProfiles.flatMap(({ claimItems }) => claimItems)
    .filter(({ preflight }) => preflight.status === "GRAY").length >= 2);
});

test("호출마다 깊은 복제본을 반환해 합성 원본과 다른 화면 호출을 오염시키지 않는다", () => {
  const first = getCopdDemoProfile("demo-patient-lee");
  const second = getCopdDemoProfile({ id: "demo-patient-lee" });

  assert.notEqual(first, second);
  assert.notEqual(first.patient, second.patient);
  assert.notEqual(first.pftSessions, second.pftSessions);
  assert.notEqual(first.pftSessions[0].provenance, second.pftSessions[0].provenance);

  first.patient.name = "변경된 이름";
  first.pftSessions[0].postBronchodilator.fev1Fvc = 0.99;
  first.pftSessions[0].provenance.sourceId = "mutated";
  first.ruleVersions.diagnosticConcordance = "mutated";

  const fresh = getCopdDemoProfile("demo-patient-lee");
  assert.equal(fresh.patient.name, "이준호");
  assert.equal(fresh.pftSessions[0].postBronchodilator.fev1Fvc, 0.64);
  assert.equal(fresh.pftSessions[0].provenance.sourceId, "lee-pft-report-2026-01");
  assert.equal(fresh.ruleVersions.diagnosticConcordance, "gold-2026-v1.3-demo");
});
