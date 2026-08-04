import test from "node:test";
import assert from "node:assert/strict";

import {
  latestFinalAdjudication,
  latestFinalReduction,
  resolveClaimAdjudicationPresentation,
  resolveClaimPreflightPresentation,
} from "../src/claim-presentation.js";

const ready = {
  id: "p:r",
  status: "ready",
  calculationAvailable: true,
  missingEvidence: [],
  explanation: "확인",
};

test("실제 심사 조정은 추적 가능한 보험자 최종 결과에서만 만든다", () => {
  const invalid = {
    status: "final",
    outcome: "reduced",
    claimItemId: "p:r",
    decidedAt: "2026-07-01T00:00:00Z",
    reasonCode: "E001",
  };
  assert.equal(latestFinalReduction([invalid], "p:r"), null);

  const valid = { ...invalid, sourceId: "claim-response-1", claimedAmount: 100, allowedAmount: 60 };
  const result = resolveClaimAdjudicationPresentation(latestFinalAdjudication([valid], "p:r"));
  assert.equal(result.state, "adjusted");
  assert.equal(result.label, "일부 조정");
  assert.match(result.paymentBoundary, /최종 결과/);

  const fixtureShape = {
    ...valid,
    outcome: "PARTIAL_REDUCTION",
    claimedAmount: undefined,
    originalAmount: 12_000,
    allowedAmount: 8_000,
    reasonLabel: "심사기관 제공 사유",
  };
  const fixtureResult = resolveClaimAdjudicationPresentation(latestFinalAdjudication([fixtureShape], "p:r"));
  assert.equal(fixtureResult.state, "adjusted");
  assert.equal(fixtureResult.label, "일부 조정");
  assert.equal(fixtureResult.reason, "심사기관 제공 사유");
});

test("심사 중·취소·역전 결과는 실제 최종 결과로 표시하지 않는다", () => {
  const base = {
    status: "final",
    outcome: "full-reduction",
    claimItemId: "p:r",
    decidedAt: "2026-07-01T00:00:00Z",
    reasonCode: "E002",
    sourceId: "claim-response-2",
  };
  assert.equal(latestFinalAdjudication([{ ...base, status: "pending" }], "p:r"), null);
  assert.equal(latestFinalAdjudication([{ ...base, lifecycleStatus: "voided" }], "p:r"), null);
  assert.equal(latestFinalAdjudication([{ ...base, reversed: true }], "p:r"), null);
  const reversal = {
    ...base,
    id: "reversal",
    outcome: "approved",
    lifecycleStatus: "reversed",
    decidedAt: "2026-07-02T00:00:00Z",
    reasonCode: "REVERSAL",
  };
  assert.equal(latestFinalAdjudication([base, reversal], "p:r"), null);
});

test("같은 청구의 사전점검과 실제 심사 결과를 병렬로 보존한다", () => {
  const reduction = {
    status: "final",
    outcome: "partial-reduction",
    claimItemId: "p:r",
    decidedAt: "2026-07-01T00:00:00Z",
    reasonCode: "E003",
    sourceId: "claim-response-3",
  };
  const preflight = resolveClaimPreflightPresentation({
    evaluation: { ...ready, status: "missing-evidence" },
    claimItem: { claimItemId: "p:r", missingData: ["타기관 검사결과"] },
  });
  const adjudication = resolveClaimAdjudicationPresentation(latestFinalAdjudication([reduction], "p:r"));
  assert.equal(preflight.state, "needs-review");
  assert.deepEqual(preflight.missingData, ["타기관 검사결과"]);
  assert.match(preflight.paymentBoundary, /심사 결과가 아닙니다|삭감 확정/);
  assert.equal(adjudication.state, "adjusted");
});

test("사전점검은 고위험·확인 필요·자료 부족·현재 기준 충족을 구분한다", () => {
  assert.equal(resolveClaimPreflightPresentation({ evaluation: ready, claimItem: { riskConfirmed: true } }).state, "high-risk");
  assert.equal(resolveClaimPreflightPresentation({ evaluation: { ...ready, status: "due-soon" } }).state, "needs-review");
  assert.equal(resolveClaimPreflightPresentation({ evaluation: ready, claimItem: { riskEvaluable: false } }).state, "insufficient");
  const verified = resolveClaimPreflightPresentation({ evaluation: ready });
  assert.equal(verified.state, "verified");
  assert.equal(verified.tone, "green");
  assert.match(verified.paymentBoundary, /보장하지 않습니다/);
});

test("최종 인정 결과도 사전점검 초록으로 위장하지 않는다", () => {
  const paid = {
    status: "final",
    outcome: "paid",
    claimItemId: "p:r",
    decidedAt: "2026-07-01T00:00:00Z",
    reasonCode: "PAID",
    sourceId: "claim-response-paid",
  };
  const result = resolveClaimAdjudicationPresentation(latestFinalAdjudication([paid], "p:r"));
  assert.equal(result.state, "recognized");
  assert.equal(result.label, "인정");
});
