import { resumeClaimReview } from "../../../../scripts/graphs/claim-review-graph.mjs";
import { ApiError, assertSameOrigin, jsonResponse, readJson, withApiErrors } from "../../../../lib/api.js";

export const POST = withApiErrors(async (request) => {
  assertSameOrigin(request);
  const payload = await readJson(request);
  try {
    return jsonResponse(200, await resumeClaimReview(payload?.threadId, { action: payload?.action, note: payload?.note }));
  } catch (error) {
    if (error instanceof TypeError) throw new ApiError(400, "INVALID_CLAIM_REVIEW", error.message);
    throw new ApiError(502, "CLAIM_REVIEW_FAILED", "청구 검토를 재개하지 못했습니다.");
  }
});
