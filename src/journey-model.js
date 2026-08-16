import { CONDITIONS, RELATIONS } from "./data.js";
import {
  CLINICAL_OBSERVATION_SPECS,
  normalizeClinicalObservationValue,
} from "./clinical-observations.js";

export const JOURNEY_BACKUP_SCHEMA = "vitagraph-journey";
export const JOURNEY_BACKUP_VERSION = 2;
export const JOURNEY_TIME_ZONE = "Asia/Seoul";
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;

const CONDITION_PROVENANCE_KINDS = new Set([
  "clinician-confirmed",
  "clinician-confirmed-unsigned-import",
  "patient-declared",
  "unverified",
  "unverified-import",
]);
const MEASUREMENT_PROVENANCE_KINDS = new Set([
  "clinician-confirmed",
  "clinician-final-unsigned-import",
  "patient-entered",
  "unverified",
  "unverified-import",
]);
const SIGNAL_KINDS = new Set(["measurement-input", "symptom-input"]);
const SOURCE_INFO = Object.freeze({
  local: Object.freeze({ kind: "local-save", label: "현재 앱에서 저장 · 항목별 출처 표시", trust: "local-unverified" }),
  legacy: Object.freeze({ kind: "legacy-flat", label: "기존 기록 · 항목별 출처 미확인", trust: "unverified" }),
  imported: Object.freeze({ kind: "backup-restore", label: "백업 복원 · 원본 출처 미검증", trust: "unverified" }),
});
const JOURNEY_MEASUREMENT_BY_KEY = new Map(CLINICAL_OBSERVATION_SPECS
  .filter(({ patientTransferKey }) => patientTransferKey)
  .map((spec) => [spec.patientTransferKey, spec]));

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value, keys, label) {
  if (!isPlainObject(value)) throw new TypeError(`${label} 구조가 유효하지 않습니다.`);
  const expected = new Set(keys);
  const actual = Object.keys(value);
  if (actual.length !== expected.size || actual.some((key) => !expected.has(key))) {
    throw new TypeError(`${label}에 허용되지 않은 필드가 있습니다.`);
  }
}

function canonicalInstant(value, label = "시각") {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label}이 유효하지 않습니다.`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new TypeError(`${label}이 유효하지 않습니다.`);
  return parsed.toISOString();
}

function dateInSeoul(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: JOURNEY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const byType = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function snapshotTime(value, fallback = new Date()) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    if (!isValidDate(value)) throw new TypeError("Journey 기록 날짜가 유효하지 않습니다.");
    return { date: value, observedAt: "", timeZone: JOURNEY_TIME_ZONE };
  }
  const source = value === undefined || value === null || value === "" ? fallback : value;
  const observedAt = canonicalInstant(source instanceof Date ? source.toISOString() : source, "Journey 관찰 시각");
  return { date: dateInSeoul(new Date(observedAt)), observedAt, timeZone: JOURNEY_TIME_ZONE };
}

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeMeasurement(measurement, fallbackProvenance = "unverified") {
  if (!isPlainObject(measurement)) return null;
  const key = typeof measurement.key === "string" ? measurement.key.trim() : "";
  const spec = JOURNEY_MEASUREMENT_BY_KEY.get(key);
  if (!spec) return null;
  let value;
  try {
    value = normalizeClinicalObservationValue(measurement.value, spec);
  } catch {
    return null;
  }
  const provenanceKind = MEASUREMENT_PROVENANCE_KINDS.has(measurement.provenanceKind)
    ? measurement.provenanceKind
    : fallbackProvenance;
  let observedAt = "";
  if (typeof measurement.observedAt === "string" && measurement.observedAt) {
    try { observedAt = canonicalInstant(measurement.observedAt, "측정 시각"); } catch { return null; }
  }
  return {
    key,
    code: spec.code,
    label: spec.label,
    value,
    unit: spec.unit,
    observedAt,
    provenanceKind,
    display: `${value}${spec.unit ? ` ${spec.unit}` : ""}`,
  };
}

function validIdentifier(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value);
}

function normalizeConditionEntries(value, legacyIds = [], fallbackProvenance = "unverified") {
  const input = Array.isArray(value)
    ? value
    : (Array.isArray(legacyIds) ? legacyIds : []).map((id) => ({ id, provenanceKind: fallbackProvenance }));
  const byId = new Map();
  for (const item of input) {
    if (!isPlainObject(item) || !CONDITIONS[item.id]) continue;
    const provenanceKind = CONDITION_PROVENANCE_KINDS.has(item.provenanceKind)
      ? item.provenanceKind
      : fallbackProvenance;
    if (!CONDITION_PROVENANCE_KINDS.has(provenanceKind)) continue;
    const current = byId.get(item.id);
    if (!current || (!current.provenanceKind.startsWith("clinician-confirmed") && provenanceKind.startsWith("clinician-confirmed"))) {
      byId.set(item.id, { id: item.id, provenanceKind });
    }
  }
  return [...byId.values()];
}

function normalizeSignal(signal) {
  if (!isPlainObject(signal) || !validIdentifier(signal.id) || !SIGNAL_KINDS.has(signal.kind)) return null;
  if (signal.provenanceKind !== "input-pattern") return null;
  const key = typeof signal.key === "string" ? signal.key.trim().slice(0, 80) : "";
  const label = typeof signal.label === "string" ? signal.label.trim().slice(0, 160) : "";
  const unit = typeof signal.unit === "string" ? signal.unit.trim().slice(0, 40) : "";
  const evidenceText = typeof signal.evidenceText === "string" ? signal.evidenceText.trim().slice(0, 240) : "";
  const value = typeof signal.value === "number"
    ? (Number.isFinite(signal.value) ? signal.value : "")
    : typeof signal.value === "string" ? signal.value.trim().slice(0, 120) : "";
  if (!key || !label || value === "" || !evidenceText) return null;
  return {
    id: signal.id,
    kind: signal.kind,
    key,
    label,
    value,
    unit,
    evidenceText,
    provenanceKind: "input-pattern",
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

let snapshotSequence = 0;

function generatedSnapshotId() {
  if (globalThis.crypto?.randomUUID) return `snapshot-${globalThis.crypto.randomUUID()}`;
  snapshotSequence += 1;
  return `snapshot-${Date.now()}-${snapshotSequence}`;
}

function normalizeSourceInfo(value, fallback = SOURCE_INFO.legacy) {
  if (!isPlainObject(value)) return { ...fallback };
  const known = Object.values(SOURCE_INFO).find(({ kind }) => kind === value.kind);
  return known ? { ...known } : { ...fallback };
}

export function createJourneySnapshot(input = {}) {
  const hasStructuredConditions = Array.isArray(input.conditionEntries);
  const conditionEntries = normalizeConditionEntries(
    input.conditionEntries,
    input.conditionIds,
    "unverified",
  );
  const conditionIds = conditionEntries.map(({ id }) => id);
  const measurements = (Array.isArray(input.measurements) ? input.measurements : [])
    .map(normalizeMeasurement)
    .filter(Boolean);
  const signals = (Array.isArray(input.signals) ? input.signals : [])
    .map(normalizeSignal)
    .filter(Boolean);
  const timing = snapshotTime(input.observedAt);
  const createdAt = canonicalInstant(
    typeof input.createdAt === "string" && input.createdAt ? input.createdAt : new Date().toISOString(),
    "Journey 저장 시각",
  );
  const id = input.id === undefined ? generatedSnapshotId() : String(input.id).trim();
  if (!validIdentifier(id)) throw new TypeError("Journey 기록 ID가 유효하지 않습니다.");
  const sourceInfo = normalizeSourceInfo(
    input.sourceInfo,
    hasStructuredConditions ? SOURCE_INFO.local : SOURCE_INFO.legacy,
  );
  return {
    id,
    ...timing,
    conditionIds,
    conditionEntries,
    signals,
    measurements,
    sourceInfo,
    source: sourceInfo.label,
    createdAt,
  };
}

export function compareSnapshots(before, after) {
  const previous = new Set(before?.conditionIds ?? []);
  const current = new Set(after?.conditionIds ?? []);
  const previousSignals = new Map((before?.signals ?? []).map((signal) => [
    `${signal.kind}:${signal.key}:${String(signal.value)}:${signal.unit}`,
    signal,
  ]));
  const currentSignals = new Map((after?.signals ?? []).map((signal) => [
    `${signal.kind}:${signal.key}:${String(signal.value)}:${signal.unit}`,
    signal,
  ]));
  return {
    added: [...current].filter((id) => !previous.has(id)),
    removed: [...previous].filter((id) => !current.has(id)),
    unchanged: [...current].filter((id) => previous.has(id)),
    addedSignals: [...currentSignals].filter(([key]) => !previousSignals.has(key)).map(([, signal]) => signal),
    removedSignals: [...previousSignals].filter(([key]) => !currentSignals.has(key)).map(([, signal]) => signal),
    unchangedSignals: [...currentSignals].filter(([key]) => previousSignals.has(key)).map(([, signal]) => signal),
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
      title: `${condition.label} 질환 항목이 새로 표시됨`,
      detail: "이번 기록의 선택 또는 가져오기 범위에서 관찰된 차이입니다.",
    });
  }

  for (const id of changes.removed) {
    const condition = CONDITIONS[id];
    if (!condition) continue;
    observations.push({
      id: `removed-${id}`,
      kind: "removed",
      title: `${condition.label} 질환 항목이 이번 기록에는 없음`,
      detail: "기록에서 빠진 것이 질환의 소실이나 회복을 뜻하지 않습니다.",
    });
  }

  for (const signal of changes.addedSignals) {
    observations.push({
      id: `added-pattern-${signal.id}`,
      kind: "added-pattern",
      title: `${signal.label}가 새로 기록됨`,
      detail: `환자 입력 패턴 ${signal.value}${signal.unit ? ` ${signal.unit}` : ""}의 기록 차이이며, 질환 진단이 아닙니다.`,
    });
  }

  for (const signal of changes.removedSignals) {
    observations.push({
      id: `removed-pattern-${signal.id}`,
      kind: "removed-pattern",
      title: `${signal.label}가 이번 기록에는 없음`,
      detail: "입력 범위의 차이이며 증상 소실·회복이나 임상 변화를 뜻하지 않습니다.",
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
      detail: "질환 항목·입력 확인 신호와 이름·단위가 같은 숫자 기록을 기준으로 비교했습니다.",
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
      detail: "새로 표시된 질환 항목의 시점·출처와 함께 의료진에게 확인하세요.",
    });
  }

  for (const measurement of changes?.measurementChanges ?? []) {
    add({
      id: `measure-${measurement.key}`,
      title: `${measurement.label} 측정 조건 대조`,
      detail: "단위가 같아도 측정 시점·방법·출처가 같았는지 먼저 확인하세요.",
    });
  }

  for (const signal of changes?.addedSignals ?? []) {
    add({
      id: `pattern-${signal.id}`,
      title: `${signal.label} 시점·조건 확인`,
      detail: "입력한 패턴 신호이며 질환명으로 해석하지 않고 의료진과 확인합니다.",
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
  const currentConditionCount = currentIds.length;
  const currentInputSignalCount = Array.isArray(after.signals) ? after.signals.length : 0;
  const currentMeasurementCount = Array.isArray(after.measurements) ? after.measurements.length : 0;

  if (!before || typeof before !== "object") {
    const hasCurrentData = currentConditionCount > 0 || currentInputSignalCount > 0 || currentMeasurementCount > 0;
    return {
      state: "baseline",
      observations: hasCurrentData
        ? [{
          id: "first-baseline",
          kind: "baseline",
          title: "현재 기록이 첫 비교 기준점",
          detail: `질환 항목 ${currentConditionCount}개·입력 확인 신호 ${currentInputSignalCount}개·측정 기록 ${currentMeasurementCount}개를 다음 시점과 비교할 수 있습니다.`,
        }]
        : [],
      contexts,
      nextReviews: nextReviewItems(after),
      comparison: {
        previousDate: "",
        currentDate: String(after.date ?? ""),
        previousSignalCount: 0,
        currentSignalCount: currentConditionCount + currentInputSignalCount,
        previousConditionCount: 0,
        currentConditionCount,
        previousInputSignalCount: 0,
        currentInputSignalCount,
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
  const previousInputSignalCount = Array.isArray(before.signals) ? before.signals.length : 0;
  const previousMeasurementCount = Array.isArray(before.measurements) ? before.measurements.length : 0;
  const hasObservedChanges = changes.added.length > 0
    || changes.removed.length > 0
    || changes.addedSignals.length > 0
    || changes.removedSignals.length > 0
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
      previousSignalCount: previousIds.length + previousInputSignalCount,
      currentSignalCount: currentConditionCount + currentInputSignalCount,
      previousConditionCount: previousIds.length,
      currentConditionCount,
      previousInputSignalCount,
      currentInputSignalCount,
      previousMeasurementCount,
      currentMeasurementCount,
      changedMeasurementCount: changes.measurementChanges.length,
      hasObservedChanges,
    },
    comparisonSummary: `${previousDate} 기록과 ${currentDate} 기록 비교 · 질환 항목 ${previousIds.length}개 → ${currentConditionCount}개 · 입력 확인 신호 ${previousInputSignalCount}개 → ${currentInputSignalCount}개 · 측정 기록 ${previousMeasurementCount}개 → ${currentMeasurementCount}개`,
  };
}

export function normalizeJourney(value) {
  if (!Array.isArray(value)) return [];
  const seenIds = new Set();
  return value
    .map((item) => {
      if (!isPlainObject(item) || !validIdentifier(item.id) || seenIds.has(item.id) || !isValidDate(item.date)) return null;
      seenIds.add(item.id);
      const structured = Array.isArray(item.conditionEntries);
      const conditionEntries = normalizeConditionEntries(item.conditionEntries, item.conditionIds, "unverified");
      const measurements = (Array.isArray(item.measurements) ? item.measurements : [])
        .map((measurement) => normalizeMeasurement(measurement))
        .filter(Boolean);
      const signals = (Array.isArray(item.signals) ? item.signals : [])
        .map(normalizeSignal)
        .filter(Boolean);
      let observedAt = "";
      if (typeof item.observedAt === "string" && item.observedAt) {
        try { observedAt = canonicalInstant(item.observedAt, "Journey 관찰 시각"); } catch { return null; }
        if (dateInSeoul(new Date(observedAt)) !== item.date) return null;
      }
      let createdAt;
      try {
        createdAt = canonicalInstant(
          typeof item.createdAt === "string" && item.createdAt
            ? item.createdAt
            : `${item.date}T00:00:00+09:00`,
          "Journey 저장 시각",
        );
      } catch {
        return null;
      }
      const sourceInfo = normalizeSourceInfo(item.sourceInfo, structured ? SOURCE_INFO.local : SOURCE_INFO.legacy);
      return {
        id: item.id,
        date: item.date,
        observedAt,
        timeZone: JOURNEY_TIME_ZONE,
        conditionIds: conditionEntries.map(({ id }) => id),
        conditionEntries,
        signals,
        measurements,
        sourceInfo,
        source: sourceInfo.label,
        createdAt,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function backupSnapshot(snapshot) {
  return {
    id: snapshot.id,
    date: snapshot.date,
    observedAt: snapshot.observedAt,
    timeZone: JOURNEY_TIME_ZONE,
    conditionEntries: snapshot.conditionEntries.map(({ id, provenanceKind }) => ({ id, provenanceKind })),
    signals: snapshot.signals.map((signal) => ({
      id: signal.id,
      kind: signal.kind,
      key: signal.key,
      label: signal.label,
      value: signal.value,
      unit: signal.unit,
      evidenceText: signal.evidenceText,
      provenanceKind: signal.provenanceKind,
    })),
    measurements: snapshot.measurements.map((measurement) => ({
      key: measurement.key,
      code: measurement.code,
      label: measurement.label,
      value: measurement.value,
      unit: measurement.unit,
      observedAt: measurement.observedAt,
      provenanceKind: measurement.provenanceKind,
    })),
    createdAt: snapshot.createdAt,
  };
}

export function createJourneyBackup(value, exportedAt = new Date().toISOString()) {
  const canonicalExportedAt = canonicalInstant(
    exportedAt instanceof Date ? exportedAt.toISOString() : exportedAt,
    "Journey 백업 내보내기 시각",
  );
  const snapshots = normalizeJourney(value).map(backupSnapshot);
  for (const snapshot of snapshots) strictSnapshot(snapshot, canonicalExportedAt);
  return {
    schema: JOURNEY_BACKUP_SCHEMA,
    version: JOURNEY_BACKUP_VERSION,
    exportedAt: canonicalExportedAt,
    timeZone: JOURNEY_TIME_ZONE,
    snapshots,
  };
}

function strictConditionEntries(value) {
  if (!Array.isArray(value) || value.length > 100) throw new TypeError("Journey 질환 항목 구조가 유효하지 않습니다.");
  const seen = new Set();
  return value.map((item) => {
    assertExactKeys(item, ["id", "provenanceKind"], "Journey 질환 항목");
    if (!CONDITIONS[item.id] || seen.has(item.id) || !CONDITION_PROVENANCE_KINDS.has(item.provenanceKind)) {
      throw new TypeError("Journey 질환 항목이 지원 범위와 일치하지 않습니다.");
    }
    seen.add(item.id);
    return { id: item.id, provenanceKind: "unverified-import" };
  });
}

function strictSignals(value) {
  if (!Array.isArray(value) || value.length > 100) throw new TypeError("Journey 패턴 신호 구조가 유효하지 않습니다.");
  const seen = new Set();
  return value.map((item) => {
    assertExactKeys(item, ["id", "kind", "key", "label", "value", "unit", "evidenceText", "provenanceKind"], "Journey 패턴 신호");
    const normalized = normalizeSignal(item);
    if (!normalized
      || seen.has(normalized.id)
      || normalized.kind !== item.kind
      || normalized.key !== item.key
      || normalized.label !== item.label
      || normalized.value !== item.value
      || normalized.unit !== item.unit
      || normalized.evidenceText !== item.evidenceText
      || normalized.provenanceKind !== item.provenanceKind) {
      throw new TypeError("Journey 패턴 신호가 지원 범위와 일치하지 않습니다.");
    }
    seen.add(normalized.id);
    return normalized;
  });
}

function strictMeasurements(value) {
  if (!Array.isArray(value) || value.length > 100) throw new TypeError("Journey 측정 항목 구조가 유효하지 않습니다.");
  const seen = new Set();
  return value.map((item) => {
    assertExactKeys(item, ["key", "code", "label", "value", "unit", "observedAt", "provenanceKind"], "Journey 측정 항목");
    const normalized = normalizeMeasurement(item, "unverified-import");
    if (!normalized
      || seen.has(normalized.key)
      || normalized.code !== item.code
      || normalized.label !== item.label
      || normalized.unit !== item.unit
      || normalized.value !== item.value
      || normalized.observedAt !== item.observedAt
      || normalized.provenanceKind !== item.provenanceKind) {
      throw new TypeError("Journey 측정 항목이 허용된 코드·값·단위와 일치하지 않습니다.");
    }
    seen.add(normalized.key);
    return { ...normalized, provenanceKind: "unverified-import" };
  });
}

function strictSnapshot(value, exportedAt) {
  assertExactKeys(value, [
    "id", "date", "observedAt", "timeZone", "conditionEntries", "signals", "measurements", "createdAt",
  ], "Journey 기록");
  if (!validIdentifier(value.id) || !isValidDate(value.date) || value.timeZone !== JOURNEY_TIME_ZONE) {
    throw new TypeError("Journey 기록 ID·날짜·시간대가 유효하지 않습니다.");
  }
  const observedAt = value.observedAt === "" ? "" : canonicalInstant(value.observedAt, "Journey 관찰 시각");
  const createdAt = canonicalInstant(value.createdAt, "Journey 저장 시각");
  if (observedAt !== value.observedAt || createdAt !== value.createdAt) {
    throw new TypeError("Journey 시각은 표준 ISO-8601 형식이어야 합니다.");
  }
  if ((observedAt && dateInSeoul(new Date(observedAt)) !== value.date)
    || value.date > dateInSeoul(new Date(exportedAt))
    || observedAt > exportedAt
    || createdAt > exportedAt) {
    throw new TypeError("Journey 기록 날짜·시각이 내보내기 범위와 일치하지 않습니다.");
  }
  const conditionEntries = strictConditionEntries(value.conditionEntries);
  const signals = strictSignals(value.signals);
  const measurements = strictMeasurements(value.measurements);
  const sourceInfo = { ...SOURCE_INFO.imported };
  return {
    id: value.id,
    date: value.date,
    observedAt,
    timeZone: JOURNEY_TIME_ZONE,
    conditionIds: conditionEntries.map(({ id }) => id),
    conditionEntries,
    signals,
    measurements,
    sourceInfo,
    source: sourceInfo.label,
    createdAt,
  };
}

export function parseJourneyBackup(value) {
  assertExactKeys(value, ["schema", "version", "exportedAt", "timeZone", "snapshots"], "Journey 백업");
  if (value.schema !== JOURNEY_BACKUP_SCHEMA) {
    throw new TypeError("VitaGraph Journey 백업 파일이 아닙니다.");
  }
  if (value.version !== JOURNEY_BACKUP_VERSION) {
    throw new TypeError(`지원하지 않는 Journey 백업 버전입니다: ${String(value.version)}`);
  }
  if (!Array.isArray(value.snapshots)) {
    throw new TypeError("Journey 백업에 기록 목록이 없습니다.");
  }
  if (value.timeZone !== JOURNEY_TIME_ZONE || value.snapshots.length > 1_000) {
    throw new TypeError("Journey 백업 시간대 또는 기록 수가 지원 범위를 넘었습니다.");
  }
  const exportedAt = canonicalInstant(value.exportedAt, "Journey 백업 내보내기 시각");
  if (exportedAt !== value.exportedAt) throw new TypeError("Journey 백업 내보내기 시각은 표준 ISO-8601 형식이어야 합니다.");
  if (new Date(exportedAt).valueOf() > Date.now() + MAX_FUTURE_CLOCK_SKEW_MS) {
    throw new TypeError("Journey 백업 내보내기 시각이 미래입니다.");
  }
  const ids = new Set();
  return value.snapshots.map((snapshot) => {
    const parsed = strictSnapshot(snapshot, exportedAt);
    if (ids.has(parsed.id)) throw new TypeError("Journey 백업에 중복된 기록 ID가 있습니다.");
    ids.add(parsed.id);
    return parsed;
  }).sort((left, right) => left.date.localeCompare(right.date));
}
