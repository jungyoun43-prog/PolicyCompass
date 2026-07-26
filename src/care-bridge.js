import {
  createPatientHealthMap,
  koreanCalendarDate,
} from "./patient-transfer.js";
import {
  clinicalObservationSpec,
  normalizeClinicalObservationValue,
} from "./clinical-observations.js";

export const CARE_BRIDGE_STORAGE_KEY = "vitagraph-care-bridge-v1";
export const CARE_BRIDGE_SCHEMA = "vitagraph-care-bridge";
export const CARE_BRIDGE_VERSION = 1;
export const CLINICAL_SNAPSHOT_SCHEMA = "vitagraph-clinical-snapshot";
export const PATIENT_BRIEF_SCHEMA = "vitagraph-patient-brief";

const BRIDGE_EVENT = "vitagraph:care-bridge";
const BRIDGE_CHANNEL = "vitagraph-care-bridge";
const MAX_BRIDGE_BYTES = 256 * 1024;
const MAX_MEDICATIONS = 100;
const MAX_CONDITIONS = 100;
const MAX_MEASUREMENTS = 100;
const CHANNEL_ID_PATTERN = /^[A-Za-z0-9-]{16,80}$/;
const SAFE_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;
const DIRECT_IDENTIFIER_PATTERNS = [
  /\b\d{6}\s*[- ]?\s*[1-8]\d{6}\b/,
  /\b01[016789]\s*[-. ]?\s*\d{3,4}\s*[-. ]?\s*\d{4}\b/,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b(?:MRN|차트|등록번호|환자번호)\s*[:#-]?\s*[A-Z0-9-]{3,}\b/i,
];

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cleanText(value, maximum = 240) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function assertExactKeys(value, keys, label) {
  if (!isPlainObject(value)) throw new TypeError(`${label} 구조가 유효하지 않습니다.`);
  const expected = new Set(keys);
  const actual = Object.keys(value);
  if (actual.length !== expected.size || actual.some((key) => !expected.has(key))) {
    throw new TypeError(`${label}에 허용되지 않은 필드가 있습니다.`);
  }
}

function canonicalText(value, maximum, label, { code = false } = {}) {
  const text = cleanText(value, maximum);
  if (!text || text !== value || DIRECT_IDENTIFIER_PATTERNS.some((pattern) => pattern.test(text))) {
    throw new TypeError(`${label}이 유효하지 않습니다.`);
  }
  if (code && !SAFE_CODE_PATTERN.test(text)) throw new TypeError(`${label} 코드가 유효하지 않습니다.`);
  return text;
}

function canonicalDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(`${label} 날짜가 유효하지 않습니다.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new TypeError(`${label} 날짜가 유효하지 않습니다.`);
  }
  return value;
}

function boundedNumber(value, minimum, maximum, label, { integer = false } = {}) {
  if (!Number.isFinite(value)
    || value < minimum
    || value > maximum
    || (integer && !Number.isSafeInteger(value))) {
    throw new TypeError(`${label} 값이 유효하지 않습니다.`);
  }
  return value;
}

function redactKnownText(value, blockedValues, maximum) {
  let cleaned = cleanText(value, maximum);
  for (const blocked of blockedValues) {
    if (!blocked) continue;
    cleaned = cleaned.replaceAll(blocked, "").replace(/\s{2,}/g, " ").trim();
  }
  return cleaned;
}

function canonicalInstant(value = new Date()) {
  const instant = new Date(value);
  if (Number.isNaN(instant.valueOf())) throw new TypeError("정제 데이터 시각이 유효하지 않습니다.");
  return instant.toISOString();
}

function eventDate(event) {
  for (const value of [event?.date, event?.observedAt, event?.recordedAt]) {
    if (typeof value !== "string" || !value) continue;
    const instant = new Date(value);
    if (!Number.isNaN(instant.valueOf())) return instant.toISOString().slice(0, 10);
  }
  return "";
}

function signedEncounter(event) {
  return event?.type === "encounter"
    && event?.recordStatus === "final"
    && event?.status === "finished"
    && event?.signature?.status === "signed"
    && Boolean(cleanText(event?.signature?.signer, 120))
    && Boolean(event?.signature?.signedAt);
}

function normalizedMedication(event, encounters, preparedOn, blockedValues) {
  if (event?.type !== "medication"
    || event?.recordStatus !== "final"
    || event?.status !== "active"
    || event?.source?.kind !== "encounter"
    || !signedEncounter(encounters.get(event?.encounterId))) {
    return null;
  }
  const prescribedOn = eventDate(event);
  const prescription = event?.prescription;
  const label = redactKnownText(event?.label, blockedValues, 160);
  const system = redactKnownText(event?.system, blockedValues, 160);
  const code = redactKnownText(event?.code, blockedValues, 120);
  const doseUnit = redactKnownText(prescription?.doseUnit, blockedValues, 40);
  const route = redactKnownText(prescription?.route, blockedValues, 80);
  const frequency = redactKnownText(prescription?.frequency, blockedValues, 120);
  if (!label || !system || !code || !prescribedOn || prescribedOn > preparedOn
    || !(prescription?.dose > 0) || !doseUnit || !route || !frequency
    || !Number.isSafeInteger(prescription?.durationDays) || prescription.durationDays < 1
    || !(prescription?.quantity > 0)) {
    return null;
  }
  return {
    system,
    code,
    label,
    prescribedOn,
    dose: prescription.dose,
    doseUnit,
    route,
    frequency,
    durationDays: prescription.durationDays,
    quantity: prescription.quantity,
    basis: "signed-prescription",
  };
}

function selectedMedications(patient, preparedAt) {
  const events = Array.isArray(patient?.events) ? patient.events : [];
  const encounters = new Map(events
    .filter(({ type, id }) => type === "encounter" && typeof id === "string")
    .map((event) => [event.id, event]));
  const preparedOn = koreanCalendarDate(preparedAt);
  const blockedValues = [
    cleanText(patient?.name, 160),
    cleanText(patient?.mrn, 80),
    cleanText(patient?.phone, 80),
    cleanText(patient?.birthDate, 32),
    cleanText(patient?.address, 240),
    cleanText(patient?.emergencyContact?.name, 160),
    cleanText(patient?.emergencyContact?.phone, 80),
  ].filter((value) => value.length >= 2);
  const latest = new Map();
  for (const event of events) {
    const medication = normalizedMedication(event, encounters, preparedOn, blockedValues);
    if (!medication) continue;
    const key = `${medication.system}|${medication.code}`;
    const current = latest.get(key);
    if (!current || medication.prescribedOn >= current.prescribedOn) latest.set(key, medication);
  }
  return [...latest.values()]
    .sort((left, right) => right.prescribedOn.localeCompare(left.prescribedOn) || left.label.localeCompare(right.label))
    .slice(0, MAX_MEDICATIONS);
}

export function createClinicalSnapshot(patient, preparedAt = new Date()) {
  const instant = canonicalInstant(preparedAt);
  const healthMap = createPatientHealthMap(patient, instant);
  const medications = selectedMedications(patient, instant);
  return {
    schema: CLINICAL_SNAPSHOT_SCHEMA,
    version: 1,
    preparedAt: instant,
    source: "finalized-clinical-record",
    healthMap,
    medications,
    summary: {
      includedConditions: healthMap.conditions.length,
      includedMeasurements: healthMap.measurements.length,
      includedMedications: medications.length,
    },
  };
}

function normalizeCondition(item) {
  assertExactKeys(item, ["id", "label", "recordedOn", "basis"], "정제 질환");
  if (item.basis !== "confirmed-condition") throw new TypeError("정제 질환 근거가 유효하지 않습니다.");
  return {
    id: canonicalText(item.id, 80, "정제 질환 ID", { code: true }),
    label: canonicalText(item.label, 160, "정제 질환명"),
    recordedOn: canonicalDate(item.recordedOn, "정제 질환"),
    basis: "confirmed-condition",
  };
}

function normalizeMeasurement(item) {
  assertExactKeys(item, ["key", "code", "label", "value", "unit", "observedOn", "basis"], "정제 측정");
  if (item.basis !== "final-observation") throw new TypeError("정제 측정 근거가 유효하지 않습니다.");
  const spec = clinicalObservationSpec(item.code);
  if (!spec?.patientTransferKey || spec.patientTransferKey !== item.key) {
    throw new TypeError("정제 측정 코드가 지원 범위와 일치하지 않습니다.");
  }
  const value = normalizeClinicalObservationValue(item.value, spec);
  if (value !== item.value || item.label !== spec.label || item.unit !== spec.unit) {
    throw new TypeError("정제 측정 값 또는 단위가 표준 형식과 일치하지 않습니다.");
  }
  return {
    key: canonicalText(item.key, 80, "정제 측정 키", { code: true }),
    code: canonicalText(item.code, 120, "정제 측정 코드", { code: true }),
    label: canonicalText(item.label, 160, "정제 측정명"),
    value,
    unit: canonicalText(item.unit, 40, "정제 측정 단위"),
    observedOn: canonicalDate(item.observedOn, "정제 측정"),
    basis: "final-observation",
  };
}

function normalizeMedication(item) {
  assertExactKeys(item, [
    "system", "code", "label", "prescribedOn", "dose", "doseUnit", "route",
    "frequency", "durationDays", "quantity", "basis",
  ], "정제 처방");
  if (item.basis !== "signed-prescription") throw new TypeError("정제 처방 근거가 유효하지 않습니다.");
  return {
    system: canonicalText(item.system, 160, "정제 처방 코드체계", { code: true }),
    code: canonicalText(item.code, 120, "정제 처방 코드", { code: true }),
    label: canonicalText(item.label, 160, "정제 처방명"),
    prescribedOn: canonicalDate(item.prescribedOn, "정제 처방"),
    dose: boundedNumber(item.dose, Number.MIN_VALUE, 100_000, "정제 처방 용량"),
    doseUnit: canonicalText(item.doseUnit, 40, "정제 처방 단위"),
    route: canonicalText(item.route, 80, "정제 처방 경로"),
    frequency: canonicalText(item.frequency, 120, "정제 처방 빈도"),
    durationDays: boundedNumber(item.durationDays, 1, 3_650, "정제 처방 기간", { integer: true }),
    quantity: boundedNumber(item.quantity, Number.MIN_VALUE, 1_000_000, "정제 처방 수량"),
    basis: "signed-prescription",
  };
}

function normalizeClinicalSnapshot(snapshot) {
  assertExactKeys(snapshot, ["schema", "version", "preparedAt", "source", "healthMap", "medications", "summary"], "정제 임상 스냅샷");
  if (snapshot.schema !== CLINICAL_SNAPSHOT_SCHEMA
    || snapshot.version !== 1
    || snapshot.source !== "finalized-clinical-record") {
    throw new TypeError("정제 임상 스냅샷 표식이 유효하지 않습니다.");
  }
  assertExactKeys(snapshot.healthMap, ["conditions", "measurements"], "정제 건강 지도");
  if (!Array.isArray(snapshot.healthMap.conditions)
    || snapshot.healthMap.conditions.length > MAX_CONDITIONS
    || !Array.isArray(snapshot.healthMap.measurements)
    || snapshot.healthMap.measurements.length > MAX_MEASUREMENTS
    || !Array.isArray(snapshot.medications)
    || snapshot.medications.length > MAX_MEDICATIONS) {
    throw new TypeError("정제 임상 항목 수가 유효하지 않습니다.");
  }
  const conditions = snapshot.healthMap.conditions.map(normalizeCondition);
  const measurements = snapshot.healthMap.measurements.map(normalizeMeasurement);
  const medications = snapshot.medications.map(normalizeMedication);
  assertExactKeys(snapshot.summary, ["includedConditions", "includedMeasurements", "includedMedications"], "정제 임상 요약");
  if (snapshot.summary.includedConditions !== conditions.length
    || snapshot.summary.includedMeasurements !== measurements.length
    || snapshot.summary.includedMedications !== medications.length) {
    throw new TypeError("정제 임상 요약이 실제 항목과 일치하지 않습니다.");
  }
  return {
    schema: CLINICAL_SNAPSHOT_SCHEMA,
    version: 1,
    preparedAt: canonicalInstant(snapshot.preparedAt),
    source: "finalized-clinical-record",
    healthMap: { conditions, measurements },
    medications,
    summary: {
      includedConditions: conditions.length,
      includedMeasurements: measurements.length,
      includedMedications: medications.length,
    },
  };
}

function normalizeQuestion(question) {
  if (typeof question === "string") {
    const text = cleanText(question, 400);
    if (!text) return null;
    if (DIRECT_IDENTIFIER_PATTERNS.some((pattern) => pattern.test(text))) {
      throw new TypeError("공유 질문에 직접식별정보 형식이 포함되어 있습니다.");
    }
    return { question: text, basis: "" };
  }
  if (!isPlainObject(question)) return null;
  const text = cleanText(question.question, 400);
  if (!text) return null;
  const basis = cleanText(question.basis, 500);
  if ([text, basis].some((value) => DIRECT_IDENTIFIER_PATTERNS.some((pattern) => pattern.test(value)))) {
    throw new TypeError("공유 질문에 직접식별정보 형식이 포함되어 있습니다.");
  }
  return { question: text, basis };
}

export function createPatientBrief(input = {}, preparedAt = new Date()) {
  const brief = isPlainObject(input) ? input : {};
  const questions = (Array.isArray(brief.questions) ? brief.questions : [])
    .map(normalizeQuestion)
    .filter(Boolean)
    .slice(0, 5);
  const signals = (Array.isArray(brief.signals) ? brief.signals : [])
    .map((signal) => cleanText(signal, 300))
    .filter(Boolean)
    .slice(0, 8);
  const summary = cleanText(brief.summary, 1_000);
  if ([summary, ...signals].some((value) => DIRECT_IDENTIFIER_PATTERNS.some((pattern) => pattern.test(value)))) {
    throw new TypeError("공유 브리프에 직접식별정보 형식이 포함되어 있습니다.");
  }
  return {
    schema: PATIENT_BRIEF_SCHEMA,
    version: 1,
    preparedAt: canonicalInstant(preparedAt),
    source: ["rule-based", "local-model", "frontier-model"].includes(brief.source)
      ? brief.source
      : "rule-based",
    summary,
    signals,
    questions,
  };
}

function normalizeStrictPatientBrief(brief) {
  assertExactKeys(brief, ["schema", "version", "preparedAt", "source", "summary", "signals", "questions"], "환자 질문 브리프");
  if (brief.schema !== PATIENT_BRIEF_SCHEMA
    || brief.version !== 1
    || !["rule-based", "local-model", "frontier-model"].includes(brief.source)
    || !Array.isArray(brief.signals)
    || brief.signals.length > 8
    || !Array.isArray(brief.questions)
    || brief.questions.length > 5) {
    throw new TypeError("환자 질문 브리프 표식이 유효하지 않습니다.");
  }
  const summary = cleanText(brief.summary, 1_000);
  if (summary !== brief.summary) throw new TypeError("환자 질문 브리프 요약이 유효하지 않습니다.");
  const signals = brief.signals.map((signal) => canonicalText(signal, 300, "환자 공유 신호"));
  const questions = brief.questions.map((question) => {
    assertExactKeys(question, ["question", "basis"], "환자 공유 질문");
    const text = canonicalText(question.question, 400, "환자 공유 질문");
    const basis = cleanText(question.basis, 500);
    if (basis !== question.basis
      || DIRECT_IDENTIFIER_PATTERNS.some((pattern) => pattern.test(basis))) {
      throw new TypeError("환자 공유 질문 근거가 유효하지 않습니다.");
    }
    return { question: text, basis };
  });
  if (DIRECT_IDENTIFIER_PATTERNS.some((pattern) => pattern.test(summary))) {
    throw new TypeError("환자 질문 브리프에 직접식별정보 형식이 포함되어 있습니다.");
  }
  return {
    schema: PATIENT_BRIEF_SCHEMA,
    version: 1,
    preparedAt: canonicalInstant(brief.preparedAt),
    source: brief.source,
    summary,
    signals,
    questions,
  };
}

function randomChannelId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  throw new Error("안전한 진료 연결 채널을 만들 수 없습니다.");
}

function byteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
  );
}

export function clinicalSnapshotFingerprint(snapshot) {
  try {
    const normalized = normalizeClinicalSnapshot(snapshot);
    return JSON.stringify(stableValue({
      source: normalized.source,
      healthMap: normalized.healthMap,
      medications: normalized.medications,
    }));
  } catch {
    return "";
  }
}

function validSnapshot(snapshot) {
  try {
    normalizeClinicalSnapshot(snapshot);
    return true;
  } catch {
    return false;
  }
}

function validBrief(brief) {
  try {
    normalizeStrictPatientBrief(brief);
    return true;
  } catch {
    return false;
  }
}

export function parseCareBridge(value) {
  try {
    if (byteLength(value) > MAX_BRIDGE_BYTES) throw new TypeError("진료 연결 데이터가 너무 큽니다.");
    assertExactKeys(value, ["schema", "version", "channelId", "updatedAt", "clinical", "patient"], "진료 연결");
    if (value.schema !== CARE_BRIDGE_SCHEMA
      || value.version !== CARE_BRIDGE_VERSION
      || typeof value.channelId !== "string"
      || !CHANNEL_ID_PATTERN.test(value.channelId)) {
      throw new TypeError("진료 연결 표식이 유효하지 않습니다.");
    }
    assertExactKeys(value.clinical, ["publishedAt", "snapshot"], "임상 연결");
    const snapshot = normalizeClinicalSnapshot(value.clinical.snapshot);
    let patient = null;
    if (value.patient !== null) {
      assertExactKeys(value.patient, ["updatedAt", "basedOnClinicalFingerprint", "brief"], "환자 공유 연결");
      const fingerprint = clinicalSnapshotFingerprint(snapshot);
      if (value.patient.basedOnClinicalFingerprint !== fingerprint) {
        throw new TypeError("환자 질문 브리프의 임상 기준이 현재 연결과 일치하지 않습니다.");
      }
      patient = {
        updatedAt: canonicalInstant(value.patient.updatedAt),
        basedOnClinicalFingerprint: fingerprint,
        brief: normalizeStrictPatientBrief(value.patient.brief),
      };
    }
    return {
      schema: CARE_BRIDGE_SCHEMA,
      version: CARE_BRIDGE_VERSION,
      channelId: value.channelId,
      updatedAt: canonicalInstant(value.updatedAt),
      clinical: {
        publishedAt: canonicalInstant(value.clinical.publishedAt),
        snapshot,
      },
      patient,
    };
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError("진료 연결 데이터가 유효하지 않습니다.");
  }
}

export function readCareBridge(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(CARE_BRIDGE_STORAGE_KEY);
    return raw ? parseCareBridge(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function notifyBridge(state) {
  if (typeof globalThis.dispatchEvent === "function" && typeof globalThis.CustomEvent === "function") {
    globalThis.dispatchEvent(new CustomEvent(BRIDGE_EVENT, { detail: structuredClone(state) }));
  }
  if (typeof globalThis.BroadcastChannel === "function") {
    const channel = new BroadcastChannel(BRIDGE_CHANNEL);
    channel.postMessage({ type: "updated", channelId: state.channelId });
    channel.close();
  }
}

function writeCareBridge(state, storage = globalThis.localStorage) {
  const parsed = parseCareBridge(state);
  storage?.setItem(CARE_BRIDGE_STORAGE_KEY, JSON.stringify(parsed));
  notifyBridge(parsed);
  return parsed;
}

export function publishClinicalSnapshot(snapshot, options = {}) {
  const normalizedSnapshot = normalizeClinicalSnapshot(snapshot);
  const storage = options.storage ?? globalThis.localStorage;
  const previous = readCareBridge(storage);
  const rotateChannel = options.rotateChannel === true || !previous;
  const now = canonicalInstant(options.publishedAt ?? normalizedSnapshot.preparedAt);
  return writeCareBridge({
    schema: CARE_BRIDGE_SCHEMA,
    version: CARE_BRIDGE_VERSION,
    channelId: rotateChannel ? randomChannelId() : previous.channelId,
    updatedAt: now,
    clinical: {
      publishedAt: now,
      snapshot: normalizedSnapshot,
    },
    patient: rotateChannel ? null : previous.patient,
  }, storage);
}

export function publishPatientBrief(briefInput, options = {}) {
  const storage = options.storage ?? globalThis.localStorage;
  const previous = readCareBridge(storage);
  if (!previous) throw new TypeError("먼저 EMR에서 정제 기록을 연결해야 합니다.");
  if (typeof options.expectedChannelId === "string"
    && options.expectedChannelId !== previous.channelId) {
    throw new Error("연결된 환자 기록이 바뀌었습니다. 최신 기록에서 질문을 다시 확인해 주세요.");
  }
  if (typeof options.expectedClinicalFingerprint === "string"
    && options.expectedClinicalFingerprint !== clinicalSnapshotFingerprint(previous.clinical.snapshot)) {
    throw new Error("연결된 임상 기록이 갱신됐습니다. 최신 기록에서 질문을 다시 확인해 주세요.");
  }
  const brief = validBrief(briefInput)
    ? normalizeStrictPatientBrief(briefInput)
    : createPatientBrief(briefInput, options.preparedAt);
  const updatedAt = canonicalInstant(options.updatedAt ?? brief.preparedAt);
  const basedOnClinicalFingerprint = clinicalSnapshotFingerprint(previous.clinical.snapshot);
  return writeCareBridge({
    ...previous,
    updatedAt,
    patient: { updatedAt, basedOnClinicalFingerprint, brief },
  }, storage);
}

export function subscribeCareBridge(callback) {
  if (typeof callback !== "function") throw new TypeError("진료 연결 변경 콜백이 필요합니다.");
  const onCustom = (event) => callback(event?.detail ?? readCareBridge());
  const onStorage = (event) => {
    if (event.key === CARE_BRIDGE_STORAGE_KEY) callback(readCareBridge());
  };
  globalThis.addEventListener?.(BRIDGE_EVENT, onCustom);
  globalThis.addEventListener?.("storage", onStorage);
  const channel = typeof globalThis.BroadcastChannel === "function"
    ? new BroadcastChannel(BRIDGE_CHANNEL)
    : null;
  if (channel) channel.onmessage = () => callback(readCareBridge());
  return () => {
    globalThis.removeEventListener?.(BRIDGE_EVENT, onCustom);
    globalThis.removeEventListener?.("storage", onStorage);
    channel?.close();
  };
}

export function createPatientOwnedJson(snapshot, exportedAt = new Date()) {
  const normalizedSnapshot = normalizeClinicalSnapshot(snapshot);
  return {
    schema: "vitagraph-patient-owned-record",
    version: 1,
    exportedAt: canonicalInstant(exportedAt),
    scope: "patient-controlled-copy",
    clinical: normalizedSnapshot,
  };
}

export function patientOwnedJsonFilename(exportedAt = new Date()) {
  return `vitagraph-my-record-${canonicalInstant(exportedAt).slice(0, 10)}.json`;
}
