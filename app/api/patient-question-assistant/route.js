export const maxDuration = 60;

import {
  patientQuestionAssistantStatus,
  runPatientQuestionAssistant,
} from "../../../scripts/patient-question-assistant.mjs";
import {
  assertFrontierDailyBudget,
  assertFrontierRequestAllowed,
  assertSameOrigin,
  modelResponse,
  readJson,
  resolveConfiguredProvider,
  withApiErrors,
} from "../../../lib/api.js";

export const POST = withApiErrors(async (request) => {
  assertSameOrigin(request);
  const payload = await readJson(request);
  const provider = resolveConfiguredProvider(payload, patientQuestionAssistantStatus, {
    requireConsent: true,
    unavailableMessage: "규칙 기반 질문을 사용합니다.",
  });
  if (provider === "frontier") {
    assertFrontierRequestAllowed(request);
    await assertFrontierDailyBudget();
  }
  return modelResponse(() => runPatientQuestionAssistant(payload), {
    invalidCode: "INVALID_PATIENT_CONTEXT",
    failureCode: "PATIENT_MODEL_FAILED",
    failureMessage: "선택한 AI가 유효한 근거 질문을 반환하지 못했습니다.",
  });
});
