export const CLAIM_PRESENTATION_STATES = Object.freeze({
  reduced: Object.freeze({ tone: "red", label: "삭감 확정" }),
  risk: Object.freeze({ tone: "yellow", label: "사전점검 주의" }),
  verified: Object.freeze({ tone: "green", label: "사전점검 확인" }),
  insufficient: Object.freeze({ tone: "gray", label: "판정 보류" }),
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

function validFinalAdjudication(item, claimItemId) {
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

export function latestFinalReduction(adjudications = [], claimItemId = "") {
  if (!cleanText(claimItemId)) return null;
  const latest = (Array.isArray(adjudications) ? adjudications : [])
    .filter((item) => traceableAdjudication(item, claimItemId))
    .sort((left, right) => validInstant(right.decidedAt).localeCompare(validInstant(left.decidedAt)))[0] ?? null;
  return validFinalAdjudication(latest, claimItemId) ? latest : null;
}

function reductionLabel(adjudication) {
  const claimed = Number(adjudication?.claimedAmount ?? adjudication?.originalAmount);
  const allowed = Number(adjudication?.allowedAmount);
  if (Number.isFinite(claimed) && claimed > 0 && Number.isFinite(allowed)) {
    return allowed <= 0 ? "전액 삭감 확정" : allowed < claimed ? "일부 삭감 확정" : "삭감 확정";
  }
  return ["full-reduction", "full_reduction", "denied"].includes(cleanText(adjudication?.outcome).toLowerCase())
    ? "전액 삭감 확정"
    : "일부 삭감 확정";
}

export function resolveClaimPresentation({ evaluation, claimItem = {}, adjudications = [] } = {}) {
  const claimItemId = cleanText(claimItem.claimItemId || evaluation?.id);
  const finalReduction = latestFinalReduction(adjudications, claimItemId);
  const missingData = Array.isArray(claimItem.missingData)
    ? claimItem.missingData.map(cleanText).filter(Boolean)
    : [];

  if (finalReduction) {
    return {
      state: "reduced",
      ...CLAIM_PRESENTATION_STATES.reduced,
      label: reductionLabel(finalReduction),
      reason: cleanText(finalReduction.reasonText || finalReduction.reasonLabel) || `심사 사유 ${cleanText(finalReduction.reasonCode)}`,
      finalReduction,
      missingData,
      paymentBoundary: "최종 심사결과에서 확인된 삭감입니다.",
    };
  }

  const evaluationStatus = cleanText(evaluation?.status);
  const riskConfirmed = claimItem.riskConfirmed === true || RISK_EVALUATION_STATUSES.has(evaluationStatus);
  const riskEvaluable = claimItem.riskEvaluable !== false && Boolean(evaluationStatus || claimItem.riskReason);
  if (riskConfirmed && riskEvaluable) {
    return {
      state: "risk",
      ...CLAIM_PRESENTATION_STATES.risk,
      reason: cleanText(claimItem.riskReason) || cleanText(evaluation?.explanation) || "기간·횟수 또는 기록 근거를 확인해야 합니다.",
      finalReduction: null,
      missingData,
      paymentBoundary: "사전점검 위험이며 실제 삭감 확정을 뜻하지 않습니다.",
    };
  }

  const insufficientReason = cleanText(claimItem.insufficientReason);
  if (!riskEvaluable || insufficientReason || INSUFFICIENT_EVALUATION_STATUSES.has(evaluationStatus) || !evaluation) {
    return {
      state: "insufficient",
      ...CLAIM_PRESENTATION_STATES.insufficient,
      reason: insufficientReason || (!riskEvaluable ? "위험을 판정할 자료가 부족합니다." : cleanText(evaluation?.explanation) || "평가 대상이 아니거나 아직 판정하지 않았습니다."),
      finalReduction: null,
      missingData,
      paymentBoundary: "자료 보완 전에는 적합·위험으로 판단하지 않습니다.",
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
      finalReduction: null,
      missingData,
      paymentBoundary: "내부 사전점검 결과이며 지급이나 급여 인정을 보장하지 않습니다.",
    };
  }

  return {
    state: "insufficient",
    ...CLAIM_PRESENTATION_STATES.insufficient,
    reason: "현재 자료만으로 사전점검 결과를 확정할 수 없습니다.",
    finalReduction: null,
    missingData,
    paymentBoundary: "자료 보완 전에는 적합·위험으로 판단하지 않습니다.",
  };
}
