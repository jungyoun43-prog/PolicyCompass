import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateHiraPneumonia2026Contribution,
  evaluatePneumoniaClinicalConcordance,
  evaluatePneumoniaConcordance,
  HIRA_PNEUMONIA_2026_RULESET,
  isPneumoniaDiagnosisCode,
  KDCA_PNEUMONIA_2026_GUIDELINE,
} from "../src/pneumonia-assessment.js";

function completeCase(overrides = {}) {
  const input = {
    patient: { id: "pneumonia-complete", ageAtAdmission: 72 },
    admission: {
      id: "admission-1",
      arrivedAt: "2026-10-01T09:00:00+09:00",
      admittedAt: "2026-10-01T09:20:00+09:00",
      dischargedAt: "2026-10-06T10:00:00+09:00",
      setting: "INPATIENT",
      communityOnset: true,
      institutionType: "GENERAL_HOSPITAL",
      ivAntibioticDays: 5,
    },
    diagnoses: [{
      code: "J18.9",
      label: "상세불명의 폐렴",
      claimPosition: "PRIMARY",
      communityAcquired: true,
      clinicianConfirmed: true,
      status: "FINAL",
    }],
    clinicalContext: {
      communityAcquired: true,
      chestImaging: { newInfiltrate: true, performedAt: "2026-10-01T09:14:00+09:00" },
      symptoms: ["발열", "화농성 객담"],
    },
    observations: [{ kind: "OXYGEN_SATURATION", recordedAt: "2026-10-01T09:12:00+09:00", value: 91, unit: "%" }],
    severityAssessments: [{ tool: "CURB-65", assessedAt: "2026-10-01T09:35:00+09:00", score: 2 }],
    microbiologyOrders: [{ kind: "SPUTUM_CULTURE", orderedAt: "2026-10-01T09:48:00+09:00" }],
    specimenCollections: [{ kind: "BLOOD_CULTURE", collectedAt: "2026-10-01T10:05:00+09:00" }],
    medicationAdministrations: [{
      id: "first-iv",
      medicationClass: "ANTIBIOTIC",
      route: "IV",
      administeredAt: "2026-10-01T10:32:00+09:00",
      appropriateForCap: true,
    }],
    evaluatedAt: "2026-08-03T12:00:00Z",
  };
  return {
    ...input,
    ...overrides,
    patient: { ...input.patient, ...(overrides.patient ?? {}) },
    admission: { ...input.admission, ...(overrides.admission ?? {}) },
    clinicalContext: { ...input.clinicalContext, ...(overrides.clinicalContext ?? {}) },
  };
}

test("official 7th plan period, five metric weights and monitoring boundary stay exact", () => {
  assert.deepEqual(HIRA_PNEUMONIA_2026_RULESET.effectivePeriod, { start: "2026-10-01", end: "2027-03-31" });
  assert.deepEqual(HIRA_PNEUMONIA_2026_RULESET.metrics.map(({ weight }) => weight), [2, 3, 1.5, 1, 2.5]);
  assert.equal(HIRA_PNEUMONIA_2026_RULESET.metrics.reduce((sum, { weight }) => sum + weight, 0), 10);
  assert.equal(HIRA_PNEUMONIA_2026_RULESET.monitoringMetrics.length, 4);
  assert.ok(HIRA_PNEUMONIA_2026_RULESET.monitoringMetrics.every(({ weighted }) => weighted === false));
  assert.match(HIRA_PNEUMONIA_2026_RULESET.sourceUrl, /apndBrdBltNo=12191/);
  assert.match(KDCA_PNEUMONIA_2026_GUIDELINE.sourceUrl, /kdca\.go\.kr/);
});

test("J18.9 and common CAP families are recognized without accepting unrelated respiratory codes", () => {
  assert.equal(isPneumoniaDiagnosisCode("J18.9"), true);
  assert.equal(isPneumoniaDiagnosisCode("J13"), true);
  assert.equal(isPneumoniaDiagnosisCode("J10.0"), true);
  assert.equal(isPneumoniaDiagnosisCode("J44.9"), false);
});

test("complete hospital CAP case is eligible and contributes to all five independent metrics", () => {
  const result = evaluateHiraPneumonia2026Contribution(completeCase());
  assert.equal(result.status, "eligible");
  assert.equal(result.target.eligible, true);
  assert.equal(result.target.ageYears, 72);
  assert.equal(result.target.diagnosisRole, "PRIMARY");
  assert.equal(result.metrics.length, 5);
  assert.deepEqual(result.metrics.map(({ status }) => status), ["included", "included", "included", "included", "included"]);
  assert.ok(result.metrics.every(({ denominatorIncluded }) => denominatorIncluded));
  for (const forbidden of ["score", "officialScore", "grade", "incentive", "officialGrade"]) {
    assert.equal(Object.hasOwn(result, forbidden), false);
  }
  assert.match(result.disclaimer, /공식 기관 점수/);
  assert.match(result.disclaimer, /삭감 판정이 아닙니다/);
});

test("blood culture not performed is excluded from its denominator, not marked failed", () => {
  const result = evaluateHiraPneumonia2026Contribution(completeCase({ specimenCollections: [] }));
  const metric = result.metrics.find(({ id }) => id === "blood-culture-before-antibiotic");
  assert.equal(metric.status, "not-applicable");
  assert.equal(metric.included, false);
  assert.equal(metric.denominatorIncluded, false);
  assert.equal(metric.observed, 0);
  assert.match(metric.reason, /분모에서 제외/);
});

test("blood culture denominator uses actual collection and requires strict pre-antibiotic timing", () => {
  const sameTime = completeCase({
    specimenCollections: [{ kind: "BLOOD_CULTURE", collectedAt: "2026-10-01T10:32:00+09:00" }],
  });
  let metric = evaluateHiraPneumonia2026Contribution(sameTime).metrics[3];
  assert.equal(metric.status, "not-included");
  assert.equal(metric.denominatorIncluded, true);

  const before = completeCase({
    specimenCollections: [{ kind: "BLOOD_CULTURE", collectedAt: "2026-09-29T09:00:00+09:00" }],
  });
  metric = evaluateHiraPneumonia2026Contribution(before).metrics[3];
  assert.equal(metric.status, "included");

  const unknownTime = completeCase({
    specimenCollections: [{ kind: "BLOOD_CULTURE" }],
  });
  metric = evaluateHiraPneumonia2026Contribution(unknownTime).metrics[3];
  assert.equal(metric.status, "insufficient");
  assert.equal(metric.denominatorIncluded, true);
});

test("24-hour, 8-hour and pre-admission 48-hour boundaries are inclusive", () => {
  const input = completeCase({
    admission: { arrivedAt: "2026-10-10T12:00:00Z", admittedAt: "2026-10-10T12:20:00Z" },
    observations: [{ kind: "PULSE_OXIMETRY", performedAt: "2026-10-08T12:00:00Z" }],
    severityAssessments: [{ tool: "PSI", assessedAt: "2026-10-11T12:00:00Z", score: 3 }],
    microbiologyOrders: [{ kind: "SPUTUM_CULTURE", orderedAt: "2026-10-11T12:00:00.001Z" }],
    specimenCollections: [],
    medicationAdministrations: [{
      route: "INTRAVENOUS",
      medicationClass: "ANTIBIOTIC",
      administeredAt: "2026-10-10T20:00:00Z",
      appropriatenessReview: { status: "APPROPRIATE" },
    }],
  });
  const result = evaluateHiraPneumonia2026Contribution(input);
  assert.deepEqual(result.metrics.map(({ status }) => status), ["included", "included", "not-included", "not-applicable", "included"]);

  input.observations = [{ kind: "PULSE_OXIMETRY", performedAt: "2026-10-08T11:59:59.999Z" }];
  input.medicationAdministrations[0].administeredAt = "2026-10-10T20:00:00.001Z";
  const outside = evaluateHiraPneumonia2026Contribution(input);
  assert.equal(outside.metrics[0].status, "not-included");
  assert.equal(outside.metrics[4].status, "not-included");
});

test("first IV antibiotic controls the quality metric even when a later drug is appropriate", () => {
  const input = completeCase({
    medicationAdministrations: [
      { route: "IV", medicationClass: "ANTIBIOTIC", administeredAt: "2026-10-01T09:30:00+09:00", appropriateForCap: false },
      { route: "IV", medicationClass: "ANTIBIOTIC", administeredAt: "2026-10-01T10:00:00+09:00", appropriateForCap: true },
    ],
  });
  assert.equal(evaluateHiraPneumonia2026Contribution(input).metrics[4].status, "not-included");

  input.medicationAdministrations[0].appropriateForCap = undefined;
  assert.equal(evaluateHiraPneumonia2026Contribution(input).metrics[4].status, "insufficient");
});

test("target eligibility enforces age, period, inpatient setting, institution, diagnosis role and IV days", () => {
  const boundaryStart = completeCase({ patient: { ageAtAdmission: 18 } });
  assert.equal(evaluateHiraPneumonia2026Contribution(boundaryStart).target.eligible, true);

  const boundaryEnd = completeCase({ admission: { arrivedAt: "2027-03-31T23:59:59Z", admittedAt: "2027-03-31T23:59:59Z" } });
  assert.equal(evaluateHiraPneumonia2026Contribution(boundaryEnd).target.eligible, true);

  const cases = [
    completeCase({ patient: { ageAtAdmission: 17 } }),
    completeCase({ admission: { arrivedAt: "2027-04-01T00:00:00Z", admittedAt: "2027-04-01T00:00:00Z" } }),
    completeCase({ admission: { setting: "OUTPATIENT" } }),
    completeCase({ admission: { institutionType: "NURSING_HOSPITAL" } }),
    completeCase({ admission: { ivAntibioticDays: 2 } }),
    completeCase({ diagnoses: [{ code: "J18.9", claimPosition: "SECONDARY", communityAcquired: true, status: "FINAL" }] }),
  ];
  for (const input of cases) {
    const result = evaluateHiraPneumonia2026Contribution(input);
    assert.equal(result.target.eligible, false);
    assert.equal(result.status, "not-eligible");
    assert.ok(result.metrics.every(({ status }) => status === "not-applicable"));
  }
});

test("missing target fields stay insufficient instead of being treated as zero or automatic exclusion", () => {
  const input = completeCase({
    patient: { ageAtAdmission: null },
    admission: { institutionType: null, communityOnset: undefined, diagnosedWithinHours: undefined, ivAntibioticDays: undefined },
    clinicalContext: { communityAcquired: undefined },
  });
  input.medicationAdministrations = [];
  const result = evaluateHiraPneumonia2026Contribution(input);
  assert.equal(result.status, "insufficient");
  assert.equal(result.target.eligible, false);
  assert.match(result.target.reason, /확인 필요/);
  assert.ok(result.metrics.every(({ status }) => status === "insufficient"));
});

test("clinical concordance requires imaging, infection context, community onset and clinician diagnosis without auto-diagnosing", () => {
  const result = evaluatePneumoniaConcordance(completeCase());
  assert.equal(result.status, "supported");
  assert.equal(result.criteriaMatch, true);
  assert.equal(result.clinicianDiagnosis.documented, true);
  assert.equal(result.clinicianDiagnosis.autoChanged, false);
  assert.match(result.disclaimer, /자동 진단/);

  const withoutClinician = completeCase({ diagnoses: [] });
  const review = evaluatePneumoniaClinicalConcordance(withoutClinician);
  assert.equal(review.criteriaMatch, true);
  assert.equal(review.status, "clinician-review");
  assert.equal(review.clinicianDiagnosis.autoChanged, false);
});

test("hospital-onset and incomplete evidence are review states, never automatic diagnosis deletion", () => {
  const hospitalOnset = completeCase({
    admission: { communityOnset: undefined, diagnosedWithinHours: 49 },
    clinicalContext: { communityAcquired: undefined },
  });
  let result = evaluatePneumoniaConcordance(hospitalOnset);
  assert.equal(result.status, "outside-cap-scope");
  assert.equal(result.criteriaMatch, false);
  assert.equal(result.clinicianDiagnosis.autoChanged, false);

  const incomplete = completeCase({ clinicalContext: { chestImaging: undefined, symptoms: [] } });
  result = evaluatePneumoniaConcordance(incomplete);
  assert.equal(result.status, "needs-review");
  assert.equal(result.criteriaMatch, null);
  assert.equal(result.clinicianDiagnosis.autoChanged, false);
});

test("evaluators are deterministic and do not mutate source records", () => {
  const input = completeCase();
  const snapshot = structuredClone(input);
  const first = evaluateHiraPneumonia2026Contribution(input);
  const second = evaluateHiraPneumonia2026Contribution(input);
  assert.deepEqual(second, first);
  assert.deepEqual(input, snapshot);
  assert.equal(first.evaluatedAt, "2026-08-03T12:00:00.000Z");
});
