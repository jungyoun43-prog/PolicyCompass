import { jsonResponse, withApiErrors } from "../../../../lib/api.js";

/**
 * Reports whether a loopback model is configured, exactly as the previous
 * dev server did: the flag is the environment variable, nothing else.
 */
export const GET = withApiErrors(async () => {
  const model = process.env.POLICYCOMPASS_OLLAMA_MODEL ?? "";
  return jsonResponse(200, {
    configured: Boolean(model),
    mode: model ? "local-model" : "rule-based",
    model,
  });
});
