import { CONDITIONS } from "./data.js";

function safeDate(value) {
  if (typeof value !== "string" || !value) return new Date().toISOString().slice(0, 10);
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? new Date().toISOString().slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function normalizeMeasurement(measurement) {
  if (!measurement || typeof measurement !== "object" || !measurement.key) return null;
  const unit = typeof measurement.unit === "string" ? measurement.unit : "";
  const value = measurement.value;
  if (typeof value !== "string" && !Number.isFinite(value)) return null;
  return {
    key: String(measurement.key),
    label: String(measurement.label ?? measurement.key),
    value,
    unit,
    display: `${value}${unit ? ` ${unit}` : ""}`,
  };
}

export function createJourneySnapshot(input = {}) {
  const conditionIds = [...new Set(Array.isArray(input.conditionIds) ? input.conditionIds : [])]
    .filter((id) => CONDITIONS[id]);
  const measurements = (Array.isArray(input.measurements) ? input.measurements : [])
    .map(normalizeMeasurement)
    .filter(Boolean);
  return {
    id: String(input.id ?? `snapshot-${Date.now()}`),
    date: safeDate(input.observedAt),
    conditionIds,
    measurements,
    source: String(input.source ?? "직접 입력"),
    createdAt: String(input.createdAt ?? new Date().toISOString()),
  };
}

export function compareSnapshots(before, after) {
  const previous = new Set(before?.conditionIds ?? []);
  const current = new Set(after?.conditionIds ?? []);
  return {
    added: [...current].filter((id) => !previous.has(id)),
    removed: [...previous].filter((id) => !current.has(id)),
    unchanged: [...current].filter((id) => previous.has(id)),
  };
}

export function normalizeJourney(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object" && item.id && /^\d{4}-\d{2}-\d{2}$/.test(item.date ?? ""))
    .map((item) => ({
      ...item,
      conditionIds: (Array.isArray(item.conditionIds) ? item.conditionIds : []).filter((id) => CONDITIONS[id]),
      measurements: (Array.isArray(item.measurements) ? item.measurements : []).map(normalizeMeasurement).filter(Boolean),
      source: String(item.source ?? "직접 입력"),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
