import assert from "node:assert/strict";
import test from "node:test";

import {
  DISEASE_ASSESSMENT_PROGRAMS,
  evaluateDiseaseAssessment,
  getCombinedDiseaseClaimProfile,
  getDiseaseAssessmentOptions,
  getDiseaseAssessmentProfiles,
  getPreferredDiseaseAssessmentId,
} from "../src/disease-assessment.js";

const DEMO_PATIENTS = ["demo-patient-lee", "demo-patient-kim", "demo-patient-choi", "demo-patient-jung"];

/** Every string reachable inside a value, so wording contracts cover nested metadata. */
function stringsOf(value, found = []) {
  if (typeof value === "string") found.push(value);
  else if (value && typeof value === "object") for (const child of Object.values(value)) stringsOf(child, found);
  return found;
}

test("질환 평가 registry는 COPD와 폐렴의 중립적인 표시 메타와 empty guard를 제공한다", () => {
  assert.deepEqual(Object.keys(DISEASE_ASSESSMENT_PROGRAMS), ["copd", "pneumonia"]);
  assert.equal(Object.isFrozen(DISEASE_ASSESSMENT_PROGRAMS), true);

  for (const [id, program] of Object.entries(DISEASE_ASSESSMENT_PROGRAMS)) {
    assert.equal(program.id, id);
    assert.ok(program.label);
    assert.ok(program.shortLabel);
    assert.doesNotMatch(program.eyebrow, /\bDEMO\b|\bcontest\b|공모전/i);
    assert.match(program.description, /현재 차트와 별도.*고정 합성.*진단 근거/);
    assert.match(program.boundary, /현재 차트 근거와 연결되지 않은 고정 합성 예시/);
    assert.ok(program.quality.title);
    assert.ok(program.quality.description);
    assert.match(program.quality.emptyMessage, /프로필이 없습니다/);
    assert.ok(program.diagnostic.title);
    assert.ok(program.diagnostic.description);
    assert.match(program.diagnostic.emptyMessage, /프로필이 없습니다/);
    assert.match(program.emptyMessage, /이 환자.*프로필이 없습니다/);
    assert.equal(Object.isFrozen(program), true);
    assert.equal(Object.isFrozen(program.quality), true);
    assert.equal(Object.isFrozen(program.diagnostic), true);
  }
  // The registry and the options built from it never present the synthetic
  // examples as linked to confirmed chart records.
  const presented = [
    ...stringsOf(DISEASE_ASSESSMENT_PROGRAMS),
    ...DEMO_PATIENTS.flatMap((patient) => stringsOf(getDiseaseAssessmentOptions(patient))),
  ];
  assert.ok(presented.length > 0);
  for (const text of presented) assert.doesNotMatch(text, /확정 기록에 연결된/);
});

test("프로필이 있는 환자에게만 관련 질환 옵션을 만들고 profile 선호도를 우선한다", () => {
  assert.deepEqual(getDiseaseAssessmentOptions("not-a-demo-patient"), []);
  assert.deepEqual(getDiseaseAssessmentProfiles(null), []);
  assert.equal(getPreferredDiseaseAssessmentId("not-a-demo-patient"), "");

  assert.deepEqual(
    getDiseaseAssessmentOptions("demo-patient-lee").map(({ id }) => id),
    ["copd"],
  );
  assert.deepEqual(
    getDiseaseAssessmentOptions("demo-patient-kim").map(({ id }) => id),
    ["pneumonia"],
  );
  assert.deepEqual(
    getDiseaseAssessmentOptions("demo-patient-choi").map(({ id }) => id),
    ["pneumonia"],
  );
  assert.deepEqual(
    getDiseaseAssessmentOptions("demo-patient-jung").map(({ id }) => id),
    ["copd", "pneumonia"],
  );

  assert.equal(getPreferredDiseaseAssessmentId("demo-patient-lee"), "copd");
  assert.equal(getPreferredDiseaseAssessmentId("demo-patient-kim"), "pneumonia");
  assert.equal(getPreferredDiseaseAssessmentId("demo-patient-jung"), "copd");

  const profiles = getDiseaseAssessmentProfiles("demo-patient-jung");
  assert.deepEqual(profiles.map(({ assessmentId }) => assessmentId), ["copd", "pneumonia"]);
  assert.ok(profiles.every(({ assessmentId, programId }) => assessmentId === programId));
  assert.ok(getDiseaseAssessmentOptions("demo-patient-jung")
    .every(({ assessmentId, programId }) => assessmentId === programId));
});

test("질환별 평가는 올바른 evaluator만 실행하고 무관한 환자를 0건 평가하지 않는다", () => {
  const copd = evaluateDiseaseAssessment("demo-patient-lee", "COPD");
  assert.ok(copd);
  assert.deepEqual(Object.keys(copd).sort(), ["diagnostic", "evaluatedAt", "profile", "program", "quality"]);
  assert.equal(copd.program.id, "copd");
  assert.equal(copd.profile.assessmentId, "copd");
  assert.equal(copd.quality.domain, "hira-copd-patient-contribution-preview");
  assert.equal(copd.diagnostic.domain, "copd-diagnostic-concordance");
  assert.equal(copd.quality.metrics.length, 3);

  const pneumonia = evaluateDiseaseAssessment("demo-patient-kim", "pneumonia");
  assert.ok(pneumonia);
  assert.deepEqual(Object.keys(pneumonia).sort(), ["diagnostic", "evaluatedAt", "profile", "program", "quality"]);
  assert.equal(pneumonia.program.id, "pneumonia");
  assert.equal(pneumonia.profile.assessmentId, "pneumonia");
  assert.equal(pneumonia.quality.domain, "hira-pneumonia-patient-contribution-preview");
  assert.equal(pneumonia.diagnostic.domain, "pneumonia-clinical-concordance");
  assert.equal(pneumonia.quality.metrics.length, 5);

  assert.equal(evaluateDiseaseAssessment("demo-patient-lee", "pneumonia"), null);
  assert.equal(evaluateDiseaseAssessment("demo-patient-kim", "copd"), null);
  assert.equal(evaluateDiseaseAssessment("demo-patient-kim", "unknown"), null);
  assert.equal(evaluateDiseaseAssessment(null, "copd"), null);
});

test("모든 관련 질환의 청구와 심사결과를 병합하면서 식별자 중복을 제거한다", () => {
  const profiles = getDiseaseAssessmentProfiles("demo-patient-jung");
  assert.equal(profiles.length, 2);
  const combined = getCombinedDiseaseClaimProfile("demo-patient-jung");

  assert.ok(combined);
  assert.deepEqual(combined.assessmentIds, ["copd", "pneumonia"]);
  assert.equal(combined.synthetic, true);
  assert.equal(combined.physicianOnly, true);
  assert.match(combined.syntheticNotice, /예시 환자/);
  assert.match(combined.syntheticNotice, /실제 환자 아님/);
  assert.doesNotMatch(combined.syntheticNotice, /\bcontest\b|공모전|데모|\bDEMO\b/i);
  assert.ok(combined.claimItems.length > 1);
  assert.equal(
    new Set(combined.claimItems.map(({ id }) => id).filter(Boolean)).size,
    combined.claimItems.filter(({ id }) => id).length,
  );
  assert.equal(
    new Set(combined.adjudications.map(({ id }) => id).filter(Boolean)).size,
    combined.adjudications.filter(({ id }) => id).length,
  );
  assert.ok(combined.claimItems.every(({ assessmentId }) => ["copd", "pneumonia"].includes(assessmentId)));
  assert.ok(combined.adjudications.every(({ assessmentId }) => ["copd", "pneumonia"].includes(assessmentId)));
  // Every merged item is the profile's item tagged with the OWNING profile's
  // assessmentId (the items themselves carry none), and appears exactly once.
  for (const patient of DEMO_PATIENTS) {
    const patientProfiles = getDiseaseAssessmentProfiles(patient);
    const patientCombined = getCombinedDiseaseClaimProfile(patient);
    assert.ok(patientProfiles.length > 0);
    for (const field of ["claimItems", "adjudications"]) {
      let expected = 0;
      for (const profile of patientProfiles) {
        for (const item of profile[field]) {
          assert.equal(item.assessmentId, undefined, `${patient} ${field} source items carry no assessmentId`);
          const matches = patientCombined[field].filter(({ id }) => id === item.id);
          assert.equal(matches.length, 1, `${patient} ${field} ${item.id} merged once`);
          assert.deepEqual(matches[0], { ...item, assessmentId: profile.assessmentId });
          expected += 1;
        }
      }
      assert.equal(patientCombined[field].length, expected);
    }
  }
  assert.equal(getCombinedDiseaseClaimProfile("not-a-demo-patient"), null);
});

test("반환한 profile·option·평가·병합값을 바꿔도 다음 호출과 registry를 오염시키지 않는다", () => {
  const profiles = getDiseaseAssessmentProfiles("demo-patient-jung");
  const options = getDiseaseAssessmentOptions("demo-patient-jung");
  const evaluation = evaluateDiseaseAssessment("demo-patient-lee", "copd");
  const combined = getCombinedDiseaseClaimProfile("demo-patient-jung");

  profiles[0].patient.name = "변경됨";
  profiles[0].claimItems.length = 0;
  options[0].label = "변경됨";
  evaluation.program.label = "변경됨";
  evaluation.profile.patient.name = "변경됨";
  evaluation.quality.metrics.length = 0;
  combined.claimItems.length = 0;
  combined.assessmentIds.length = 0;

  const freshProfiles = getDiseaseAssessmentProfiles("demo-patient-jung");
  const freshOptions = getDiseaseAssessmentOptions("demo-patient-jung");
  const freshEvaluation = evaluateDiseaseAssessment("demo-patient-lee", "copd");
  const freshCombined = getCombinedDiseaseClaimProfile("demo-patient-jung");

  assert.notEqual(freshProfiles[0].patient.name, "변경됨");
  assert.ok(freshProfiles[0].claimItems.length > 0);
  assert.equal(freshOptions[0].label, "만성폐쇄성폐질환");
  assert.equal(freshEvaluation.program.label, DISEASE_ASSESSMENT_PROGRAMS.copd.label);
  assert.equal(freshEvaluation.profile.patient.name, "이준호");
  assert.equal(freshEvaluation.quality.metrics.length, 3);
  assert.ok(freshCombined.claimItems.length > 0);
  assert.deepEqual(freshCombined.assessmentIds, ["copd", "pneumonia"]);
});
