import { medicationClaimReviewStatus } from "../../../../scripts/graphs/medication-claim-review-graph.mjs";
import { jsonResponse, withApiErrors } from "../../../../lib/api.js";

export const GET = withApiErrors(async () => jsonResponse(200, medicationClaimReviewStatus()));
