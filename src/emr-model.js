import { DEFAULT_CLAIM_RULES, normalizeClaimRule } from "./claim-rules.js";
import { createVisitBrief } from "./insight-model.js";

export const EMR_SCHEMA = "vitagraph-emr";
export const EMR_BACKUP_SCHEMA = "vitagraph-emr-backup";
export const EMR_VERSION = 1;
export const EMR_STORAGE_KEY = "vitagraph-emr-v1";

const EVENT_TYPES = new Set(["encounter", "condition", "observation", "medication", "allergy", "procedure", "symptom", "note"]);
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
  return {
    kind: ["manual", "fhir", "demo", "import", "copilot"].includes(input.kind) ? input.kind : "manual",
    label: cleanText(input.label, "직접 입력", 160),
    resourceId: cleanText(input.resourceId, "", 200),
  };
}

export function normalizePatientEvent(input = {}) {
  if (!input || typeof input !== "object") return null;
  const id = cleanText(input.id, "", 160);
  const type = cleanText(input.type, "", 40);
  const label = cleanText(input.label, "", 240);
  const date = validDate(input.date ?? input.recordedAt ?? input.observedAt);
  if (!id || !EVENT_TYPES.has(type) || !label || !date) return null;
  const value = typeof input.value === "number" && Number.isFinite(input.value)
    ? input.value
    : cleanText(input.value, "", 500);
  const lifecycle = {};
  for (const field of ["clinicalStatus", "verificationStatus", "intent"]) {
    const normalized = cleanText(input[field], "", 80);
    if (normalized) lifecycle[field] = normalized;
  }
  return {
    id,
    type,
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
}

function hasCompatibleEventLifecycle(event) {
  const acceptedStatuses = CANONICAL_EVENT_STATUSES[event?.type];
  if (!acceptedStatuses?.has(event?.status)) return false;
  if (["condition", "allergy"].includes(event.type)) {
    if (Object.hasOwn(event, "verificationStatus") && event.verificationStatus !== "confirmed") return false;
    if (Object.hasOwn(event, "clinicalStatus") && event.clinicalStatus !== event.status) return false;
    if (event.source?.kind === "fhir" && (event.verificationStatus !== "confirmed" || event.clinicalStatus !== event.status)) return false;
  }
  if (event.type === "medication") {
    if (Object.hasOwn(event, "intent") && !ORDER_INTENTS.has(event.intent)) return false;
    if (event.source?.kind === "fhir" && !ORDER_INTENTS.has(event.intent)) return false;
  }
  return true;
}

function assertCanonicalEventLifecycle(event) {
  if (!hasCompatibleEventLifecycle(event)) {
    throw new TypeError(`EMR 임상 이벤트의 상태·검증·의도 조합이 유효하지 않습니다: ${event?.id || "unknown"}`);
  }
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
  return {
    id: cleanText(input.id, uniqueId("patient"), 160),
    mrn: cleanText(input.mrn, "", 120),
    name: cleanText(input.name, "이름 없음", 120),
    birthDate: validDate(input.birthDate),
    sex: ["female", "male", "other", "unknown"].includes(input.sex) ? input.sex : "unknown",
    phone: cleanText(input.phone, "", 80),
    memo: cleanText(input.memo, "", 2_000),
    events,
    createdAt: validTimestamp(input.createdAt, timestamp),
    updatedAt: validTimestamp(input.updatedAt, timestamp),
    ...(fhirIdentity ? { fhirIdentity } : {}),
  };
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
    detail: cleanText(input.detail, "", 500),
  };
}

function audit(action, now, { patientId = "", detail = "" } = {}) {
  return {
    id: uniqueId("audit"),
    at: validTimestamp(now),
    actor: "local-user",
    action,
    patientId,
    detail: cleanText(detail, "", 500),
  };
}

export function createEmptyEmrState(now = new Date().toISOString()) {
  const timestamp = validTimestamp(now);
  return {
    schema: EMR_SCHEMA,
    version: EMR_VERSION,
    demo: false,
    selectedPatientId: "",
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
  return {
    schema: EMR_SCHEMA,
    version: EMR_VERSION,
    demo: input.demo === true,
    selectedPatientId: patientIds.has(selected) ? selected : patients[0]?.id ?? "",
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
  const patient = createPatient(patientInput, now);
  for (const event of patient.events) assertCanonicalEventLifecycle(event);
  if (state.patients.some(({ id }) => id === patient.id)) throw new Error("이미 존재하는 환자 ID입니다.");
  if (patient.fhirIdentity && state.patients.some(({ fhirIdentity }) => fhirIdentity === patient.fhirIdentity)) throw new Error("같은 FHIR 환자가 이미 있습니다.");
  if (patient.mrn && state.patients.some(({ mrn }) => mrn === patient.mrn)) throw new Error("같은 등록번호가 이미 있습니다.");
  return {
    ...state,
    demo: false,
    selectedPatientId: patient.id,
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
    return createPatient({ ...patient, ...patch, id: patient.id, events: patient.events, createdAt: patient.createdAt, updatedAt: now }, now);
  });
  if (!found) throw new Error("환자를 찾을 수 없습니다.");
  return {
    ...state,
    demo: false,
    patients,
    audit: [...state.audit, audit("patient.updated", now, { patientId })].slice(-1_000),
    updatedAt: validTimestamp(now),
  };
}

export function appendPatientEvent(stateInput, patientId, eventInput, now = new Date().toISOString()) {
  const state = normalizeEmrState(stateInput);
  const normalized = normalizePatientEvent({ ...eventInput, id: cleanText(eventInput?.id, uniqueId("event")) });
  if (!normalized) throw new TypeError("임상 이벤트에 유형, 이름, 날짜가 필요합니다.");
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
    demo: false,
    patients,
    audit: [...state.audit, audit("patient.event.added", now, { patientId, detail: `${normalized.type}:${normalized.code || normalized.label}` })].slice(-1_000),
    updatedAt: validTimestamp(now),
  };
}

export function removePatientEvent(stateInput, patientId, eventId, now = new Date().toISOString()) {
  const state = normalizeEmrState(stateInput);
  let removed = false;
  const patients = state.patients.map((patient) => {
    if (patient.id !== patientId) return patient;
    const events = patient.events.filter((event) => {
      if (event.id !== eventId) return true;
      removed = true;
      return false;
    });
    return { ...patient, events, updatedAt: validTimestamp(now) };
  });
  if (!removed) throw new Error("삭제할 이벤트를 찾을 수 없습니다.");
  return {
    ...state,
    demo: false,
    patients,
    audit: [...state.audit, audit("patient.event.removed", now, { patientId, detail: eventId })].slice(-1_000),
    updatedAt: validTimestamp(now),
  };
}

export function addClaimRule(stateInput, ruleInput, now = new Date().toISOString()) {
  const state = normalizeEmrState(stateInput);
  const rule = normalizeClaimRule({ ...ruleInput, id: cleanText(ruleInput?.id, uniqueId("rule")) });
  if (!rule) throw new TypeError("급여 규칙의 이름, 서비스 코드, 시행일이 필요합니다.");
  assertOperationalClaimRule(rule);
  assertNonOverlappingRuleVersions([...state.rules.filter(({ id }) => id !== rule.id), rule]);
  return {
    ...state,
    demo: false,
    rules: [...state.rules.filter(({ id }) => id !== rule.id), rule],
    audit: [...state.audit, audit("claim-rule.saved", now, { detail: rule.id })].slice(-1_000),
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

export function appendStateAudit(stateInput, action, detail = "", now = new Date().toISOString(), patientId = "") {
  const state = normalizeEmrState(stateInput);
  return {
    ...state,
    audit: [...state.audit, audit(action, now, { patientId, detail })].slice(-1_000),
    updatedAt: validTimestamp(now),
  };
}

export function selectPatient(stateInput, patientId) {
  const state = normalizeEmrState(stateInput);
  return state.patients.some(({ id }) => id === patientId) ? { ...state, selectedPatientId: patientId } : state;
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
  const first = createPatient({
    id: "demo-patient-kim",
    mrn: "VG-1001",
    name: "김비타",
    birthDate: "1974-04-12",
    sex: "female",
    memo: "샘플 환자 · 실제 인물이 아닙니다.",
    events: [
      demoEvent("kim-encounter", "encounter", "AMB", "내분비내과 외래", dateBefore(asOf, 4), { note: "혈압과 당화혈색소 추적" }),
      demoEvent("kim-bp", "observation", "85354-9", "혈압", dateBefore(asOf, 9), { system: "http://loinc.org", value: "148/94", unit: "mmHg" }),
      demoEvent("kim-a1c", "observation", "4548-4", "당화혈색소", dateBefore(asOf, 12), { system: "http://loinc.org", value: 7.1, unit: "%" }),
      demoEvent("kim-ldl", "observation", "2089-1", "LDL 콜레스테롤", dateBefore(asOf, 12), { system: "http://loinc.org", value: 156, unit: "mg/dL" }),
      demoEvent("kim-med", "medication", "MED-ARB", "예시 혈압약", dateBefore(asOf, 28), { status: "active", note: "1일 1회" }),
      demoEvent("kim-procedure", "procedure", "DEMO-BP-FOLLOWUP", "고혈압 추적검사", dateBefore(asOf, 55), { system: "urn:vitagraph:demo:service", status: "completed" }),
      demoEvent("kim-diabetes", "condition", "E11", "제2형 당뇨병", dateBefore(asOf, 940), { system: "http://hl7.org/fhir/sid/icd-10", status: "active" }),
      demoEvent("kim-hypertension", "condition", "I10", "고혈압", dateBefore(asOf, 1_460), { system: "http://hl7.org/fhir/sid/icd-10", status: "active" }),
      demoEvent("kim-allergy", "allergy", "ALG-PEN", "페니실린 알레르기", dateBefore(asOf, 2_100), { status: "active", note: "발진" }),
    ],
  }, timestamp);
  const second = createPatient({
    id: "demo-patient-park",
    mrn: "VG-1002",
    name: "박여정",
    birthDate: "1988-11-03",
    sex: "male",
    memo: "샘플 환자 · 실제 인물이 아닙니다.",
    events: [
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
    demo: true,
    selectedPatientId: first.id,
    patients: [first, second],
    rules: DEFAULT_CLAIM_RULES.map((rule) => normalizeClaimRule(rule)),
    audit: [audit("demo.loaded", timestamp, { detail: "2 patients" })],
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
  const patient = createPatient(patientInput);
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
  const patient = createPatient(patientInput);
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
  const normalized = normalizeEmrState(stateInput);
  const data = validateCanonicalEmrState({ ...normalized, demo: false, storageError: "", recoveryRaw: "" });
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
  const patient = createPatient(patientInput);
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
  const normalized = normalizeEmrState(input);
  for (const patient of normalized.patients) {
    for (const event of patient.events) assertCanonicalEventLifecycle(event);
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
  if (input.version !== EMR_VERSION) throw new TypeError(`지원하지 않는 EMR 백업 버전입니다: ${String(input.version)}`);
  if (!input.data || typeof input.data !== "object") throw new TypeError("EMR 백업에 데이터가 없습니다.");
  const normalized = validateCanonicalEmrState(input.data);
  if (input.data.selectedPatientId && normalized.selectedPatientId !== input.data.selectedPatientId) {
    throw new TypeError("EMR 백업의 선택 환자 참조가 유효하지 않습니다.");
  }
  return normalized;
}

export function loadEmrState(storage) {
  let raw = "";
  try {
    const resolvedStorage = storage === undefined ? globalThis.localStorage : storage;
    raw = resolvedStorage?.getItem?.(EMR_STORAGE_KEY) ?? "";
    if (!raw) return createEmptyEmrState();
    const parsed = JSON.parse(raw);
    const normalized = validateCanonicalEmrState(parsed);
    return { ...normalized, demo: false, storageError: "", recoveryRaw: "" };
  } catch (error) {
    return {
      ...createEmptyEmrState(),
      storageError: error instanceof Error ? error.message : "저장된 EMR을 읽지 못했습니다.",
      recoveryRaw: raw,
    };
  }
}

export function saveEmrState(stateInput, storage) {
  const normalized = normalizeEmrState(stateInput);
  const state = validateCanonicalEmrState({ ...normalized, demo: false, storageError: "", recoveryRaw: "" });
  const resolvedStorage = storage === undefined ? globalThis.localStorage : storage;
  resolvedStorage?.setItem?.(EMR_STORAGE_KEY, JSON.stringify(state));
  return state;
}

export function clearEmrState(storage) {
  const resolvedStorage = storage === undefined ? globalThis.localStorage : storage;
  resolvedStorage?.removeItem?.(EMR_STORAGE_KEY);
}
