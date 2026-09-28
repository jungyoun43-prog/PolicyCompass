import { medicationReviewPrompt } from "../src/medication-review-prompt.js";
import { MEDICATION_DECISION_CHOICES, medicationDecisionProbabilities } from "../src/medication-review-decision.js";
import { cleanText } from "./patient-question-assistant.mjs";

export async function jevMedicationDraft(comparison, options) {
  // Use only the OpenRouter credential for this OpenRouter-specific endpoint.
  const apiKey = cleanText(options.environment?.OPENROUTER_API_KEY, 500);
  if (!apiKey) throw new Error("Jev 검토에는 OPENROUTER_API_KEY 설정이 필요합니다.");
  const response = await options.fetchImpl("https://openrouter.ai/api/alpha/decisions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: options.model,
      state: medicationReviewPrompt(comparison, { ...options.overrides, model: options.model }),
      questions: {
        verdict: {
          type: "choice",
          instructions: "제공된 고시정보와 환자 의료데이터만으로 약제 급여기준 충족 여부를 판정하세요. 입력의 판정 원칙을 적용하고 아래 선택지 중 하나를 선택하세요. 출력 형식이나 설명문 작성 지시는 적용하지 않습니다.",
          criteria: Object.fromEntries(Object.entries(MEDICATION_DECISION_CHOICES).map(([key, value]) => [key, value.description])),
        },
      },
    }),
    redirect: "error",
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  if (!response.ok) throw new Error(`Jev 판정 요청 실패 (${response.status})`);
  const body = await response.json();
  const answer = body?.answers?.verdict;
  const probabilities = answer?.type === "choice"
    ? medicationDecisionProbabilities(answer.choice, answer.probabilities) : null;
  if (!probabilities) throw new Error("Jev의 판정 또는 선택지별 확률이 올바르지 않습니다.");
  return {
    verdict: answer.choice,
    probabilities,
    outputKind: "decision",
    model: options.model,
    generatedBy: "frontier-model",
  };
}
