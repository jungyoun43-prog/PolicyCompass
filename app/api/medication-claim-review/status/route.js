import { medicationClaimReviewStatus } from "../../../../scripts/graphs/medication-claim-review-graph.mjs";
import { jsonResponse, withApiErrors } from "../../../../lib/api.js";
import { medicationCoverageTranslationStatus } from "../../../../scripts/medication-coverage-translation.mjs";

export const GET = withApiErrors(async () => jsonResponse(200, { ...medicationClaimReviewStatus(), translation: medicationCoverageTranslationStatus() }));
