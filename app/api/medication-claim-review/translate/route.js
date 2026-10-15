export const maxDuration = 120;

import { medicationCoverageTranslationStatus, translateMedicationCoverage, validateCoverageTranslationPayload } from "../../../../scripts/medication-coverage-translation.mjs";
import { ApiError, assertSameOrigin, assertFrontierRequestAllowed, assertFrontierDailyBudget, readJson, modelResponse, withApiErrors } from "../../../../lib/api.js";

export const POST = withApiErrors(async request => {
  assertSameOrigin(request);
  const payload = await readJson(request, { maxLength: null });
  if (!medicationCoverageTranslationStatus().configured) throw new ApiError(503, "TRANSLATION_NOT_CONFIGURED", "Haiku 번역을 사용하려면 서버의 OpenRouter 연결이 필요합니다.");
  try { validateCoverageTranslationPayload(payload); } catch (error) {
    if (error instanceof TypeError) throw new ApiError(400, "INVALID_COVERAGE_TRANSLATION", error.message);
    throw error;
  }
  assertFrontierRequestAllowed(request);
  await assertFrontierDailyBudget();
  return modelResponse(() => translateMedicationCoverage(payload), { invalidCode: "INVALID_COVERAGE_TRANSLATION", failureCode: "COVERAGE_TRANSLATION_FAILED",
    failureMessage: "번역을 완료하지 못했거나 원문 보존 검증을 통과하지 못했습니다. 원문은 유지했습니다. 다시 시도해 주세요." });
});
