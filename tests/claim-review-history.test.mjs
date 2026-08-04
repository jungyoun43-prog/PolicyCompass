import assert from "node:assert/strict";
import test from "node:test";

import { evaluateClaimRule } from "../src/claim-rules.js";
import {
  addPatient,
  appendPatientEvent,
  confirmPatientEvent,
  createEmptyEmrState,
  normalizeEmrState,
  reconcileClaimReviews,
  resolveClaimReview,
  setClaimReviewStage,
} from "../src/emr-model.js";

function fixture() {
  const state = addPatient(createEmptyEmrState("2026-08-04T00:00:00.000Z"), {
    id: "claim-review-history-patient",
    mrn: "CLAIM-HISTORY-1",
    name: "검토 이력 환자",
    events: [{
      id: "claim-review-history-condition",
      type: "condition",
      recordStatus: "final",
      system: "urn:kr:kcd",
      code: "I10",
      label: "고혈압",
      date: "2026-08-01",
      status: "active",
      clinicalStatus: "active",
      verificationStatus: "confirmed",
      source: { kind: "manual", label: "검토 확정" },
    }],
  }, "2026-08-04T00:00:01.000Z");
  const rule = state.rules.find(({ id }) => id === "demo-bp-follow-up");
  return {
    state,
    rule,
    evaluation: evaluateClaimRule(state.patients[0], rule, "2026-08-04"),
  };
}

test("담당자 메타데이터와 최종 결론을 구조화된 이력으로 저장한다", () => {
  const { state, evaluation } = fixture();
  const reviewing = setClaimReviewStage(
    state,
    evaluation,
    "reviewing",
    "",
    "2026-08-04T01:00:00.000Z",
    {
      reviewer: "김심사",
      reason: "외부 검사 결과 확인 필요",
      opinion: "의뢰기관 회신을 기다립니다.",
      inputMethod: "drawer",
    },
  );

  assert.equal(reviewing.claimReviews[0].reviewer, "김심사");
  assert.equal(reviewing.claimReviews[0].transitionReason, "외부 검사 결과 확인 필요");
  assert.equal(reviewing.claimReviews[0].history.length, 1);
  assert.deepEqual(reviewing.claimReviews[0].history[0], {
    at: "2026-08-04T01:00:00.000Z",
    from: "new",
    to: "reviewing",
    reviewer: "김심사",
    reason: "외부 검사 결과 확인 필요",
    opinion: "의뢰기관 회신을 기다립니다.",
    outcome: "",
    inputMethod: "drawer",
  });

  const opinionUpdated = setClaimReviewStage(
    reviewing,
    evaluation,
    "reviewing",
    "",
    "2026-08-04T01:05:00.000Z",
    { opinion: "외부 검사 결과를 수신했습니다.", inputMethod: "drawer" },
  );
  assert.equal(opinionUpdated.revision, reviewing.revision + 1);
  assert.equal(opinionUpdated.claimReviews[0].history.at(-1).from, "reviewing");
  assert.equal(opinionUpdated.claimReviews[0].history.at(-1).to, "reviewing");
  assert.equal(opinionUpdated.claimReviews[0].opinion, "외부 검사 결과를 수신했습니다.");

  const finalized = setClaimReviewStage(
    opinionUpdated,
    evaluation,
    "reviewed",
    "",
    "2026-08-04T01:10:00.000Z",
    { reason: "근거 확인 완료", outcome: "approved", inputMethod: "drawer" },
  );
  const reloaded = normalizeEmrState(structuredClone(finalized));
  assert.equal(reloaded.claimReviews[0].outcome, "approved");
  assert.equal(reloaded.claimReviews[0].history.at(-1).outcome, "approved");
  const view = resolveClaimReview(reloaded, evaluation);
  assert.equal(view.reviewer, "김심사");
  assert.equal(view.outcome, "approved");
  assert.equal(view.history.length, 3);
});

test("검토 이력은 50건으로 제한하고 자동 무효화 뒤에도 이전 이력을 보존한다", () => {
  const { state: initial, rule, evaluation } = fixture();
  let state = setClaimReviewStage(
    initial,
    evaluation,
    "reviewed",
    "",
    "2026-08-04T02:00:00.000Z",
    { reviewer: "김심사", reason: "초기 판정", outcome: "approved", inputMethod: "drawer" },
  );
  for (let index = 0; index < 52; index += 1) {
    state = setClaimReviewStage(
      state,
      evaluation,
      "reviewed",
      "",
      new Date(Date.parse("2026-08-04T02:01:00.000Z") + index * 60_000).toISOString(),
      { opinion: `담당자 의견 ${index}`, inputMethod: "drawer" },
    );
  }
  assert.equal(state.claimReviews[0].history.length, 50);

  let changed = appendPatientEvent(state, "claim-review-history-patient", {
    id: "claim-review-history-service",
    type: "procedure",
    system: "urn:vitagraph:demo:service",
    code: "DEMO-BP-FOLLOWUP",
    label: "고혈압 추적검사",
    date: "2026-08-03",
    status: "completed",
    source: { kind: "manual", label: "직접 입력 · 검토 대기" },
  }, "2026-08-04T03:00:00.000Z");
  changed = confirmPatientEvent(
    changed,
    "claim-review-history-patient",
    "claim-review-history-service",
    "2026-08-04T03:01:00.000Z",
  );
  const changedEvaluation = evaluateClaimRule(changed.patients[0], rule, "2026-08-04");
  const reconciled = reconcileClaimReviews(changed, [changedEvaluation], "2026-08-04T03:02:00.000Z");

  assert.equal(reconciled.claimReviews[0].stage, "new");
  assert.equal(reconciled.claimReviews[0].invalidatedFrom, "reviewed");
  assert.equal(reconciled.claimReviews[0].history.length, 50);
  assert.deepEqual(reconciled.claimReviews[0].history.at(-1), {
    at: "2026-08-04T03:02:00.000Z",
    from: "reviewed",
    to: "new",
    reviewer: "자동 규칙 엔진",
    reason: `자동 판정·근거·규칙 또는 판정일 변경 · ${evaluation.status}(2026-08-04) → ${changedEvaluation.status}(2026-08-04)`,
    opinion: "",
    outcome: "",
    inputMethod: "system",
  });
});
