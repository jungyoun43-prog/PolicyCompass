export const maxDuration = 60;

import { ApiError, assertSameOrigin, assertFrontierRequestAllowed, assertFrontierDailyBudget, jsonResponse, readJson, withApiErrors } from "../../../lib/api.js";
import { hermesSettings, openRouterSelected } from "../../../scripts/hermes-gateway.mjs";

import { frontierCredentials } from "../../../scripts/patient-question-assistant.mjs";

export const POST = withApiErrors(async (request) => {
  assertSameOrigin(request);
  const payload = await readJson(request);
  const hermes = hermesSettings();
  if (openRouterSelected() ? !frontierCredentials().configured : hermes.enabled ? !hermes.configured : !process.env.POLICYCOMPASS_OLLAMA_MODEL) {
    return jsonResponse(503, { code: "AI_NOT_CONFIGURED", message: "규칙 기반 요약을 사용합니다." });
  }
  if (!payload.patient || !Array.isArray(payload.patient?.events)) {
    throw new ApiError(400, "INVALID_PAYLOAD", "구조화 환자 이벤트가 필요합니다.");
  }
  if (hermes.enabled || openRouterSelected()) {
    assertFrontierRequestAllowed(request);
    await assertFrontierDailyBudget();
  }
  const { runClinicalCopilot } = await import("../../../scripts/clinical-copilot.mjs");
  try {
    return jsonResponse(200, await runClinicalCopilot(payload));
  } catch {
    throw new ApiError(502, "LOCAL_MODEL_FAILED", "AI가 유효한 근거 초안을 반환하지 못했습니다.");
  }
});
