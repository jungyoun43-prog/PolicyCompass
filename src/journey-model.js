import { CONDITIONS, RELATIONS } from "./data.js";

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

function uniqueConditionIds(ids) {
  return [...new Set(Array.isArray(ids) ? ids : [])].filter((id) => CONDITIONS[id]);
}

function possibleContextsFor(ids) {
  const current = new Set(uniqueConditionIds(ids));
  return RELATIONS
    .filter(({ a, b }) => current.has(a) && current.has(b))
    .slice(0, 3)
    .map((relation) => ({
      id: `${relation.a}-${relation.b}`,
      title: `${CONDITIONS[relation.a].label} · ${CONDITIONS[relation.b].label}`,
      label: relation.label,
      category: relation.category,
      rationale: relation.rationale,
      sourceTitle: relation.sourceTitle,
      sourceUrl: relation.sourceUrl,
      guardrail: "함께 검토할 수 있는 일반적 맥락이며, 이번 변화의 원인이나 인과관계를 뜻하지 않습니다.",
    }));
}

function comparisonObservations(changes) {
  const observations = [];

  for (const id of changes.added) {
    const condition = CONDITIONS[id];
    if (!condition) continue;
    observations.push({
      id: `added-${id}`,
      kind: "added",
      title: `${condition.label} 신호가 새로 표시됨`,
      detail: "이번 기록의 입력 또는 가져오기 범위에서 관찰된 차이입니다.",
    });
  }

  for (const id of changes.removed) {
    const condition = CONDITIONS[id];
    if (!condition) continue;
    observations.push({
      id: `removed-${id}`,
      kind: "removed",
      title: `${condition.label} 신호가 이번 기록에는 없음`,
      detail: "기록에서 빠진 것이 질환의 소실이나 회복을 뜻하지 않습니다.",
    });
  }

  for (const measurement of changes.measurementChanges) {
    observations.push({
      id: `measurement-${measurement.key}`,
      kind: "measurement",
      title: `${measurement.label} 기록값이 달라짐`,
      detail: "같은 이름과 단위의 숫자 기록에서 확인된 차이이며, 호전·악화를 판단하지 않습니다.",
      measurement,
    });
  }

  if (observations.length === 0) {
    observations.push({
      id: "no-observed-change",
      kind: "steady",
      title: "비교 가능한 기록에서 달라진 항목 없음",
      detail: "표시 신호와 이름·단위가 같은 숫자 기록을 기준으로 비교했습니다.",
    });
  }

  const visible = observations.slice(0, 4);
  if (observations.length > visible.length) {
    visible.push({
      id: "more-observed-changes",
      kind: "more",
      title: `그 밖의 변화 ${observations.length - visible.length}개`,
      detail: "아래 항목별 비교에서 나머지 차이를 확인할 수 있습니다.",
    });
  }
  return visible;
}

function nextReviewItems(after, changes = null) {
  const items = [];
  const seen = new Set();
  const add = (item) => {
    if (!item?.title || seen.has(item.title) || items.length >= 3) return;
    seen.add(item.title);
    items.push(item);
  };

  for (const id of changes?.added ?? []) {
    const condition = CONDITIONS[id];
    if (!condition) continue;
    add({
      id: `new-${id}`,
      title: `${condition.label} · ${condition.checks[0]}`,
      detail: "새로 표시된 신호의 시점·출처와 함께 의료진에게 확인하세요.",
    });
  }

  for (const measurement of changes?.measurementChanges ?? []) {
    add({
      id: `measure-${measurement.key}`,
      title: `${measurement.label} 측정 조건 대조`,
      detail: "단위가 같아도 측정 시점·방법·출처가 같았는지 먼저 확인하세요.",
    });
  }

  for (const id of changes?.removed ?? []) {
    const condition = CONDITIONS[id];
    if (!condition) continue;
    add({
      id: `missing-${id}`,
      title: `${condition.label} 기록 범위 확인`,
      detail: "이번 기록에 없는 이유가 입력·가져오기 범위 차이인지 확인하세요.",
    });
  }

  for (const id of uniqueConditionIds(after?.conditionIds)) {
    const condition = CONDITIONS[id];
    add({
      id: `follow-${id}`,
      title: `${condition.label} · ${condition.checks[0]}`,
      detail: "다음 기록에도 같은 항목을 남기면 시점 간 비교가 쉬워집니다.",
    });
  }

  if (items.length === 0 && (after?.measurements?.length ?? 0) > 0) {
    add({
      id: "measurement-follow-up",
      title: "같은 이름·단위로 다음 측정 저장",
      detail: "측정 시점과 출처도 함께 남기면 다음 비교에서 차이를 대조할 수 있습니다.",
    });
  }

  return items;
}

/**
 * Builds neutral, task-oriented copy around two snapshots. This intentionally
 * describes record differences only; it never classifies a change as clinical
 * improvement, deterioration, cause, or diagnosis.
 */
export function createJourneyNarrative(before, after) {
  const hasAfter = Boolean(after && typeof after === "object");
  if (!hasAfter) {
    return {
      state: "empty",
      observations: [],
      contexts: [],
      nextReviews: [],
      comparison: null,
      comparisonSummary: "아직 비교할 기록이 없습니다.",
    };
  }

  const currentIds = uniqueConditionIds(after.conditionIds);
  const contexts = possibleContextsFor(currentIds);
  const currentSignalCount = currentIds.length;
  const currentMeasurementCount = Array.isArray(after.measurements) ? after.measurements.length : 0;

  if (!before || typeof before !== "object") {
    const hasCurrentData = currentSignalCount > 0 || currentMeasurementCount > 0;
    return {
      state: "baseline",
      observations: hasCurrentData
        ? [{
          id: "first-baseline",
          kind: "baseline",
          title: "현재 기록이 첫 비교 기준점",
          detail: `표시 신호 ${currentSignalCount}개와 측정 기록 ${currentMeasurementCount}개를 다음 시점과 비교할 수 있습니다.`,
        }]
        : [],
      contexts,
      nextReviews: nextReviewItems(after),
      comparison: {
        previousDate: "",
        currentDate: String(after.date ?? ""),
        previousSignalCount: 0,
        currentSignalCount,
        previousMeasurementCount: 0,
        currentMeasurementCount,
        changedMeasurementCount: 0,
        hasObservedChanges: false,
      },
      comparisonSummary: "이전 저장 기록이 없어 현재 기록을 첫 기준점으로 사용합니다.",
    };
  }

  const changes = compareSnapshots(before, after);
  const previousIds = uniqueConditionIds(before.conditionIds);
  const previousMeasurementCount = Array.isArray(before.measurements) ? before.measurements.length : 0;
  const hasObservedChanges = changes.added.length > 0
    || changes.removed.length > 0
    || changes.measurementChanges.length > 0;
  const previousDate = String(before.date ?? "이전 시점");
  const currentDate = String(after.date ?? "현재 시점");

  return {
    state: "comparison",
    observations: comparisonObservations(changes),
    contexts,
    nextReviews: nextReviewItems(after, changes),
    comparison: {
      previousDate,
      currentDate,
      previousSignalCount: previousIds.length,
      currentSignalCount,
      previousMeasurementCount,
      currentMeasurementCount,
      changedMeasurementCount: changes.measurementChanges.length,
      hasObservedChanges,
    },
    comparisonSummary: `${previousDate} 기록과 ${currentDate} 기록 비교 · 표시 신호 ${previousIds.length}개 → ${currentSignalCount}개 · 측정 기록 ${previousMeasurementCount}개 → ${currentMeasurementCount}개`,
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
