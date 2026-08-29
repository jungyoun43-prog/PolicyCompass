import { jsonResponse, withApiErrors } from "../../../../lib/api.js";

/**
 * The clinical copilot only ever ran against a loopback model on a developer
 * machine; a deployed server reports rule-based mode exactly as before.
 */
export const GET = withApiErrors(async () => {
  const local = process.env.NODE_ENV !== "production" && Boolean(process.env.POLICYCOMPASS_OLLAMA_MODEL);
  return jsonResponse(200, {
    configured: local,
    mode: local ? "local-model" : "rule-based",
    model: local ? process.env.POLICYCOMPASS_OLLAMA_MODEL : "",
  });
});
