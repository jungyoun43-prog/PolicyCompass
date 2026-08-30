import {
  appendStateAudit,
  KOREA_TIMEZONE_OFFSET_MINUTES,
  localCalendarDate,
  normalizeEmrState,
  normalizePatientEvent,
} from "./emr-model.js";
import {
  CLINICAL_OBSERVATION_SPECS,
  clinicalObservationSpec,
  LOINC_SYSTEM,
  normalizeClinicalObservationValue,
} from "./clinical-observations.js";

const ACTIVE_ENCOUNTER_STATUSES = new Set(["arrived", "in-progress"]);
const ENCOUNTER_CHILD_TYPES = new Set(["condition", "observation", "medication", "service-request"]);

export const ENCOUNTER_OBSERVATION_PRESETS = CLINICAL_OBSERVATION_SPECS;

function cleanText(value, maximum = 2_000) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function uniqueId(prefix) {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

function normalizedNow(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new TypeError("진료 기록 시각이 유효하지 않습니다.");
  return parsed.toISOString();
}

function assertAtOrAfter(value, previous, label) {
  if (previous && new Date(value).valueOf() < new Date(previous).valueOf()) {
    throw new TypeError(`${label} 시각은 앞선 진료 시각보다 빠를 수 없습니다.`);
  }
}

function latestEncounterAuditTime(state, encounterId) {
  return state.audit
    .filter((event) => event.encounterId === encounterId)
    .map((event) => event.at)
    .filter(Boolean)
    .sort((left, right) => right.localeCompare(left))[0] ?? "";
}

function assertEncounterMutationTime(state, encounterId, now, previous, label) {
  assertAtOrAfter(now, previous, label);
  assertAtOrAfter(now, latestEncounterAuditTime(state, encounterId), label);
}

function assertTextLength(value, label, maximum) {
  if (typeof value === "string" && value.trim().length > maximum) {
    throw new TypeError(`${label}은(는) ${maximum.toLocaleString("ko-KR")}자 이하여야 합니다.`);
  }
}

function calendarDate(value) {
  const parsed = new Date(value);
  const result = localCalendarDate(parsed, KOREA_TIMEZONE_OFFSET_MINUTES);
  if (!result) throw new TypeError("진료일이 유효하지 않습니다.");
  return result;
}

function normalizedPositiveNumber(value, label, maximum = 100_000) {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > maximum) throw new TypeError(`${label}은(는) 0보다 큰 숫자여야 합니다.`);
  return parsed;
}

function normalizedPositiveInteger(value, label, maximum = 3_650) {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) throw new TypeError(`${label}은(는) 1 이상의 정수여야 합니다.`);
  return parsed;
}

function patientIn(state, patientId) {
  const patient = state.patients.find(({ id }) => id === patientId);
  if (!patient) throw new Error("환자를 찾을 수 없습니다.");
  return patient;
}

export function getEncounter(patient, encounterId) {
  return patient?.events?.find((event) => event.type === "encounter" && event.id === encounterId) ?? null;
}

export function getEncounterRecords(patient, encounterId) {
  const encounter = getEncounter(patient, encounterId);
  if (!encounter) return [];
  return [encounter, ...patient.events.filter((event) => event.encounterId === encounterId)];
}

function requireEncounter(state, patientId, encounterId) {
  const patient = patientIn(state, patientId);
  const encounter = getEncounter(patient, encounterId);
  if (!encounter) throw new Error("진료 회차를 찾을 수 없습니다.");
  return { patient, encounter };
}

function assertTrustedEncounterOrigin(encounter) {
  if (encounter.source?.kind === "import") {
    throw new Error("출처 미검증 백업 진료는 진행·수정·완료·서명·취소할 수 없습니다. 새 로컬 진료로 접수하세요.");
  }
}

function requireEditableEncounter(state, patientId, encounterId) {
  const result = requireEncounter(state, patientId, encounterId);
  assertTrustedEncounterOrigin(result.encounter);
  if (result.encounter.recordStatus !== "draft" || result.encounter.signature?.status === "signed") {
    throw new Error("서명된 진료는 직접 수정할 수 없습니다.");
  }
  if (result.encounter.status !== "in-progress") throw new Error("진료 중 상태에서만 기록을 수정할 수 있습니다.");
  return result;
}

function sortedEvents(events) {
  return [...events].sort((left, right) => right.date.localeCompare(left.date)
    || String(right.arrivedAt ?? "").localeCompare(String(left.arrivedAt ?? ""))
    || left.id.localeCompare(right.id));
}

function replacePatientEvents(state, patientId, events, now) {
  return {
    ...state,
    selectedPatientId: patientId,
    patients: state.patients.map((patient) => patient.id === patientId
      ? { ...patient, events: sortedEvents(events), updatedAt: now }
      : patient),
    updatedAt: now,
  };
}

function withAudit(state, action, { patientId, encounterId = "", entityId = "", detail = "", now }) {
  return appendStateAudit(state, action, detail, now, patientId, encounterId, entityId);
}

export function checkInPatient(stateInput, patientId, input = {}, nowInput = new Date().toISOString()) {
  const now = normalizedNow(nowInput);
  const state = normalizeEmrState(stateInput);
  const patient = patientIn(state, patientId);
  if (patient.events.some((event) => event.type === "encounter"
    && event.recordStatus === "draft"
    && event.source?.kind !== "import"
    && ACTIVE_ENCOUNTER_STATUSES.has(event.status))) {
    throw new Error("이 환자에게 이미 대기 또는 진료 중인 회차가 있습니다.");
  }
  const date = cleanText(input.date, 10) || calendarDate(now);
  const department = cleanText(input.department, 120);
  const encounterId = cleanText(input.id, 160) || uniqueId("encounter");
  if (patient.events.some((event) => event.id === encounterId)) throw new Error("이미 존재하는 진료 또는 임상기록 ID입니다.");
  const encounter = normalizePatientEvent({
    id: encounterId,
    type: "encounter",
    recordStatus: "draft",
    label: cleanText(input.label, 240) || `${department || "외래"} 진료`,
    date,
    status: "arrived",
    arrivedAt: now,
    department,
    clinician: cleanText(input.clinician, 120),
    room: cleanText(input.room, 80),
    chiefComplaint: cleanText(input.chiefComplaint),
    soap: {},
    signature: { status: "unsigned", signer: "", signedAt: "" },
    source: { kind: input.source?.kind === "demo" ? "demo" : "manual", label: input.source?.label || "당일 접수" },
  });
  if (!encounter) throw new TypeError("진료 접수 정보가 유효하지 않습니다.");
  let next = replacePatientEvents(state, patientId, [...patient.events, encounter], now);
  next = { ...next, selectedEncounterId: encounter.id };
  return withAudit(next, "encounter.checked-in", { patientId, encounterId: encounter.id, entityId: encounter.id, detail: encounter.label, now });
}

export function startEncounter(stateInput, patientId, encounterId, nowInput = new Date().toISOString()) {
  const now = normalizedNow(nowInput);
  const state = normalizeEmrState(stateInput);
  const { patient, encounter } = requireEncounter(state, patientId, encounterId);
  assertTrustedEncounterOrigin(encounter);
  if (encounter.recordStatus !== "draft" || encounter.status !== "arrived") throw new Error("대기 상태 진료만 시작할 수 있습니다.");
  assertEncounterMutationTime(state, encounterId, now, encounter.arrivedAt, "진료 시작");
  const updated = normalizePatientEvent({ ...encounter, status: "in-progress", startedAt: now });
  let next = replacePatientEvents(state, patientId, patient.events.map((event) => event.id === encounterId ? updated : event), now);
  next = { ...next, selectedEncounterId: encounterId };
  return withAudit(next, "encounter.started", { patientId, encounterId, entityId: encounterId, detail: encounter.label, now });
}

export function saveEncounterDraft(stateInput, patientId, encounterId, patch = {}, nowInput = new Date().toISOString()) {
  const now = normalizedNow(nowInput);
  const state = normalizeEmrState(stateInput);
  const { patient, encounter } = requireEditableEncounter(state, patientId, encounterId);
  assertEncounterMutationTime(state, encounterId, now, encounter.startedAt || encounter.arrivedAt, "진료 초안 저장");
  assertTextLength(patch.chiefComplaint, "주호소", 2_000);
  for (const [field, label] of [["subjective", "SOAP S"], ["objective", "SOAP O"], ["assessment", "SOAP A"], ["plan", "SOAP P"]]) {
    assertTextLength(patch.soap?.[field], label, 8_000);
  }
  const updated = normalizePatientEvent({
    ...encounter,
    date: cleanText(patch.date, 10) || encounter.date,
    department: patch.department ?? encounter.department,
    clinician: patch.clinician ?? encounter.clinician,
    room: patch.room ?? encounter.room,
    chiefComplaint: patch.chiefComplaint ?? encounter.chiefComplaint,
    soap: patch.soap ?? encounter.soap,
  });
  if (!updated) throw new TypeError("진료 기본정보 또는 진료일이 유효하지 않습니다.");
  const nextDate = updated.date;
  let next = replacePatientEvents(state, patientId, patient.events.map((event) => {
    if (event.id === encounterId) return updated;
    if (event.encounterId === encounterId && event.recordStatus === "draft" && event.date !== nextDate) {
      return normalizePatientEvent({ ...event, date: nextDate });
    }
    return event;
  }), now);
  next = { ...next, selectedEncounterId: encounterId };
  return withAudit(next, "encounter.draft.saved", { patientId, encounterId, entityId: encounterId, detail: "SOAP·진료 정보 임시저장", now });
}

function addChildEvent(stateInput, patientId, encounterId, eventInput, action, nowInput) {
  const now = normalizedNow(nowInput);
  const state = normalizeEmrState(stateInput);
  const { patient, encounter } = requireEditableEncounter(state, patientId, encounterId);
  assertEncounterMutationTime(state, encounterId, now, encounter.startedAt || encounter.arrivedAt, "진료 항목 추가");
  const event = normalizePatientEvent({
    ...eventInput,
    id: cleanText(eventInput.id, 160) || uniqueId(eventInput.type),
    encounterId,
    recordStatus: "draft",
    date: encounter.date,
    ...(eventInput.type === "observation" ? { observedAt: now } : {}),
    source: { kind: "encounter", label: "진료 입력", resourceId: encounterId },
  });
  if (!event) throw new TypeError("진료 항목이 유효하지 않습니다.");
  if (patient.events.some(({ id }) => id === event.id)) throw new Error("이미 존재하는 진료 항목 ID입니다.");
  let next = replacePatientEvents(state, patientId, [...patient.events, event], now);
  next = { ...next, selectedEncounterId: encounterId };
  return withAudit(next, action, { patientId, encounterId, entityId: event.id, detail: event.label, now });
}

export function addEncounterDiagnosis(stateInput, patientId, encounterId, input = {}, now = new Date().toISOString()) {
  requireEditableEncounter(normalizeEmrState(stateInput), patientId, encounterId);
  const label = cleanText(input.label, 240);
  const code = cleanText(input.code, 120);
  const system = cleanText(input.system, 300);
  if (!label) throw new TypeError("진단명이 필요합니다.");
  if (!code || !system) throw new TypeError("진단 코드와 코드 시스템이 필요합니다.");
  if (input.diagnosisRole === "primary") {
    const state = normalizeEmrState(stateInput);
    const { patient } = requireEditableEncounter(state, patientId, encounterId);
    if (patient.events.some((event) => event.encounterId === encounterId && event.type === "condition" && event.recordStatus === "draft" && event.diagnosisRole === "primary")) {
      throw new TypeError("주상병은 진료 회차마다 한 건만 입력할 수 있습니다.");
    }
  }
  const certainty = input.certainty === "provisional" ? "provisional" : "confirmed";
  return addChildEvent(stateInput, patientId, encounterId, {
    id: input.id,
    type: "condition",
    system,
    code,
    label,
    status: "active",
    clinicalStatus: "active",
    verificationStatus: certainty,
    certainty,
    diagnosisRole: input.diagnosisRole === "primary" ? "primary" : "secondary",
    onsetDate: cleanText(input.onsetDate, 10),
    note: cleanText(input.note, 4_000),
  }, "diagnosis.added", now);
}

export function addEncounterObservation(stateInput, patientId, encounterId, input = {}, now = new Date().toISOString()) {
  requireEditableEncounter(normalizeEmrState(stateInput), patientId, encounterId);
  const code = cleanText(input.code, 120);
  const preset = clinicalObservationSpec(code);
  if (!preset) throw new TypeError("지원되는 진료 측정 항목을 선택하세요.");
  const value = normalizeClinicalObservationValue(input.value, preset);
  return addChildEvent(stateInput, patientId, encounterId, {
    id: input.id,
    type: "observation",
    system: LOINC_SYSTEM,
    code: preset.code,
    label: preset.label,
    status: "final",
    value,
    unit: preset.unit,
    note: cleanText(input.note, 4_000),
  }, "observation.added", now);
}

export function addEncounterPrescription(stateInput, patientId, encounterId, input = {}, now = new Date().toISOString()) {
  requireEditableEncounter(normalizeEmrState(stateInput), patientId, encounterId);
  const label = cleanText(input.label, 240);
  const code = cleanText(input.code, 120);
  const system = cleanText(input.system, 300);
  if (!label) throw new TypeError("약품명이 필요합니다.");
  if (code && !system) throw new TypeError("약품 코드를 입력하면 코드 시스템이 필요합니다.");
  const prescription = {
    dose: normalizedPositiveNumber(input.dose, "1회량"),
    doseUnit: cleanText(input.doseUnit, 40),
    route: cleanText(input.route, 80),
    frequency: cleanText(input.frequency, 120),
    durationDays: normalizedPositiveInteger(input.durationDays, "투여 일수", 365),
    quantity: normalizedPositiveNumber(input.quantity, "총량"),
    instructions: cleanText(input.instructions),
  };
  if (!prescription.doseUnit || !prescription.route || !prescription.frequency) {
    throw new TypeError("처방에는 단위, 투여 경로, 투여 횟수가 필요합니다.");
  }
  return addChildEvent(stateInput, patientId, encounterId, {
    id: input.id,
    type: "medication",
    system,
    code,
    label,
    status: "active",
    intent: "order",
    prescription,
    claimReviewVerdict: ["circle", "triangle", "cross"].includes(input.claimReviewVerdict) ? input.claimReviewVerdict : undefined,
    note: prescription.instructions,
  }, "prescription.added", now);
}

export function addEncounterOrder(stateInput, patientId, encounterId, input = {}, now = new Date().toISOString()) {
  requireEditableEncounter(normalizeEmrState(stateInput), patientId, encounterId);
  const label = cleanText(input.label, 240);
  const code = cleanText(input.code, 120);
  const system = cleanText(input.system, 300);
  if (!label) throw new TypeError("오더명이 필요합니다.");
  if (code && !system) throw new TypeError("오더 코드를 입력하면 코드 시스템이 필요합니다.");
  return addChildEvent(stateInput, patientId, encounterId, {
    id: input.id,
    type: "service-request",
    system,
    code,
    label,
    status: "active",
    intent: "order",
    order: {
      kind: ["laboratory", "imaging", "procedure", "referral"].includes(input.kind) ? input.kind : "laboratory",
      priority: ["routine", "urgent", "asap", "stat"].includes(input.priority) ? input.priority : "routine",
      instructions: cleanText(input.instructions),
    },
  }, "order.added", now);
}

const EDITABLE_ITEM_FIELDS = {
  condition: new Set(["system", "code", "label", "diagnosisRole", "certainty", "onsetDate", "note"]),
  observation: new Set(["note"]),
  medication: new Set(["system", "code", "label", "prescription", "note"]),
  "service-request": new Set(["system", "code", "label", "order", "note"]),
};

function editableItemPatch(current, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new TypeError("진료 항목 수정 형식이 유효하지 않습니다.");
  const allowed = EDITABLE_ITEM_FIELDS[current.type];
  const forbidden = Object.keys(patch).filter((field) => !allowed.has(field));
  if (forbidden.length) throw new TypeError(`진료 항목의 보호 필드는 수정할 수 없습니다: ${forbidden.join(", ")}`);
  return Object.fromEntries(Object.entries(patch).filter(([field]) => allowed.has(field)));
}

function assertEditableItem(current, updated, patient, encounterId) {
  if (!updated.label) throw new TypeError("진료 항목 이름이 필요합니다.");
  if (updated.code && !updated.system) throw new TypeError("코드를 입력하면 코드 시스템이 필요합니다.");
  if (current.type === "condition") {
    if (!updated.code || !updated.system) throw new TypeError("진단 코드와 코드 시스템이 필요합니다.");
    if (!['confirmed', 'provisional'].includes(updated.certainty)) throw new TypeError("진단 확정 상태가 유효하지 않습니다.");
    if (updated.diagnosisRole === "primary" && patient.events.some((event) => (
      event.id !== current.id
      && event.encounterId === encounterId
      && event.type === "condition"
      && event.recordStatus === "draft"
      && event.diagnosisRole === "primary"
    ))) throw new TypeError("주상병은 진료 회차마다 한 건만 입력할 수 있습니다.");
  }
  if (current.type === "observation") {
    const preset = clinicalObservationSpec(updated.code);
    if (!preset || updated.system !== "http://loinc.org" || updated.label !== preset.label || updated.unit !== preset.unit) {
      throw new TypeError("진료 측정의 LOINC 코드·이름·단위를 변경할 수 없습니다.");
    }
    normalizeClinicalObservationValue(updated.value, preset);
  }
  if (current.type === "medication") {
    const prescription = updated.prescription ?? {};
    if (!(prescription.dose > 0) || !prescription.doseUnit || !prescription.route || !prescription.frequency
      || !(prescription.durationDays > 0) || !(prescription.quantity > 0)) {
      throw new TypeError("처방 용법을 완성하세요.");
    }
  }
}

export function updateEncounterItem(stateInput, patientId, encounterId, entityId, patch = {}, nowInput = new Date().toISOString()) {
  const now = normalizedNow(nowInput);
  const state = normalizeEmrState(stateInput);
  const { patient, encounter } = requireEditableEncounter(state, patientId, encounterId);
  assertEncounterMutationTime(state, encounterId, now, encounter.startedAt || encounter.arrivedAt, "진료 항목 수정");
  const current = patient.events.find((event) => event.id === entityId && event.encounterId === encounterId && ENCOUNTER_CHILD_TYPES.has(event.type));
  if (!current) throw new Error("수정할 진료 항목을 찾을 수 없습니다.");
  const editable = editableItemPatch(current, patch);
  if (current.type === "condition" && Object.hasOwn(editable, "certainty")) editable.verificationStatus = editable.certainty;
  const updated = normalizePatientEvent({
    ...current,
    ...editable,
    id: current.id,
    type: current.type,
    encounterId,
    recordStatus: "draft",
    date: current.date,
    status: current.status,
    clinicalStatus: current.clinicalStatus,
    intent: current.intent,
    source: current.source,
  });
  if (!updated) throw new TypeError("수정한 진료 항목이 유효하지 않습니다.");
  assertEditableItem(current, updated, patient, encounterId);
  const next = replacePatientEvents(state, patientId, patient.events.map((event) => event.id === entityId ? updated : event), now);
  return withAudit(next, `${current.type}.updated`, { patientId, encounterId, entityId, detail: current.label, now });
}

export function removeEncounterItem(stateInput, patientId, encounterId, entityId, nowInput = new Date().toISOString()) {
  const now = normalizedNow(nowInput);
  const state = normalizeEmrState(stateInput);
  const { patient, encounter } = requireEditableEncounter(state, patientId, encounterId);
  assertEncounterMutationTime(state, encounterId, now, encounter.startedAt || encounter.arrivedAt, "진료 항목 삭제");
  const current = patient.events.find((event) => event.id === entityId && event.encounterId === encounterId && ENCOUNTER_CHILD_TYPES.has(event.type));
  if (!current) throw new Error("삭제할 진료 항목을 찾을 수 없습니다.");
  const next = replacePatientEvents(state, patientId, patient.events.filter((event) => event.id !== entityId), now);
  return withAudit(next, `${current.type}.removed`, { patientId, encounterId, entityId, detail: current.label, now });
}

export function validateEncounterForCompletion(patient, encounterId) {
  const encounter = getEncounter(patient, encounterId);
  if (!encounter) return ["진료 회차를 찾을 수 없습니다."];
  const errors = [];
  if (encounter.status !== "in-progress") errors.push("진료 중 상태가 아닙니다.");
  if (!cleanText(encounter.clinician, 120)) errors.push("담당 의료진을 입력하세요.");
  if (!cleanText(encounter.chiefComplaint)) errors.push("주호소를 입력하세요.");
  if (!cleanText(encounter.soap?.subjective, 8_000) && !cleanText(encounter.soap?.objective, 8_000)) errors.push("SOAP의 S 또는 O를 입력하세요.");
  if (!cleanText(encounter.soap?.assessment, 8_000)) errors.push("SOAP의 A를 입력하세요.");
  if (!cleanText(encounter.soap?.plan, 8_000)) errors.push("SOAP의 P를 입력하세요.");
  const children = patient.events.filter((event) => event.encounterId === encounterId && event.recordStatus === "draft");
  const diagnoses = children.filter((event) => event.type === "condition");
  if (diagnoses.length === 0) errors.push("진단을 한 건 이상 입력하세요.");
  if (diagnoses.filter((event) => event.diagnosisRole === "primary").length !== 1) errors.push("주상병을 정확히 한 건 입력하세요.");
  if (diagnoses.some((event) => !event.code || !event.system)) errors.push("모든 진단에 코드와 코드 시스템을 입력하세요.");
  for (const medication of children.filter((event) => event.type === "medication")) {
    const prescription = medication.prescription ?? {};
    if (!(prescription.dose > 0) || !prescription.doseUnit || !prescription.route || !prescription.frequency || !(prescription.durationDays > 0) || !(prescription.quantity > 0)) {
      errors.push(`${medication.label} 처방 용법을 완성하세요.`);
    }
  }
  return errors;
}

function signingOmission(code, message, target, action) {
  return { code, message, target, action };
}

export function encounterSigningOmissions(patient, encounterId) {
  const encounter = getEncounter(patient, encounterId);
  if (!encounter) {
    return [signingOmission(
      "encounter-missing",
      "진료 회차를 찾을 수 없습니다.",
      "encounterDate",
      "진료 맥락 확인",
    )];
  }
  const omissions = [];
  if (!cleanText(patient?.name, 200)) {
    omissions.push(signingOmission("patient-name", "환자 이름이 없습니다.", "patientName", "환자 정보 수정"));
  }
  if (!cleanText(patient?.mrn, 120)) {
    omissions.push(signingOmission("patient-mrn", "MRN(차트번호)이 없습니다.", "patientMrn", "환자 정보 수정"));
  }
  if (!cleanText(encounter.id, 200) || !cleanText(encounter.date, 40)) {
    omissions.push(signingOmission(
      "encounter-context",
      "Encounter 식별자 또는 날짜가 없습니다.",
      "encounterDate",
      "진료 맥락 수정",
    ));
  }
  if (!cleanText(encounter.clinician, 120)) {
    omissions.push(signingOmission(
      "encounter-clinician",
      "담당 의료진이 없습니다.",
      "encounterClinician",
      "담당 의료진 수정",
    ));
  }
  if (!cleanText(encounter.chiefComplaint)) {
    omissions.push(signingOmission(
      "chief-complaint",
      "주호소가 없습니다.",
      "chiefComplaint",
      "주호소 수정",
    ));
  }
  for (const [key, label, target] of [
    ["subjective", "Subjective", "soapSubjective"],
    ["objective", "Objective", "soapObjective"],
    ["assessment", "Assessment", "soapAssessment"],
    ["plan", "Plan", "soapPlan"],
  ]) {
    if (!cleanText(encounter.soap?.[key], 8_000)) {
      omissions.push(signingOmission(
        `soap-${key}`,
        `SOAP ${label}가 비어 있습니다.`,
        target,
        "SOAP 수정",
      ));
    }
  }
  const children = patient.events.filter((event) =>
    event.encounterId === encounterId && event.recordStatus === "draft");
  const diagnoses = children.filter((event) => event.type === "condition");
  if (diagnoses.length === 0) {
    omissions.push(signingOmission(
      "diagnosis-required",
      "KCD 진단이 없습니다.",
      "diagnosisLabel",
      "진단 추가",
    ));
  }
  if (diagnoses.length > 0 && diagnoses.filter((event) => event.diagnosisRole === "primary").length !== 1) {
    omissions.push(signingOmission(
      "primary-diagnosis-count",
      "주상병을 정확히 한 건 지정해야 합니다.",
      "diagnosisLabel",
      "진단 역할 수정",
    ));
  }
  if (diagnoses.some((event) => !cleanText(event.code, 120) || !cleanText(event.system, 500))) {
    omissions.push(signingOmission(
      "diagnosis-coding",
      "모든 진단에 코드와 코드 시스템이 필요합니다.",
      "diagnosisLabel",
      "진단 코드 수정",
    ));
  }
  for (const medication of children.filter((event) => event.type === "medication")) {
    const prescription = medication.prescription ?? {};
    if (!(prescription.dose > 0)
      || !cleanText(prescription.doseUnit, 80)
      || !cleanText(prescription.route, 80)
      || !cleanText(prescription.frequency, 120)
      || !(prescription.durationDays > 0)
      || !(prescription.quantity > 0)) {
      omissions.push(signingOmission(
        `prescription-dosing:${medication.id}`,
        `${medication.label} 처방의 1회량·단위·경로·빈도·기간·총량을 완성해야 합니다.`,
        "medicationName",
        "처방 용법 수정",
      ));
    }
  }
  return omissions;
}

export function validateEncounterForSigning(patient, encounterId) {
  return encounterSigningOmissions(patient, encounterId).map(({ message }) => message);
}

export function completeEncounter(stateInput, patientId, encounterId, draftPatch = {}, nowInput = new Date().toISOString()) {
  const now = normalizedNow(nowInput);
  let state = saveEncounterDraft(stateInput, patientId, encounterId, draftPatch, now);
  const { patient, encounter } = requireEditableEncounter(state, patientId, encounterId);
  const errors = validateEncounterForCompletion(patient, encounterId);
  if (errors.length) throw new TypeError(errors.join(" "));
  assertEncounterMutationTime(state, encounterId, now, encounter.startedAt || encounter.arrivedAt, "진료 완료");
  const completed = normalizePatientEvent({ ...encounter, status: "finished", finishedAt: now });
  let next = replacePatientEvents(state, patientId, patient.events.map((event) => event.id === encounterId ? completed : event), now);
  next = { ...next, selectedEncounterId: encounterId };
  return withAudit(next, "encounter.completed", { patientId, encounterId, entityId: encounterId, detail: "서명 대기", now });
}

export function signEncounter(stateInput, patientId, encounterId, signerInput = "", nowInput = new Date().toISOString()) {
  const now = normalizedNow(nowInput);
  const state = normalizeEmrState(stateInput);
  const { patient, encounter } = requireEncounter(state, patientId, encounterId);
  assertTrustedEncounterOrigin(encounter);
  if (encounter.recordStatus !== "draft" || encounter.status !== "finished" || encounter.signature?.status !== "unsigned") {
    throw new Error("완료되어 서명 대기 중인 진료만 서명할 수 있습니다.");
  }
  const omissions = encounterSigningOmissions(patient, encounterId);
  if (omissions.length) {
    throw new TypeError(`필수 진료기록이 완전하지 않아 서명할 수 없습니다. ${omissions.map(({ message }) => message).join(" ")}`);
  }
  const signer = cleanText(signerInput || encounter.clinician, 120);
  if (!signer) throw new TypeError("서명자 표시명이 필요합니다.");
  assertEncounterMutationTime(state, encounterId, now, encounter.finishedAt || encounter.startedAt || encounter.arrivedAt, "진료 서명");
  const signedEvents = patient.events.map((event) => {
    if (event.id === encounterId) return normalizePatientEvent({
      ...event,
      recordStatus: "final",
      signature: { status: "signed", signer, signedAt: now },
    });
    if (event.encounterId === encounterId && event.recordStatus === "draft") return normalizePatientEvent({ ...event, recordStatus: "final" });
    return event;
  });
  let next = replacePatientEvents(state, patientId, signedEvents, now);
  next = { ...next, selectedEncounterId: encounterId };
  return withAudit(next, "encounter.signed", { patientId, encounterId, entityId: encounterId, detail: signer, now });
}

export function reopenEncounter(stateInput, patientId, encounterId, nowInput = new Date().toISOString()) {
  const now = normalizedNow(nowInput);
  const state = normalizeEmrState(stateInput);
  const { patient, encounter } = requireEncounter(state, patientId, encounterId);
  assertTrustedEncounterOrigin(encounter);
  if (encounter.recordStatus !== "draft" || encounter.status !== "finished" || encounter.signature?.status !== "unsigned") {
    throw new Error("서명 전 완료 진료만 다시 열 수 있습니다.");
  }
  assertEncounterMutationTime(state, encounterId, now, encounter.finishedAt || encounter.startedAt || encounter.arrivedAt, "진료 재개");
  const reopened = normalizePatientEvent({ ...encounter, status: "in-progress", finishedAt: "" });
  let next = replacePatientEvents(state, patientId, patient.events.map((event) => event.id === encounterId ? reopened : event), now);
  next = { ...next, selectedEncounterId: encounterId };
  return withAudit(next, "encounter.reopened", { patientId, encounterId, entityId: encounterId, detail: "서명 전 재개", now });
}

export function cancelEncounter(stateInput, patientId, encounterId, reasonInput = "", nowInput = new Date().toISOString()) {
  const now = normalizedNow(nowInput);
  const reason = cleanText(reasonInput, 500);
  if (!reason) throw new TypeError("진료 취소 사유가 필요합니다.");
  const state = normalizeEmrState(stateInput);
  const { patient, encounter } = requireEncounter(state, patientId, encounterId);
  assertTrustedEncounterOrigin(encounter);
  if (encounter.recordStatus !== "draft" || !ACTIVE_ENCOUNTER_STATUSES.has(encounter.status)) throw new Error("대기 또는 진료 중 회차만 취소할 수 있습니다.");
  assertEncounterMutationTime(state, encounterId, now, encounter.startedAt || encounter.arrivedAt, "진료 취소");
  const events = patient.events.map((event) => {
    if (event.id === encounterId) return normalizePatientEvent({ ...event, status: "cancelled", recordStatus: "entered-in-error", finishedAt: now, note: reason });
    if (event.encounterId === encounterId) return normalizePatientEvent({ ...event, recordStatus: "entered-in-error", note: [event.note, `진료 취소: ${reason}`].filter(Boolean).join(" · ") });
    return event;
  });
  let next = replacePatientEvents(state, patientId, events, now);
  next = { ...next, selectedEncounterId: encounterId };
  return withAudit(next, "encounter.cancelled", { patientId, encounterId, entityId: encounterId, detail: reason, now });
}

export function selectTodayQueue(stateInput, dateInput = localCalendarDate()) {
  const state = normalizeEmrState(stateInput);
  const date = cleanText(dateInput, 10);
  const rows = [];
  for (const patient of state.patients) {
    for (const encounter of patient.events.filter((event) => event.type === "encounter" && event.date === date && event.recordStatus !== "entered-in-error")) {
      rows.push({ patient, encounter });
    }
  }
  return rows.sort((left, right) => String(left.encounter.arrivedAt).localeCompare(String(right.encounter.arrivedAt)) || left.patient.name.localeCompare(right.patient.name, "ko"));
}
