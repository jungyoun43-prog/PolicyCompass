export const maxDuration = 120;

import { medicationCoverageTranslationStatus, translateMedicationCoverage, validateCoverageTranslationPayload } from "../../../../scripts/medication-coverage-translation.mjs";
import { ApiError, assertSameOrigin, assertFrontierRequestAllowed, assertFrontierDailyBudget, readJson, modelResponse, withApiErrors } from "../../../../lib/api.js";
import { keepAliveJson } from "../../../../lib/keep-alive-json.js";

export const POST = withApiErrors(async request => {
  assertSameOrigin(request);
  const payload = await readJson(request, { maxLength: null });
  if (!medicationCoverageTranslationStatus().configured) throw new ApiError(503, "TRANSLATION_NOT_CONFIGURED", "서버의 AI 번역 연결을 확인해 주세요.");
  try { validateCoverageTranslationPayload(payload); } catch (error) {
    if (error instanceof TypeError) throw new ApiError(400, "INVALID_COVERAGE_TRANSLATION", error.message);
    throw error;
  }
  assertFrontierRequestAllowed(request);
  await assertFrontierDailyBudget();
  // Preflight errors keep their HTTP status. Once the JSON stream starts,
  // delayed model errors retain the API's code/message body for the client.
  return keepAliveJson(() => withApiErrors(() => modelResponse(() => translateMedicationCoverage(payload), {
    invalidCode: "INVALID_COVERAGE_TRANSLATION", failureCode: "COVERAGE_TRANSLATION_FAILED",
    failureMessage: "AI 번역을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  }))(request), { signal: request.signal });
});
