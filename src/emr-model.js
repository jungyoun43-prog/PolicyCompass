import { DEFAULT_CLAIM_RULES, KCD_SYSTEM, normalizeClaimRule } from "./claim-rules.js";
import { createVisitBrief } from "./insight-model.js";
import { clinicalObservationSpec, isCanonicalClinicalObservation, LOINC_SYSTEM } from "./clinical-observations.js";

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
    entityId: cleanText(input.entityId, "", 160),
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
  return normalizePatientEvent({ id, type, code, label, date, source: { kind: "demo", label: "VitaGraph 임상 샘플" }, ...extras });
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
    address: "서울시 샘플구",
    bloodType: "A+",
    insuranceType: "national-health",
    emergencyContact: { name: "김보호", relation: "가족", phone: "010-0000-9001" },
    memo: "샘플 환자 · 실제 인물이 아닙니다.",
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
    ],
  }, timestamp);
  const second = createPatient({
    id: "demo-patient-park",
    mrn: "VG-1002",
    name: "박여정",
    birthDate: "1988-11-03",
    sex: "male",
    bloodType: "unknown",
    insuranceType: "national-health",
    memo: "샘플 환자 · 실제 인물이 아닙니다.",
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
    ],
  }, timestamp);
  return {
    schema: EMR_SCHEMA,
    version: EMR_VERSION,
    revision: 0,
    demo: true,
    selectedPatientId: first.id,
    selectedEncounterId: "kim-visit-today",
    patients: [first, second],
    rules: DEFAULT_CLAIM_RULES.map((rule) => normalizeClaimRule(rule)),
    audit: [audit("demo.loaded", timestamp, { detail: "2 patients" })],
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
  if (/\bf3[2-4]\b|\bf4[01]\b|우울|불안/.test(searchable)) return "mood";
  if (/\bm(?:05|06|1[5-9])\b|관절염/.test(searchable)) return "arthritis";
  return "";
}

export function createClinicalGraph(patientInput = {}) {
  const patient = createFinalizedPatientView(patientInput);
  const nodes = patient.events
    .filter((event) => ["condition", "observation", "medication", "allergy", "procedure", "symptom"].includes(event.type)
      && hasCompatibleEventLifecycle(event))
    .slice(0, 24)
    .map((event) => ({ id: event.id, type: event.type, label: event.label, code: event.code, date: event.date, source: event.source }));
  const conditionNodes = nodes.filter(({ type }) => type === "condition");
  const edges = [];
  for (const node of nodes) {
    if (node.type === "condition") continue;
    const nodeConditionId = conditionIdForEvent(node);
    const target = nodeConditionId
      ? conditionNodes.find((condition) => conditionIdForEvent(condition) === nodeConditionId)
      : null;
    if (target) edges.push({
      id: `${target.id}:${node.id}`,
      from: target.id,
      to: node.id,
      label: node.type === "medication" ? "치료" : node.type === "observation" ? "추적" : "기록",
      kind: "inferred",
      basis: `코드·표시명 키워드 기반 주제 분류(${nodeConditionId})`,
    });
  }
  return { nodes, edges };
}

function eventDisplay(event) {
  const value = event.value === "" ? "" : ` ${String(event.value)}${event.unit ? ` ${event.unit}` : ""}`;
  return `${event.label}${value}`;
}

export function createLocalCopilotBrief(patientInput, claimEvaluations = [], asOf = new Date().toISOString().slice(0, 10)) {
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
  const questions = visitBrief.questions.map((question) => ({
    ...question,
    evidenceEventIds: conditions.filter((event) => conditionIdForEvent(event) === question.sourceId).map(({ id }) => id),
  })).filter(({ evidenceEventIds }) => evidenceEventIds.length > 0);
  for (const eventId of questions.flatMap(({ evidenceEventIds }) => evidenceEventIds)) provenanceIds.add(eventId);
  const eventById = new Map(patient.events.map((event) => [event.id, event]));
  return {
    id: uniqueId("brief"),
    kind: "rule-based",
    label: "규칙 기반 요약",
    confirmed: false,
    generatedAt: `${asOf}T00:00:00.000Z`,
    summary,
    tasks,
    questions,
    provenance: [...provenanceIds].map((eventId) => eventById.get(eventId)).filter(Boolean).map((event) => ({ eventId: event.id, label: event.label, date: event.date, sourceLabel: event.source.label })),
    disclaimer: "의료진 검토 전 확정 기록이 아닙니다. 진단·처방·급여 결정을 자동 수행하지 않습니다.",
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

export function createCopilotRequest(patientInput = {}, evaluations = [], asOf = localCalendarDate()) {
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
  return {
    payload: { patient: { events }, claimEvaluations, asOf: validDate(asOf) },
    aliasToEventId,
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
  if (!Array.isArray(input.patients) || !Array.isArray(input.rules) || !Array.isArray(input.audit)) {
    throw new TypeError("EMR 내부 배열이 손상되었습니다.");
  }
  const mrns = input.patients.map((patient) => cleanText(patient?.mrn)).filter(Boolean);
  if (new Set(mrns).size !== mrns.length) throw new TypeError("EMR 데이터에 중복 등록번호가 있습니다.");
  const fhirIdentities = input.patients.map((patient) => cleanText(patient?.fhirIdentity, "", 2_000)).filter(Boolean);
  if (new Set(fhirIdentities).size !== fhirIdentities.length) throw new TypeError("EMR 데이터에 중복 FHIR 환자 식별자가 있습니다.");
  const validationNow = new Date().toISOString();
  for (const patient of input.patients) assertPatientDemographicsInput(patient, validationNow);
  const normalized = normalizeEmrState(input);
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
  if (JSON.stringify(stableJson(input)) !== JSON.stringify(stableJson(normalized))) {
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
      throw new Error("서명된 진료기록은 일반 저장으로 변경하거나 삭제할 수 없습니다. 검증된 백업 복원 또는 정정 절차를 사용하세요.");
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

function saveEmrStateUnlocked(stateInput, storage, expectedRevision, options) {
  const state = validateCanonicalEmrState({ ...stateInput, demo: false, storageError: "", recoveryRaw: "" });
  const resolvedStorage = storage === undefined ? globalThis.localStorage : storage;
  let currentState = null;
  const checksCurrentState = expectedRevision !== null && expectedRevision !== undefined;
  if (checksCurrentState && typeof resolvedStorage?.getItem === "function") {
    const raw = resolvedStorage.getItem(EMR_STORAGE_KEY) ?? "";
    if (raw) {
      const current = JSON.parse(raw);
      if (current?.schema !== EMR_SCHEMA || current?.version !== EMR_VERSION) {
        throw new Error("현재 저장된 EMR 스키마가 달라 덮어쓸 수 없습니다.");
      }
      currentState = validateCanonicalEmrState(current);
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
  if (currentState && options.allowSignedRecordReplacement !== true) assertSignedEncountersPreserved(currentState, state);
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
