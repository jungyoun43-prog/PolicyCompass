import { CONDITIONS } from "./data.js";

export const JOURNEY_BACKUP_SCHEMA = "vitagraph-journey";
export const JOURNEY_BACKUP_VERSION = 1;

function safeDate(value) {
  if (typeof value !== "string" || !value) return new Date().toISOString().slice(0, 10);
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? new Date().toISOString().slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeMeasurement(measurement) {
  if (!measurement || typeof measurement !== "object" || !measurement.key) return null;
  const key = String(measurement.key).trim();
  const unit = typeof measurement.unit === "string" ? measurement.unit.trim() : "";
  const value = typeof measurement.value === "string" ? measurement.value.trim() : measurement.value;
  if (!key || value === "" || (typeof value !== "string" && !Number.isFinite(value))) return null;
  return {
    key,
    label: String(measurement.label ?? key),
    value,
    unit,
    display: `${value}${unit ? ` ${unit}` : ""}`,
  };
}

function numericValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareMeasurements(before, after) {
  const previousByKey = new Map((before?.measurements ?? []).map((item) => [item.key, item]));
  const currentByKey = new Map((after?.measurements ?? []).map((item) => [item.key, item]));
  const changes = [];

  for (const [key, current] of currentByKey) {
    const previous = previousByKey.get(key);
    if (!previous || previous.unit !== current.unit) continue;
    const beforeValue = numericValue(previous.value);
    const afterValue = numericValue(current.value);
    if (beforeValue === null || afterValue === null || beforeValue === afterValue) continue;
    changes.push({
      key,
      label: current.label || previous.label || key,
      before: beforeValue,
      after: afterValue,
      delta: afterValue - beforeValue,
      unit: current.unit,
    });
  }

  return changes;
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
    measurementChanges: compareMeasurements(before, after),
  };
}

export function normalizeJourney(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object" && item.id && isValidDate(item.date))
    .map((item) => ({
      id: String(item.id),
      date: item.date,
      conditionIds: [...new Set(Array.isArray(item.conditionIds) ? item.conditionIds : [])].filter((id) => CONDITIONS[id]),
      measurements: (Array.isArray(item.measurements) ? item.measurements : []).map(normalizeMeasurement).filter(Boolean),
      source: String(item.source ?? "직접 입력"),
      createdAt: String(item.createdAt ?? `${item.date}T00:00:00.000Z`),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function createJourneyBackup(value, exportedAt = new Date().toISOString()) {
  return {
    schema: JOURNEY_BACKUP_SCHEMA,
    version: JOURNEY_BACKUP_VERSION,
    exportedAt,
    snapshots: normalizeJourney(value),
  };
}

export function parseJourneyBackup(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Journey 백업 파일 형식이 아닙니다.");
  }
  if (value.schema !== JOURNEY_BACKUP_SCHEMA) {
    throw new TypeError("VitaGraph Journey 백업 파일이 아닙니다.");
  }
  if (value.version !== JOURNEY_BACKUP_VERSION) {
    throw new TypeError(`지원하지 않는 Journey 백업 버전입니다: ${String(value.version)}`);
  }
  if (!Array.isArray(value.snapshots)) {
    throw new TypeError("Journey 백업에 기록 목록이 없습니다.");
  }

  const snapshots = normalizeJourney(value.snapshots);
  if (snapshots.length !== value.snapshots.length) {
    throw new TypeError("Journey 백업에 읽을 수 없는 기록이 포함되어 있습니다.");
  }
  return snapshots;
}
