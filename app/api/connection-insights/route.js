import { runConnectionInsights } from "../../../scripts/graphs/connection-insights-graph.mjs";
import { ApiError, assertSameOrigin, jsonResponse, readJson, withApiErrors } from "../../../lib/api.js";

export const POST = withApiErrors(async (request) => {
  assertSameOrigin(request);
  const payload = await readJson(request);
  try {
    return jsonResponse(200, await runConnectionInsights(payload));
  } catch (error) {
    if (error instanceof TypeError) throw new ApiError(400, "INVALID_PATIENT_CONTEXT", error.message);
    throw new ApiError(502, "CONNECTION_INSIGHTS_FAILED", "관계 근거를 생성하지 못했습니다.");
  }
});
