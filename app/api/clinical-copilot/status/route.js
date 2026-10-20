import { jsonResponse, withApiErrors } from "../../../../lib/api.js";
import { hermesSettings, openRouterSelected } from "../../../../scripts/hermes-gateway.mjs";

import { frontierCredentials } from "../../../../scripts/patient-question-assistant.mjs";

/**
 * Reports whether a loopback model is configured, exactly as the previous
 * dev server did: the flag is the environment variable, nothing else.
 */
export const GET = withApiErrors(async () => {
  const hermes = hermesSettings();
  const cloud = openRouterSelected() ? { ...frontierCredentials(), provider: "openrouter" } : hermes;
  const model = hermes.enabled || openRouterSelected() ? (cloud.configured ? cloud.model : "") : process.env.POLICYCOMPASS_OLLAMA_MODEL ?? "";
  return jsonResponse(200, {
    configured: Boolean(model),
    mode: model ? (openRouterSelected() ? "openrouter" : hermes.enabled ? "hermes" : "local-model") : "rule-based",
    ...(openRouterSelected() ? { provider: "openrouter" } : hermes.enabled ? { provider: "hermes" } : {}),
    model,
  });
});
