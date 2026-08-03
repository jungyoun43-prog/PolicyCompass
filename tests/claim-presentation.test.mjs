import test from "node:test";
import assert from "node:assert/strict";

import { latestFinalReduction, resolveClaimPresentation } from "../src/claim-presentation.js";

const ready = {
  id: "p:r",
  status: "ready",
  calculationAvailable: true,
  missingEvidence: [],
  explanation: "확인",
};

test("red is reserved for a traceable final reduction", () => {
  const invalid = {
    status: "final",
    outcome: "reduced",
    claimItemId: "p:r",
    decidedAt: "2026-07-01T00:00:00Z",
    reasonCode: "E001",
  };
  assert.equal(latestFinalReduction([invalid], "p:r"), null);
  assert.equal(resolveClaimPresentation({ evaluation: ready, adjudications: [invalid] }).state, "verified");

  const valid = { ...invalid, sourceId: "claim-response-1", claimedAmount: 100, allowedAmount: 60 };
  const result = resolveClaimPresentation({ evaluation: ready, adjudications: [valid] });
  assert.equal(result.state, "reduced");
  assert.equal(result.label, "일부 삭감 확정");

  const syntheticFixtureShape = {
    ...valid,
    outcome: "PARTIAL_REDUCTION",
    claimedAmount: undefined,
    originalAmount: 12_000,
    allowedAmount: 8_000,
    reasonLabel: "합성 심사 결과",
  };
  const syntheticResult = resolveClaimPresentation({ evaluation: ready, adjudications: [syntheticFixtureShape] });
  assert.equal(syntheticResult.state, "reduced");
  assert.equal(syntheticResult.label, "일부 삭감 확정");
  assert.equal(syntheticResult.reason, "합성 심사 결과");
});

test("voided or reversed adjudication never paints an item red", () => {
  const base = {
    status: "final",
    outcome: "full-reduction",
    claimItemId: "p:r",
    decidedAt: "2026-07-01T00:00:00Z",
    reasonCode: "E002",
    sourceId: "claim-response-2",
  };
  assert.equal(resolveClaimPresentation({ evaluation: ready, adjudications: [{ ...base, lifecycleStatus: "voided" }] }).state, "verified");
  assert.equal(resolveClaimPresentation({ evaluation: ready, adjudications: [{ ...base, reversed: true }] }).state, "verified");
  const reversal = {
    ...base,
    id: "reversal",
    status: "FINAL",
    outcome: "approved",
    lifecycleStatus: "reversed",
    sourceId: "claim-response-reversal",
    decidedAt: "2026-07-02T00:00:00Z",
    reasonCode: "REVERSAL",
  };
  assert.equal(resolveClaimPresentation({ evaluation: ready, adjudications: [base, reversal] }).state, "verified");
});

test("precedence is red, confirmed risk, insufficient, then verified", () => {
  const reduction = {
    status: "final",
    outcome: "denied",
    claimItemId: "p:r",
    decidedAt: "2026-07-01T00:00:00Z",
    reasonCode: "E003",
    sourceId: "claim-response-3",
  };
  assert.equal(resolveClaimPresentation({ evaluation: { ...ready, status: "missing-evidence" }, adjudications: [reduction] }).state, "reduced");
  assert.equal(resolveClaimPresentation({ evaluation: { ...ready, status: "missing-evidence" }, claimItem: { missingData: ["타기관 청구"] } }).state, "risk");
  assert.deepEqual(resolveClaimPresentation({ evaluation: { ...ready, status: "missing-evidence" }, claimItem: { missingData: ["타기관 청구"] } }).missingData, ["타기관 청구"]);
  assert.equal(resolveClaimPresentation({ evaluation: ready, claimItem: { riskEvaluable: false } }).state, "insufficient");
  assert.equal(resolveClaimPresentation({ evaluation: ready }).state, "verified");
});

test("green explicitly remains an internal preflight without payment guarantee", () => {
  const result = resolveClaimPresentation({ evaluation: ready });
  assert.equal(result.tone, "green");
  assert.match(result.paymentBoundary, /보장하지 않습니다/);
});
