export const maxDuration = 60;

import { patientQuestionAssistantStatus } from "../../../../scripts/patient-question-assistant.mjs";
import { runQuestionRefine } from "../../../../scripts/graphs/question-refine-graph.mjs";
import {
  assertFrontierDailyBudget,
  assertFrontierRequestAllowed,
  assertSameOrigin,
  modelResponse,
  readJson,
  resolveConfiguredProvider,
  withApiErrors,
} from "../../../../lib/api.js";

export const POST = withApiErrors(async (request) => {
  assertSameOrigin(request);
  const payload = await readJson(request);
  const provider = resolveConfiguredProvider(payload, patientQuestionAssistantStatus, {
    requireConsent: true,
    unavailableMessage: "질문 다듬기에는 AI 설정이 필요합니다.",
  });
  if (provider === "frontier") {
    assertFrontierRequestAllowed(request);
    await assertFrontierDailyBudget();
  }
  return modelResponse(() => runQuestionRefine(payload), {
    invalidCode: "INVALID_REFINE_REQUEST",
    failureCode: "REFINE_FAILED",
    failureMessage: "질문을 다듬지 못했습니다.",
  });
});
