export const CLAIM_PRESENTATION_STATES = Object.freeze({
  "high-risk": Object.freeze({ tone: "red", label: "내부 규칙상 근거 누락" }),
  "needs-review": Object.freeze({ tone: "orange", label: "등록 규칙 확인 필요" }),
  verified: Object.freeze({ tone: "green", label: "등록 규칙 조건 일치" }),
  insufficient: Object.freeze({ tone: "violet", label: "자료 부족" }),
});

export const CLAIM_ADJUDICATION_STATES = Object.freeze({
  adjusted: Object.freeze({ tone: "deep-red", label: "심사 조정" }),
  recognized: Object.freeze({ tone: "green", label: "인정" }),
  final: Object.freeze({ tone: "gray", label: "최종 결과 확인" }),
});

const FINAL_STATUSES = new Set(["final", "completed"]);
const VOID_STATUSES = new Set(["void", "voided", "reversed", "cancelled", "entered-in-error"]);
const REDUCTION_OUTCOMES = new Set([
  "reduced",
  "denied",
  "partial-reduction",
  "full-reduction",
  "partial_reduction",
  "full_reduction",
]);
const RECOGNIZED_OUTCOMES = new Set(["approved", "paid", "allowed", "accepted", "recognized"]);
const RISK_EVALUATION_STATUSES = new Set(["missing-evidence", "due-soon", "waiting"]);
const INSUFFICIENT_EVALUATION_STATUSES = new Set(["unknown", "not-applicable"]);

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validInstant(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? "" : parsed.toISOString();
}

function validFinalReduction(item, claimItemId) {
  if (!item || typeof item !== "object") return false;
  const status = cleanText(item.status).toLowerCase();
  const outcome = cleanText(item.outcome).toLowerCase();
  return FINAL_STATUSES.has(status)
    && !VOID_STATUSES.has(cleanText(item.lifecycleStatus).toLowerCase())
    && item.reversed !== true
    && cleanText(item.claimItemId) === cleanText(claimItemId)
    && Boolean(cleanText(item.sourceId))
    && Boolean(validInstant(item.decidedAt))
    && Boolean(cleanText(item.reasonCode))
    && REDUCTION_OUTCOMES.has(outcome);
}

function traceableAdjudication(item, claimItemId) {
  return item
    && typeof item === "object"
    && cleanText(item.claimItemId) === cleanText(claimItemId)
    && Boolean(cleanText(item.sourceId))
    && Boolean(validInstant(item.decidedAt))
    && Boolean(cleanText(item.reasonCode));
}

function validFinalAdjudication(item, claimItemId) {
  if (!traceableAdjudication(item, claimItemId)) return false;
  const status = cleanText(item.status).toLowerCase();
  return FINAL_STATUSES.has(status)
    && !VOID_STATUSES.has(cleanText(item.lifecycleStatus).toLowerCase())
    && item.reversed !== true;
}

export function latestFinalAdjudication(adjudications = [], claimItemId = "") {
  if (!cleanText(claimItemId)) return null;
  const latest = (Array.isArray(adjudications) ? adjudications : [])
    .filter((item) => traceableAdjudication(item, claimItemId))
    .sort((left, right) => validInstant(right.decidedAt).localeCompare(validInstant(left.decidedAt)))[0] ?? null;
  return validFinalAdjudication(latest, claimItemId) ? latest : null;
}

export function latestFinalReduction(adjudications = [], claimItemId = "") {
  if (!cleanText(claimItemId)) return null;
  const latest = (Array.isArray(adjudications) ? adjudications : [])
    .filter((item) => traceableAdjudication(item, claimItemId))
    .sort((left, right) => validInstant(right.decidedAt).localeCompare(validInstant(left.decidedAt)))[0] ?? null;
  return validFinalReduction(latest, claimItemId) ? latest : null;
}

function reductionLabel(adjudication) {
  const claimed = Number(adjudication?.claimedAmount ?? adjudication?.originalAmount);
  const allowed = Number(adjudication?.allowedAmount);
  if (Number.isFinite(claimed) && claimed > 0 && Number.isFinite(allowed)) {
    return allowed <= 0 ? "전액 불인정" : allowed < claimed ? "일부 조정" : "심사 조정";
  }
  return ["full-reduction", "full_reduction", "denied"].includes(cleanText(adjudication?.outcome).toLowerCase())
    ? "전액 불인정"
    : "일부 조정";
}

export function resolveClaimAdjudicationPresentation(adjudication) {
  if (!adjudication || typeof adjudication !== "object") return null;
  const outcome = cleanText(adjudication.outcome).toLowerCase();
  const isReduction = REDUCTION_OUTCOMES.has(outcome);
  const state = isReduction ? "adjusted" : RECOGNIZED_OUTCOMES.has(outcome) ? "recognized" : "final";
  const base = CLAIM_ADJUDICATION_STATES[state];
  return {
    state,
    ...base,
    label: isReduction ? reductionLabel(adjudication) : base.label,
    reason: cleanText(adjudication.reasonText || adjudication.reasonLabel) || `심사 사유 ${cleanText(adjudication.reasonCode)}`,
    adjudication,
    paymentBoundary: "보험자 또는 심사기관에서 연결된 최종 결과입니다. 청구 전 자동점검과 별도로 표시합니다.",
  };
}

export function resolveClaimPreflightPresentation({ evaluation, claimItem = {} } = {}) {
  const missingData = Array.isArray(claimItem.missingData)
    ? claimItem.missingData.map(cleanText).filter(Boolean)
    : [];
  const evaluationStatus = cleanText(evaluation?.status);
  const riskEvaluable = claimItem.riskEvaluable !== false && Boolean(evaluationStatus || claimItem.riskReason);

  if (claimItem.riskConfirmed === true && riskEvaluable) {
    return {
      state: "high-risk",
      ...CLAIM_PRESENTATION_STATES["high-risk"],
      reason: cleanText(claimItem.riskReason) || cleanText(evaluation?.explanation) || "현재 등록된 내부 규칙에서 필요한 근거가 확인되지 않았습니다.",
      missingData,
      paymentBoundary: "기관이 등록한 내부 규칙의 사전점검이며 급여 여부나 실제 심사 결과가 아닙니다.",
    };
  }

  if (riskEvaluable && RISK_EVALUATION_STATUSES.has(evaluationStatus)) {
    return {
      state: "needs-review",
      ...CLAIM_PRESENTATION_STATES["needs-review"],
      reason: cleanText(claimItem.riskReason) || cleanText(evaluation?.explanation) || "기간·횟수 또는 기록 근거를 추가로 확인해야 합니다.",
      missingData,
      paymentBoundary: "추가 확인이 필요한 내부 규칙 점검이며 불인정이나 삭감 확정을 뜻하지 않습니다.",
    };
  }

  const insufficientReason = cleanText(claimItem.insufficientReason);
  if (!riskEvaluable || insufficientReason || INSUFFICIENT_EVALUATION_STATUSES.has(evaluationStatus) || !evaluation) {
    return {
      state: "insufficient",
      ...CLAIM_PRESENTATION_STATES.insufficient,
      reason: insufficientReason || (!riskEvaluable ? "위험을 판정할 자료가 부족합니다." : cleanText(evaluation?.explanation) || "평가 대상 또는 연결 자료를 확인해야 합니다."),
      missingData,
      paymentBoundary: "자료 보완 전에는 등록 규칙 일치 여부나 심사 결과를 판단하지 않습니다.",
    };
  }

  const verified = evaluationStatus === "ready"
    && evaluation?.calculationAvailable === true
    && (!Array.isArray(evaluation?.missingEvidence) || evaluation.missingEvidence.length === 0)
    && claimItem.requiredEvidenceVerified !== false;
  if (verified) {
    return {
      state: "verified",
      ...CLAIM_PRESENTATION_STATES.verified,
      reason: cleanText(claimItem.verifiedReason) || "현재 EMR에서 기간·횟수와 필요한 근거를 확인했습니다.",
      missingData,
      paymentBoundary: "확인된 자료가 현재 등록된 내부 규칙과 일치한다는 뜻이며 지급·급여 인정·심사 결과를 보장하지 않습니다.",
    };
  }

  return {
    state: "insufficient",
    ...CLAIM_PRESENTATION_STATES.insufficient,
    reason: "현재 자료만으로 청구 전 점검 결과를 판단할 수 없습니다.",
    missingData,
    paymentBoundary: "자료 보완 전에는 등록 규칙 일치 여부나 심사 결과를 판단하지 않습니다.",
  };
}
