import assert from "node:assert/strict";
import test from "node:test";

import { evaluateClaimRule } from "../src/claim-rules.js";
import {
  addPatient,
  appendPatientEvent,
  claimEvaluationFingerprint,
  confirmPatientEvent,
  createEmptyEmrState,
  exportEmrBackup,
  normalizeEmrState,
  parseEmrBackup,
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
      assignee: "박담당",
      reviewer: "김심사",
      reason: "외부 검사 결과 확인 필요",
      opinion: "의뢰기관 회신을 기다립니다.",
      inputMethod: "drawer",
    },
  );

  assert.equal(reviewing.claimReviews[0].assignee, "박담당");
  assert.equal(reviewing.claimReviews[0].reviewer, "김심사");
  assert.equal(reviewing.claimReviews[0].transitionReason, "외부 검사 결과 확인 필요");
  assert.equal(reviewing.claimReviews[0].history.length, 1);
  assert.deepEqual(reviewing.claimReviews[0].history[0], {
    at: "2026-08-04T01:00:00.000Z",
    from: "new",
    to: "reviewing",
    assignee: "박담당",
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
  assert.equal(view.assignee, "박담당");
  assert.equal(view.reviewer, "김심사");
  assert.equal(view.outcome, "approved");
  assert.equal(view.history.length, 3);
});

test("담당자 필드가 없던 기존 v2 백업은 선택 필드를 추가하지 않고 그대로 호환한다", () => {
  const { state, evaluation } = fixture();
  const reviewed = setClaimReviewStage(
    state,
    evaluation,
    "reviewed",
    "기존 검토 완료",
    "2026-08-04T01:30:00.000Z",
    { reviewer: "기존 검토자", outcome: "approved" },
  );
  assert.equal(Object.hasOwn(reviewed.claimReviews[0], "assignee"), false);
  assert.equal(Object.hasOwn(reviewed.claimReviews[0].history[0], "assignee"), false);

  const backup = exportEmrBackup(reviewed, "2026-08-04T01:31:00.000Z");
  for (const rule of backup.data.rules) delete rule.sourceDocumentNumber;
  const restored = parseEmrBackup(structuredClone(backup));
  assert.equal(restored.claimReviews[0].reviewer, "기존 검토자");
  assert.equal(Object.hasOwn(restored.claimReviews[0], "assignee"), false);
  assert.equal(Object.hasOwn(restored.claimReviews[0].history[0], "assignee"), false);
  assert.ok(restored.rules.every((rule) => !Object.hasOwn(rule, "sourceDocumentNumber")));
});

test("프로필 청구 line은 상태 규칙에 없더라도 안전한 식별자와 지문으로 검토를 저장한다", () => {
  const { state } = fixture();
  const patient = state.patients[0];
  const claimItemId = "claim-line-copd-oral-2026-08";
  const sourceId = `copd.${claimItemId}`;
  const ruleId = `profile:${sourceId}`;
  const evaluation = {
    id: `${patient.id}:profile:${sourceId}`,
    patientId: patient.id,
    patientName: "위조된 환자명",
    patientMrn: "FORGED-MRN",
    sourceKind: "profile",
    sourceId,
    ruleId,
    title: "COPD 상병의 경구약 급여조건 확인",
    serviceCode: "DEMO-ORAL-COPD",
    status: "missing-evidence",
    asOf: "2026-08-04",
    calculationAvailable: false,
    windowStart: "2026-01-01",
    windowEnd: "2026-08-04",
    usedCount: 1,
    remainingCount: 0,
    serviceEventIds: ["unknown-event"],
    lastServiceDate: "2026-08-01",
    daysSinceLastService: 3,
    nextEligibleDate: "",
    missingEvidence: ["적용 상병과 약제 급여조건 대조"],
    evidenceEventIds: ["claim-review-history-condition", "unknown-event"],
    explanation: "프로필 청구 line 사전점검",
    claimContext: {
      assessmentId: "copd",
      claimItemId,
      serviceDate: "2026-08-04",
      workflowStatus: "CLAIMED",
      claimUnit: { lineNumber: "3", quantity: 30, unit: "정" },
      preflightStatus: "YELLOW",
      riskConfirmed: true,
      reasonCodes: ["RECORD_CONTEXT_MISSING", "REQUIRED_DATA_MISSING"],
      reasonLabels: ["적용 상병과 약제 급여조건 대조", "외부 처방 이력 확인"],
      evidenceIds: ["profile-evidence-2", "profile-evidence-1"],
      evidenceCount: 2,
      evidenceRecords: [
        {
          id: "profile-evidence-1",
          label: "진단 기록",
          date: "2026-08-01",
          sourceId: "clinical-source-1",
          sourceLabel: "원내 차트",
          verificationStatus: "VERIFIED",
          patientMatch: "VERIFIED",
          reviewerId: "reviewer-1",
          verifiedAt: "2026-08-01T09:00:00.000Z",
          synthetic: true,
        },
        {
          id: "profile-evidence-2",
          label: "처방 기록",
          date: "2026-08-02",
          sourceId: "clinical-source-2",
          sourceLabel: "원내 차트",
          verificationStatus: "VERIFIED",
          patientMatch: "VERIFIED",
          reviewerId: "reviewer-1",
          verifiedAt: "2026-08-02T09:00:00.000Z",
          synthetic: true,
        },
      ],
      disclaimer: "청구 전 확인 필요 · 실제 심사결과 아님",
      provenance: {
        kind: "synthetic-local-emr",
        sourceId: "profile-claim-source-1",
        sourceLabel: "예시 환자 기록",
        verificationStatus: "VERIFIED",
        patientMatch: "VERIFIED",
        reviewerId: "reviewer-1",
        verifiedAt: "2026-08-04T03:50:00.000Z",
        synthetic: true,
      },
    },
    rule: {
      id: ruleId,
      ruleSetId: ruleId,
      version: "1",
      title: "COPD 상병의 경구약 급여조건 확인",
      serviceCode: "DEMO-ORAL-COPD",
      serviceSystem: "urn:vitagraph:profile:service",
      serviceEventType: "procedure",
      windowDays: 365,
      maxCount: 1,
      dueSoonDays: 30,
      applicabilityCodes: [],
      requiredEvidence: [],
      effectiveFrom: "2026-01-01",
      sourceLabel: "연결 프로필 내부 사전점검",
      sourceDocumentNumber: "기관 규칙 VG-PROFILE-01",
      sample: true,
    },
  };

  const assigned = setClaimReviewStage(
    state,
    evaluation,
    "evidence",
    "외부 처방 근거 확인",
    "2026-08-04T04:00:00.000Z",
    { assignee: "이심사", reviewer: "김배정", inputMethod: "master-detail" },
  );
  assert.equal(assigned.claimReviews[0].sourceKind, "profile");
  assert.equal(assigned.claimReviews[0].sourceId, sourceId);
  assert.equal(assigned.claimReviews[0].ruleId, ruleId);
  assert.equal(assigned.claimReviews[0].assignee, "이심사");

  const reloaded = normalizeEmrState(structuredClone(assigned));
  assert.equal(reloaded.claimReviews.length, 1);
  const view = resolveClaimReview(reloaded, evaluation);
  assert.equal(view.stage, "evidence");
  assert.equal(view.stale, false);
  assert.equal(view.evaluation.patientName, patient.name);
  assert.equal(view.evaluation.patientMrn, patient.mrn);
  assert.deepEqual(view.evaluation.evidenceEventIds, ["claim-review-history-condition"]);
  assert.deepEqual(view.evaluation.serviceEventIds, []);
  assert.equal(view.evaluation.claimContext.claimUnit.lineNumber, "3");

  const backup = exportEmrBackup(reloaded, "2026-08-04T04:01:00.000Z");
  assert.equal(parseEmrBackup(structuredClone(backup)).claimReviews[0].sourceId, sourceId);

  const changedDisplayEvidence = {
    ...evaluation,
    missingEvidence: ["적용 상병과 약제 급여조건 대조", "외부 처방 이력 확인"],
  };
  const changedDisplayView = resolveClaimReview(reloaded, changedDisplayEvidence);
  assert.equal(changedDisplayView.stage, "evidence");
  assert.equal(changedDisplayView.stale, false);

  const changedDecision = structuredClone(evaluation);
  changedDecision.claimContext.reasonCodes.push("NEW_DECISION_REASON");
  const changedView = resolveClaimReview(reloaded, changedDecision);
  assert.equal(changedView.stage, "new");
  assert.equal(changedView.stale, true);

  const reorderedContext = structuredClone(evaluation);
  reorderedContext.claimContext.reasonCodes.reverse();
  reorderedContext.claimContext.reasonLabels.reverse();
  reorderedContext.claimContext.evidenceIds.reverse();
  assert.equal(claimEvaluationFingerprint(reorderedContext, patient), claimEvaluationFingerprint(evaluation, patient));

  const changedLine = structuredClone(evaluation);
  changedLine.claimContext.claimUnit.lineNumber = "4";
  assert.equal(resolveClaimReview(reloaded, changedLine).stale, true);
  const changedWorkflow = structuredClone(evaluation);
  changedWorkflow.claimContext.workflowStatus = "ADJUDICATED";
  assert.equal(resolveClaimReview(reloaded, changedWorkflow).stale, true);
  const changedProvenance = structuredClone(evaluation);
  changedProvenance.claimContext.provenance.verificationStatus = "UNVERIFIED";
  assert.equal(resolveClaimReview(reloaded, changedProvenance).stale, true);
  const changedRisk = structuredClone(evaluation);
  changedRisk.claimContext.riskConfirmed = false;
  assert.equal(resolveClaimReview(reloaded, changedRisk).stale, true);

  const ignoredDisplayFields = structuredClone(evaluation);
  ignoredDisplayFields.patientName = "표시 위조";
  ignoredDisplayFields.patientMrn = "DISPLAY-FORGED";
  ignoredDisplayFields.claimContext.untrustedExtra = "ignored";
  assert.equal(claimEvaluationFingerprint(ignoredDisplayFields, patient), claimEvaluationFingerprint(evaluation, patient));

  const changedDisplayCopy = structuredClone(evaluation);
  changedDisplayCopy.missingEvidence = ["새 화면 표시용 보완 문구"];
  changedDisplayCopy.claimContext.reasonLabels = ["새 번역 문구", "화면 표시 문구"];
  changedDisplayCopy.claimContext.disclaimer = "표시용 경계 문구 개정";
  changedDisplayCopy.claimContext.provenance.sourceLabel = "표시용 출처 이름 개정";
  changedDisplayCopy.claimContext.evidenceRecords[0].label = "표시용 근거 이름 개정";
  changedDisplayCopy.claimContext.evidenceRecords[0].sourceLabel = "표시용 근거 출처 이름 개정";
  assert.equal(claimEvaluationFingerprint(changedDisplayCopy, patient), claimEvaluationFingerprint(evaluation, patient));

  const malformedQuantity = structuredClone(evaluation);
  malformedQuantity.claimContext.claimUnit.quantity = Number.POSITIVE_INFINITY;
  assert.throws(
    () => setClaimReviewStage(reloaded, malformedQuantity, "reviewing", "검토", "2026-08-04T04:01:30.000Z", { reviewer: "김배정" }),
    /청구 수량이 유효하지 않습니다/,
  );
  const reconciled = reconcileClaimReviews(reloaded, [changedDecision], "2026-08-04T04:02:00.000Z");
  assert.equal(reconciled.claimReviews[0].stage, "new");
  assert.equal(reconciled.claimReviews[0].history.at(-1).assignee, "이심사");

  const forged = structuredClone(reloaded);
  forged.claimReviews[0].evaluationId = `${patient.id}:profile:other-line`;
  assert.deepEqual(normalizeEmrState(forged).claimReviews, []);

  const longPatientId = `patient-${"p".repeat(152)}`;
  const longAssessmentId = `assessment-${"a".repeat(69)}`;
  const longClaimItemId = `claim-${"c".repeat(154)}`;
  const longSourceId = `${longAssessmentId}.${longClaimItemId}`;
  const longRuleId = `profile-${longAssessmentId}-${longClaimItemId}`;
  const longState = structuredClone(state);
  longState.patients[0].id = longPatientId;
  longState.selectedPatientId = longPatientId;
  const longEvaluation = structuredClone(evaluation);
  longEvaluation.patientId = longPatientId;
  longEvaluation.sourceId = longSourceId;
  longEvaluation.ruleId = longRuleId;
  longEvaluation.id = `${longPatientId}:profile:${longSourceId}`;
  longEvaluation.claimContext.assessmentId = longAssessmentId;
  longEvaluation.claimContext.claimItemId = longClaimItemId;
  longEvaluation.rule.id = longRuleId;
  longEvaluation.rule.ruleSetId = longRuleId;
  assert.ok(longEvaluation.id.length > 400);
  assert.ok(longSourceId.length > 160);
  assert.ok(longRuleId.length > 160);
  const longReviewed = setClaimReviewStage(
    longState,
    longEvaluation,
    "evidence",
    "긴 기관 식별자 경계 검토",
    "2026-08-04T04:03:00.000Z",
    { assignee: "장문 식별자 담당", inputMethod: "master-detail" },
  );
  assert.equal(longReviewed.claimReviews[0].evaluationId, longEvaluation.id);
  assert.equal(longReviewed.claimReviews[0].sourceId, longSourceId);
  assert.equal(longReviewed.claimReviews[0].ruleId, longRuleId);
  const longRestored = parseEmrBackup(exportEmrBackup(longReviewed, "2026-08-04T04:04:00.000Z"));
  assert.equal(resolveClaimReview(longRestored, longEvaluation).stage, "evidence");
  assert.equal(longRestored.audit.at(-1).entityId, longEvaluation.id);
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
