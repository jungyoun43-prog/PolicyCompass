/**
 * Reviewer-selectable OpenRouter models, grouped by family. This list is also
 * the server-side whitelist — a model id outside it is ignored, so the demo
 * cannot be steered to arbitrary (or arbitrarily expensive) models.
 */
export const FRONTIER_MODEL_CHOICES = Object.freeze([
  { group: "판정 전용", id: "typesafe/jev-1.13", label: "Jev 1.13 · 판정과 확률" },
  { group: "Claude", id: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5" },
  { group: "Claude", id: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5" },
  { group: "Claude", id: "anthropic/claude-haiku-5.5", label: "Claude Haiku 5.5" },
  { group: "Claude", id: "anthropic/claude-fable-5.1", label: "Claude Fable 5.1" },
  { group: "ChatGPT", id: "openai/gpt-6.1-sol", label: "GPT-6.1 Sol" },
  { group: "ChatGPT", id: "openai/gpt-6-astra", label: "GPT-6 Astra" },
  { group: "ChatGPT", id: "openai/gpt-6-luna", label: "GPT-6 Luna" },
  { group: "Gemini", id: "google/gemini-4-argon", label: "Gemini 4 Argon" },
  { group: "Gemini", id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash" },
  { group: "Gemini", id: "google/gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite" },
  { group: "로컬급 (오픈모델)", id: "google/gemma-4-31b-it", label: "Gemma 4 31B" },
  { group: "로컬급 (오픈모델)", id: "qwen/qwen3-32b", label: "Qwen3 32B" },
  { group: "로컬급 (오픈모델)", id: "upstage/solar-pro-3", label: "Solar Pro 3 (Upstage)" },
  { group: "소형 (10B 이하)", id: "qwen/qwen3-8b", label: "Qwen3 8B" },
  { group: "소형 (10B 이하)", id: "meta-llama/llama-3.1-8b-instruct", label: "Llama 3.1 8B" },
  { group: "소형 (10B 이하)", id: "google/gemma-3-4b-it", label: "Gemma 3 4B" },
]);

export const FRONTIER_MODEL_GROUPS = Object.freeze([...new Set(FRONTIER_MODEL_CHOICES.map(({ group }) => group))]);

export function isAllowedFrontierModel(id) {
  return FRONTIER_MODEL_CHOICES.some((choice) => choice.id === id);
}

export function frontierModelLabel(id) {
  return FRONTIER_MODEL_CHOICES.find((choice) => choice.id === id)?.label ?? id;
}
