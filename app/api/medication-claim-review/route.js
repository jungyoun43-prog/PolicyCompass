export const maxDuration = 120;

import {
  medicationClaimReviewStatus,
  runMedicationClaimReview,
  sanitizeMedicationClaimComparison,
} from "../../../scripts/graphs/medication-claim-review-graph.mjs";
import {
  ApiError,
  assertFrontierDailyBudget,
  assertFrontierRequestAllowed,
  assertSameOrigin,
  modelResponse,
  readJson,
  resolveConfiguredProvider,
  withApiErrors,
} from "../../../lib/api.js";
import { keepAliveJson } from "../../../lib/keep-alive-json.js";

export const POST = withApiErrors(async (request) => {
  assertSameOrigin(request);
  const payload = await readJson(request, { maxLength: null });
  // Reject malformed comparisons before opening the heartbeat response.
  try { sanitizeMedicationClaimComparison(payload); } catch (error) {
    throw new ApiError(400, "INVALID_MEDICATION_REVIEW", error.message);
  }
  const provider = resolveConfiguredProvider(payload, medicationClaimReviewStatus, {
    unavailableMessage: "AI 검토가 설정되지 않아 검토를 완료할 수 없습니다.",
  });
  if (provider === "frontier") {
    assertFrontierRequestAllowed(request);
    await assertFrontierDailyBudget();
  }
  return keepAliveJson(() => withApiErrors(() => modelResponse(() => runMedicationClaimReview(payload, { timeoutMs: 100_000 }), {
    invalidCode: "INVALID_MEDICATION_REVIEW",
    failureCode: "MEDICATION_REVIEW_FAILED",
    failureMessage: "약제 급여 사전점검 초안을 만들지 못했습니다.",
  }))(request), { signal: request.signal });
});
