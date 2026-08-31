export const maxDuration = 60;

import { patientQuestionAssistantStatus } from "../../../../scripts/patient-question-assistant.mjs";
import { runQuestionRefine } from "../../../../scripts/graphs/question-refine-graph.mjs";
import { ApiError, assertFrontierDailyBudget, assertFrontierRequestAllowed, assertSameOrigin, jsonResponse, readJson, withApiErrors } from "../../../../lib/api.js";

export const POST = withApiErrors(async (request) => {
  assertSameOrigin(request);
  const payload = await readJson(request);
  const provider = payload.provider === "frontier" ? "frontier" : "local";
  if (provider === "frontier" && payload.consent !== true) {
    throw new ApiError(400, "FRONTIER_CONSENT_REQUIRED", "프론티어 모델 전송 동의가 필요합니다.");
  }
  const status = patientQuestionAssistantStatus();
  if (!status[provider].configured) {
    return jsonResponse(503, {
      code: provider === "frontier" ? "FRONTIER_NOT_CONFIGURED" : "LOCAL_AI_NOT_CONFIGURED",
      message: "질문 다듬기에는 AI 설정이 필요합니다.",
    });
  }
  if (provider === "frontier") {
    assertFrontierRequestAllowed(request);
    await assertFrontierDailyBudget();
  }
  try {
    return jsonResponse(200, await runQuestionRefine(payload));
  } catch (error) {
    if (error instanceof TypeError) throw new ApiError(400, "INVALID_REFINE_REQUEST", error.message);
    throw new ApiError(502, "REFINE_FAILED", "질문을 다듬지 못했습니다.");
  }
});
