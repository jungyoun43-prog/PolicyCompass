import { resumeClaimReview } from "../../../../scripts/graphs/claim-review-graph.mjs";
import { assertSameOrigin, modelResponse, readJson, withApiErrors } from "../../../../lib/api.js";

export const POST = withApiErrors(async (request) => {
  assertSameOrigin(request);
  const payload = await readJson(request);
  return modelResponse(() => resumeClaimReview(payload.threadId, { action: payload.action, note: payload.note }), {
    invalidCode: "INVALID_CLAIM_REVIEW",
    failureCode: "CLAIM_REVIEW_FAILED",
    failureMessage: "청구 검토를 재개하지 못했습니다.",
  });
});
