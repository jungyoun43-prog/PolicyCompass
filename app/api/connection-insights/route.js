export const maxDuration = 60;

import { runConnectionInsights } from "../../../scripts/graphs/connection-insights-graph.mjs";
import { assertSameOrigin, modelResponse, readJson, withApiErrors } from "../../../lib/api.js";

export const POST = withApiErrors(async (request) => {
  assertSameOrigin(request);
  const payload = await readJson(request);
  return modelResponse(() => runConnectionInsights(payload), {
    invalidCode: "INVALID_PATIENT_CONTEXT",
    failureCode: "CONNECTION_INSIGHTS_FAILED",
    failureMessage: "관계 근거를 생성하지 못했습니다.",
  });
});
