export const JEV_REVIEW_MODEL = "typesafe/jev-1.13";

export function isJevReviewModel(model) {
  return model === JEV_REVIEW_MODEL;
}

export const MEDICATION_DECISION_CHOICES = Object.freeze({
  circle: { symbol: "○", label: "충족", description: "급여 고시에서 요구하는 조건을 환자 의료데이터가 충족함" },
  triangle: { symbol: "△", label: "판정 제한", description: "관련 정보는 있으나 내용이 모호하여 충족 여부를 판단할 수 없음" },
  cross: { symbol: "✕", label: "미충족", description: "급여기준에 미달하거나 필요한 정보가 없음" },
});

// Reject incomplete or malformed distributions; never invent missing probabilities.
export function medicationDecisionProbabilities(verdict, input) {
  if (!Object.hasOwn(MEDICATION_DECISION_CHOICES, verdict) || !input || typeof input !== "object") return null;
  const result = {};
  for (const key of Object.keys(MEDICATION_DECISION_CHOICES)) {
    const value = input[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return null;
    result[key] = value;
  }
  if (Math.abs(Object.values(result).reduce((sum, value) => sum + value, 0) - 1) > 0.02) return null;
  if (result[verdict] < Math.max(...Object.values(result))) return null;
  return result;
}
