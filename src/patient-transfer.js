import {
  CLINICAL_OBSERVATION_SPECS,
  isCanonicalClinicalObservation,
  LOINC_SYSTEM,
  normalizeClinicalObservationValue,
} from "./clinical-observations.js";

export const PATIENT_TRANSFER_SCHEMA = "vitagraph-patient-transfer";
export const PATIENT_TRANSFER_VERSION = 1;

const TRANSFER_SCOPE = "patient-vita-graph";
const TRANSFER_TRUST = "unsigned-local-export";
const KCD_SYSTEM = "urn:kr:kcd";
const MAX_TRANSFER_BYTES = 2 * 1024 * 1024;
const MAX_TRANSFER_FACTS = 1_000;
const CONDITION_STATUSES = new Set(["active", "recurrence", "relapse"]);
const OBSERVATION_STATUSES = new Set(["final", "amended", "corrected"]);
const OBSERVATION_SELECTION_RANK = { final: 1, amended: 2, corrected: 3 };
const TRANSFER_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TRANSFER_CODE_PATTERN = /^VG-[0-9A-HJKMNP-TV-Z]{5}(?:-[0-9A-HJKMNP-TV-Z]{5}){3}-[0-9A-HJKMNP-TV-Z]{6}$/;
const KOREA_TIMEZONE_OFFSET_MILLISECONDS = 9 * 60 * 60 * 1_000;

const conditionSpecs = [
  { id: "hypertension", label: "고혈압", codeRule: /^I10(?:\..+)?$/i },
  { id: "diabetes", label: "당뇨병", codeRule: /^E1[0-4](?:\..+)?$/i },
  { id: "dyslipidemia", label: "이상지질혈증", codeRule: /^E78(?:\..+)?$/i },
  { id: "migraine", label: "편두통", codeRule: /^G43(?:\..+)?$/i },
  { id: "reflux", label: "위식도역류", codeRule: /^K21(?:\..+)?$/i },
  { id: "asthma", label: "천식", codeRule: /^J45(?:\..+)?$/i },
  { id: "mood", label: "우울·불안", codeRule: /^F(?:3[2-4]|4[0-1])(?:\..+)?$/i },
  { id: "arthritis", label: "관절염", codeRule: /^M(?:0[5-6]|1[5-9])(?:\..+)?$/i },
];

const conditionById = new Map(conditionSpecs.map((spec) => [spec.id, spec]));
const measurementByCode = new Map(CLINICAL_OBSERVATION_SPECS
  .filter(({ patientTransferKey }) => patientTransferKey)
  .map((spec) => [spec.code, { ...spec, key: spec.patientTransferKey }]));
const measurementByKey = new Map([...measurementByCode.entries()].map(([code, spec]) => [spec.key, { ...spec, code }]));

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) throw new TypeError(`${label} 구조가 유효하지 않습니다.`);
}

function assertExactKeys(value, keys, label) {
  assertPlainObject(value, label);
  const expected = new Set(keys);
  const actual = Object.keys(value);
  if (actual.length !== expected.size || actual.some((key) => !expected.has(key))) {
    throw new TypeError(`${label}에 허용되지 않은 필드가 있습니다.`);
  }
}

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function canonicalInstant(value, label = "내보내기 시각") {
  const parsed = value === undefined ? new Date() : new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new TypeError(`${label}이 유효하지 않습니다.`);
  return parsed.toISOString();
}

function koreanCalendarDate(instant) {
  return new Date(new Date(instant).valueOf() + KOREA_TIMEZONE_OFFSET_MILLISECONDS).toISOString().slice(0, 10);
}

function assertCanonicalInstant(value) {
  if (typeof value !== "string" || canonicalInstant(value) !== value) {
    throw new TypeError("환자 전달 파일의 내보내기 시각이 유효하지 않습니다.");
  }
}

function assertTransferCode(value) {
  if (typeof value !== "string" || !TRANSFER_CODE_PATTERN.test(value)) {
    throw new TypeError("환자 전달 확인 코드가 유효하지 않습니다.");
  }
  return value;
}

function randomTransferCode() {
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new Error("안전한 환자 전달 확인 코드를 만들 수 없습니다.");
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  let buffer = 0;
  let bits = 0;
  let encoded = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += TRANSFER_CODE_ALPHABET[(buffer >>> bits) & 31];
      buffer &= (1 << bits) - 1;
    }
  }
  if (bits > 0) encoded += TRANSFER_CODE_ALPHABET[(buffer << (5 - bits)) & 31];
  return `VG-${encoded.slice(0, 5)}-${encoded.slice(5, 10)}-${encoded.slice(10, 15)}-${encoded.slice(15, 20)}-${encoded.slice(20)}`;
}

function cleanString(value, maximum) {
  if (typeof value !== "string") return "";
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  return cleaned.length <= maximum ? cleaned : "";
}

function assertString(value, maximum, label) {
  const cleaned = cleanString(value, maximum);
  if (!cleaned || cleaned !== value) throw new TypeError(`${label}이 유효하지 않습니다.`);
  return cleaned;
}

function eventDate(event) {
  for (const value of [event?.date, event?.observedAt, event?.recordedAt]) {
    if (isValidDate(value)) return value;
    if (typeof value === "string" && value) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString().slice(0, 10);
    }
  }
  return "";
}

function eventOccurrenceInstant(event) {
  for (const value of [event?.observedAt, event?.recordedAt]) {
    if (typeof value !== "string" || !value) continue;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString();
  }
  const date = eventDate(event);
  return date ? `${date}T00:00:00.000Z` : "";
}

function finalRecord(event) {
  return event?.recordStatus === "final" && ["manual", "encounter"].includes(event?.source?.kind);
}

function eligibleEncounter(event) {
  return event?.type === "encounter"
    && finalRecord(event)
    && event.status === "finished"
    && event.signature?.status === "signed"
    && Boolean(event.signature.signer)
    && Boolean(event.signature.signedAt);
}

function belongsToEligibleEncounter(event, encounterById) {
  if (!event?.encounterId) return event?.source?.kind === "manual";
  return event?.source?.kind === "encounter" && eligibleEncounter(encounterById.get(event.encounterId));
}

function conditionSpecFor(event) {
  if (event?.system !== KCD_SYSTEM || typeof event?.code !== "string") return null;
  return conditionSpecs.find(({ codeRule }) => codeRule.test(event.code.trim())) ?? null;
}

function eligibleCondition(event, encounterById) {
  const verification = event?.verificationStatus ?? event?.certainty;
  return event?.type === "condition"
    && finalRecord(event)
    && CONDITION_STATUSES.has(event.status)
    && verification === "confirmed"
    && Boolean(eventDate(event))
    && belongsToEligibleEncounter(event, encounterById);
}

function eligibleObservation(event, encounterById) {
  return event?.type === "observation"
    && finalRecord(event)
    && OBSERVATION_STATUSES.has(event.status)
    && Boolean(eventDate(event))
    && belongsToEligibleEncounter(event, encounterById);
}

function normalizedMeasurementValue(value, spec) {
  try {
    return normalizeClinicalObservationValue(value, spec);
  } catch {
    return null;
  }
}

function transferMeasurement(event, spec, code = event.code) {
  if (event.system !== LOINC_SYSTEM || !isCanonicalClinicalObservation(event)) return null;
  const value = normalizedMeasurementValue(event.value, spec);
  if (value === null) return null;
  return {
    key: spec.key,
    code,
    label: spec.label,
    value,
    unit: spec.unit,
    observedOn: eventDate(event),
    observedAt: eventOccurrenceInstant(event),
    basis: "final-observation",
    selectionRank: OBSERVATION_SELECTION_RANK[event.status] ?? 0,
  };
}

function latestByKey(items, keyOf, dateOf, rankOf = () => 0) {
  const latest = new Map();
  for (const item of items) {
    const key = keyOf(item);
    const current = latest.get(key);
    if (!current || dateOf(item) > dateOf(current) || (dateOf(item) === dateOf(current) && rankOf(item) > rankOf(current))) {
      latest.set(key, item);
    }
  }
  return [...latest.values()].sort((left, right) => keyOf(left).localeCompare(keyOf(right)));
}

function selectedHealthMap(patient, exportedAt) {
  if (!isPlainObject(patient)) throw new TypeError("내보낼 환자 기록이 유효하지 않습니다.");
  const exportedOn = koreanCalendarDate(exportedAt);
  const events = Array.isArray(patient.events) ? patient.events.filter(isPlainObject) : [];
  const encounterById = new Map(events.filter(({ type, id }) => type === "encounter" && typeof id === "string").map((event) => [event.id, event]));

  const conditionCandidates = [];
  const measurementCandidates = [];

  for (const event of events) {
    if (eligibleCondition(event, encounterById)) {
      const spec = conditionSpecFor(event);
      if (spec) {
        if (eventDate(event) > exportedOn) throw new TypeError("내보내기 시각보다 미래인 확정 진단 기록이 있습니다.");
        conditionCandidates.push({
          id: spec.id,
          label: spec.label,
          recordedOn: eventDate(event),
          basis: "confirmed-condition",
        });
      }
      continue;
    }
    if (!eligibleObservation(event, encounterById)) continue;
    const spec = measurementByCode.get(event.code);
    if (spec) {
      const measurement = transferMeasurement(event, spec);
      if (measurement) {
        const hasExactOccurrence = typeof event.observedAt === "string" || typeof event.recordedAt === "string";
        if ((hasExactOccurrence && measurement.observedAt > exportedAt) || (!hasExactOccurrence && measurement.observedOn > exportedOn)) {
          throw new TypeError("내보내기 시각보다 미래인 최종 측정 기록이 있습니다.");
        }
        measurementCandidates.push(measurement);
      }
    }
  }

  return {
    conditions: latestByKey(conditionCandidates, ({ id }) => id, ({ recordedOn }) => recordedOn),
    measurements: latestByKey(
      measurementCandidates,
      ({ key }) => key,
      ({ observedAt }) => observedAt,
      ({ selectionRank }) => selectionRank,
    ).map(({ selectionRank: _selectionRank, observedAt: _observedAt, ...measurement }) => measurement),
  };
}

export function createPatientTransferPackage(patient, exportedAt, transferCode = randomTransferCode()) {
  const instant = canonicalInstant(exportedAt);
  const { conditions, measurements } = selectedHealthMap(patient, instant);
  if (conditions.length + measurements.length === 0) {
    throw new TypeError("환자용 VitaGraph에 내보낼 최종·확정 지원 기록이 없습니다.");
  }
  return {
    schema: PATIENT_TRANSFER_SCHEMA,
    version: PATIENT_TRANSFER_VERSION,
    exportedAt: instant,
    transferCode: assertTransferCode(transferCode),
    scope: TRANSFER_SCOPE,
    trust: TRANSFER_TRUST,
    healthMap: { conditions, measurements },
    summary: {
      includedConditions: conditions.length,
      includedMeasurements: measurements.length,
    },
  };
}

function serializedByteLength(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    throw new TypeError("환자 전달 파일을 읽을 수 없습니다.");
  }
}

function parseCondition(item, seen) {
  assertExactKeys(item, ["id", "label", "recordedOn", "basis"], "진단 항목");
  const spec = conditionById.get(item.id);
  if (!spec || item.label !== spec.label || item.basis !== "confirmed-condition" || !isValidDate(item.recordedOn)) {
    throw new TypeError("환자 전달 파일의 진단 항목이 유효하지 않습니다.");
  }
  if (seen.has(item.id)) throw new TypeError("환자 전달 파일에 중복 진단 항목이 있습니다.");
  seen.add(item.id);
  return { id: item.id, recordedAt: item.recordedOn, sourceLabel: item.label };
}

function parseMeasurement(item, seen) {
  assertExactKeys(item, ["key", "code", "label", "value", "unit", "observedOn", "basis"], "측정 항목");
  const spec = measurementByKey.get(item.key);
  if (!spec || item.code !== spec.code || item.label !== spec.label || item.basis !== "final-observation" || !isValidDate(item.observedOn)) {
    throw new TypeError("환자 전달 파일의 측정 항목이 유효하지 않습니다.");
  }
  if (seen.has(item.key)) throw new TypeError("환자 전달 파일에 중복 측정 항목이 있습니다.");
  seen.add(item.key);
  const value = normalizedMeasurementValue(item.value, spec);
  if (value === null || value !== item.value) throw new TypeError("환자 전달 파일의 측정값이 유효하지 않습니다.");
  const unit = assertString(item.unit, 32, "측정 단위");
  if (unit !== spec.unit) throw new TypeError("환자 전달 파일의 측정 단위가 유효하지 않습니다.");
  return { key: item.key, code: item.code, label: item.label, value, unit, observedAt: item.observedOn };
}

export function parsePatientTransferPackage(value) {
  if (serializedByteLength(value) > MAX_TRANSFER_BYTES) {
    throw new RangeError("2MB 이하의 환자용 VitaGraph JSON 파일만 가져올 수 있습니다.");
  }
  assertExactKeys(value, ["schema", "version", "exportedAt", "transferCode", "scope", "trust", "healthMap", "summary"], "환자 전달 파일");
  if (value.schema !== PATIENT_TRANSFER_SCHEMA) throw new TypeError("VitaGraph 환자 전달 파일이 아닙니다.");
  if (value.version !== PATIENT_TRANSFER_VERSION) throw new TypeError(`지원하지 않는 환자 전달 파일 버전입니다: ${String(value.version)}`);
  if (value.scope !== TRANSFER_SCOPE || value.trust !== TRANSFER_TRUST) {
    throw new TypeError("환자 전달 파일의 사용 범위 또는 신뢰 표시가 유효하지 않습니다.");
  }
  assertCanonicalInstant(value.exportedAt);
  const transferCode = assertTransferCode(value.transferCode);
  assertExactKeys(value.healthMap, ["conditions", "measurements"], "건강 지도");
  if (!Array.isArray(value.healthMap.conditions) || !Array.isArray(value.healthMap.measurements)) {
    throw new TypeError("환자 전달 파일에 건강 지도 항목 목록이 없습니다.");
  }
  const totalFacts = value.healthMap.conditions.length + value.healthMap.measurements.length;
  if (totalFacts === 0) throw new TypeError("환자 전달 파일에 연결할 건강 정보가 없습니다.");
  if (totalFacts > MAX_TRANSFER_FACTS) throw new RangeError("한 번에 가져올 수 있는 환자 건강 항목은 1,000개입니다.");

  const conditionIds = new Set();
  const measurementKeys = new Set();
  const conditions = value.healthMap.conditions.map((item) => parseCondition(item, conditionIds));
  const measurements = value.healthMap.measurements.map((item) => parseMeasurement(item, measurementKeys));

  const exportedOn = koreanCalendarDate(value.exportedAt);
  if (conditions.some(({ recordedAt }) => recordedAt > exportedOn) || measurements.some(({ observedAt }) => observedAt > exportedOn)) {
    throw new TypeError("환자 전달 파일에 내보내기 시각보다 미래인 건강 정보가 있습니다.");
  }

  assertExactKeys(value.summary, ["includedConditions", "includedMeasurements"], "전달 요약");
  const summaryValues = [value.summary.includedConditions, value.summary.includedMeasurements];
  if (!summaryValues.every((item) => Number.isSafeInteger(item) && item >= 0)
    || value.summary.includedConditions !== conditions.length
    || value.summary.includedMeasurements !== measurements.length) {
    throw new TypeError("환자 전달 파일의 항목 요약이 실제 내용과 일치하지 않습니다.");
  }

  const latestDate = [...conditions.map(({ recordedAt }) => recordedAt), ...measurements.map(({ observedAt }) => observedAt)]
    .sort()
    .at(-1) ?? value.exportedAt;
  return {
    conditionIds: [...conditionIds],
    conditions,
    measurements,
    observedAt: latestDate,
    provenance: {
      format: "VitaGraph 환자 전달 JSON",
      supported: totalFacts,
      unsupported: 0,
      total: totalFacts,
      trust: TRANSFER_TRUST,
      exportedAt: value.exportedAt,
      transferCode,
    },
  };
}

export function patientTransferFilename(exportedAt) {
  const instant = canonicalInstant(exportedAt);
  return `vitagraph-patient-transfer-${koreanCalendarDate(instant)}.json`;
}
