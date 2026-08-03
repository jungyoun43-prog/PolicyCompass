import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateGoldCopdConcordance,
  evaluateHiraCopd2026Contribution,
  GOLD_COPD_2026_RULESET,
  HIRA_COPD_2026_RULESET,
  normalizeSpirometryRatio,
} from "../src/copd-assessment.js";
import { getCopdDemoProfile } from "../src/copd-demo-data.js";

function verifiedSession(ratio, { id = `s-${ratio}`, date = "2026-01-08", encounterId = `e-${ratio}` } = {}) {
  return {
    id,
    serviceDate: date,
    encounterId,
    quality: { status: "ACCEPTABLE" },
    postBronchodilator: { fev1Fvc: ratio, unit: "ratio" },
    provenance: {
      kind: "synthetic-local-emr",
      sourceId: `source-${id}`,
      verificationStatus: "VERIFIED",
      patientMatch: "VERIFIED",
      reviewerId: "reviewer-1",
      verifiedAt: `${date}T09:00:00.000Z`,
    },
  };
}

const context = {
  evidenceStatus: "VERIFIED",
  exposure: { kind: "TOBACCO", status: "VERIFIED", packYears: 40 },
  symptoms: [{ label: "만성 기침", status: "VERIFIED" }],
};

test("ratio normalization accepts explicit percent and rejects invalid units", () => {
  assert.equal(normalizeSpirometryRatio("64%"), 0.64);
  assert.equal(normalizeSpirometryRatio(64, "%"), 0.64);
  assert.equal(normalizeSpirometryRatio(0.64, "ratio"), 0.64);
  assert.equal(normalizeSpirometryRatio(64, "L"), null);
});

test("GOLD strict threshold and inclusive repeat range are stable at boundaries", () => {
  const truthTable = [
    [0.5999, true, false],
    [0.60, true, true],
    [0.64, true, true],
    [0.6999, true, true],
    [0.70, false, true],
    [0.80, false, true],
    [0.8001, false, false],
  ];
  for (const [ratio, matches, repeat] of truthTable) {
    const result = evaluateGoldCopdConcordance({ clinicalContext: context, spirometrySessions: [verifiedSession(ratio)] }, { evaluatedAt: "2026-11-01T00:00:00Z" });
    assert.equal(result.criteriaMatch, matches, `ratio ${ratio}`);
    assert.equal(result.repeatConfirmationRecommended, repeat, `repeat ${ratio}`);
  }
  assert.equal(GOLD_COPD_2026_RULESET.criterion.operator, "<");
});

test("single 0.64 is criteria matched and repeat pending, never an automatic diagnosis", () => {
  const result = evaluateGoldCopdConcordance({ clinicalContext: context, spirometrySessions: [verifiedSession(0.64)] });
  assert.equal(result.status, "matched-repeat-pending");
  assert.equal(result.criterion.status, "matched");
  assert.equal(result.repeatConfirmation.status, "pending");
  assert.equal(result.clinicianDiagnosis.autoChanged, false);
  assert.match(result.disclaimer, /자동 진단/);
});

test("repeat confirmation requires separate date and encounter and discordance requires clinician review", () => {
  const sameOccasion = evaluateGoldCopdConcordance({
    clinicalContext: context,
    spirometrySessions: [
      verifiedSession(0.64, { id: "same-1", date: "2026-01-08", encounterId: "same-e" }),
      verifiedSession(0.65, { id: "same-2", date: "2026-01-08", encounterId: "same-e" }),
    ],
  });
  assert.equal(sameOccasion.repeatConfirmation.status, "pending");

  const confirmed = evaluateGoldCopdConcordance({
    clinicalContext: context,
    spirometrySessions: [
      verifiedSession(0.64, { id: "first", date: "2026-01-08", encounterId: "first-e" }),
      verifiedSession(0.65, { id: "second", date: "2026-02-19", encounterId: "second-e" }),
    ],
  });
  assert.equal(confirmed.repeatConfirmation.status, "confirmed");

  const discordant = evaluateGoldCopdConcordance({
    clinicalContext: context,
    spirometrySessions: [
      verifiedSession(0.64, { id: "first", date: "2026-01-08", encounterId: "first-e" }),
      verifiedSession(0.72, { id: "second", date: "2026-02-19", encounterId: "second-e" }),
    ],
  });
  assert.equal(discordant.status, "clinician-review");
  assert.equal(discordant.clinicianReviewRequired, true);
});

test("pre-BD, incomplete, bad quality and unverified external PFT stay insufficient", () => {
  const invalidSessions = [
    { id: "pre-only", serviceDate: "2026-01-01", encounterId: "e1", quality: "ACCEPTABLE", preBronchodilator: { fev1Fvc: 0.64 } },
    { id: "missing-fvc", serviceDate: "2026-01-02", encounterId: "e2", quality: "ACCEPTABLE", postBronchodilator: { fev1: 1.2, unit: "L" } },
    { ...verifiedSession(0.64), quality: { status: "REJECTED" } },
    getCopdDemoProfile("demo-patient-jung").pftSessions[0],
  ];
  for (const session of invalidSessions) {
    const result = evaluateGoldCopdConcordance({ clinicalContext: context, spirometrySessions: [session] });
    assert.equal(result.status, "insufficient");
    assert.equal(result.criteriaMatch, null);
  }
});

test("HIRA result has exactly three independent patient contribution metrics and no institution score fields", () => {
  const profile = getCopdDemoProfile("demo-patient-lee");
  for (const session of profile.pftSessions) session.quality = { status: "ACCEPTABLE" };
  const result = evaluateHiraCopd2026Contribution(profile);
  assert.equal(result.target.eligible, true);
  assert.equal(result.metrics.length, 3);
  assert.deepEqual(result.metrics.map(({ id }) => id), ["pft", "continuing-visits", "inhaled-bronchodilator"]);
  assert.ok(result.metrics.every(({ status }) => status === "included"));
  assert.equal(Object.hasOwn(result, "officialScore"), false);
  assert.equal(Object.hasOwn(result, "score"), false);
  assert.equal(Object.hasOwn(result, "total"), false);
  assert.equal(Object.hasOwn(result, "grade"), false);
  assert.equal(Object.hasOwn(result, "incentive"), false);
  assert.equal(HIRA_COPD_2026_RULESET.metrics.reduce((sum, { weight }) => sum + weight, 0), 100);
});

test("HIRA PFT contribution uses verified code/date provenance, not the GOLD ratio", () => {
  const profile = getCopdDemoProfile("demo-patient-lee");
  profile.pftSessions[0].postBronchodilator.fev1Fvc = 0.90;
  profile.pftSessions[0].quality = { status: "ACCEPTABLE" };
  profile.pftSessions[1].quality = { status: "ACCEPTABLE" };
  assert.equal(evaluateHiraCopd2026Contribution(profile).metrics[0].status, "included");

  const external = getCopdDemoProfile("demo-patient-jung");
  external.pftSessions[0].quality = { status: "ACCEPTABLE" };
  const result = evaluateHiraCopd2026Contribution(external);
  assert.equal(result.target.eligible, true);
  assert.equal(result.metrics[0].status, "insufficient");
  assert.match(result.metrics[0].reason, /타기관/);
});

test("changing GOLD sessions does not mutate HIRA contribution and vice versa", () => {
  const profile = getCopdDemoProfile("demo-patient-lee");
  for (const session of profile.pftSessions) session.quality = { status: "ACCEPTABLE" };
  const before = evaluateHiraCopd2026Contribution(profile);
  const changed = structuredClone(profile);
  changed.pftSessions[1].postBronchodilator.fev1Fvc = 0.75;
  const gold = evaluateGoldCopdConcordance(changed);
  const after = evaluateHiraCopd2026Contribution(changed);
  assert.equal(gold.clinicianReviewRequired, true);
  assert.deepEqual(after.metrics.map(({ status }) => status), before.metrics.map(({ status }) => status));
});
