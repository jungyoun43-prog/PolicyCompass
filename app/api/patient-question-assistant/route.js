import {
  patientQuestionAssistantStatus,
  runPatientQuestionAssistant,
} from "../../../scripts/patient-question-assistant.mjs";
import { ApiError, assertFrontierRequestAllowed, assertSameOrigin, jsonResponse, readJson, withApiErrors } from "../../../lib/api.js";

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
      message: "규칙 기반 질문을 사용합니다.",
    });
  }
  if (provider === "frontier") assertFrontierRequestAllowed(request);
  try {
    return jsonResponse(200, await runPatientQuestionAssistant(payload));
  } catch (error) {
    if (error instanceof TypeError) throw new ApiError(400, "INVALID_PATIENT_CONTEXT", error.message);
    throw new ApiError(502, "PATIENT_MODEL_FAILED", "선택한 AI가 유효한 근거 질문을 반환하지 못했습니다.");
  }
});
