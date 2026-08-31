export const maxDuration = 60;

import {
  medicationClaimReviewStatus,
  runMedicationClaimReview,
} from "../../../scripts/graphs/medication-claim-review-graph.mjs";
import { ApiError, assertFrontierDailyBudget, assertFrontierRequestAllowed, assertSameOrigin, jsonResponse, readJson, withApiErrors } from "../../../lib/api.js";

export const POST = withApiErrors(async (request) => {
  assertSameOrigin(request);
  const payload = await readJson(request);
  const provider = payload.provider === "frontier" ? "frontier" : "local";
  const status = medicationClaimReviewStatus();
  if (!status[provider].configured) {
    return jsonResponse(503, {
      code: provider === "frontier" ? "FRONTIER_NOT_CONFIGURED" : "LOCAL_AI_NOT_CONFIGURED",
      message: "AI 검토가 설정되지 않아 규칙 기반 사전점검을 사용합니다.",
    });
  }
  if (provider === "frontier") {
    assertFrontierRequestAllowed(request);
    await assertFrontierDailyBudget();
  }
  try {
    return jsonResponse(200, await runMedicationClaimReview(payload));
  } catch (error) {
    if (error instanceof TypeError) throw new ApiError(400, "INVALID_MEDICATION_REVIEW", error.message);
    throw new ApiError(502, "MEDICATION_REVIEW_FAILED", "약제 급여 사전점검 초안을 만들지 못했습니다.");
  }
});
