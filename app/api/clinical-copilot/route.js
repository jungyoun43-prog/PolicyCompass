import { ApiError, assertSameOrigin, jsonResponse, readJson, withApiErrors } from "../../../lib/api.js";

export const POST = withApiErrors(async (request) => {
  assertSameOrigin(request);
  if (process.env.NODE_ENV === "production" || !process.env.POLICYCOMPASS_OLLAMA_MODEL) {
    return jsonResponse(503, { code: "AI_NOT_CONFIGURED", message: "규칙 기반 요약을 사용합니다." });
  }
  const payload = await readJson(request);
  if (!payload.patient || !Array.isArray(payload.patient?.events)) {
    throw new ApiError(400, "INVALID_PAYLOAD", "구조화 환자 이벤트가 필요합니다.");
  }
  const { runClinicalCopilot } = await import("../../../scripts/clinical-copilot.mjs");
  try {
    return jsonResponse(200, await runClinicalCopilot(payload));
  } catch {
    throw new ApiError(502, "LOCAL_MODEL_FAILED", "로컬 AI가 유효한 근거 초안을 반환하지 못했습니다.");
  }
});
