import { DEFAULT_CLAIM_RULES, evaluateClaimRule, KCD_SYSTEM, normalizeClaimRule } from "./claim-rules.js";
import { createVisitBrief } from "./insight-model.js";
import { clinicalObservationSpec, isCanonicalClinicalObservation, LOINC_SYSTEM } from "./clinical-observations.js";
import {
  createClinicalQuestionSuggestions,
  normalizeClinicalPatientBrief,
} from "./clinical-question-assistant.js";
import { CONDITIONS } from "./data.js";

export const EMR_SCHEMA = "vitagraph-emr";
export const EMR_BACKUP_SCHEMA = "vitagraph-emr-backup";
export const EMR_VERSION = 2;
export const EMR_STORAGE_KEY = "vitagraph-emr-v2";
export const LEGACY_EMR_STORAGE_KEY = "vitagraph-emr-v1";
export const KOREA_TIMEZONE_OFFSET_MINUTES = -540;

const EVENT_TYPES = new Set(["encounter", "condition", "observation", "medication", "allergy", "procedure", "service-request", "symptom", "note"]);
const RECORD_STATUSES = new Set(["draft", "final", "entered-in-error"]);
const ENCOUNTER_STATUSES = new Set(["arrived", "in-progress", "finished", "cancelled"]);
const DIAGNOSIS_ROLES = new Set(["primary", "secondary"]);
const DIAGNOSIS_CERTAINTIES = new Set(["confirmed", "provisional"]);
const ORDER_KINDS = new Set(["laboratory", "imaging", "procedure", "referral"]);
const ORDER_PRIORITIES = new Set(["routine", "urgent", "asap", "stat"]);
const DEFAULT_EVENT_STATUS = {
  encounter: "finished",
  condition: "active",
  observation: "final",
  medication: "active",
  allergy: "active",
  procedure: "completed",
  symptom: "active",
  note: "final",
};
const CANONICAL_EVENT_STATUSES = {
  encounter: new Set(["in-progress", "finished"]),
  condition: new Set(["active", "recurrence", "relapse"]),
  observation: new Set(["final", "amended", "corrected"]),
  medication: new Set(["active"]),
  allergy: new Set(["active"]),
  procedure: new Set(["completed"]),
  symptom: new Set(["active"]),
  note: new Set(["final"]),
};
const ORDER_INTENTS = new Set(["order", "original-order", "reflex-order", "filler-order", "instance-order"]);
const CLAIM_REVIEW_STAGES = new Set(["new", "evidence", "reviewing", "reviewed"]);
const CLAIM_REVIEW_STAGE_LABELS = {
  new: "검토 대기",
  evidence: "자료 확인",
  reviewing: "담당자 검토",
  reviewed: "최종 판정",
};
const CLAIM_REVIEW_OUTCOMES = new Set(["approved", "hold", "exception"]);
const CLAIM_EVALUATION_STATUSES = new Set(["missing-evidence", "due-soon", "ready", "waiting", "not-applicable", "unknown"]);
const PROFILE_CLAIM_WORKFLOW_STATUSES = new Set(["DRAFT", "PERFORMED", "CLAIMED", "SUBMITTED", "ADJUDICATED"]);
const PROFILE_CLAIM_PREFLIGHT_STATUSES = new Set(["GREEN", "YELLOW", "RED", "GRAY"]);
const CLAIM_REVIEW_HISTORY_LIMIT = 50;
const CLAIM_REVIEW_ACTION_PREFIX = "claim-review.stage.";
const PROFILE_CLAIM_SOURCE_ID_LIMIT = 241;
const CLAIM_REVIEW_RULE_ID_LIMIT = 260;
const CLAIM_REVIEW_EVALUATION_ID_LIMIT = 512;
const PROFILE_CLAIM_SOURCE_ID_PATTERN = new RegExp(`^[A-Za-z0-9][A-Za-z0-9._-]{0,${PROFILE_CLAIM_SOURCE_ID_LIMIT - 1}}$`);
const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight32(value, bits) {
  return (value >>> bits) | (value << (32 - bits));
}

export function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value));
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const data = new Uint8Array(paddedLength);
  data.set(bytes);
  data[bytes.length] = 0x80;
  const bitLength = BigInt(bytes.length) * 8n;
  for (let index = 0; index < 8; index += 1) {
    data[paddedLength - 1 - index] = Number((bitLength >> BigInt(index * 8)) & 0xffn);
  }
  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const cursor = offset + index * 4;
      words[index] = ((data[cursor] << 24) | (data[cursor + 1] << 16) | (data[cursor + 2] << 8) | data[cursor + 3]) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15];
      const right = words[index - 2];
      const sigma0 = rotateRight32(left, 7) ^ rotateRight32(left, 18) ^ (left >>> 3);
      const sigma1 = rotateRight32(right, 17) ^ rotateRight32(right, 19) ^ (right >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const upperSigma1 = rotateRight32(e, 6) ^ rotateRight32(e, 11) ^ rotateRight32(e, 25);
      const choice = (e & f) ^ (~e & g);
      const first = (h + upperSigma1 + choice + SHA256_CONSTANTS[index] + words[index]) >>> 0;
      const upperSigma0 = rotateRight32(a, 2) ^ rotateRight32(a, 13) ^ rotateRight32(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const second = (upperSigma0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + first) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (first + second) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }
  return [...hash].map((word) => word.toString(16).padStart(8, "0")).join("");
}

function cleanText(value, fallback = "", maxLength = 2_000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : fallback;
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value ? "" : value;
}

function validTimestamp(value, fallback = new Date().toISOString()) {
  if (typeof value !== "string") return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? fallback : parsed.toISOString();
}

function optionalTimestamp(value) {
  if (value === undefined || value === null || value === "") return "";
  return validTimestamp(value, "");
}

function boundedInteger(value, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : /^\d+$/.test(String(value).trim()) ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function positiveDecimal(value, { maximum = 100_000 } = {}) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(parsed) && parsed > 0 && parsed <= maximum ? parsed : null;
}

export function localCalendarDate(date = new Date(), timezoneOffsetMinutes = date.getTimezoneOffset()) {
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.valueOf())) return "";
  return new Date(parsed.valueOf() - timezoneOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

function uniqueId(prefix) {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

function normalizeSource(source) {
  const input = source && typeof source === "object" ? source : {};
  const normalized = {
    kind: ["manual", "fhir", "demo", "import", "copilot", "encounter"].includes(input.kind) ? input.kind : "manual",
    label: cleanText(input.label, "직접 입력", 160),
    resourceId: cleanText(input.resourceId, "", 200),
  };
  const metaSource = cleanText(input.metaSource, "", 200);
  return metaSource ? { ...normalized, metaSource } : normalized;
}

function normalizeSoap(input = {}) {
  const soap = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return {
    subjective: cleanText(soap.subjective, "", 8_000),
    objective: cleanText(soap.objective, "", 8_000),
    assessment: cleanText(soap.assessment, "", 8_000),
    plan: cleanText(soap.plan, "", 8_000),
  };
}

function normalizeSignature(input = {}) {
  const signature = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const status = ["unsigned", "signed", "legacy", "external"].includes(signature.status) ? signature.status : "unsigned";
  return {
    status,
    signer: cleanText(signature.signer, "", 120),
    signedAt: optionalTimestamp(signature.signedAt),
  };
}

function normalizePrescription(input = {}) {
  const prescription = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return {
    dose: positiveDecimal(prescription.dose),
    doseUnit: cleanText(prescription.doseUnit, "", 40),
    route: cleanText(prescription.route, "", 80),
    frequency: cleanText(prescription.frequency, "", 120),
    durationDays: boundedInteger(prescription.durationDays, { minimum: 1, maximum: 365 }),
    quantity: positiveDecimal(prescription.quantity),
    instructions: cleanText(prescription.instructions, "", 2_000),
  };
}

function normalizeOrder(input = {}) {
  const order = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return {
    kind: ORDER_KINDS.has(order.kind) ? order.kind : "laboratory",
    priority: ORDER_PRIORITIES.has(order.priority) ? order.priority : "routine",
    instructions: cleanText(order.instructions, "", 2_000),
  };
}

export function normalizePatientEvent(input = {}) {
  if (!input || typeof input !== "object") return null;
  const id = cleanText(input.id, "", 160);
  const type = cleanText(input.type, "", 40);
  const label = cleanText(input.label, "", 240);
  const occurrenceTimestamp = optionalTimestamp(input.recordedAt ?? input.observedAt);
  const date = validDate(input.date) || occurrenceTimestamp.slice(0, 10);
  if (!id || !EVENT_TYPES.has(type) || !label || !date) return null;
  const value = typeof input.value === "number" && Number.isFinite(input.value)
    ? input.value
    : cleanText(input.value, "", 500);
  const lifecycle = {};
  for (const field of ["clinicalStatus", "verificationStatus", "intent"]) {
    const normalized = cleanText(input[field], "", 80);
    if (normalized) lifecycle[field] = normalized;
  }
  const recordStatus = RECORD_STATUSES.has(input.recordStatus) ? input.recordStatus : "final";
  const event = {
    id,
    type,
    recordStatus,
    encounterId: cleanText(input.encounterId, "", 160),
    system: cleanText(input.system, "", 300),
    code: cleanText(input.code, "", 120),
    label,
    date,
    status: cleanText(input.status, DEFAULT_EVENT_STATUS[type], 80),
    value,
    unit: cleanText(input.unit, "", 80),
    note: cleanText(input.note, "", 4_000),
    source: normalizeSource(input.source),
    ...lifecycle,
  };
  if (type === "encounter") {
    event.status = ENCOUNTER_STATUSES.has(input.status) ? input.status : DEFAULT_EVENT_STATUS.encounter;
    event.arrivedAt = optionalTimestamp(input.arrivedAt);
    event.startedAt = optionalTimestamp(input.startedAt);
    event.finishedAt = optionalTimestamp(input.finishedAt);
    event.department = cleanText(input.department, "", 120);
    event.clinician = cleanText(input.clinician, "", 120);
    event.room = cleanText(input.room, "", 80);
    event.chiefComplaint = cleanText(input.chiefComplaint, "", 2_000);
    event.soap = normalizeSoap(input.soap);
    event.signature = input.signature && typeof input.signature === "object"
      ? normalizeSignature(input.signature)
      : recordStatus === "final" && event.status === "finished"
        ? { status: event.source.kind === "fhir" ? "external" : "legacy", signer: "", signedAt: "" }
        : normalizeSignature();
  } else if (type === "condition") {
    event.diagnosisRole = DIAGNOSIS_ROLES.has(input.diagnosisRole) ? input.diagnosisRole : "secondary";
    event.certainty = DIAGNOSIS_CERTAINTIES.has(input.certainty) ? input.certainty : "confirmed";
    event.onsetDate = validDate(input.onsetDate);
  } else if (type === "observation") {
    const observedAt = optionalTimestamp(input.observedAt);
    if (observedAt) event.observedAt = observedAt;
  } else if (type === "medication") {
    event.prescription = normalizePrescription(input.prescription);
  } else if (type === "service-request") {
    event.status = ["active", "completed", "cancelled"].includes(input.status) ? input.status : "active";
    event.intent = ORDER_INTENTS.has(input.intent) ? input.intent : "order";
    event.order = normalizeOrder(input.order);
  }
  return event;
}

function hasCompatibleEventLifecycle(event) {
  if (event?.recordStatus === "entered-in-error") return false;
  if (event?.recordStatus === "draft") {
    if (event.type === "condition" && event.verificationStatus && !["confirmed", "provisional"].includes(event.verificationStatus)) return false;
    if (event.type === "allergy" && event.verificationStatus && event.verificationStatus !== "confirmed") return false;
    if (["medication", "service-request"].includes(event.type) && event.intent && !ORDER_INTENTS.has(event.intent)) return false;
    return true;
  }
  if (event?.type === "service-request") return event.status === "active" && ORDER_INTENTS.has(event.intent);
  const acceptedStatuses = CANONICAL_EVENT_STATUSES[event?.type];
  if (!acceptedStatuses?.has(event?.status)) return false;
  if (["condition", "allergy"].includes(event.type)) {
    const allowedVerification = event.type === "condition" ? new Set(["confirmed", "provisional"]) : new Set(["confirmed"]);
    if (Object.hasOwn(event, "verificationStatus") && !allowedVerification.has(event.verificationStatus)) return false;
    if (Object.hasOwn(event, "clinicalStatus") && event.clinicalStatus !== event.status) return false;
    const acceptedFhirVerification = event.verificationStatus === "confirmed"
      || (event.type === "condition" && event.verificationStatus === "provisional" && Boolean(event.encounterId));
    if (event.source?.kind === "fhir" && (!acceptedFhirVerification || event.clinicalStatus !== event.status)) return false;
  }
  if (event.type === "medication") {
    if (Object.hasOwn(event, "intent") && !ORDER_INTENTS.has(event.intent)) return false;
    if (event.source?.kind === "fhir" && !ORDER_INTENTS.has(event.intent)) return false;
  }
  return true;
}

function assertCanonicalEventLifecycle(event) {
  if (event?.type === "observation" && event.system === LOINC_SYSTEM && clinicalObservationSpec(event.code)
    && !isCanonicalClinicalObservation(event)) {
    throw new TypeError(`표준 측정값·단위가 유효하지 않습니다: ${event.id}`);
  }
  if (event?.recordStatus === "entered-in-error") {
    if (event.type === "encounter" && event.status !== "cancelled") {
      throw new TypeError(`취소 진료의 상태가 유효하지 않습니다: ${event.id}`);
    }
    return;
  }
  if (!hasCompatibleEventLifecycle(event)) {
    throw new TypeError(`EMR 임상 이벤트의 상태·검증·의도 조합이 유효하지 않습니다: ${event?.id || "unknown"}`);
  }
}

export function selectFinalPatientEvents(patientInput = {}) {
  const patient = createPatient(patientInput);
  const encounterById = new Map(patient.events.filter((event) => event.type === "encounter").map((event) => [event.id, event]));
  return patient.events.filter((event) => {
    if (event.recordStatus !== "final" || !hasCompatibleEventLifecycle(event)) return false;
    if (["fhir", "import"].includes(event.source?.kind)) return false;
    if (["condition", "allergy"].includes(event.type) && event.verificationStatus && event.verificationStatus !== "confirmed") return false;
    if (!event.encounterId) return true;
    const encounter = encounterById.get(event.encounterId);
    return encounter?.recordStatus === "final"
      && encounter.status === "finished"
      && !["fhir", "import"].includes(encounter.source?.kind);
  });
}

export function createFinalizedPatientView(patientInput = {}) {
  const patient = createPatient(patientInput);
  return { ...patient, events: selectFinalPatientEvents(patient) };
}

export function createClaimPreflightPatient(patientInput = {}, encounterId = "") {
  const patient = createPatient(patientInput);
  const finalPatient = createFinalizedPatientView(patient);
  const encounter = patient.events.find((event) => event.type === "encounter" && event.id === encounterId);
  if (!encounter
    || encounter.recordStatus !== "draft"
    || !["manual", "demo"].includes(encounter.source?.kind)) return finalPatient;
  const projected = patient.events
    .filter((event) => event.encounterId === encounter.id
      && event.recordStatus === "draft"
      && ((event.source?.kind === "encounter" && event.source.resourceId === encounter.id)
        || (encounter.source.kind === "demo" && event.source?.kind === "demo")))
    .map((event) => ({ ...event, recordStatus: "final" }));
  const projectedEncounter = encounter.status === "finished"
    ? [{ ...encounter, recordStatus: "final" }]
    : [];
  return { ...finalPatient, events: [...finalPatient.events, ...projectedEncounter, ...projected] };
}

export function createPatient(input = {}, now = new Date().toISOString()) {
  const timestamp = validTimestamp(now);
  const events = [];
  const seen = new Set();
  for (const rawEvent of Array.isArray(input.events) ? input.events : []) {
    const event = normalizePatientEvent(rawEvent);
    if (!event || seen.has(event.id)) continue;
    seen.add(event.id);
    events.push(event);
  }
  events.sort((a, b) => b.date.localeCompare(a.date));
  const fhirIdentity = cleanText(input.fhirIdentity, "", 2_000);
  const ageYears = boundedInteger(input.ageYears, { minimum: 0, maximum: 130 });
  const emergency = input.emergencyContact && typeof input.emergencyContact === "object" && !Array.isArray(input.emergencyContact)
    ? input.emergencyContact
    : {};
  return {
    id: cleanText(input.id, uniqueId("patient"), 160),
    mrn: cleanText(input.mrn, "", 120),
    name: cleanText(input.name, "이름 없음", 120),
    birthDate: validDate(input.birthDate),
    sex: ["female", "male", "other", "unknown"].includes(input.sex) ? input.sex : "unknown",
    phone: cleanText(input.phone, "", 80),
    ageYears,
    address: cleanText(input.address, "", 500),
    bloodType: ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "unknown"].includes(input.bloodType) ? input.bloodType : "unknown",
    insuranceType: ["national-health", "medical-aid", "industrial", "auto", "self-pay", "other", "unknown"].includes(input.insuranceType) ? input.insuranceType : "unknown",
    emergencyContact: {
      name: cleanText(emergency.name, "", 120),
      relation: cleanText(emergency.relation, "", 80),
      phone: cleanText(emergency.phone, "", 80),
    },
    memo: cleanText(input.memo, "", 2_000),
    events,
    createdAt: validTimestamp(input.createdAt, timestamp),
    updatedAt: validTimestamp(input.updatedAt, timestamp),
    ...(fhirIdentity ? { fhirIdentity } : {}),
  };
}

function assertPatientDemographicsInput(input, now) {
  if (!cleanText(input?.name, "", 120)) throw new TypeError("환자 이름이 필요합니다.");
  if (!cleanText(input?.mrn, "", 120) && !cleanText(input?.fhirIdentity, "", 2_000)) {
    throw new TypeError("환자 등록번호 또는 FHIR 환자 식별자가 필요합니다.");
  }
  if (Object.hasOwn(input ?? {}, "sex") && !["female", "male", "other", "unknown"].includes(input.sex)) {
    throw new TypeError("환자 성별 값이 유효하지 않습니다.");
  }
  if (Object.hasOwn(input ?? {}, "bloodType") && !["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "unknown"].includes(input.bloodType)) {
    throw new TypeError("환자 혈액형 값이 유효하지 않습니다.");
  }
  if (Object.hasOwn(input ?? {}, "insuranceType") && !["national-health", "medical-aid", "industrial", "auto", "self-pay", "other", "unknown"].includes(input.insuranceType)) {
    throw new TypeError("환자 보험 유형 값이 유효하지 않습니다.");
  }
  const birthDateInput = cleanText(input?.birthDate, "", 20);
  if (birthDateInput && !validDate(birthDateInput)) throw new TypeError("생년월일 형식이 유효하지 않습니다.");
  if (birthDateInput && birthDateInput > localCalendarDate(new Date(now), KOREA_TIMEZONE_OFFSET_MINUTES)) {
    throw new TypeError("생년월일은 오늘보다 미래일 수 없습니다.");
  }
  if (birthDateInput && input?.ageYears !== undefined && input?.ageYears !== null && String(input.ageYears).trim() !== "") {
    throw new TypeError("생년월일과 직접 입력 만 나이는 동시에 저장할 수 없습니다.");
  }
  if (input?.ageYears !== undefined && input?.ageYears !== null && String(input.ageYears).trim() !== ""
    && boundedInteger(input.ageYears, { minimum: 0, maximum: 130 }) === null) {
    throw new TypeError("만 나이는 0세부터 130세 사이의 정수여야 합니다.");
  }
}

function normalizeAuditEvent(input = {}) {
  if (!input || typeof input !== "object") return null;
  const id = cleanText(input.id, "", 160);
  const action = cleanText(input.action, "", 160);
  if (!id || !action) return null;
  return {
    id,
    at: validTimestamp(input.at),
    actor: cleanText(input.actor, "local-user", 120),
    action,
    patientId: cleanText(input.patientId, "", 160),
    encounterId: cleanText(input.encounterId, "", 160),
    entityId: cleanText(input.entityId, "", CLAIM_REVIEW_EVALUATION_ID_LIMIT),
    detail: cleanText(input.detail, "", 500),
  };
}

function audit(action, now, { patientId = "", encounterId = "", entityId = "", detail = "" } = {}) {
  return {
    id: uniqueId("audit"),
    at: validTimestamp(now),
    actor: "local-user",
    action,
    patientId,
    encounterId,
    entityId,
    detail: cleanText(detail, "", 500),
  };
}

function normalizeClaimReviewOutcome(value) {
  return CLAIM_REVIEW_OUTCOMES.has(value) ? value : "";
}

function isStableProfileSourceId(value) {
  return typeof value === "string" && PROFILE_CLAIM_SOURCE_ID_PATTERN.test(value);
}

function normalizeProfileContextText(value, label, maxLength, { optional = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (optional) return "";
    throw new TypeError(`${label}이(가) 유효하지 않습니다.`);
  }
  if (typeof value !== "string") throw new TypeError(`${label}이(가) 유효하지 않습니다.`);
  const text = value.trim();
  if ((!optional && !text) || text.length > maxLength || /[\u0000-\u001f\u007f-\u009f]/u.test(text)) {
    throw new TypeError(`${label}이(가) 유효하지 않습니다.`);
  }
  return text;
}

function normalizeProfileContextList(values, label, maxLength = 500) {
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values) || values.length > 100) throw new TypeError(`${label}이(가) 유효하지 않습니다.`);
  const normalized = values.map((value) => normalizeProfileContextText(value, label, maxLength));
  return [...new Set(normalized)].sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
}

function normalizeProfileClaimUnit(input) {
  if (input === undefined || input === null) return { lineNumber: "", quantity: null, unit: "" };
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("청구 line 단위가 유효하지 않습니다.");
  }
  let lineNumber = "";
  if (input.lineNumber !== undefined && input.lineNumber !== null && input.lineNumber !== "") {
    lineNumber = typeof input.lineNumber === "number" && Number.isSafeInteger(input.lineNumber) && input.lineNumber >= 0
      ? String(input.lineNumber)
      : normalizeProfileContextText(input.lineNumber, "청구 line 번호", 80);
  }
  let quantity = null;
  if (input.quantity !== undefined && input.quantity !== null && input.quantity !== "") {
    const parsed = typeof input.quantity === "number" ? input.quantity : Number(input.quantity);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000_000) {
      throw new TypeError("청구 수량이 유효하지 않습니다.");
    }
    quantity = parsed;
  }
  const unit = normalizeProfileContextText(input.unit, "청구 수량 단위", 80, { optional: true });
  return { lineNumber, quantity, unit };
}

function normalizeProfileEvidenceRecords(values, evidenceIds) {
  if (!Array.isArray(values) || values.length > 100) throw new TypeError("프로필 근거 기록이 유효하지 않습니다.");
  const allowedIds = new Set(evidenceIds);
  const seen = new Set();
  const records = values.map((record) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) throw new TypeError("프로필 근거 기록이 유효하지 않습니다.");
    const id = normalizeProfileContextText(record.id, "프로필 근거 기록 식별자", 160);
    if (!allowedIds.has(id) || seen.has(id)) throw new TypeError("프로필 근거 기록 식별자가 연결 목록과 일치하지 않습니다.");
    seen.add(id);
    const dateRaw = normalizeProfileContextText(record.date, "프로필 근거 기록일", 10, { optional: true });
    const date = dateRaw ? validDate(dateRaw) : "";
    if (dateRaw && !date) throw new TypeError("프로필 근거 기록일이 유효하지 않습니다.");
    const verifiedAtRaw = normalizeProfileContextText(record.verifiedAt, "프로필 근거 검증 시각", 80, { optional: true });
    const verifiedAt = optionalTimestamp(verifiedAtRaw);
    if (verifiedAtRaw && !verifiedAt) throw new TypeError("프로필 근거 검증 시각이 유효하지 않습니다.");
    return {
      id,
      label: normalizeProfileContextText(record.label, "프로필 근거 이름", 240),
      date,
      sourceId: normalizeProfileContextText(record.sourceId, "프로필 근거 출처 식별자", 160, { optional: true }),
      sourceLabel: normalizeProfileContextText(record.sourceLabel, "프로필 근거 출처 이름", 240, { optional: true }),
      verificationStatus: normalizeProfileContextText(record.verificationStatus, "프로필 근거 검증 상태", 80, { optional: true }),
      patientMatch: normalizeProfileContextText(record.patientMatch, "프로필 근거 환자 일치 상태", 80, { optional: true }),
      reviewerId: normalizeProfileContextText(record.reviewerId, "프로필 근거 검토자", 160, { optional: true }),
      verifiedAt,
      synthetic: record.synthetic === true,
    };
  });
  if (records.length !== evidenceIds.length) throw new TypeError("프로필 근거 기록이 연결 목록과 일치하지 않습니다.");
  return records.sort((left, right) => left.id.localeCompare(right.id, "en", { numeric: true }));
}

function normalizeProfileClaimContext(input, { sourceId, asOf }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("프로필 청구 line 맥락이 유효하지 않습니다.");
  }
  const assessmentId = normalizeProfileContextText(input.assessmentId, "질환 평가 식별자", 80);
  if (!isStableProfileSourceId(assessmentId)) throw new TypeError("질환 평가 식별자가 유효하지 않습니다.");
  const claimItemId = normalizeProfileContextText(input.claimItemId, "청구 line 식별자", 160);
  const serviceDate = validDate(input.serviceDate);
  const workflowStatus = normalizeProfileContextText(input.workflowStatus, "청구 업무 상태", 40).toUpperCase();
  const preflightStatus = normalizeProfileContextText(input.preflightStatus, "사전점검 상태", 20).toUpperCase();
  if (`${assessmentId}.${claimItemId}` !== sourceId || !serviceDate || serviceDate !== asOf) {
    throw new TypeError("프로필 청구 line의 식별자 또는 진료일이 일치하지 않습니다.");
  }
  if (!PROFILE_CLAIM_WORKFLOW_STATUSES.has(workflowStatus) || !PROFILE_CLAIM_PREFLIGHT_STATUSES.has(preflightStatus)) {
    throw new TypeError("프로필 청구 line의 업무 또는 사전점검 상태가 유효하지 않습니다.");
  }
  if (typeof input.riskConfirmed !== "boolean") throw new TypeError("사전점검 위험 확인 상태가 유효하지 않습니다.");
  const evidenceIds = normalizeProfileContextList(input.evidenceIds, "프로필 근거 식별자", 160);
  const evidenceCount = boundedInteger(input.evidenceCount, { minimum: 0, maximum: 100_000 });
  if (evidenceCount === null || evidenceCount !== evidenceIds.length) {
    throw new TypeError("프로필 근거 개수가 유효하지 않습니다.");
  }
  const evidenceRecords = normalizeProfileEvidenceRecords(input.evidenceRecords, evidenceIds);
  const disclaimer = normalizeProfileContextText(input.disclaimer, "사전점검 경계 문구", 2_000, { optional: true });
  const provenanceInput = input.provenance;
  if (!provenanceInput || typeof provenanceInput !== "object" || Array.isArray(provenanceInput)) {
    throw new TypeError("프로필 청구 line 출처가 유효하지 않습니다.");
  }
  const verifiedAtRaw = normalizeProfileContextText(provenanceInput.verifiedAt, "출처 검증 시각", 80, { optional: true });
  const verifiedAt = optionalTimestamp(verifiedAtRaw);
  if (verifiedAtRaw && !verifiedAt) throw new TypeError("출처 검증 시각이 유효하지 않습니다.");
  return {
    assessmentId,
    claimItemId,
    serviceDate,
    workflowStatus,
    claimUnit: normalizeProfileClaimUnit(input.claimUnit),
    preflightStatus,
    riskConfirmed: input.riskConfirmed,
    reasonCodes: normalizeProfileContextList(input.reasonCodes, "사전점검 사유 코드", 160),
    reasonLabels: normalizeProfileContextList(input.reasonLabels, "사전점검 사유", 500),
    evidenceIds,
    evidenceCount,
    evidenceRecords,
    disclaimer,
    provenance: {
      kind: normalizeProfileContextText(provenanceInput.kind, "출처 유형", 120),
      sourceId: normalizeProfileContextText(provenanceInput.sourceId, "출처 식별자", 160),
      sourceLabel: normalizeProfileContextText(provenanceInput.sourceLabel, "출처 이름", 240, { optional: true }),
      verificationStatus: normalizeProfileContextText(provenanceInput.verificationStatus, "출처 검증 상태", 80, { optional: true }),
      patientMatch: normalizeProfileContextText(provenanceInput.patientMatch, "환자 일치 상태", 80, { optional: true }),
      reviewerId: normalizeProfileContextText(provenanceInput.reviewerId, "출처 검토자", 160, { optional: true }),
      verifiedAt,
      synthetic: provenanceInput.synthetic === true,
    },
  };
}

function profileClaimDecisionContext(context) {
  return {
    assessmentId: context.assessmentId,
    claimItemId: context.claimItemId,
    serviceDate: context.serviceDate,
    workflowStatus: context.workflowStatus,
    claimUnit: context.claimUnit,
    preflightStatus: context.preflightStatus,
    riskConfirmed: context.riskConfirmed,
    reasonCodes: context.reasonCodes,
    evidenceIds: context.evidenceIds,
    evidenceCount: context.evidenceCount,
    evidenceRecords: context.evidenceRecords.map((record) => ({
      id: record.id,
      date: record.date,
      sourceId: record.sourceId,
      verificationStatus: record.verificationStatus,
      patientMatch: record.patientMatch,
      reviewerId: record.reviewerId,
      verifiedAt: record.verifiedAt,
      synthetic: record.synthetic,
    })),
    provenance: {
      kind: context.provenance.kind,
      sourceId: context.provenance.sourceId,
      verificationStatus: context.provenance.verificationStatus,
      patientMatch: context.provenance.patientMatch,
      reviewerId: context.provenance.reviewerId,
      verifiedAt: context.provenance.verifiedAt,
      synthetic: context.provenance.synthetic,
    },
  };
}

function normalizeClaimReviewHistoryEntry(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const at = optionalTimestamp(input.at);
  const from = CLAIM_REVIEW_STAGES.has(input.from) ? input.from : "";
  const to = CLAIM_REVIEW_STAGES.has(input.to) ? input.to : "";
  if (!at || !from || !to) return null;
  const assignee = cleanText(input.assignee, "", 120);
  return {
    at,
    from,
    to,
    ...(assignee ? { assignee } : {}),
    reviewer: cleanText(input.reviewer, "", 120),
    reason: cleanText(input.reason, "", 2_000),
    opinion: cleanText(input.opinion, "", 8_000),
    outcome: normalizeClaimReviewOutcome(input.outcome),
    inputMethod: cleanText(input.inputMethod, "", 80),
  };
}

function normalizeClaimReviewHistory(input = []) {
  if (!Array.isArray(input)) return [];
  return input
    .map((entry) => normalizeClaimReviewHistoryEntry(entry))
    .filter(Boolean)
    .slice(-CLAIM_REVIEW_HISTORY_LIMIT);
}

function appendClaimReviewHistory(history, entry) {
  const normalized = normalizeClaimReviewHistoryEntry(entry);
  return normalized
    ? [...normalizeClaimReviewHistory(history), normalized].slice(-CLAIM_REVIEW_HISTORY_LIMIT)
    : normalizeClaimReviewHistory(history);
}

function normalizeClaimReview(input = {}, now = new Date().toISOString()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const evaluationId = cleanText(input.evaluationId, "", CLAIM_REVIEW_EVALUATION_ID_LIMIT);
  const patientId = cleanText(input.patientId, "", 160);
  const ruleId = cleanText(input.ruleId, "", CLAIM_REVIEW_RULE_ID_LIMIT);
  const stage = CLAIM_REVIEW_STAGES.has(input.stage) ? input.stage : "";
  const fingerprint = cleanText(input.fingerprint, "", 80);
  const calculatedStatus = cleanText(input.calculatedStatus, "", 80);
  const calculatedAsOf = validDate(input.calculatedAsOf);
  if (!evaluationId || !patientId || !ruleId || !/^sha256:[0-9a-f]{64}$/.test(fingerprint) || !stage || !calculatedStatus || !calculatedAsOf) return null;
  const sourceKind = input.sourceKind === "profile" ? "profile" : "";
  const sourceId = cleanText(input.sourceId, "", PROFILE_CLAIM_SOURCE_ID_LIMIT);
  if ((sourceKind && !isStableProfileSourceId(sourceId)) || (!sourceKind && sourceId)) return null;
  const requestedInvalidatedAt = optionalTimestamp(input.invalidatedAt);
  const requestedInvalidatedFrom = CLAIM_REVIEW_STAGES.has(input.invalidatedFrom) && input.invalidatedFrom !== "new"
    ? input.invalidatedFrom
    : "";
  const keepsInvalidation = stage === "new" && Boolean(requestedInvalidatedAt) && Boolean(requestedInvalidatedFrom);
  const assignee = cleanText(input.assignee, "", 120);
  return {
    evaluationId,
    patientId,
    ruleId,
    ...(sourceKind ? { sourceKind, sourceId } : {}),
    stage,
    fingerprint,
    calculatedStatus,
    calculatedAsOf,
    invalidatedAt: keepsInvalidation ? requestedInvalidatedAt : "",
    invalidatedFrom: keepsInvalidation ? requestedInvalidatedFrom : "",
    ...(assignee ? { assignee } : {}),
    reviewer: cleanText(input.reviewer, "", 120),
    transitionReason: cleanText(input.transitionReason, "", 2_000),
    opinion: cleanText(input.opinion, "", 8_000),
    outcome: normalizeClaimReviewOutcome(input.outcome),
    history: normalizeClaimReviewHistory(input.history),
    updatedAt: validTimestamp(input.updatedAt, validTimestamp(now)),
  };
}

export function createEmptyEmrState(now = new Date().toISOString()) {
  const timestamp = validTimestamp(now);
  return {
    schema: EMR_SCHEMA,
    version: EMR_VERSION,
    revision: 0,
    demo: false,
    selectedPatientId: "",
    selectedEncounterId: "",
    patients: [],
    rules: DEFAULT_CLAIM_RULES.map((rule) => normalizeClaimRule(rule)),
    claimReviews: [],
    audit: [],
    storageError: "",
    recoveryRaw: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function normalizeEmrState(input = {}) {
  if (!input || typeof input !== "object") return createEmptyEmrState();
  const now = validTimestamp(input.updatedAt ?? input.createdAt);
  const patients = [];
  const patientIds = new Set();
  for (const item of Array.isArray(input.patients) ? input.patients : []) {
    if (!item || typeof item !== "object" || !cleanText(item.id) || patientIds.has(cleanText(item.id))) continue;
    const patient = createPatient(item, now);
    patientIds.add(patient.id);
    patients.push(patient);
  }
  const rules = [];
  const ruleIds = new Set();
  for (const item of Array.isArray(input.rules) ? input.rules : DEFAULT_CLAIM_RULES) {
    const rule = normalizeClaimRule(item);
    if (!rule || ruleIds.has(rule.id)) continue;
    ruleIds.add(rule.id);
    rules.push(rule);
  }
  const auditEvents = [];
  const auditIds = new Set();
  for (const item of Array.isArray(input.audit) ? input.audit : []) {
    const event = normalizeAuditEvent(item);
    if (!event || auditIds.has(event.id)) continue;
    auditIds.add(event.id);
    auditEvents.push(event);
  }
  const claimReviews = [];
  const claimReviewIds = new Set();
  for (const item of Array.isArray(input.claimReviews) ? input.claimReviews : []) {
    const review = normalizeClaimReview(item, now);
    if (!review || claimReviewIds.has(review.evaluationId) || !patientIds.has(review.patientId)) continue;
    const profileReview = review.sourceKind === "profile";
    const validReference = profileReview
      ? isStableProfileSourceId(review.sourceId)
        && review.evaluationId === `${review.patientId}:profile:${review.sourceId}`
      : ruleIds.has(review.ruleId) && review.evaluationId === `${review.patientId}:${review.ruleId}`;
    if (!validReference) continue;
    claimReviewIds.add(review.evaluationId);
    claimReviews.push(review);
  }
  const selected = cleanText(input.selectedPatientId);
  const selectedPatientId = patientIds.has(selected) ? selected : patients[0]?.id ?? "";
  const selectedPatient = patients.find((patient) => patient.id === selectedPatientId);
  const requestedEncounter = cleanText(input.selectedEncounterId);
  const selectedEncounterId = selectedPatient?.events.some((event) => event.type === "encounter" && event.id === requestedEncounter)
    ? requestedEncounter
    : "";
  return {
    schema: EMR_SCHEMA,
    version: EMR_VERSION,
    revision: boundedInteger(input.revision, { minimum: 0, maximum: Number.MAX_SAFE_INTEGER }) ?? 0,
    demo: input.demo === true,
    selectedPatientId,
    selectedEncounterId,
    patients,
    rules: rules.length ? rules : DEFAULT_CLAIM_RULES.map((rule) => normalizeClaimRule(rule)),
    claimReviews: claimReviews.slice(0, 10_000),
    audit: auditEvents.slice(-1_000),
    storageError: cleanText(input.storageError, "", 500),
    recoveryRaw: typeof input.recoveryRaw === "string" ? input.recoveryRaw.slice(0, 5 * 1024 * 1024) : "",
    createdAt: validTimestamp(input.createdAt, now),
    updatedAt: now,
  };
}

export function addPatient(stateInput, patientInput, now = new Date().toISOString()) {
  const state = normalizeEmrState(stateInput);
  assertPatientDemographicsInput(patientInput, now);
  const patient = createPatient(patientInput, now);
  for (const event of patient.events) assertCanonicalEventLifecycle(event);
  if (state.patients.some(({ id }) => id === patient.id)) throw new Error("이미 존재하는 환자 ID입니다.");
  if (patient.fhirIdentity && state.patients.some(({ fhirIdentity }) => fhirIdentity === patient.fhirIdentity)) throw new Error("같은 FHIR 환자가 이미 있습니다.");
  if (patient.mrn && state.patients.some(({ mrn }) => mrn === patient.mrn)) throw new Error("같은 등록번호가 이미 있습니다.");
  return {
    ...state,
    revision: state.revision + 1,
    demo: false,
    selectedPatientId: patient.id,
    selectedEncounterId: "",
    patients: [...state.patients, patient],
    audit: [...state.audit, audit("patient.created", now, { patientId: patient.id, detail: patient.mrn })].slice(-1_000),
    updatedAt: validTimestamp(now),
  };
}

export function updatePatient(stateInput, patientId, patch = {}, now = new Date().toISOString()) {
  const state = normalizeEmrState(stateInput);
  const requestedMrn = cleanText(patch.mrn);
  const requestedFhirIdentity = cleanText(patch.fhirIdentity, "", 2_000);
  if (requestedMrn && state.patients.some((patient) => patient.id !== patientId && patient.mrn === requestedMrn)) {
    throw new Error("같은 등록번호가 이미 있습니다.");
  }
  if (requestedFhirIdentity && state.patients.some((patient) => patient.id !== patientId && patient.fhirIdentity === requestedFhirIdentity)) {
    throw new Error("같은 FHIR 환자가 이미 있습니다.");
  }
  let found = false;
  const patients = state.patients.map((patient) => {
    if (patient.id !== patientId) return patient;
    found = true;
    const input = { ...patient, ...patch, id: patient.id, events: patient.events, createdAt: patient.createdAt, updatedAt: now };
    assertPatientDemographicsInput(input, now);
    return createPatient(input, now);
  });
  if (!found) throw new Error("환자를 찾을 수 없습니다.");
  return {
    ...state,
    revision: state.revision + 1,
    demo: false,
    patients,
    audit: [...state.audit, audit("patient.updated", now, { patientId })].slice(-1_000),
    updatedAt: validTimestamp(now),
  };
}

export function appendPatientEvent(stateInput, patientId, eventInput, now = new Date().toISOString()) {
  const state = normalizeEmrState(stateInput);
  const demoRecord = eventInput?.source?.kind === "demo";
  const normalized = normalizePatientEvent({
    ...eventInput,
    id: cleanText(eventInput?.id, uniqueId("event")),
    recordStatus: demoRecord ? (eventInput?.recordStatus ?? "final") : "draft",
  });
  if (!normalized) throw new TypeError("임상 이벤트에 유형, 이름, 날짜가 필요합니다.");
  if (normalized.type === "encounter") throw new TypeError("진료 회차는 접수·진료 시작 흐름에서만 만들 수 있습니다.");
  if (normalized.encounterId) throw new TypeError("진료 연결 기록은 해당 진료 화면에서만 만들 수 있습니다.");
  assertCanonicalEventLifecycle(normalized);
  let found = false;
  const patients = state.patients.map((patient) => {
    if (patient.id !== patientId) return patient;
    found = true;
    if (patient.events.some(({ id }) => id === normalized.id)) throw new Error("이미 존재하는 이벤트 ID입니다.");
    return { ...patient, events: [normalized, ...patient.events].sort((a, b) => b.date.localeCompare(a.date)), updatedAt: validTimestamp(now) };
  });
  if (!found) throw new Error("환자를 찾을 수 없습니다.");
  return {
    ...state,
    revision: state.revision + 1,
    demo: false,
    patients,
    audit: [...state.audit, audit("patient.event.added", now, { patientId, detail: `${normalized.type}:${normalized.code || normalized.label}` })].slice(-1_000),
    updatedAt: validTimestamp(now),
  };
}

export function confirmPatientEvent(stateInput, patientId, eventId, now = new Date().toISOString()) {
  const state = normalizeEmrState(stateInput);
  const confirmedOn = localCalendarDate(new Date(now), KOREA_TIMEZONE_OFFSET_MINUTES);
  let confirmed = null;
  const patients = state.patients.map((patient) => {
    if (patient.id !== patientId) return patient;
    const target = patient.events.find((event) => event.id === eventId);
    if (!target) throw new Error("확정할 기록을 찾을 수 없습니다.");
    if (target.type === "encounter" || target.encounterId) throw new Error("진료 연결 기록은 해당 진료의 완료·서명 흐름에서만 확정할 수 있습니다.");
    if (target.recordStatus !== "draft") throw new Error("검토 대기 중인 기록만 확정할 수 있습니다.");
    if (target.source?.kind !== "manual") throw new Error("직접 입력한 기록만 이 흐름에서 확정할 수 있습니다.");
    if (target.date > confirmedOn) throw new Error("미래 날짜 기록은 확정할 수 없습니다.");
    if (["condition", "observation"].includes(target.type) && (!target.system || !target.code)) {
      throw new Error("진단·측정 기록을 확정하려면 코드와 코드 시스템이 필요합니다.");
    }
    if (target.type === "observation" && target.value === "") {
      throw new Error("측정 기록을 확정하려면 결과값이 필요합니다.");
    }
    confirmed = normalizePatientEvent({
      ...target,
      recordStatus: "final",
      ...(target.type === "condition" ? {
        certainty: "confirmed",
        clinicalStatus: target.status,
        verificationStatus: "confirmed",
      } : {}),
      source: { kind: "manual", label: "직접 입력 · 의료진 검토 확정" },
    });
    assertCanonicalEventLifecycle(confirmed);
    return {
      ...patient,
      events: patient.events.map((event) => event.id === eventId ? confirmed : event),
      updatedAt: validTimestamp(now),
    };
  });
  if (!confirmed) throw new Error("확정할 기록을 찾을 수 없습니다.");
  return {
    ...state,
    revision: state.revision + 1,
    demo: false,
    patients,
    audit: [...state.audit, audit("patient.event.confirmed", now, {
      patientId,
      entityId: eventId,
      detail: `${confirmed.type}:${confirmed.code || confirmed.label}`,
    })].slice(-1_000),
    updatedAt: validTimestamp(now),
  };
}

export function removePatientEvent(stateInput, patientId, eventId, reasonInput = "", now = new Date().toISOString()) {
  const state = normalizeEmrState(stateInput);
  const reason = cleanText(reasonInput, "", 500);
  if (!reason) throw new TypeError("기록 취소 사유가 필요합니다.");
  let voided = false;
  const patients = state.patients.map((patient) => {
    if (patient.id !== patientId) return patient;
    const target = patient.events.find((event) => event.id === eventId);
    if (target?.source?.kind === "import") throw new Error("출처 미검증 백업 기록은 변경하거나 취소할 수 없습니다.");
    if (target?.encounterId) throw new Error("진료에 연결된 항목은 해당 진료 화면에서만 관리할 수 있습니다.");
    if (target?.type === "encounter") throw new Error("진료 회차는 삭제할 수 없습니다. 취소 사유와 함께 진료 취소를 사용하세요.");
    if (target?.recordStatus === "entered-in-error") throw new Error("이미 취소된 기록입니다.");
    const events = patient.events.map((event) => {
      if (event.id !== eventId) return event;
      voided = true;
      return normalizePatientEvent({
        ...event,
        recordStatus: "entered-in-error",
        note: [event.note, `기록 취소: ${reason}`].filter(Boolean).join(" · "),
      });
    });
    return { ...patient, events, updatedAt: validTimestamp(now) };
  });
  if (!voided) throw new Error("취소할 이벤트를 찾을 수 없습니다.");
  return {
    ...state,
    revision: state.revision + 1,
    demo: false,
    patients,
    audit: [...state.audit, audit("patient.event.voided", now, { patientId, entityId: eventId, detail: reason })].slice(-1_000),
    updatedAt: validTimestamp(now),
  };
}

export function addClaimRule(stateInput, ruleInput, now = new Date().toISOString()) {
  const state = normalizeEmrState(stateInput);
  const requestedEffectiveTo = cleanText(ruleInput?.effectiveTo, "", 20);
  if (requestedEffectiveTo && !validDate(requestedEffectiveTo)) throw new TypeError("급여 규칙 종료일이 유효하지 않습니다.");
  const rule = normalizeClaimRule({ ...ruleInput, id: cleanText(ruleInput?.id, uniqueId("rule")) });
  if (!rule) throw new TypeError("급여 규칙의 이름, 서비스 코드, 시행일이 필요합니다.");
  if (state.rules.some(({ id }) => id === rule.id)) throw new Error("같은 급여 규칙 ID가 이미 있습니다. 기존 버전을 종료한 뒤 새 ID로 후속 버전을 추가하세요.");
  assertOperationalClaimRule(rule);
  assertNonOverlappingRuleVersions([...state.rules, rule]);
  return {
    ...state,
    revision: state.revision + 1,
    demo: false,
    rules: [...state.rules, rule],
    audit: [...state.audit, audit("claim-rule.saved", now, { detail: rule.id })].slice(-1_000),
    updatedAt: validTimestamp(now),
  };
}

export function retireClaimRule(stateInput, ruleIdInput, effectiveToInput, now = new Date().toISOString()) {
  const state = normalizeEmrState(stateInput);
  const ruleId = cleanText(ruleIdInput, "", 160);
  const effectiveTo = validDate(effectiveToInput);
  if (!ruleId) throw new TypeError("종료할 급여 규칙 ID가 필요합니다.");
  if (!effectiveTo) throw new TypeError("급여 규칙 종료일이 유효하지 않습니다.");
  const current = state.rules.find(({ id }) => id === ruleId);
  if (!current) throw new Error("종료할 급여 규칙을 찾을 수 없습니다.");
  if (effectiveTo < current.effectiveFrom) throw new TypeError("급여 규칙 종료일은 시행일보다 빠를 수 없습니다.");
  const updated = normalizeClaimRule({ ...current, effectiveTo });
  if (!updated || updated.effectiveTo !== effectiveTo) throw new TypeError("급여 규칙 종료일을 저장할 수 없습니다.");
  const rules = state.rules.map((rule) => rule.id === ruleId ? updated : rule);
  assertNonOverlappingRuleVersions(rules);
  return {
    ...state,
    revision: state.revision + 1,
    demo: false,
    rules,
    audit: [...state.audit, audit("claim-rule.retired", now, { entityId: ruleId, detail: effectiveTo })].slice(-1_000),
    updatedAt: validTimestamp(now),
  };
}

function assertOperationalClaimRule(rule) {
  if (!rule.sourceLabel || rule.sourceLabel === "기관 내부 규칙") throw new TypeError("검증한 공식 출처명을 입력해야 합니다.");
  if (!rule.serviceSystem) throw new TypeError("기관 급여 규칙의 서비스 코드 시스템을 입력해야 합니다.");
  if (rule.applicabilityCodes.length && !rule.applicabilitySystem) throw new TypeError("적용 조건 코드 시스템을 입력해야 합니다.");
  if (rule.requiredEvidence.some(({ system }) => !system)) throw new TypeError("필수 근거 코드 시스템을 입력해야 합니다.");
  return rule;
}

function assertNonOverlappingRuleVersions(rules) {
  for (let leftIndex = 0; leftIndex < rules.length; leftIndex += 1) {
    const left = rules[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < rules.length; rightIndex += 1) {
      const right = rules[rightIndex];
      if (left.ruleSetId !== right.ruleSetId) continue;
      const overlaps = (!left.effectiveTo || left.effectiveTo >= right.effectiveFrom)
        && (!right.effectiveTo || right.effectiveTo >= left.effectiveFrom);
      if (overlaps) throw new Error("같은 규칙군의 시행기간이 기존 버전과 겹칩니다.");
    }
  }
}

export function appendStateAudit(stateInput, action, detail = "", now = new Date().toISOString(), patientId = "", encounterId = "", entityId = "") {
  const state = normalizeEmrState(stateInput);
  return {
    ...state,
    revision: state.revision + 1,
    audit: [...state.audit, audit(action, now, { patientId, encounterId, entityId, detail })].slice(-1_000),
    updatedAt: validTimestamp(now),
  };
}

function claimReviewEvidenceSnapshot(event) {
  if (!event) return null;
  return {
    id: event.id,
    type: event.type,
    recordStatus: event.recordStatus,
    system: event.system,
    code: event.code,
    label: event.label,
    date: event.date,
    status: event.status,
    value: event.value,
    unit: event.unit,
    observedAt: event.observedAt ?? "",
    clinicalStatus: event.clinicalStatus ?? "",
    verificationStatus: event.verificationStatus ?? "",
    intent: event.intent ?? "",
    source: event.source,
  };
}

export function claimEvaluationFingerprint(evaluationInput = {}, patientInput = {}) {
  const evaluation = evaluationInput && typeof evaluationInput === "object" ? evaluationInput : {};
  const patient = createPatient(patientInput);
  const evidenceIds = [...new Set((Array.isArray(evaluation.evidenceEventIds) ? evaluation.evidenceEventIds : [])
    .map((id) => cleanText(id, "", 160))
    .filter(Boolean))].sort();
  const eventById = new Map(patient.events.map((event) => [event.id, event]));
  const canonical = clinicalContextFingerprint({
    evaluationId: cleanText(evaluation.id, "", CLAIM_REVIEW_EVALUATION_ID_LIMIT),
    patientId: cleanText(evaluation.patientId, "", 160),
    ruleId: cleanText(evaluation.ruleId ?? evaluation.rule?.id, "", CLAIM_REVIEW_RULE_ID_LIMIT),
    ...(evaluation.sourceKind === "profile" ? {
      sourceKind: "profile",
      sourceId: cleanText(evaluation.sourceId, "", PROFILE_CLAIM_SOURCE_ID_LIMIT),
      profileContext: profileClaimDecisionContext(normalizeProfileClaimContext(evaluation.claimContext, {
        sourceId: cleanText(evaluation.sourceId, "", PROFILE_CLAIM_SOURCE_ID_LIMIT),
        asOf: validDate(evaluation.asOf),
      })),
    } : {}),
    asOf: validDate(evaluation.asOf),
    result: {
      status: cleanText(evaluation.status, "", 80),
      usedCount: boundedInteger(evaluation.usedCount),
      remainingCount: boundedInteger(evaluation.remainingCount),
      nextEligibleDate: validDate(evaluation.nextEligibleDate),
      missingEvidence: evaluation.sourceKind === "profile"
        ? []
        : [...new Set((Array.isArray(evaluation.missingEvidence) ? evaluation.missingEvidence : [])
          .map((item) => cleanText(item, "", 500))
          .filter(Boolean))].sort(),
    },
    rule: normalizeClaimRule(evaluation.rule),
    evidence: evidenceIds.map((id) => claimReviewEvidenceSnapshot(eventById.get(id))).filter(Boolean),
  });
  return `sha256:${sha256Hex(canonical)}`;
}

function normalizeProfileClaimEvaluation(evaluationInput, patient) {
  const sourceId = cleanText(evaluationInput?.sourceId, "", PROFILE_CLAIM_SOURCE_ID_LIMIT);
  const patientId = cleanText(evaluationInput?.patientId, "", 160);
  const ruleId = cleanText(evaluationInput?.ruleId ?? evaluationInput?.rule?.id, "", CLAIM_REVIEW_RULE_ID_LIMIT);
  const asOf = validDate(evaluationInput?.asOf);
  const status = cleanText(evaluationInput?.status, "", 80);
  const rule = normalizeClaimRule(evaluationInput?.rule);
  const expectedId = `${patientId}:profile:${sourceId}`;
  if (!isStableProfileSourceId(sourceId)
    || !patientId
    || !asOf
    || !CLAIM_EVALUATION_STATUSES.has(status)
    || !rule
    || !ruleId
    || rule.id !== ruleId
    || cleanText(evaluationInput?.id, "", CLAIM_REVIEW_EVALUATION_ID_LIMIT) !== expectedId) {
    throw new TypeError("담당자 검토에 연결할 환자·프로필 항목·판정일이 유효하지 않습니다.");
  }
  const eventIds = new Set(patient.events.map(({ id }) => id));
  const normalizeEventIds = (values) => [...new Set((Array.isArray(values) ? values : [])
    .map((id) => cleanText(id, "", 160))
    .filter((id) => id && eventIds.has(id)))];
  const normalizeLabels = (values) => [...new Set((Array.isArray(values) ? values : [])
    .map((value) => cleanText(value, "", 500))
    .filter(Boolean))];
  const optionalDate = (value) => validDate(value);
  const daysSinceLastService = evaluationInput?.daysSinceLastService === null
    ? null
    : boundedInteger(evaluationInput?.daysSinceLastService, { minimum: 0, maximum: 100_000 });
  const claimContext = normalizeProfileClaimContext(evaluationInput?.claimContext, { sourceId, asOf });
  return {
    id: expectedId,
    patientId,
    patientName: patient.name,
    patientMrn: patient.mrn,
    sourceKind: "profile",
    sourceId,
    ruleId,
    title: cleanText(evaluationInput?.title, rule.title, 300),
    serviceCode: rule.serviceCode,
    status,
    asOf,
    calculationAvailable: evaluationInput?.calculationAvailable === true,
    windowStart: optionalDate(evaluationInput?.windowStart),
    windowEnd: optionalDate(evaluationInput?.windowEnd) || asOf,
    usedCount: boundedInteger(evaluationInput?.usedCount, { minimum: 0, maximum: 100_000 }) ?? 0,
    remainingCount: boundedInteger(evaluationInput?.remainingCount, { minimum: 0, maximum: 100_000 }) ?? 0,
    serviceEventIds: normalizeEventIds(evaluationInput?.serviceEventIds),
    lastServiceDate: optionalDate(evaluationInput?.lastServiceDate),
    daysSinceLastService,
    nextEligibleDate: optionalDate(evaluationInput?.nextEligibleDate),
    missingEvidence: normalizeLabels(evaluationInput?.missingEvidence),
    evidenceEventIds: normalizeEventIds(evaluationInput?.evidenceEventIds),
    explanation: cleanText(evaluationInput?.explanation, "프로필 청구 항목을 담당자가 검토합니다.", 2_000),
    rule,
    claimContext,
  };
}

function currentClaimEvaluation(state, evaluationInput) {
  const patientId = cleanText(evaluationInput?.patientId, "", 160);
  const patient = state.patients.find(({ id }) => id === patientId);
  if (evaluationInput?.sourceKind === "profile") {
    if (!patient) throw new TypeError("담당자 검토에 연결할 환자·프로필 항목·판정일이 유효하지 않습니다.");
    const evaluation = normalizeProfileClaimEvaluation(evaluationInput, patient);
    return { evaluation, patient, fingerprint: claimEvaluationFingerprint(evaluation, patient) };
  }
  const ruleId = cleanText(evaluationInput?.ruleId ?? evaluationInput?.rule?.id, "", CLAIM_REVIEW_RULE_ID_LIMIT);
  const asOf = validDate(evaluationInput?.asOf);
  const rule = state.rules.find(({ id }) => id === ruleId);
  if (!patient || !rule || !asOf) throw new TypeError("담당자 검토에 연결할 환자·규칙·판정일이 유효하지 않습니다.");
  const evaluation = evaluateClaimRule(patient, rule, asOf);
  if (evaluation.id !== cleanText(evaluationInput?.id, "", CLAIM_REVIEW_EVALUATION_ID_LIMIT)) {
    throw new TypeError("담당자 검토와 자동 규칙 판정의 식별자가 일치하지 않습니다.");
  }
  return { evaluation, patient, fingerprint: claimEvaluationFingerprint(evaluation, patient) };
}

function legacyClaimReviewStage(state, evaluationId) {
  for (let index = state.audit.length - 1; index >= 0; index -= 1) {
    const event = state.audit[index];
    if (event.entityId !== evaluationId || !event.action.startsWith(CLAIM_REVIEW_ACTION_PREFIX)) continue;
    const stage = event.action.slice(CLAIM_REVIEW_ACTION_PREFIX.length);
    if (CLAIM_REVIEW_STAGES.has(stage)) return stage;
  }
  return "new";
}

function resolveClaimReviewFromState(state, evaluationInput) {
  const context = currentClaimEvaluation(state, evaluationInput);
  const stored = state.claimReviews.find(({ evaluationId }) => evaluationId === context.evaluation.id);
  if (!stored) {
    const legacyStage = legacyClaimReviewStage(state, context.evaluation.id);
    return {
      ...context,
      stage: "new",
      stale: legacyStage !== "new",
      legacy: legacyStage !== "new",
      invalidatedFrom: legacyStage !== "new" ? legacyStage : "",
      invalidatedAt: "",
      assignee: "",
      reviewer: "",
      transitionReason: "",
      opinion: "",
      outcome: "",
      history: [],
      stored: null,
    };
  }
  const fingerprintChanged = stored.fingerprint !== context.fingerprint;
  const stale = Boolean(stored.invalidatedAt) || (fingerprintChanged && stored.stage !== "new");
  return {
    ...context,
    stage: fingerprintChanged ? "new" : stored.stage,
    stale,
    legacy: false,
    invalidatedFrom: fingerprintChanged && stored.stage !== "new" ? stored.stage : stored.invalidatedFrom,
    invalidatedAt: stored.invalidatedAt,
    assignee: stored.assignee ?? "",
    reviewer: stored.reviewer,
    transitionReason: stored.transitionReason,
    opinion: stored.opinion,
    outcome: stored.outcome,
    history: stored.history,
    stored,
  };
}

export function resolveClaimReview(stateInput, evaluationInput) {
  return resolveClaimReviewFromState(normalizeEmrState(stateInput), evaluationInput);
}

function claimReviewRecord(context, stage, now, options = {}) {
  const stored = context.stored ?? {};
  return normalizeClaimReview({
    evaluationId: context.evaluation.id,
    patientId: context.evaluation.patientId,
    ruleId: context.evaluation.ruleId,
    sourceKind: context.evaluation.sourceKind ?? stored.sourceKind ?? "",
    sourceId: context.evaluation.sourceId ?? stored.sourceId ?? "",
    stage,
    fingerprint: context.fingerprint,
    calculatedStatus: context.evaluation.status,
    calculatedAsOf: context.evaluation.asOf,
    invalidatedAt: options.invalidatedAt ?? "",
    invalidatedFrom: options.invalidatedFrom ?? "",
    assignee: options.assignee ?? stored.assignee ?? "",
    reviewer: options.reviewer ?? stored.reviewer ?? "",
    transitionReason: options.transitionReason ?? stored.transitionReason ?? "",
    opinion: options.opinion ?? stored.opinion ?? "",
    outcome: options.outcome ?? stored.outcome ?? "",
    history: options.history ?? stored.history ?? [],
    updatedAt: now,
  }, now);
}

function claimReviewInvalidationReason(view) {
  const previousStatus = view.stored?.calculatedStatus || "이전 판정";
  const previousAsOf = view.stored?.calculatedAsOf || "이전 판정일";
  return `자동 판정·근거·규칙 또는 판정일 변경 · ${previousStatus}(${previousAsOf}) → ${view.evaluation.status}(${view.evaluation.asOf})`;
}

function claimReviewInvalidationHistory(view, now, history = view.stored?.history ?? []) {
  const from = view.invalidatedFrom || view.stored?.stage || "reviewed";
  return appendClaimReviewHistory(history, {
    at: now,
    from,
    to: "new",
    assignee: view.stored?.assignee ?? "",
    reviewer: "자동 규칙 엔진",
    reason: claimReviewInvalidationReason(view),
    opinion: "",
    outcome: "",
    inputMethod: "system",
  });
}

function claimReviewInvalidationAudit(view, now) {
  const from = view.invalidatedFrom || view.stored?.stage || "reviewed";
  return audit("claim-review.invalidated", now, {
    patientId: view.evaluation.patientId,
    entityId: view.evaluation.id,
    detail: `${CLAIM_REVIEW_STAGE_LABELS[from]} → ${CLAIM_REVIEW_STAGE_LABELS.new} · ${claimReviewInvalidationReason(view)}`,
  });
}

export function setClaimReviewStage(
  stateInput,
  evaluationInput,
  nextStage,
  detail = "",
  now = new Date().toISOString(),
  metadata = {},
) {
  const state = normalizeEmrState(stateInput);
  if (!CLAIM_REVIEW_STAGES.has(nextStage)) throw new TypeError("담당자 검토 단계가 유효하지 않습니다.");
  const view = resolveClaimReviewFromState(state, evaluationInput);
  const at = validTimestamp(now);
  const input = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);
  const stored = view.stored ?? {};
  const stageChanged = view.stage !== nextStage;
  const legacyDetail = cleanText(detail, "", 2_000);
  const assignee = has("assignee") ? cleanText(input.assignee, "", 120) : stored.assignee ?? "";
  const reviewer = has("reviewer") ? cleanText(input.reviewer, "", 120) : stored.reviewer ?? "";
  const transitionReason = has("reason")
    ? cleanText(input.reason, "", 2_000)
    : stageChanged && legacyDetail
      ? legacyDetail
      : stored.transitionReason ?? "";
  const opinion = has("opinion") ? cleanText(input.opinion, "", 8_000) : stored.opinion ?? "";
  let outcome = has("outcome") ? normalizeClaimReviewOutcome(input.outcome) : stored.outcome ?? "";
  if (stageChanged && nextStage !== "reviewed" && !has("outcome")) outcome = "";
  if (stageChanged && view.stale && !has("outcome")) outcome = "";
  const metadataChanged = assignee !== (stored.assignee ?? "")
    || reviewer !== (stored.reviewer ?? "")
    || transitionReason !== (stored.transitionReason ?? "")
    || opinion !== (stored.opinion ?? "")
    || outcome !== (stored.outcome ?? "");
  if (!stageChanged && !metadataChanged) return state;

  let history = stored.history ?? [];
  if (view.stale && !view.invalidatedAt && view.invalidatedFrom) {
    history = claimReviewInvalidationHistory(view, at, history);
  }
  history = appendClaimReviewHistory(history, {
    at,
    from: view.stage,
    to: nextStage,
    assignee,
    reviewer,
    reason: has("reason") ? transitionReason : stageChanged ? legacyDetail || transitionReason : "",
    opinion,
    outcome,
    inputMethod: has("inputMethod") ? cleanText(input.inputMethod, "", 80) : "",
  });
  const preservesInvalidation = !stageChanged && nextStage === "new";
  const next = claimReviewRecord(view, nextStage, at, {
    invalidatedAt: preservesInvalidation ? view.invalidatedAt : "",
    invalidatedFrom: preservesInvalidation ? view.invalidatedFrom : "",
    assignee,
    reviewer,
    transitionReason,
    opinion,
    outcome,
    history,
  });
  const claimReviews = state.claimReviews.filter(({ evaluationId }) => evaluationId !== next.evaluationId);
  claimReviews.push(next);
  const auditEvents = [];
  if (view.stale && !view.invalidatedAt) auditEvents.push(claimReviewInvalidationAudit(view, at));
  auditEvents.push(audit(`${CLAIM_REVIEW_ACTION_PREFIX}${nextStage}`, at, {
    patientId: view.evaluation.patientId,
    entityId: view.evaluation.id,
    detail: legacyDetail || `${CLAIM_REVIEW_STAGE_LABELS[view.stage]} → ${CLAIM_REVIEW_STAGE_LABELS[nextStage]}${transitionReason ? ` · ${transitionReason}` : ""}`,
  }));
  return {
    ...state,
    revision: state.revision + 1,
    claimReviews,
    audit: [...state.audit, ...auditEvents].slice(-1_000),
    updatedAt: at,
  };
}

export function reconcileClaimReviews(stateInput, evaluationInputs = [], now = new Date().toISOString()) {
  const state = normalizeEmrState(stateInput);
  const inputs = new Map((Array.isArray(evaluationInputs) ? evaluationInputs : [])
    .map((evaluation) => [cleanText(evaluation?.id, "", CLAIM_REVIEW_EVALUATION_ID_LIMIT), evaluation])
    .filter(([id]) => Boolean(id)));
  const at = validTimestamp(now);
  const reviews = [];
  const invalidationAudits = [];
  let changed = false;
  const handled = new Set();
  for (const stored of state.claimReviews) {
    const input = inputs.get(stored.evaluationId);
    if (!input) {
      reviews.push(stored);
      continue;
    }
    const view = resolveClaimReviewFromState(state, input);
    handled.add(stored.evaluationId);
    if (stored.fingerprint === view.fingerprint) {
      reviews.push(stored);
      continue;
    }
    changed = true;
    if (stored.stage === "new") {
      reviews.push(claimReviewRecord(view, "new", at, {
        invalidatedAt: stored.invalidatedAt,
        invalidatedFrom: stored.invalidatedFrom,
      }));
      continue;
    }
    reviews.push(claimReviewRecord(view, "new", at, {
      invalidatedAt: at,
      invalidatedFrom: stored.stage,
      history: claimReviewInvalidationHistory(view, at),
    }));
    invalidationAudits.push(claimReviewInvalidationAudit(view, at));
  }
  for (const [evaluationId, input] of inputs) {
    if (handled.has(evaluationId) || state.claimReviews.some((review) => review.evaluationId === evaluationId)) continue;
    const view = resolveClaimReviewFromState(state, input);
    if (!view.legacy || !view.invalidatedFrom) continue;
    changed = true;
    reviews.push(claimReviewRecord(view, "new", at, {
      invalidatedAt: at,
      invalidatedFrom: view.invalidatedFrom,
      history: claimReviewInvalidationHistory(view, at),
    }));
    invalidationAudits.push(claimReviewInvalidationAudit(view, at));
  }
  if (!changed) return state;
  return {
    ...state,
    revision: state.revision + 1,
    claimReviews: reviews,
    audit: [...state.audit, ...invalidationAudits].slice(-1_000),
    updatedAt: at,
  };
}

export function selectPatient(stateInput, patientId) {
  const state = normalizeEmrState(stateInput);
  return state.patients.some(({ id }) => id === patientId)
    ? { ...state, selectedPatientId: patientId, selectedEncounterId: state.selectedPatientId === patientId ? state.selectedEncounterId : "" }
    : state;
}

export function selectEncounter(stateInput, patientId, encounterId) {
  const state = normalizeEmrState(stateInput);
  const patient = state.patients.find(({ id }) => id === patientId);
  if (!patient?.events.some((event) => event.type === "encounter" && event.id === encounterId)) return state;
  return { ...state, selectedPatientId: patientId, selectedEncounterId: encounterId };
}

function dateBefore(asOf, days) {
  const timestamp = new Date(`${asOf}T00:00:00.000Z`).valueOf();
  return new Date(timestamp - days * 86_400_000).toISOString().slice(0, 10);
}

function demoEvent(id, type, code, label, date, extras = {}) {
  return normalizePatientEvent({ id, type, code, label, date, source: { kind: "demo", label: "VitaGraph 예시 환자 기록" }, ...extras });
}

export function createDemoEmrState(now = new Date().toISOString()) {
  const timestamp = validTimestamp(now);
  const asOf = timestamp.slice(0, 10);
  const arrivedAt = new Date(new Date(timestamp).valueOf() - 12 * 60_000).toISOString();
  const startedAt = new Date(new Date(timestamp).valueOf() - 7 * 60_000).toISOString();
  const first = createPatient({
    id: "demo-patient-kim",
    mrn: "VG-1001",
    name: "김비타",
    birthDate: "1974-04-12",
    sex: "female",
    phone: "010-0000-1001",
    address: "서울시 한빛구",
    bloodType: "A+",
    insuranceType: "national-health",
    emergencyContact: { name: "김보호", relation: "가족", phone: "010-0000-9001" },
    memo: "예시 환자 · 실제 인물이 아닙니다.",
    events: [
      demoEvent("kim-visit-today", "encounter", "AMB", "내분비내과 외래", asOf, {
        recordStatus: "draft",
        status: "in-progress",
        arrivedAt,
        startedAt,
        department: "내분비내과",
        clinician: "이선우",
        room: "3진료실",
        chiefComplaint: "혈압·당뇨 추적 상담",
        soap: {
          subjective: "최근 어지럼은 없으며 처방약을 규칙적으로 복용했다고 말함.",
          objective: "최근 혈압과 당화혈색소 결과를 검토함.",
          assessment: "고혈압과 제2형 당뇨 추적 평가.",
          plan: "복약 지속 여부와 추적검사 계획을 설명함.",
        },
        signature: { status: "unsigned", signer: "", signedAt: "" },
      }),
      demoEvent("kim-visit-dx", "condition", "I10", "고혈압", asOf, {
        recordStatus: "draft",
        encounterId: "kim-visit-today",
        system: KCD_SYSTEM,
        status: "active",
        clinicalStatus: "active",
        verificationStatus: "confirmed",
        diagnosisRole: "primary",
      }),
      demoEvent("kim-visit-med", "medication", "MED-ARB", "예시 혈압약", asOf, {
        recordStatus: "draft",
        encounterId: "kim-visit-today",
        system: "urn:vitagraph:demo:drug",
        status: "active",
        intent: "order",
        prescription: { dose: 1, doseUnit: "정", route: "경구", frequency: "1일 1회", durationDays: 30, quantity: 30, instructions: "아침 식후" },
      }),
      demoEvent("kim-visit-order", "service-request", "DEMO-A1C-FOLLOWUP", "당화혈색소 추적검사", asOf, {
        recordStatus: "draft",
        encounterId: "kim-visit-today",
        system: "urn:vitagraph:demo:service",
        status: "active",
        intent: "order",
        order: { kind: "laboratory", priority: "routine", instructions: "다음 내원 전 시행" },
      }),
      demoEvent("kim-encounter", "encounter", "AMB", "내분비내과 외래", dateBefore(asOf, 4), { note: "혈압과 당화혈색소 추적" }),
      demoEvent("kim-bp", "observation", "85354-9", "혈압", dateBefore(asOf, 9), { system: "http://loinc.org", value: "148/94", unit: "mmHg" }),
      demoEvent("kim-a1c", "observation", "4548-4", "당화혈색소", dateBefore(asOf, 12), { system: "http://loinc.org", value: 7.1, unit: "%" }),
      demoEvent("kim-ldl", "observation", "2089-1", "LDL 콜레스테롤", dateBefore(asOf, 12), { system: "http://loinc.org", value: 156, unit: "mg/dL" }),
      demoEvent("kim-med", "medication", "MED-ARB", "예시 혈압약", dateBefore(asOf, 28), { status: "active", note: "1일 1회" }),
      demoEvent("kim-procedure", "procedure", "DEMO-BP-FOLLOWUP", "고혈압 추적검사", dateBefore(asOf, 55), { system: "urn:vitagraph:demo:service", status: "completed" }),
      demoEvent("kim-diabetes", "condition", "E11", "제2형 당뇨병", dateBefore(asOf, 940), { system: KCD_SYSTEM, status: "active" }),
      demoEvent("kim-hypertension", "condition", "I10", "고혈압", dateBefore(asOf, 1_460), { system: KCD_SYSTEM, status: "active" }),
      demoEvent("kim-allergy", "allergy", "ALG-PEN", "페니실린 알레르기", dateBefore(asOf, 2_100), { status: "active", note: "발진" }),
      demoEvent("kim-pneumonia-encounter", "encounter", "IMP", "호흡기내과 입원", dateBefore(asOf, 150), {
        status: "finished",
        department: "호흡기내과",
        clinician: "한가람",
        chiefComplaint: "발열·기침·호흡곤란을 동반한 지역사회획득 폐렴 입원",
        note: "7차 폐렴 적정성 평가 흐름을 설명하기 위한 예시 과거 입원",
        soap: {
          subjective: "발열, 객담을 동반한 기침과 운동 시 호흡곤란을 호소함.",
          objective: "산소포화도·흉부 영상·초기 미생물검사와 중증도 기록을 확인함.",
          assessment: "지역사회획득 폐렴으로 입원 치료가 필요한 상태를 평가함.",
          plan: "정맥 항생제 투여와 호흡 상태 추적, 퇴원 후 경과 확인을 계획함.",
        },
        signature: { status: "signed", signer: "한가람", signedAt: `${dateBefore(asOf, 150)}T12:00:00.000Z` },
      }),
      demoEvent("kim-pneumonia", "condition", "J18.9", "상세불명 병원체의 폐렴", dateBefore(asOf, 150), {
        encounterId: "kim-pneumonia-encounter",
        system: KCD_SYSTEM,
        status: "active",
        clinicalStatus: "active",
        verificationStatus: "confirmed",
        diagnosisRole: "primary",
      }),
    ],
  }, timestamp);
  const second = createPatient({
    id: "demo-patient-park",
    mrn: "VG-1002",
    name: "박여정",
    birthDate: "1958-11-03",
    sex: "male",
    bloodType: "unknown",
    insuranceType: "national-health",
    memo: "예시 환자 · 실제 인물이 아닙니다.",
    events: [
      demoEvent("park-visit-today", "encounter", "AMB", "신경과 외래", asOf, {
        recordStatus: "draft",
        status: "arrived",
        arrivedAt: timestamp,
        department: "신경과",
        clinician: "박지안",
        room: "5진료실",
        signature: { status: "unsigned", signer: "", signedAt: "" },
      }),
      demoEvent("park-encounter", "encounter", "AMB", "신경과 외래", dateBefore(asOf, 2), { note: "두통 빈도와 약물 사용 확인" }),
      demoEvent("park-symptom", "symptom", "SYM-HEADACHE", "반복되는 두통", dateBefore(asOf, 2), { note: "월 5회, 빛에 민감" }),
      demoEvent("park-migraine", "condition", "G43", "편두통", dateBefore(asOf, 460), { status: "active" }),
      demoEvent("park-med", "medication", "MED-TRIPTAN", "예시 편두통 약", dateBefore(asOf, 35), { status: "active", note: "증상 시 복용" }),
      demoEvent("park-bmd-indication", "condition", "DEMO-BMD-INDICATION", "골밀도검사 적응증 확인 기록", dateBefore(asOf, 40), { system: "urn:vitagraph:demo:condition", status: "active" }),
      demoEvent("park-bmd", "procedure", "DEMO-BMD", "골밀도검사", dateBefore(asOf, 350), { system: "urn:vitagraph:demo:service", status: "completed" }),
      demoEvent("park-copd-encounter", "encounter", "AMB", "호흡기내과 외래", dateBefore(asOf, 90), {
        status: "finished",
        department: "호흡기내과",
        clinician: "한가람",
        chiefComplaint: "반복 COPD 상병과 처방 근거 재확인",
        note: "진단 근거 보완이 필요한 COPD 예시 사례",
        soap: {
          subjective: "반복된 COPD 상병과 경구약 처방 기록을 함께 검토하기 위해 내원함.",
          objective: "F6002 시행 코드는 있으나 구조화된 post-BD 결과와 노출력 기록은 확인되지 않음.",
          assessment: "COPD 진단 근거와 현재 처방의 임상·청구 정합성을 재확인할 필요가 있음.",
          plan: "과거 PFT 판독과 증상·노출력 자료를 확인하고 진단 및 치료 계획을 재검토함.",
        },
        signature: { status: "signed", signer: "한가람", signedAt: `${dateBefore(asOf, 90)}T12:00:00.000Z` },
      }),
      demoEvent("park-copd", "condition", "J44.9", "만성폐쇄성폐질환", dateBefore(asOf, 90), {
        encounterId: "park-copd-encounter",
        system: KCD_SYSTEM,
        status: "active",
        clinicalStatus: "active",
        verificationStatus: "confirmed",
        diagnosisRole: "primary",
      }),
      demoEvent("park-copd-pft-procedure", "procedure", "F6002", "폐기능검사 시행 기록", dateBefore(asOf, 88), {
        encounterId: "park-copd-encounter",
        system: "urn:hira:fee-code",
        status: "completed",
        note: "시행 코드는 확인되지만 post-BD 구조화 결과는 없는 예시 기록",
      }),
    ],
  }, timestamp);
  const third = createPatient({
    id: "demo-patient-lee",
    mrn: "VG-1003",
    name: "이준호",
    birthDate: "1959-02-18",
    sex: "male",
    bloodType: "B+",
    insuranceType: "national-health",
    memo: "예시 환자 · 실제 인물이 아닙니다.",
    events: [
      demoEvent("lee-visit-today", "encounter", "AMB", "순환기내과 외래", asOf, {
        recordStatus: "draft",
        status: "arrived",
        arrivedAt: new Date(new Date(timestamp).valueOf() - 25 * 60_000).toISOString(),
        department: "순환기내과",
        clinician: "이선우",
        room: "2진료실",
        chiefComplaint: "혈압약 복용 후 시작된 야간 기침 상담",
        signature: { status: "unsigned", signer: "", signedAt: "" },
      }),
      demoEvent("lee-cough", "symptom", "SYM-COUGH", "지난 2주 동안 심해진 야간 기침", dateBefore(asOf, 1), {
        note: "밤에 누우면 마른기침이 잦아짐",
      }),
      demoEvent("lee-ace", "medication", "C09AA03", "리시노프릴 예시 처방", dateBefore(asOf, 18), {
        system: "http://www.whocc.no/atc",
        status: "active",
        note: "1일 1회 아침 복용",
      }),
      demoEvent("lee-bp", "observation", "85354-9", "혈압", dateBefore(asOf, 3), {
        system: "http://loinc.org",
        value: "142/88",
        unit: "mmHg",
      }),
      demoEvent("lee-hypertension", "condition", "I10", "고혈압", dateBefore(asOf, 1_825), {
        system: KCD_SYSTEM,
        status: "active",
      }),
      demoEvent("lee-copd-encounter", "encounter", "AMB", "호흡기내과 외래", dateBefore(asOf, 92), {
        status: "finished",
        department: "호흡기내과",
        clinician: "한가람",
        room: "8진료실",
        chiefComplaint: "만성 운동 시 호흡곤란·기침·객담 추적",
        note: "COPD 예시의 이전 확정 진료",
      }),
      demoEvent("lee-copd", "condition", "J44.9", "만성폐쇄성폐질환", dateBefore(asOf, 92), {
        encounterId: "lee-copd-encounter",
        system: KCD_SYSTEM,
        status: "active",
        clinicalStatus: "active",
        verificationStatus: "confirmed",
        diagnosisRole: "primary",
      }),
      demoEvent("lee-copd-symptom", "symptom", "SYM-COPD-CONTEXT", "만성 운동 시 호흡곤란·기침·객담", dateBefore(asOf, 92), {
        encounterId: "lee-copd-encounter",
        note: "40갑년 흡연력과 함께 기록된 예시 임상 맥락",
      }),
      demoEvent("lee-copd-pft", "procedure", "F6002", "기관지확장제 전후 폐활량검사", dateBefore(asOf, 90), {
        encounterId: "lee-copd-encounter",
        system: "urn:hira:fee-code",
        status: "completed",
        note: "post-BD FEV₁/FVC 0.64 · 구조화 상세는 COPD 평가 상세 참조",
      }),
      demoEvent("lee-copd-lama", "medication", "DEMO-LAMA", "LAMA 흡입제", dateBefore(asOf, 89), {
        encounterId: "lee-copd-encounter",
        system: "urn:vitagraph:demo:drug",
        status: "active",
        note: "흡입기 사용법과 증상 변화를 추적한 예시 기록",
      }),
    ],
  }, timestamp);
  const fourth = createPatient({
    id: "demo-patient-choi",
    mrn: "VG-1004",
    name: "최민아",
    birthDate: "1985-09-27",
    sex: "female",
    bloodType: "O+",
    insuranceType: "national-health",
    memo: "예시 환자 · 실제 인물이 아닙니다.",
    events: [
      demoEvent("choi-visit-today", "encounter", "AMB", "소화기내과 외래", asOf, {
        recordStatus: "draft",
        status: "arrived",
        arrivedAt: new Date(new Date(timestamp).valueOf() - 18 * 60_000).toISOString(),
        department: "소화기내과",
        clinician: "정다온",
        room: "6진료실",
        chiefComplaint: "야식 뒤 속쓰림과 식사 조절 상담",
        signature: { status: "unsigned", signer: "", signedAt: "" },
      }),
      demoEvent("choi-reflux-symptom", "symptom", "SYM-HEARTBURN", "늦은 식사 뒤 반복되는 속쓰림", dateBefore(asOf, 2), {
        note: "주 3회 정도, 취침 전 악화",
      }),
      demoEvent("choi-reflux", "condition", "K21", "위식도역류", dateBefore(asOf, 210), {
        system: KCD_SYSTEM,
        status: "active",
      }),
      demoEvent("choi-med", "medication", "MED-PPI", "예시 위산 억제제", dateBefore(asOf, 30), {
        status: "active",
        note: "아침 식전 복용",
      }),
      demoEvent("choi-weight", "observation", "29463-7", "체중", dateBefore(asOf, 7), {
        system: "http://loinc.org",
        value: 62.4,
        unit: "kg",
      }),
      demoEvent("choi-pneumonia-encounter", "encounter", "IMP", "호흡기내과 입원", dateBefore(asOf, 175), {
        status: "finished",
        department: "호흡기내과",
        clinician: "한가람",
        chiefComplaint: "발열·기침을 동반한 지역사회획득 폐렴 입원",
        note: "혈액배양 채혈 순서를 확인하는 예시 혼합 사례",
        soap: {
          subjective: "발열과 누런 객담을 동반한 기침이 지속되어 내원함.",
          objective: "흉부 영상의 폐침윤과 산소포화도, 초기 항생제·배양검사 시각을 확인함.",
          assessment: "지역사회획득 폐렴 입원 치료 사례로 평가함.",
          plan: "정맥 항생제 치료와 호흡 상태를 추적하고 배양검사 시각 기록을 보완함.",
        },
        signature: { status: "signed", signer: "한가람", signedAt: `${dateBefore(asOf, 175)}T12:00:00.000Z` },
      }),
      demoEvent("choi-pneumonia", "condition", "J18.9", "상세불명 병원체의 폐렴", dateBefore(asOf, 175), {
        encounterId: "choi-pneumonia-encounter",
        system: KCD_SYSTEM,
        status: "active",
        clinicalStatus: "active",
        verificationStatus: "confirmed",
        diagnosisRole: "primary",
      }),
    ],
  }, timestamp);
  const fifth = createPatient({
    id: "demo-patient-jung",
    mrn: "VG-1005",
    name: "정수진",
    birthDate: "1959-06-08",
    sex: "female",
    bloodType: "AB+",
    insuranceType: "national-health",
    memo: "예시 환자 · 실제 인물이 아닙니다.",
    events: [
      demoEvent("jung-visit-today", "encounter", "AMB", "재활의학과 외래", asOf, {
        recordStatus: "draft",
        status: "arrived",
        arrivedAt: new Date(new Date(timestamp).valueOf() - 4 * 60_000).toISOString(),
        department: "재활의학과",
        clinician: "한가람",
        room: "4진료실",
        chiefComplaint: "무릎 통증에 맞는 운동 종류와 강도 상담",
        signature: { status: "unsigned", signer: "", signedAt: "" },
      }),
      demoEvent("jung-knee-pain", "symptom", "SYM-KNEE-PAIN", "계단에서 심해지는 오른쪽 무릎 통증", dateBefore(asOf, 3), {
        note: "걷기는 가능하나 오래 걸으면 통증 증가",
      }),
      demoEvent("jung-arthritis", "condition", "M17", "무릎 골관절염", dateBefore(asOf, 680), {
        system: KCD_SYSTEM,
        status: "active",
      }),
      demoEvent("jung-therapy", "procedure", "DEMO-PT", "무릎 재활운동 교육", dateBefore(asOf, 45), {
        system: "urn:vitagraph:demo:service",
        status: "completed",
      }),
      demoEvent("jung-bmi", "observation", "39156-5", "체질량지수", dateBefore(asOf, 12), {
        system: "http://loinc.org",
        value: 26.1,
        unit: "kg/m2",
      }),
      demoEvent("jung-copd-encounter", "encounter", "AMB", "호흡기내과 외래", dateBefore(asOf, 53), {
        status: "finished",
        department: "호흡기내과",
        clinician: "한가람",
        chiefComplaint: "타기관 폐기능검사 출처 확인과 흡입제 추적",
        soap: {
          subjective: "타기관 폐기능검사 자료 확인과 현재 흡입제 사용 상태 점검을 위해 내원함.",
          objective: "외부 PFT는 환자 일치·검증 시각 확인 전이며 LAMA 흡입제 처방은 확인됨.",
          assessment: "COPD 진단 근거의 출처 검증과 지속 방문 기준을 추가 확인할 필요가 있음.",
          plan: "외부 원본과 판독을 확인하고 흡입기 사용법 및 다음 추적 일정을 검토함.",
        },
        signature: { status: "signed", signer: "한가람", signedAt: `${dateBefore(asOf, 53)}T12:00:00.000Z` },
      }),
      demoEvent("jung-copd", "condition", "J44.9", "만성폐쇄성폐질환", dateBefore(asOf, 53), {
        encounterId: "jung-copd-encounter",
        system: KCD_SYSTEM,
        status: "active",
        clinicalStatus: "active",
        verificationStatus: "confirmed",
        diagnosisRole: "primary",
      }),
      demoEvent("jung-copd-lama", "medication", "DEMO-LAMA", "LAMA 흡입제", dateBefore(asOf, 53), {
        encounterId: "jung-copd-encounter",
        system: "urn:vitagraph:demo:drug",
        status: "active",
        intent: "order",
        prescription: {
          dose: 1,
          doseUnit: "회",
          route: "흡입",
          frequency: "1일 1회",
          durationDays: 30,
          quantity: 30,
          instructions: "매일 같은 시간에 흡입하고 사용법을 추적 진료에서 확인",
        },
        note: "타기관 PFT는 확인 중이며 흡입제 처방 기록은 확인됨",
      }),
      demoEvent("jung-pneumonia-encounter", "encounter", "IMP", "호흡기내과 입원", dateBefore(asOf, 230), {
        status: "finished",
        department: "호흡기내과",
        clinician: "한가람",
        chiefComplaint: "지역사회획득 폐렴 입원 치료",
        note: "중증도 판정도구 기록 보완이 필요한 예시 사례",
        soap: {
          subjective: "발열과 객담성 기침, 호흡 불편을 호소하여 내원함.",
          objective: "흉부 영상과 산소포화도, 배양검사 및 초기 항생제 기록을 확인함.",
          assessment: "지역사회획득 폐렴으로 입원 치료하며 중증도 도구 기록 보완이 필요함.",
          plan: "정맥 항생제와 경과 관찰을 시행하고 CURB-65·PSI 기록 여부를 재확인함.",
        },
        signature: { status: "signed", signer: "한가람", signedAt: `${dateBefore(asOf, 230)}T12:00:00.000Z` },
      }),
      demoEvent("jung-pneumonia", "condition", "J18.9", "상세불명 병원체의 폐렴", dateBefore(asOf, 230), {
        encounterId: "jung-pneumonia-encounter",
        system: KCD_SYSTEM,
        status: "active",
        clinicalStatus: "active",
        verificationStatus: "confirmed",
        diagnosisRole: "primary",
      }),
    ],
  }, timestamp);
  return {
    schema: EMR_SCHEMA,
    version: EMR_VERSION,
    revision: 0,
    demo: true,
    selectedPatientId: first.id,
    selectedEncounterId: "kim-visit-today",
    patients: [first, second, third, fourth, fifth],
    rules: DEFAULT_CLAIM_RULES.map((rule) => normalizeClaimRule(rule)),
    claimReviews: [],
    audit: [audit("demo.loaded", timestamp, { detail: "5 patients" })],
    storageError: "",
    recoveryRaw: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function conditionIdForEvent(event) {
  const searchable = `${event.code} ${event.label}`.toLowerCase();
  if (/\bi10\b|고혈압/.test(searchable)) return "hypertension";
  if (/\be11\b|당뇨/.test(searchable)) return "diabetes";
  if (/\be78\b|지질|ldl/.test(searchable)) return "dyslipidemia";
  if (/\bg43\b|편두통/.test(searchable)) return "migraine";
  if (/\bk21\b|역류|속쓰림/.test(searchable)) return "reflux";
  if (/\bj45\b|천식/.test(searchable)) return "asthma";
  if ((/\bj4[34](?:\.|\b)|copd|만성폐쇄성폐질환|폐기종/.test(searchable)) && !/\bj43\.0(?:\b|\.)/.test(searchable)) return "copd";
  if (/\bj1[2-8](?:\.|\b)|\bj1[01]\.0(?:\.|\b)|폐렴/.test(searchable)) return "pneumonia";
  if (/\bf3[2-4]\b|\bf4[01]\b|우울|불안/.test(searchable)) return "mood";
  if (/\bm(?:05|06|1[5-9])\b|관절염/.test(searchable)) return "arthritis";
  return "";
}

export const CLINICAL_BODY_AREAS = Object.freeze([
  Object.freeze({ id: "neuro", title: "뇌·신경", department: "신경과" }),
  Object.freeze({ id: "mental", title: "마음·수면", department: "정신건강의학과" }),
  Object.freeze({ id: "sensory", title: "눈·귀·코", department: "안과·이비인후과" }),
  Object.freeze({ id: "cardio", title: "심장·혈관", department: "순환기내과" }),
  Object.freeze({ id: "respiratory", title: "폐·호흡", department: "호흡기내과" }),
  Object.freeze({ id: "digestive", title: "위·장·간", department: "소화기내과" }),
  Object.freeze({ id: "endocrine", title: "대사·호르몬", department: "내분비내과" }),
  Object.freeze({ id: "renal", title: "신장·수분", department: "신장내과" }),
  Object.freeze({ id: "pelvic", title: "골반·비뇨", department: "산부인과·비뇨의학과" }),
  Object.freeze({ id: "musculoskeletal", title: "뼈·관절", department: "정형외과·재활의학과" }),
  Object.freeze({ id: "rheumatology", title: "면역·관절", department: "류마티스내과" }),
  Object.freeze({ id: "dermatology", title: "피부·알레르기", department: "피부과·알레르기내과" }),
]);

const CLINICAL_BODY_AREA_IDS = new Set(CLINICAL_BODY_AREAS.map(({ id }) => id));
const CLINICAL_DEPARTMENT_PATTERNS = {
  neuro: [/신경과/],
  mental: [/정신건강의학과/, /정신과/],
  sensory: [/안과/, /이비인후과/],
  cardio: [/순환기내과/, /심장내과/, /심혈관내과/, /심장혈관흉부외과/, /흉부외과/],
  respiratory: [/호흡기내과/, /호흡기과/],
  digestive: [/소화기내과/, /소화기과/, /간담췌외과/],
  endocrine: [/내분비(?:대사)?내과/, /내분비과/],
  renal: [/신장내과/, /신장병내과/, /신장과/],
  pelvic: [/산부인과/, /비뇨의학과/, /비뇨기과/],
  musculoskeletal: [/정형외과/, /재활의학과/],
  rheumatology: [/류마티스내과/],
  dermatology: [/피부과/, /알레르기내과/],
};

function bodyAreasForDepartmentText(value) {
  if (!value) return [];
  return CLINICAL_BODY_AREAS
    .filter(({ id }) => CLINICAL_DEPARTMENT_PATTERNS[id].some((pattern) => pattern.test(value)))
    .map(({ id }) => id);
}

function encounterBodyAssociation(encounter) {
  const departmentAreaIds = bodyAreasForDepartmentText(encounter.department);
  if (departmentAreaIds.length === 1) {
    return {
      areaId: departmentAreaIds[0],
      kind: "declared",
      sourceField: "department",
      value: encounter.department,
      basis: "Encounter 진료과 필드에 명시된 단일 진료과",
    };
  }
  if (departmentAreaIds.length > 1) {
    return {
      areaId: "",
      kind: "ambiguous",
      sourceField: "department",
      value: encounter.department,
      basis: "Encounter 진료과 필드에 복수 진료과가 있어 자동 귀속하지 않음",
      candidateAreaIds: departmentAreaIds,
    };
  }
  const labelAreaIds = bodyAreasForDepartmentText(encounter.label);
  if (labelAreaIds.length > 1) {
    return {
      areaId: "",
      kind: "ambiguous",
      sourceField: "label",
      value: encounter.label,
      basis: "Encounter 표시명에 복수 진료과가 있어 자동 귀속하지 않음",
      candidateAreaIds: labelAreaIds,
    };
  }
  return labelAreaIds.length === 1
    ? {
        areaId: labelAreaIds[0],
        kind: "classified",
        sourceField: "label",
        value: encounter.label,
        basis: "Encounter 표시명에 포함된 진료과 분류 후보 · 확인된 진료과로 집계하지 않음",
        candidateAreaIds: labelAreaIds,
      }
    : null;
}

function encounterLifecycle(event) {
  if (event.recordStatus === "draft" && ["arrived", "in-progress", "finished"].includes(event.status)) {
    return {
      lifecycle: "draft",
      lifecycleLabel: event.status === "arrived"
        ? "접수"
        : event.status === "in-progress" ? "진료 중" : "서명 대기",
    };
  }
  if (event.recordStatus === "final" && event.status === "finished") {
    return { lifecycle: "final", lifecycleLabel: "진료 완료" };
  }
  return null;
}

function medicationLifecycle(event) {
  if (event.recordStatus === "draft") return { lifecycle: "draft", lifecycleLabel: "처방 초안" };
  if (event.recordStatus === "final") return { lifecycle: "final", lifecycleLabel: "확정 처방" };
  return null;
}

function clinicalVisitProjection(event, association, lifecycle) {
  return {
    id: event.id,
    label: event.label,
    date: event.date,
    department: event.department,
    clinician: event.clinician,
    room: event.room,
    status: event.status,
    recordStatus: event.recordStatus,
    ...lifecycle,
    association: {
      kind: association.kind,
      sourceField: association.sourceField,
      value: association.value,
      basis: association.basis,
      ...(association.candidateAreaIds ? { candidateAreaIds: [...association.candidateAreaIds] } : {}),
    },
    source: event.source,
  };
}

function clinicalMedicationProjection(event, lifecycle, { association = null, unassignedReason = "" } = {}) {
  return {
    id: event.id,
    label: event.label,
    code: event.code,
    date: event.date,
    status: event.status,
    recordStatus: event.recordStatus,
    ...lifecycle,
    encounterId: event.encounterId,
    prescription: event.prescription,
    source: event.source,
    ...(association ? { association } : {}),
    ...(unassignedReason ? { unassignedReason } : {}),
  };
}

function isTrustedClinicalBodyEvent(event) {
  return !["fhir", "import"].includes(event?.source?.kind);
}

export function createClinicalBodyAtlas(patientInput = {}) {
  const patient = createPatient(patientInput);
  const encounterById = new Map(
    patient.events.filter(({ type }) => type === "encounter").map((event) => [event.id, event]),
  );
  const areas = CLINICAL_BODY_AREAS.map((area) => ({
    ...area,
    active: false,
    careActive: false,
    candidateActive: false,
    signalActive: false,
    candidateOnly: false,
    signalOnly: false,
    declaredVisitCount: 0,
    classifiedVisitCount: 0,
    declaredMedicationCount: 0,
    classifiedMedicationCount: 0,
    evidence: [],
    conditions: [],
    visits: [],
    medications: [],
  }));
  const areaById = new Map(areas.map((area) => [area.id, area]));

  const confirmedActiveConditions = patient.events.filter((event) => (
    event.type === "condition"
    && event.recordStatus === "final"
    && event.status === "active"
    && event.certainty === "confirmed"
    && (!event.verificationStatus || event.verificationStatus === "confirmed")
    && hasCompatibleEventLifecycle(event)
    && isTrustedClinicalBodyEvent(event)
  ));
  for (const condition of confirmedActiveConditions) {
    const conditionId = conditionIdForEvent(condition);
    const areaIds = (CONDITIONS[conditionId]?.departments ?? []).filter((areaId) => CLINICAL_BODY_AREA_IDS.has(areaId));
    for (const areaId of areaIds) {
      const area = areaById.get(areaId);
      const association = {
        kind: "classified",
        sourceField: "code-label",
        value: [condition.code, condition.label].filter(Boolean).join(" · "),
        basis: `확정 active 진단의 코드·표시명 기반 진료과 분류(${conditionId})`,
      };
      area.conditions.push({
        id: condition.id,
        label: condition.label,
        code: condition.code,
        date: condition.date,
        status: condition.status,
        recordStatus: condition.recordStatus,
        certainty: condition.certainty,
        conditionId,
        association,
        source: condition.source,
      });
      area.evidence.push({
        eventId: condition.id,
        eventType: "condition",
        label: condition.label,
        ...association,
      });
    }
  }

  const eligibleEncounterById = new Map();
  const mappedEncounterById = new Map();
  const unassignedEncounterById = new Map();
  const unassignedVisits = [];
  for (const encounter of patient.events.filter(({ type }) => type === "encounter")) {
    const lifecycle = encounterLifecycle(encounter);
    if (!lifecycle || !hasCompatibleEventLifecycle(encounter) || !isTrustedClinicalBodyEvent(encounter)) continue;
    eligibleEncounterById.set(encounter.id, encounter);
    const association = encounterBodyAssociation(encounter);
    if (!association?.areaId) {
      const unassignedReason = association?.kind === "ambiguous"
        ? "department-ambiguous"
        : association?.kind === "classified" ? "department-classified" : "department-unmapped";
      unassignedVisits.push({
        id: encounter.id,
        label: encounter.label,
        date: encounter.date,
        department: encounter.department,
        clinician: encounter.clinician,
        room: encounter.room,
        status: encounter.status,
        recordStatus: encounter.recordStatus,
        ...lifecycle,
        source: encounter.source,
        unassignedReason,
        ...(association ? { association } : {}),
      });
      unassignedEncounterById.set(encounter.id, {
        reason: unassignedReason,
        association,
      });
      continue;
    }
    const visit = clinicalVisitProjection(encounter, association, lifecycle);
    const area = areaById.get(association.areaId);
    area.visits.push(visit);
    area.evidence.push({
      eventId: encounter.id,
      eventType: "encounter",
      label: encounter.label,
      kind: association.kind,
      sourceField: association.sourceField,
      value: association.value,
      basis: association.basis,
      ...(association.candidateAreaIds ? { candidateAreaIds: [...association.candidateAreaIds] } : {}),
    });
    mappedEncounterById.set(encounter.id, {
      areaId: association.areaId,
      lifecycle: lifecycle.lifecycle,
      associationKind: association.kind,
      candidateAreaIds: association.candidateAreaIds ?? [],
    });
  }

  const unassignedMedications = [];
  for (const medication of patient.events.filter((event) => (
    event.type === "medication"
    && hasCompatibleEventLifecycle(event)
    && isTrustedClinicalBodyEvent(event)
  ))) {
    const lifecycle = medicationLifecycle(medication);
    if (!lifecycle) continue;
    const mappedEncounter = mappedEncounterById.get(medication.encounterId);
    const eligibleEncounter = eligibleEncounterById.get(medication.encounterId);
    if (mappedEncounter && mappedEncounter.lifecycle === lifecycle.lifecycle) {
      areaById.get(mappedEncounter.areaId).medications.push(clinicalMedicationProjection(medication, lifecycle, {
        association: {
          kind: "direct",
          sourceField: "encounterId",
          value: medication.encounterId,
          basis: "Medication.encounterId로 Encounter에 직접 연결",
          encounterAreaKind: mappedEncounter.associationKind,
          ...(mappedEncounter.candidateAreaIds.length
            ? { candidateAreaIds: [...mappedEncounter.candidateAreaIds] }
            : {}),
        },
      }));
      continue;
    }
    let unassignedReason = "lifecycle-mismatch";
    if (!medication.encounterId) unassignedReason = "encounter-not-linked";
    else if (!encounterById.has(medication.encounterId)) unassignedReason = "encounter-not-found";
    else if (!eligibleEncounter) unassignedReason = "encounter-not-eligible";
    else if (!mappedEncounter) {
      unassignedReason = unassignedEncounterById.get(medication.encounterId)?.reason ?? "department-unmapped";
    }
    const encounterAssociation = unassignedEncounterById.get(medication.encounterId)?.association;
    unassignedMedications.push(clinicalMedicationProjection(medication, lifecycle, {
      unassignedReason,
      ...(encounterAssociation ? {
        association: {
          kind: "direct",
          sourceField: "encounterId",
          value: medication.encounterId,
          basis: "Medication.encounterId로 자동 귀속하지 않은 Encounter에 직접 연결",
          encounterAreaKind: encounterAssociation.kind,
          candidateAreaIds: encounterAssociation.candidateAreaIds ?? [],
        },
      } : {}),
    }));
  }

  for (const area of areas) {
    area.declaredVisitCount = area.visits.filter(({ association }) => association.kind === "declared").length;
    area.classifiedVisitCount = area.visits.filter(({ association }) => association.kind === "classified").length;
    area.declaredMedicationCount = area.medications
      .filter(({ association }) => association.encounterAreaKind === "declared").length;
    area.classifiedMedicationCount = area.medications
      .filter(({ association }) => association.encounterAreaKind === "classified").length;
    area.careActive = area.declaredVisitCount > 0;
    area.candidateActive = area.classifiedVisitCount > 0;
    area.signalActive = area.conditions.length > 0;
    area.candidateOnly = area.candidateActive && !area.careActive && !area.signalActive;
    area.signalOnly = area.signalActive && !area.careActive && !area.candidateActive;
    area.active = area.careActive || area.candidateActive || area.signalActive;
  }
  const activeAreaIds = areas.filter(({ active }) => active).map(({ id }) => id);
  const careAreaIds = areas.filter(({ careActive }) => careActive).map(({ id }) => id);
  const candidateAreaIds = areas.filter(({ candidateActive }) => candidateActive).map(({ id }) => id);
  const signalAreaIds = areas.filter(({ signalActive }) => signalActive).map(({ id }) => id);
  return {
    schema: "vitagraph-clinical-body-atlas",
    areas,
    activeAreaIds,
    careAreaIds,
    candidateAreaIds,
    signalAreaIds,
    unassigned: { visits: unassignedVisits, medications: unassignedMedications },
    totals: {
      areas: areas.length,
      activeAreas: activeAreaIds.length,
      careAreas: careAreaIds.length,
      candidateAreas: candidateAreaIds.length,
      candidateOnlyAreas: areas.filter(({ candidateOnly }) => candidateOnly).length,
      signalAreas: signalAreaIds.length,
      signalOnlyAreas: areas.filter(({ signalOnly }) => signalOnly).length,
      conditions: confirmedActiveConditions.length,
      conditionAssociations: areas.reduce((total, area) => total + area.conditions.length, 0),
      visits: areas.reduce((total, area) => total + area.visits.length, 0),
      declaredVisits: areas.reduce((total, area) => total + area.declaredVisitCount, 0),
      classifiedVisits: areas.reduce((total, area) => total + area.classifiedVisitCount, 0),
      medications: areas.reduce((total, area) => total + area.medications.length, 0),
      declaredMedications: areas.reduce((total, area) => total + area.declaredMedicationCount, 0),
      classifiedMedications: areas.reduce((total, area) => total + area.classifiedMedicationCount, 0),
      unassignedVisits: unassignedVisits.length,
      unassignedMedications: unassignedMedications.length,
    },
  };
}

function eventDisplay(event) {
  const value = event.value === "" ? "" : ` ${String(event.value)}${event.unit ? ` ${event.unit}` : ""}`;
  return `${event.label}${value}`;
}

export function createLocalCopilotBrief(
  patientInput,
  claimEvaluations = [],
  asOf = new Date().toISOString().slice(0, 10),
  patientBriefInput = {},
) {
  const patient = createFinalizedPatientView(patientInput);
  const conditions = patient.events.filter((event) => event.type === "condition" && hasCompatibleEventLifecycle(event));
  const medications = patient.events.filter((event) => event.type === "medication" && hasCompatibleEventLifecycle(event));
  const observations = patient.events.filter((event) => event.type === "observation" && hasCompatibleEventLifecycle(event)).slice(0, 4);
  const allergies = patient.events.filter((event) => event.type === "allergy" && hasCompatibleEventLifecycle(event));
  const sourceEvents = [...conditions, ...medications, ...observations, ...allergies].filter((event, index, list) => list.findIndex(({ id }) => id === event.id) === index);
  const conditionIds = [...new Set(conditions.map(conditionIdForEvent).filter(Boolean))];
  const visitBrief = createVisitBrief(conditionIds);
  const summary = [];
  if (conditions.length) summary.push({ text: "활성 문제 " + conditions.map(({ label }) => label).join(", "), evidenceEventIds: conditions.map(({ id }) => id) });
  if (observations.length) summary.push({ text: "최근 측정 " + observations.map(eventDisplay).join(", "), evidenceEventIds: observations.map(({ id }) => id) });
  if (medications.length) summary.push({ text: "현재 약물 " + medications.map(({ label }) => label).join(", "), evidenceEventIds: medications.map(({ id }) => id) });
  if (allergies.length) summary.push({ text: "알레르기 " + allergies.map(({ label }) => label).join(", "), evidenceEventIds: allergies.map(({ id }) => id) });
  const tasks = claimEvaluations
    .filter(({ status }) => ["missing-evidence", "due-soon", "unknown"].includes(status))
    .map((evaluation) => ({
      id: evaluation.id,
      title: evaluation.title,
      text: evaluation.status === "missing-evidence"
        ? `${evaluation.missingEvidence.join(", ")} 근거를 확인하세요.`
        : evaluation.status === "due-soon"
          ? `${evaluation.nextEligibleDate} 전후 시행 계획을 확인하세요.`
          : "적용 기준을 담당자가 확인하세요.",
      evidenceEventIds: Array.isArray(evaluation.evidenceEventIds) ? evaluation.evidenceEventIds : [],
    }))
    .filter(({ evidenceEventIds }) => evidenceEventIds.length > 0);
  const provenanceIds = new Set([
    ...sourceEvents.map(({ id }) => id),
    ...tasks.flatMap(({ evidenceEventIds }) => evidenceEventIds),
  ]);
  const conditionQuestions = visitBrief.questions.map((question) => ({
    ...question,
    evidenceEventIds: conditions.filter((event) => conditionIdForEvent(event) === question.sourceId).map(({ id }) => id),
    patientBriefIds: [],
  })).filter(({ evidenceEventIds }) => evidenceEventIds.length > 0);
  const questionDraft = createClinicalQuestionSuggestions(patient, patientBriefInput);
  const questionKeys = new Set();
  const patientQuestions = [
    ...questionDraft.patientQuestions.filter(({ patientBriefIds }) => patientBriefIds.length > 0),
    ...conditionQuestions,
    ...questionDraft.patientQuestions.filter(({ patientBriefIds }) => patientBriefIds.length === 0),
  ].filter((item) => {
    const key = cleanText(item?.question, "", 500).toLocaleLowerCase("ko");
    if (!key || questionKeys.has(key)) return false;
    questionKeys.add(key);
    return true;
  }).slice(0, 5);
  const clinicianQuestions = questionDraft.clinicianQuestions.slice(0, 5);
  for (const eventId of [...clinicianQuestions, ...patientQuestions].flatMap(({ evidenceEventIds }) => evidenceEventIds)) {
    provenanceIds.add(eventId);
  }
  const eventById = new Map(patient.events.map((event) => [event.id, event]));
  return {
    id: uniqueId("brief"),
    kind: "rule-based",
    label: "규칙 기반 요약",
    confirmed: false,
    generatedAt: `${asOf}T00:00:00.000Z`,
    summary,
    tasks,
    clinicianQuestions,
    patientQuestions,
    questions: patientQuestions,
    patientBriefProvenance: questionDraft.patientBriefProvenance,
    provenance: [...provenanceIds].map((eventId) => eventById.get(eventId)).filter(Boolean).map((event) => ({ eventId: event.id, label: event.label, date: event.date, sourceLabel: event.source.label })),
    disclaimer: "의료진 검토 전 확정 기록이 아닙니다. 질문 준비용 초안이며 진단·처방·인과관계·급여 결정을 자동 수행하지 않습니다.",
  };
}

export function exportEmrBackup(stateInput, exportedAt = new Date().toISOString()) {
  const data = validateCanonicalEmrState({ ...stateInput, demo: false, storageError: "", recoveryRaw: "" });
  return {
    schema: EMR_BACKUP_SCHEMA,
    version: EMR_VERSION,
    exportedAt: validTimestamp(exportedAt),
    data,
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
}

export function clinicalContextFingerprint(value) {
  return JSON.stringify(stableJson(value));
}

function redactPatientText(value, patient) {
  if (typeof value !== "string") return value;
  let redacted = value;
  const identifiers = [patient.name, patient.mrn, patient.phone]
    .map((item) => String(item ?? "").trim())
    .filter((item) => item.length >= 2);
  for (const identifier of identifiers) redacted = redacted.split(identifier).join("[식별정보 제거]");
  return redacted;
}

export function createCopilotRequest(
  patientInput = {},
  evaluations = [],
  asOf = localCalendarDate(),
  patientBriefInput = {},
) {
  const patient = createFinalizedPatientView(patientInput);
  const aliasToEventId = new Map();
  const eventIdToAlias = new Map();
  const events = patient.events.filter(hasCompatibleEventLifecycle).slice(0, 80).map((event, index) => {
    const alias = `event-${index + 1}`;
    aliasToEventId.set(alias, event.id);
    eventIdToAlias.set(event.id, alias);
    return {
      id: alias,
      type: event.type,
      system: redactPatientText(event.system, patient),
      code: redactPatientText(event.code, patient),
      label: redactPatientText(event.label, patient),
      date: event.date,
      status: redactPatientText(event.status, patient),
      value: redactPatientText(event.value, patient),
      unit: redactPatientText(event.unit, patient),
    };
  });
  const claimEvaluations = (Array.isArray(evaluations) ? evaluations : []).slice(0, 40).map((evaluation, index) => ({
    id: `rule-${index + 1}`,
    title: redactPatientText(evaluation?.title, patient),
    status: cleanText(evaluation?.status, "", 80),
    explanation: redactPatientText(evaluation?.explanation, patient),
    missingEvidence: (Array.isArray(evaluation?.missingEvidence) ? evaluation.missingEvidence : [])
      .map((item) => redactPatientText(item, patient)),
    nextEligibleDate: validDate(evaluation?.nextEligibleDate),
    evidenceEventIds: (Array.isArray(evaluation?.evidenceEventIds) ? evaluation.evidenceEventIds : [])
      .map((id) => eventIdToAlias.get(id))
      .filter(Boolean),
  }));
  const patientBrief = normalizeClinicalPatientBrief(patientBriefInput, patient);
  const aliasToPatientBriefId = new Map();
  const patientBriefItems = patientBrief.items.map((item, index) => {
    const alias = `patient-${index + 1}`;
    aliasToPatientBriefId.set(alias, item.id);
    return {
      id: alias,
      kind: item.kind,
      text: item.text,
      observedOn: item.observedOn,
    };
  });
  return {
    payload: {
      patient: { events },
      patientBrief: {
        items: patientBriefItems,
        safety: {
          patientReported: true,
          verifiedClinicalFact: false,
        },
      },
      claimEvaluations,
      asOf: validDate(asOf),
    },
    aliasToEventId,
    aliasToPatientBriefId,
  };
}

function validateLegacyEmrState(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || input.schema !== EMR_SCHEMA || input.version !== 1) {
    throw new TypeError("기존 EMR 내부 스키마가 유효하지 않습니다.");
  }
  if (!Array.isArray(input.patients) || !Array.isArray(input.rules) || !Array.isArray(input.audit)) {
    throw new TypeError("기존 EMR 내부 배열이 손상되었습니다.");
  }
  const patientIds = new Set();
  const mrns = new Set();
  const identities = new Set();
  for (const patient of input.patients) {
    if (!patient || typeof patient !== "object" || !cleanText(patient.id) || patientIds.has(cleanText(patient.id))) {
      throw new TypeError("기존 EMR 환자 식별자가 손상되었습니다.");
    }
    patientIds.add(cleanText(patient.id));
    if (patient.birthDate && !validDate(patient.birthDate)) throw new TypeError("기존 EMR 생년월일이 손상되었습니다.");
    if (patient.sex && !["female", "male", "other", "unknown"].includes(patient.sex)) throw new TypeError("기존 EMR 성별 값이 손상되었습니다.");
    const mrn = cleanText(patient.mrn);
    if (mrn && mrns.has(mrn)) throw new TypeError("기존 EMR 데이터에 중복 등록번호가 있습니다.");
    if (mrn) mrns.add(mrn);
    const identity = cleanText(patient.fhirIdentity, "", 2_000);
    if (identity && identities.has(identity)) throw new TypeError("기존 EMR 데이터에 중복 FHIR 환자 식별자가 있습니다.");
    if (identity) identities.add(identity);
    const eventIds = new Set();
    if (!Array.isArray(patient.events)) throw new TypeError("기존 EMR 임상 이벤트 배열이 손상되었습니다.");
    for (const rawEvent of patient.events) {
      const event = normalizePatientEvent({ ...rawEvent, recordStatus: "final" });
      if (!event || eventIds.has(event.id)) throw new TypeError("기존 EMR 임상 이벤트가 손상되었습니다.");
      eventIds.add(event.id);
      assertCanonicalEventLifecycle(event);
    }
  }
  const selectedPatientId = cleanText(input.selectedPatientId);
  if (selectedPatientId && !patientIds.has(selectedPatientId)) {
    throw new TypeError("기존 EMR의 선택 환자 참조가 유효하지 않습니다.");
  }
  for (const ruleInput of input.rules) {
    const rule = normalizeClaimRule(ruleInput);
    if (!rule) throw new TypeError("기존 EMR 급여 규칙이 손상되었습니다.");
    assertOperationalClaimRule(rule);
  }
  return input;
}

export function migrateV1ToV2(input, migratedAt = new Date().toISOString()) {
  const legacy = validateLegacyEmrState(input);
  const at = validTimestamp(legacy.updatedAt, validTimestamp(migratedAt));
  const patients = legacy.patients.map((patient) => createPatient({
    ...patient,
    events: patient.events.map((event) => ({
      ...event,
      recordStatus: event.type === "encounter" && event.status === "in-progress" ? "draft" : "final",
      ...(event.type === "encounter"
        ? { signature: event.status === "in-progress"
          ? { status: "unsigned", signer: "", signedAt: "" }
          : { status: event.source?.kind === "fhir" ? "external" : "legacy", signer: "", signedAt: "" } }
        : {}),
    })),
  }, at));
  const auditEvents = Array.isArray(legacy.audit) ? legacy.audit : [];
  const migrated = normalizeEmrState({
    ...legacy,
    version: EMR_VERSION,
    revision: 0,
    selectedEncounterId: "",
    patients,
    audit: [
      ...auditEvents,
      {
        id: "audit-migration-v1-v2",
        at,
        actor: "system",
        action: "schema.migrated",
        patientId: "",
        encounterId: "",
        entityId: "",
        detail: "v1 → v2",
      },
    ],
    storageError: "",
    recoveryRaw: "",
  });
  return validateCanonicalEmrState(migrated);
}

function validateCanonicalEmrState(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("EMR 데이터 형식이 유효하지 않습니다.");
  if (input.schema !== EMR_SCHEMA || input.version !== EMR_VERSION) throw new TypeError("EMR 내부 스키마가 유효하지 않습니다.");
  const compatibleInput = Object.hasOwn(input, "claimReviews") ? input : { ...input, claimReviews: [] };
  if (!Array.isArray(compatibleInput.patients) || !Array.isArray(compatibleInput.rules)
    || !Array.isArray(compatibleInput.claimReviews) || !Array.isArray(compatibleInput.audit)) {
    throw new TypeError("EMR 내부 배열이 손상되었습니다.");
  }
  const mrns = compatibleInput.patients.map((patient) => cleanText(patient?.mrn)).filter(Boolean);
  if (new Set(mrns).size !== mrns.length) throw new TypeError("EMR 데이터에 중복 등록번호가 있습니다.");
  const fhirIdentities = compatibleInput.patients.map((patient) => cleanText(patient?.fhirIdentity, "", 2_000)).filter(Boolean);
  if (new Set(fhirIdentities).size !== fhirIdentities.length) throw new TypeError("EMR 데이터에 중복 FHIR 환자 식별자가 있습니다.");
  const validationNow = new Date().toISOString();
  for (const patient of compatibleInput.patients) assertPatientDemographicsInput(patient, validationNow);
  const normalized = normalizeEmrState(compatibleInput);
  for (const patient of normalized.patients) {
    const encounterById = new Map(patient.events.filter((event) => event.type === "encounter").map((event) => [event.id, event]));
    const activeEncounters = [...encounterById.values()].filter((event) => event.recordStatus === "draft" && ["arrived", "in-progress"].includes(event.status));
    if (activeEncounters.length > 1) throw new TypeError("한 환자에게 대기 또는 진료 중인 회차가 둘 이상 있습니다.");
    for (const event of patient.events) assertCanonicalEventLifecycle(event);
    for (const event of patient.events) {
      if (event.encounterId) {
        const encounter = encounterById.get(event.encounterId);
        if (!encounter) throw new TypeError("진료 항목이 존재하지 않는 Encounter를 참조합니다.");
        if (event.recordStatus === "final" && (encounter.recordStatus !== "final" || encounter.status !== "finished")) {
          throw new TypeError("확정 진료 항목의 Encounter 상태가 일치하지 않습니다.");
        }
        if (event.recordStatus === "draft" && encounter.recordStatus !== "draft") {
          throw new TypeError("초안 진료 항목의 Encounter 상태가 일치하지 않습니다.");
        }
      }
    }
    for (const encounter of encounterById.values()) {
      if ((encounter.status === "cancelled") !== (encounter.recordStatus === "entered-in-error")) {
        throw new TypeError("취소 Encounter의 상태가 유효하지 않습니다.");
      }
      const chronology = [
        [encounter.arrivedAt, encounter.startedAt, "도착·진료 시작"],
        [encounter.startedAt || encounter.arrivedAt, encounter.finishedAt, "진료 시작·완료"],
        [encounter.finishedAt || encounter.startedAt || encounter.arrivedAt, encounter.signature?.signedAt, "진료 완료·서명"],
      ];
      for (const [earlier, later, label] of chronology) {
        if (earlier && later && new Date(later).valueOf() < new Date(earlier).valueOf()) {
          throw new TypeError(`Encounter ${label} 시각 순서가 유효하지 않습니다.`);
        }
      }
      if (encounter.recordStatus === "draft" && encounter.signature?.status !== "unsigned") {
        throw new TypeError("초안 Encounter에는 확정 서명 상태를 둘 수 없습니다.");
      }
      if (encounter.status === "arrived" && (encounter.startedAt || encounter.finishedAt)) {
        throw new TypeError("대기 Encounter에 진료 시작·완료 시각을 둘 수 없습니다.");
      }
      if (encounter.status === "in-progress" && encounter.finishedAt) {
        throw new TypeError("진료 중 Encounter에 완료 시각을 둘 수 없습니다.");
      }
      if (encounter.recordStatus === "final") {
        if (encounter.status !== "finished") throw new TypeError("확정 Encounter는 종료 상태여야 합니다.");
        if (!["signed", "legacy", "external"].includes(encounter.signature?.status)) throw new TypeError("확정 Encounter의 서명 상태가 유효하지 않습니다.");
        if (encounter.signature.status === "signed" && (!encounter.signature.signer || !encounter.signature.signedAt)) {
          throw new TypeError("로컬 서명의 서명자와 시각이 필요합니다.");
        }
        if (encounter.signature.status === "signed") {
          const signedChildren = patient.events.filter((event) => event.encounterId === encounter.id && event.recordStatus === "final");
          const diagnoses = signedChildren.filter((event) => event.type === "condition");
          if (!encounter.clinician || !encounter.chiefComplaint
            || (!encounter.soap.subjective && !encounter.soap.objective)
            || !encounter.soap.assessment || !encounter.soap.plan) {
            throw new TypeError("로컬 서명 진료의 담당 의료진·주호소·SOAP가 완전하지 않습니다.");
          }
          if (diagnoses.length === 0 || diagnoses.filter(({ diagnosisRole }) => diagnosisRole === "primary").length !== 1
            || diagnoses.some(({ code, system }) => !code || !system)) {
            throw new TypeError("로컬 서명 진료에는 코드가 있는 주상병 한 건이 필요합니다.");
          }
          for (const medication of signedChildren.filter((event) => event.type === "medication")) {
            const prescription = medication.prescription ?? {};
            if (!(prescription.dose > 0) || !prescription.doseUnit || !prescription.route || !prescription.frequency
              || !(prescription.durationDays > 0) || !(prescription.quantity > 0)) {
              throw new TypeError("로컬 서명 진료의 처방 용법이 완전하지 않습니다.");
            }
          }
        }
      }
    }
  }
  for (const rule of normalized.rules) {
    assertOperationalClaimRule(rule);
  }
  assertNonOverlappingRuleVersions(normalized.rules);
  if (JSON.stringify(stableJson(compatibleInput)) !== JSON.stringify(stableJson(normalized))) {
    throw new TypeError("EMR 데이터에 손상되거나 정규화 중 유실되는 필드가 있습니다.");
  }
  return normalized;
}

export function parseEmrBackup(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("VitaGraph EMR 백업 파일 형식이 아닙니다.");
  if (input.schema !== EMR_BACKUP_SCHEMA) throw new TypeError("VitaGraph EMR 백업 파일이 아닙니다.");
  if (!input.data || typeof input.data !== "object") throw new TypeError("EMR 백업에 데이터가 없습니다.");
  if (![1, EMR_VERSION].includes(input.version)) throw new TypeError(`지원하지 않는 EMR 백업 버전입니다: ${String(input.version)}`);
  if (input.data.version !== input.version) throw new TypeError("EMR 백업의 버전 참조가 일치하지 않습니다.");
  const normalized = input.version === 1 ? migrateV1ToV2(input.data, input.exportedAt) : validateCanonicalEmrState(input.data);
  if (input.data.selectedPatientId && normalized.selectedPatientId !== input.data.selectedPatientId) {
    throw new TypeError("EMR 백업의 선택 환자 참조가 유효하지 않습니다.");
  }
  return normalized;
}

export function prepareUnverifiedBackupRestore(backupStateInput, trustedStateInput, restoredAt = new Date().toISOString()) {
  const backupState = validateCanonicalEmrState(backupStateInput);
  const trustedState = validateCanonicalEmrState(trustedStateInput);
  const timestamp = validTimestamp(restoredAt);
  const patients = backupState.patients.map((patient) => ({
    ...patient,
    events: patient.events.map((event) => {
      return {
        ...event,
        source: { kind: "import", label: "백업 복원 · 출처 미검증", resourceId: "" },
        ...(event.type === "encounter" && event.recordStatus === "final"
          ? { signature: { status: "external", signer: "", signedAt: "" } }
          : {}),
      };
    }),
    updatedAt: timestamp,
  }));
  return validateCanonicalEmrState({
    ...backupState,
    patients,
    selectedEncounterId: "",
    rules: trustedState.rules,
    claimReviews: [],
    audit: [],
    demo: false,
    storageError: "",
    recoveryRaw: "",
    updatedAt: timestamp,
  });
}

function loadEmrStateUnlocked(storage, persistMigration) {
  let raw = "";
  try {
    const resolvedStorage = storage === undefined ? globalThis.localStorage : storage;
    raw = resolvedStorage?.getItem?.(EMR_STORAGE_KEY) ?? "";
    let legacy = false;
    if (!raw) {
      raw = resolvedStorage?.getItem?.(LEGACY_EMR_STORAGE_KEY) ?? "";
      legacy = Boolean(raw);
    }
    if (!raw) return createEmptyEmrState();
    const parsed = JSON.parse(raw);
    const normalized = parsed?.version === 1 ? migrateV1ToV2(parsed) : validateCanonicalEmrState(parsed);
    if (persistMigration && (legacy || parsed?.version === 1)) {
      try {
        resolvedStorage?.setItem?.(EMR_STORAGE_KEY, JSON.stringify(normalized));
      } catch (error) {
        return {
          ...normalized,
          demo: false,
          storageError: `v1 기록을 v2 저장소로 승격하지 못했습니다: ${error instanceof Error ? error.message : "저장 실패"}`,
          recoveryRaw: raw,
        };
      }
    }
    return { ...normalized, demo: false, storageError: "", recoveryRaw: "" };
  } catch (error) {
    return {
      ...createEmptyEmrState(),
      storageError: error instanceof Error ? error.message : "저장된 EMR을 읽지 못했습니다.",
      recoveryRaw: raw,
    };
  }
}

export function loadEmrState(storage) {
  return loadEmrStateUnlocked(storage, false);
}

export async function initializeEmrState(storage, options = {}) {
  try {
    return await withEmrWriteLock(
      storage,
      options,
      () => loadEmrStateUnlocked(storage, true),
    );
  } catch (error) {
    const loaded = loadEmrState(storage);
    return {
      ...loaded,
      storageError: error instanceof Error ? error.message : "안전한 로컬 저장을 초기화하지 못했습니다.",
    };
  }
}

function signedEncounterSnapshots(state) {
  const snapshots = new Map();
  for (const patient of state.patients) {
    for (const encounter of patient.events.filter((event) => (
      event.type === "encounter"
      && event.recordStatus === "final"
      && event.signature?.status === "signed"
    ))) {
      const records = patient.events
        .filter((event) => event.id === encounter.id || event.encounterId === encounter.id)
        .sort((left, right) => left.id.localeCompare(right.id));
      snapshots.set(`${patient.id}\u0000${encounter.id}`, JSON.stringify(stableJson(records)));
    }
  }
  return snapshots;
}

function assertSignedEncountersPreserved(current, candidate) {
  const currentSnapshots = signedEncounterSnapshots(current);
  const candidateSnapshots = signedEncounterSnapshots(candidate);
  for (const [key, snapshot] of currentSnapshots) {
    if (candidateSnapshots.get(key) !== snapshot) {
      throw new Error("서명된 진료기록은 일반 저장으로 변경하거나 삭제할 수 없습니다. 전체 백업 교체는 전용 미검증 복원 절차를 사용하세요.");
    }
  }
}

const EMR_WRITE_LOCK_NAME = `${EMR_STORAGE_KEY}:write`;

function resolveEmrWriteLock(storage, options) {
  if (Object.hasOwn(options, "lockManager")) return options.lockManager;
  const lockManager = globalThis.navigator?.locks;
  if (typeof lockManager?.request === "function") return lockManager;
  const usesBrowserStorage = storage === undefined
    && typeof globalThis.window !== "undefined"
    && globalThis.window === globalThis;
  if (usesBrowserStorage) {
    throw new Error("이 브라우저는 안전한 다중 탭 저장 잠금을 지원하지 않습니다. 최신 브라우저에서 다시 여세요.");
  }
  return null;
}

async function withEmrWriteLock(storage, options, operation) {
  const lockManager = resolveEmrWriteLock(storage, options);
  if (!lockManager) return operation();
  if (typeof lockManager.request !== "function") {
    throw new TypeError("EMR 저장 잠금 관리자가 올바르지 않습니다.");
  }
  return lockManager.request(EMR_WRITE_LOCK_NAME, { mode: "exclusive" }, operation);
}

function saveEmrStateUnlocked(
  stateInput,
  storage,
  expectedRevision,
  options,
  preserveSignedEncounters = true,
) {
  const state = validateCanonicalEmrState({ ...stateInput, demo: false, storageError: "", recoveryRaw: "" });
  const resolvedStorage = storage === undefined ? globalThis.localStorage : storage;
  let currentState = null;
  const checksRevision = expectedRevision !== null && expectedRevision !== undefined;
  if (typeof resolvedStorage?.getItem === "function") {
    const raw = resolvedStorage.getItem(EMR_STORAGE_KEY) ?? "";
    if (raw) {
      try {
        const current = JSON.parse(raw);
        if (current?.schema !== EMR_SCHEMA || current?.version !== EMR_VERSION) {
          throw new Error("현재 저장된 EMR 스키마가 달라 덮어쓸 수 없습니다.");
        }
        currentState = validateCanonicalEmrState(current);
      } catch (error) {
        if (checksRevision) throw error;
      }
    }
  }
  if (expectedRevision !== null && expectedRevision !== undefined) {
    const expected = boundedInteger(expectedRevision, { minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
    if (expected === null) throw new TypeError("저장 기준 리비전이 유효하지 않습니다.");
    if (typeof resolvedStorage?.getItem !== "function") throw new Error("저장소가 리비전 충돌 검사를 지원하지 않습니다.");
    const currentRevision = currentState?.revision ?? 0;
    if (currentRevision !== expected) {
      throw new Error("다른 탭에서 기록이 변경되었습니다. 최신 기록을 다시 불러온 뒤 다시 시도하세요.");
    }
  }
  if (currentState && preserveSignedEncounters) assertSignedEncountersPreserved(currentState, state);
  resolvedStorage?.setItem?.(EMR_STORAGE_KEY, JSON.stringify(state));
  return state;
}

export async function saveEmrState(stateInput, storage, expectedRevision = null, options = {}) {
  return withEmrWriteLock(
    storage,
    options,
    () => saveEmrStateUnlocked(stateInput, storage, expectedRevision, options),
  );
}

export async function restoreEmrBackupState(
  backupStateInput,
  trustedStateInput,
  storage,
  restoredAt = new Date().toISOString(),
  options = {},
) {
  const trustedState = validateCanonicalEmrState(trustedStateInput);
  const timestamp = validTimestamp(restoredAt);
  return withEmrWriteLock(storage, options, () => {
    let candidate = prepareUnverifiedBackupRestore(backupStateInput, trustedState, timestamp);
    candidate = { ...candidate, revision: trustedState.revision };
    candidate = appendStateAudit(candidate, "backup.restored", `환자 ${candidate.patients.length}명`, timestamp);
    return saveEmrStateUnlocked(
      candidate,
      storage,
      trustedState.revision,
      options,
      false,
    );
  });
}

function recoverEmrStateUnlocked(stateInput, expectedRawInput, storage, now) {
  const state = validateCanonicalEmrState({ ...stateInput, demo: false, storageError: "", recoveryRaw: "" });
  const expectedRaw = typeof expectedRawInput === "string" ? expectedRawInput : "";
  if (!expectedRaw) throw new TypeError("복구할 손상 저장 원본이 없습니다.");
  const resolvedStorage = storage === undefined ? globalThis.localStorage : storage;
  if (typeof resolvedStorage?.getItem !== "function" || typeof resolvedStorage?.setItem !== "function") {
    throw new Error("저장소가 안전 복구를 지원하지 않습니다.");
  }
  const primaryRaw = resolvedStorage.getItem(EMR_STORAGE_KEY) ?? "";
  const legacyRaw = resolvedStorage.getItem(LEGACY_EMR_STORAGE_KEY) ?? "";
  const currentRaw = primaryRaw || legacyRaw;
  if (currentRaw !== expectedRaw) {
    throw new Error("손상 저장 원본이 다른 탭에서 변경되었습니다. 원본을 다시 확인한 뒤 복원하세요.");
  }
  const recoveryRevision = rotateStorageRevision(state.revision, now);
  const recovered = validateCanonicalEmrState({ ...state, revision: recoveryRevision });
  resolvedStorage.setItem(EMR_STORAGE_KEY, JSON.stringify(recovered));
  resolvedStorage.removeItem?.(LEGACY_EMR_STORAGE_KEY);
  return recovered;
}

export async function recoverEmrState(
  stateInput,
  expectedRawInput,
  storage,
  now = new Date().toISOString(),
  options = {},
) {
  return withEmrWriteLock(
    storage,
    options,
    () => recoverEmrStateUnlocked(stateInput, expectedRawInput, storage, now),
  );
}

function rotateStorageRevision(currentRevision, now) {
  const revision = Math.max(
    currentRevision + 1,
    new Date(validTimestamp(now)).valueOf() * 1_000 + Math.floor(Math.random() * 1_000),
  );
  if (!Number.isSafeInteger(revision)) throw new Error("새 저장 리비전을 안전하게 만들 수 없습니다.");
  return revision;
}

function clearEmrStateUnlocked(storage, now) {
  const resolvedStorage = storage === undefined ? globalThis.localStorage : storage;
  if (typeof resolvedStorage?.getItem !== "function"
    || typeof resolvedStorage?.setItem !== "function"
    || typeof resolvedStorage?.removeItem !== "function") {
    throw new Error("저장소가 안전 초기화를 지원하지 않습니다.");
  }
  let currentRevision = 0;
  const currentRaw = resolvedStorage.getItem(EMR_STORAGE_KEY) ?? "";
  if (currentRaw) {
    try {
      const current = JSON.parse(currentRaw);
      if (current?.schema === EMR_SCHEMA && current?.version === EMR_VERSION) {
        currentRevision = boundedInteger(current.revision, { minimum: 0, maximum: Number.MAX_SAFE_INTEGER }) ?? 0;
      }
    } catch {
      // A high generation below still prevents stale pre-recovery tabs from reviving records.
    }
  }
  const cleared = validateCanonicalEmrState({
    ...createEmptyEmrState(now),
    revision: rotateStorageRevision(currentRevision, now),
  });
  resolvedStorage.setItem(EMR_STORAGE_KEY, JSON.stringify(cleared));
  resolvedStorage.removeItem(LEGACY_EMR_STORAGE_KEY);
  return cleared;
}

export async function clearEmrState(storage, options = {}) {
  const now = options.now ?? new Date().toISOString();
  return withEmrWriteLock(storage, options, () => clearEmrStateUnlocked(storage, now));
}
