/**
 * Reviewer-selectable OpenRouter models, grouped by family. This list is also
 * the server-side whitelist — a model id outside it is ignored, so the demo
 * cannot be steered to arbitrary (or arbitrarily expensive) models.
 */
export const FRONTIER_MODEL_CHOICES = Object.freeze([
  { group: "Claude", id: "anthropic/claude-opus-5", label: "Claude Opus 5" },
  { group: "Claude", id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5" },
  { group: "Claude", id: "anthropic/claude-fable-5", label: "Claude Fable 5" },
  { group: "Claude", id: "anthropic/claude-opus-4.8", label: "Claude Opus 4.8" },
  { group: "Claude", id: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
  { group: "ChatGPT", id: "openai/gpt-5.6-luna", label: "GPT-5.6 Luna" },
  { group: "ChatGPT", id: "openai/gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { group: "ChatGPT", id: "openai/gpt-5.6-sol", label: "GPT-5.6 Sol" },
  { group: "ChatGPT", id: "openai/gpt-5.5", label: "GPT-5.5" },
  { group: "ChatGPT", id: "openai/gpt-5.4", label: "GPT-5.4" },
  { group: "Gemini", id: "google/gemini-3.7-flash", label: "Gemini 3.7 Flash" },
  { group: "Gemini", id: "google/gemini-3.6-flash", label: "Gemini 3.6 Flash" },
  { group: "Gemini", id: "google/gemini-3.5-flash", label: "Gemini 3.5 Flash" },
  { group: "Gemini", id: "google/gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite" },
  { group: "Gemini", id: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
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
