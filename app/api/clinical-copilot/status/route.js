import { jsonResponse, withApiErrors } from "../../../../lib/api.js";
import { hermesSettings } from "../../../../scripts/hermes-gateway.mjs";

/**
 * Reports whether a loopback model is configured, exactly as the previous
 * dev server did: the flag is the environment variable, nothing else.
 */
export const GET = withApiErrors(async () => {
  const hermes = hermesSettings();
  const model = hermes.enabled ? (hermes.configured ? hermes.model : "") : process.env.POLICYCOMPASS_OLLAMA_MODEL ?? "";
  return jsonResponse(200, {
    configured: Boolean(model),
    mode: model ? (hermes.enabled ? "hermes" : "local-model") : "rule-based",
    ...(hermes.enabled ? { provider: "hermes" } : {}),
    model,
  });
});
