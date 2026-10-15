import { medicationReviewRequest } from "../src/medication-review-prompt.js";
import { assertModelContextAccepted } from "../lib/model-errors.js";
import { MEDICATION_DECISION_CHOICES, medicationDecisionProbabilities } from "../src/medication-review-decision.js";
import { cleanText } from "./patient-question-assistant.mjs";

export async function jevMedicationDraft(comparison, options) {
  // Use only the OpenRouter credential for this OpenRouter-specific endpoint.
  const apiKey = cleanText(options.environment?.OPENROUTER_API_KEY, 500);
  if (!apiKey) throw new Error("Jev 검토에는 OPENROUTER_API_KEY 설정이 필요합니다.");
  const { instructions, input } = medicationReviewRequest(comparison, { ...options.overrides, model: options.model });
  const response = await options.fetchImpl("https://openrouter.ai/api/alpha/decisions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: options.model,
      state: input,
      questions: {
        verdict: {
          type: "choice",
          instructions: `${instructions}\n\n아래 선택지 중 하나를 선택하세요. 출력 형식이나 설명문 작성 지시는 적용하지 않습니다.`,
          criteria: Object.fromEntries(Object.entries(MEDICATION_DECISION_CHOICES).map(([key, value]) => [key, value.description])),
        },
      },
    }),
    redirect: "error",
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    assertModelContextAccepted(response.status, error);
    throw new Error(`Jev 판정 요청 실패 (${response.status})`);
  }
  const body = await response.json();
  if (body?.error) {
    assertModelContextAccepted(response.status, body);
    throw new Error("Jev 판정 응답이 완료되지 않았습니다.");
  }
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
