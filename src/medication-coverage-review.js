import { applyMedicationReviewDraft, MEDICATION_REVIEW_VERDICTS } from "./medication-claim-review.js";
import { isForeignCoveragePolicy, medicationCoveragePolicy, medicationCoveragePolicyNotice } from "./medication-coverage-policies.js";

export function applyCoveragePolicyReview(input, draft = {}) {
  const policy = medicationCoveragePolicy(input.medicationId, input.policyId);
  if (!policy) throw new Error("이 약제에 등록되지 않은 보험 기준입니다.");
  const foreign = isForeignCoveragePolicy(input);
  if ((draft.status && draft.status !== "completed") || draft.generatedBy === "rule" || draft.generatedBy === "none"
    || !MEDICATION_REVIEW_VERDICTS[draft.verdict]) {
    throw new Error(draft.note || `${foreign ? "선택한 해외 보험 기준의 " : ""}검토를 완료하지 못했습니다. 입력을 확인한 뒤 다시 검토해 주세요.`);
  }
  const merged = applyMedicationReviewDraft(input.base, draft);
  // The deterministic comparison is Korean. Foreign reviews must contain an
  // actual notice-based model report/decision, never a fallback to that verdict.
  if (foreign && (merged.generatedBy === "rule" || !MEDICATION_REVIEW_VERDICTS[draft.verdict]
    || !(draft.markdown?.trim() || (draft.outputKind === "decision" && merged.probabilities)))) {
    throw new Error("선택한 해외 보험 기준의 검토 결과를 받지 못했습니다. 모델 연결을 확인한 뒤 다시 검토해 주세요.");
  }
  return {
    ...merged,
    status: "completed", assessmentMethod: draft.assessmentMethod,
    criteria: draft.criteria, criteriaProfile: draft.criteriaProfile, reviewScope: draft.reviewScope,
    ...(foreign || draft.assessmentMethod === "server-criteria-aggregation" ? { checks: [], rationale: [], citedCheckIds: [], ruleVerdict: undefined,
      verdictLabel: { circle: "기준 충족", triangle: "판정 제한", cross: "기준 미충족" }[merged.verdict],
      summary: draft.summary || "선택한 보험 기준에 대한 모델 판정입니다. 기준별 근거를 확인해 주세요." } : {}),
    medicationId: input.medicationId,
    coveragePolicy: { ...policy, noticeText: input.noticeText, noticeSource: input.noticeSource ?? null,
      checkedOn: input.noticeSource?.checkedOn ?? policy.checkedOn,
      ...(input.translation ? { translation: input.translation, criteria: input.translatedCriteria } : {}),
      edited: (input.translation?.sourceNotice ?? input.noticeText) !== (input.noticeSource?.text ?? medicationCoveragePolicyNotice(input.medicationId, input.policyId)) },
  };
}
