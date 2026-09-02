export const maxDuration = 120;

import {
  medicationClaimReviewStatus,
  runMedicationClaimReview,
} from "../../../scripts/graphs/medication-claim-review-graph.mjs";
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
  const provider = resolveConfiguredProvider(payload, medicationClaimReviewStatus, {
    unavailableMessage: "AI 검토가 설정되지 않아 규칙 기반 사전점검을 사용합니다.",
  });
  if (provider === "frontier") {
    assertFrontierRequestAllowed(request);
    await assertFrontierDailyBudget();
  }
  return modelResponse(() => runMedicationClaimReview(payload, { timeoutMs: 100_000 }), {
    invalidCode: "INVALID_MEDICATION_REVIEW",
    failureCode: "MEDICATION_REVIEW_FAILED",
    failureMessage: "약제 급여 사전점검 초안을 만들지 못했습니다.",
  });
});
