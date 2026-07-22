import {
  addClaimRule,
  addPatient,
  appendStateAudit,
  appendPatientEvent,
  clinicalContextFingerprint,
  clearEmrState,
  confirmPatientEvent,
  createClinicalGraph,
  createClaimPreflightPatient,
  createCopilotRequest,
  createDemoEmrState,
  createEmptyEmrState,
  createFinalizedPatientView,
  createLocalCopilotBrief,
  EMR_STORAGE_KEY,
  exportEmrBackup,
  initializeEmrState,
  loadEmrState,
  localCalendarDate,
  KOREA_TIMEZONE_OFFSET_MINUTES,
  parseEmrBackup,
  prepareUnverifiedBackupRestore,
  recoverEmrState,
  removePatientEvent,
  retireClaimRule,
  saveEmrState,
  selectPatient,
  selectEncounter,
  updatePatient,
} from "./emr-model.js";
import { parseEmrFhirBundle } from "./emr-fhir.js";
import { exportPatientFhirBundle } from "./emr-fhir-export.js";
import {
  createPatientTransferPackage,
  patientTransferFilename,
} from "./patient-transfer.js";
import {
  addEncounterDiagnosis,
  addEncounterObservation,
  addEncounterOrder,
  addEncounterPrescription,
  cancelEncounter,
  checkInPatient,
  completeEncounter,
  getEncounter,
  getEncounterRecords,
  reopenEncounter,
  removeEncounterItem,
  saveEncounterDraft,
  signEncounter,
  startEncounter,
  ENCOUNTER_OBSERVATION_PRESETS,
} from "./emr-encounter.js";
import {
  buildClaimBoard,
  CLAIM_LANE_LABELS,
  CLAIM_LANE_ORDER,
} from "./claim-rules.js";

const EVENT_LABELS = {
  encounter: "내원",
  condition: "진단·문제",
  observation: "검사·측정",
  medication: "약물",
  allergy: "알레르기",
  procedure: "수술·처치",
  "service-request": "검사·처치 오더",
  symptom: "증상",
  note: "진료 메모",
};

const SEX_LABELS = {
  female: "여성",
  male: "남성",
  other: "기타",
  unknown: "미상",
};

const AUDIT_LABELS = {
  "patient.created": "환자 등록",
  "patient.updated": "환자 정보 변경",
  "patient.event.added": "임상 이벤트 추가",
  "patient.event.confirmed": "과거자료 검토·확정",
  "patient.event.voided": "임상 이벤트 취소",
  "encounter.checked-in": "오늘 진료 접수",
  "encounter.started": "진료 시작",
  "encounter.draft.saved": "SOAP·진료 초안 저장",
  "encounter.completed": "진료 완료",
  "encounter.signed": "진료 서명",
  "encounter.reopened": "서명 전 진료 재개",
  "encounter.cancelled": "진료 취소",
  "diagnosis.added": "진단 추가",
  "observation.added": "진료 측정 추가",
  "prescription.added": "처방 추가",
  "order.added": "오더 추가",
  "condition.removed": "진단 초안 삭제",
  "observation.removed": "진료 측정 초안 삭제",
  "medication.removed": "처방 초안 삭제",
  "service-request.removed": "오더 초안 삭제",
  "schema.migrated": "EMR 스키마 이관",
  "claim-rule.saved": "급여 규칙 저장",
  "claim-rule.retired": "급여 규칙 종료일 설정",
  "fhir.imported": "FHIR 가져오기",
  "fhir.exported": "의료기관용 FHIR 내보내기",
  "patient.transfer.exported": "환자용 VitaGraph 전달",
  "backup.restored": "백업 복원",
  "demo.loaded": "샘플 워크스페이스 열기",
};

const INSURANCE_LABELS = {
  "national-health": "건강보험",
  "medical-aid": "의료급여",
  industrial: "산재보험",
  auto: "자동차보험",
  "self-pay": "일반·비급여",
  other: "기타",
  unknown: "보험 미상",
};

const QUEUE_LABELS = {
  none: "미접수",
  waiting: "대기",
  "in-progress": "진료 중",
  completed: "서명 대기",
  signed: "완료·서명",
  legacy: "완료·이관",
  external: "외부 완료·미검증",
};

const GRAPH_COLORS = {
  condition: "var(--accent)",
  observation: "var(--data-cyan)",
  medication: "var(--data-violet)",
  allergy: "var(--data-amber)",
  procedure: "var(--data-lime)",
  symptom: "var(--surface)",
};

const SVG_NS = "http://www.w3.org/2000/svg";
const today = () => localCalendarDate(new Date(), KOREA_TIMEZONE_OFFSET_MINUTES);
const byId = (id) => document.getElementById(id);
const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const timestampFormatter = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const refs = {
  mainContent: byId("mainContent"),
  patientList: byId("patientList"),
  patientListEmpty: byId("patientListEmpty"),
  patientCount: byId("patientCount"),
  patientSearch: byId("patientSearch"),
  patientComposer: byId("patientComposer"),
  patientForm: byId("patientForm"),
  patientFormMode: byId("patientFormMode"),
  patientMrn: byId("patientMrn"),
  patientName: byId("patientName"),
  patientBirthDate: byId("patientBirthDate"),
  patientAgeYears: byId("patientAgeYears"),
  patientSex: byId("patientSex"),
  patientPhone: byId("patientPhone"),
  patientAddress: byId("patientAddress"),
  patientBloodType: byId("patientBloodType"),
  patientInsuranceType: byId("patientInsuranceType"),
  patientEmergencyName: byId("patientEmergencyName"),
  patientEmergencyRelation: byId("patientEmergencyRelation"),
  patientEmergencyPhone: byId("patientEmergencyPhone"),
  patientMemo: byId("patientMemo"),
  patientFormMessage: byId("patientFormMessage"),
  cancelPatientEdit: byId("cancelPatientEdit"),
  workspaceEmpty: byId("workspaceEmpty"),
  workspaceContent: byId("workspaceContent"),
  selectedPatientName: byId("selectedPatientName"),
  selectedPatientMeta: byId("selectedPatientMeta"),
  safetyAlerts: byId("safetyAlerts"),
  lastSavedAt: byId("lastSavedAt"),
  patientMetrics: byId("patientMetrics"),
  clinicalSummary: byId("clinicalSummary"),
  copilotMode: byId("copilotMode"),
  copilotContent: byId("copilotContent"),
  runCopilot: byId("runCopilot"),
  nextWorkList: byId("nextWorkList"),
  queueFilters: byId("queueFilters"),
  encounterTitle: byId("encounterTitle"),
  encounterStatus: byId("encounterStatus"),
  encounterStatusText: byId("encounterStatusText"),
  returnCurrentEncounter: byId("returnCurrentEncounter"),
  checkInPatient: byId("checkInPatient"),
  startEncounter: byId("startEncounter"),
  encounterForm: byId("encounterForm"),
  encounterDate: byId("encounterDate"),
  encounterDepartment: byId("encounterDepartment"),
  encounterClinician: byId("encounterClinician"),
  encounterRoom: byId("encounterRoom"),
  chiefComplaint: byId("chiefComplaint"),
  soapSubjective: byId("soapSubjective"),
  soapObjective: byId("soapObjective"),
  soapAssessment: byId("soapAssessment"),
  soapPlan: byId("soapPlan"),
  saveEncounterDraft: byId("saveEncounterDraft"),
  completeEncounter: byId("completeEncounter"),
  signEncounter: byId("signEncounter"),
  reopenEncounter: byId("reopenEncounter"),
  cancelEncounter: byId("cancelEncounter"),
  encounterFormMessage: byId("encounterFormMessage"),
  vitalForm: byId("vitalForm"),
  vitalPreset: byId("vitalPreset"),
  vitalValue: byId("vitalValue"),
  vitalUnit: byId("vitalUnit"),
  vitalNote: byId("vitalNote"),
  vitalList: byId("vitalList"),
  diagnosisForm: byId("diagnosisForm"),
  diagnosisRole: byId("diagnosisRole"),
  diagnosisCode: byId("diagnosisCode"),
  diagnosisSystem: byId("diagnosisSystem"),
  diagnosisLabel: byId("diagnosisLabel"),
  diagnosisCertainty: byId("diagnosisCertainty"),
  diagnosisList: byId("diagnosisList"),
  prescriptionForm: byId("prescriptionForm"),
  medicationCode: byId("medicationCode"),
  medicationSystem: byId("medicationSystem"),
  medicationName: byId("medicationName"),
  medicationDose: byId("medicationDose"),
  medicationDoseUnit: byId("medicationDoseUnit"),
  medicationRoute: byId("medicationRoute"),
  medicationFrequency: byId("medicationFrequency"),
  medicationDurationDays: byId("medicationDurationDays"),
  medicationQuantity: byId("medicationQuantity"),
  medicationInstructions: byId("medicationInstructions"),
  prescriptionList: byId("prescriptionList"),
  orderForm: byId("orderForm"),
  orderKind: byId("orderKind"),
  orderCode: byId("orderCode"),
  orderSystem: byId("orderSystem"),
  orderLabel: byId("orderLabel"),
  orderPriority: byId("orderPriority"),
  orderInstructions: byId("orderInstructions"),
  orderList: byId("orderList"),
  encounterClaimSummary: byId("encounterClaimSummary"),
  encounterSignoffSummary: byId("encounterSignoffSummary"),
  recentEncounterList: byId("recentEncounterList"),
  encounterGraphSummary: byId("encounterGraphSummary"),
  eventForm: byId("eventForm"),
  eventType: byId("eventType"),
  eventDate: byId("eventDate"),
  eventCode: byId("eventCode"),
  eventSystem: byId("eventSystem"),
  eventLabel: byId("eventLabel"),
  eventValue: byId("eventValue"),
  eventUnit: byId("eventUnit"),
  eventNote: byId("eventNote"),
  eventFormMessage: byId("eventFormMessage"),
  eventFilters: byId("eventFilters"),
  eventTimeline: byId("eventTimeline"),
  eventCount: byId("eventCount"),
  clinicalGraph: byId("clinicalGraph"),
  graphEvidenceList: byId("graphEvidenceList"),
  graphLegend: document.querySelector(".graph-legend"),
  claimBoard: byId("claimBoard"),
  ruleVersionList: byId("ruleVersionList"),
  ruleForm: byId("ruleForm"),
  ruleSetId: byId("ruleSetId"),
  ruleVersion: byId("ruleVersion"),
  ruleTitle: byId("ruleTitle"),
  ruleServiceCode: byId("ruleServiceCode"),
  ruleServiceSystem: byId("ruleServiceSystem"),
  ruleServiceEventType: byId("ruleServiceEventType"),
  ruleWindowDays: byId("ruleWindowDays"),
  ruleMaxCount: byId("ruleMaxCount"),
  ruleApplicabilityCodes: byId("ruleApplicabilityCodes"),
  ruleApplicabilitySystem: byId("ruleApplicabilitySystem"),
  ruleEvidenceCodes: byId("ruleEvidenceCodes"),
  ruleEvidenceEventType: byId("ruleEvidenceEventType"),
  ruleEvidenceSystem: byId("ruleEvidenceSystem"),
  ruleEvidenceLookbackDays: byId("ruleEvidenceLookbackDays"),
  ruleEffectiveFrom: byId("ruleEffectiveFrom"),
  ruleEffectiveTo: byId("ruleEffectiveTo"),
  ruleSourceLabel: byId("ruleSourceLabel"),
  ruleSourceUrl: byId("ruleSourceUrl"),
  ruleFormMessage: byId("ruleFormMessage"),
  clinicalJourney: byId("clinicalJourney"),
  visitQuestions: byId("visitQuestions"),
  auditList: byId("auditList"),
  auditCount: byId("auditCount"),
  dataFacts: byId("dataFacts"),
  workspaceStatus: byId("workspaceStatus"),
  demoBanner: byId("demoBanner"),
  loadDemo: byId("loadDemo"),
  exitDemo: byId("exitDemo"),
  fhirImport: byId("fhirImport"),
  importEmr: byId("importEmr"),
  exportEmr: byId("exportEmr"),
  exportFhir: byId("exportFhir"),
  exportPatientTransfer: byId("exportPatientTransfer"),
  patientTransferStatus: byId("patientTransferStatus"),
  exportEmrSecondary: byId("exportEmrSecondary"),
  wipeEmr: byId("wipeEmr"),
  exportRecoveryRaw: byId("exportRecoveryRaw"),
  fhirImportReport: byId("fhirImportReport"),
  fhirImportReportSummary: byId("fhirImportReportSummary"),
  fhirImportIssues: byId("fhirImportIssues"),
  editPatient: byId("editPatient"),
  aiStatusDot: byId("aiStatusDot"),
  aiStatusLabel: byId("aiStatusLabel"),
  aiStatusDetail: byId("aiStatusDetail"),
};

let savedState = await initializeEmrState();
let state = new URL(window.location.href).searchParams.get("demo") === "1"
  ? createDemoEmrState()
  : savedState;
let activeTab = "encounter";
let eventFilter = "all";
let boardScope = "patient";
let queueFilter = "all";
let viewedEncounterId = "";
let clinicalComposerContextKey = "";
let stateTransitionBusy = false;
let copilotBusy = false;
let stateGeneration = 0;
let copilotRequestController = null;
let aiCapability = { checked: false, configured: false, model: "" };
let lastFhirReport = null;
const briefCache = new Map();

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function svgElement(tag, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

function clear(node) {
  node.replaceChildren();
}

function displayDate(value) {
  if (!value) return "날짜 미상";
  const parsed = new Date(value.length === 10 ? value + "T00:00:00.000Z" : value);
  return Number.isNaN(parsed.valueOf()) ? value : dateFormatter.format(parsed);
}

function displayTimestamp(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? "기록 없음" : timestampFormatter.format(parsed);
}

function ageFromBirthDate(value) {
  if (!value) return "";
  const [birthYear, birthMonth, birthDay] = value.split("-").map(Number);
  const [currentYear, currentMonth, currentDay] = today().split("-").map(Number);
  let age = currentYear - birthYear;
  const beforeBirthday = currentMonth < birthMonth
    || (currentMonth === birthMonth && currentDay < birthDay);
  if (beforeBirthday) age -= 1;
  return age >= 0 ? "만 " + age + "세" : "";
}

function patientAgeLabel(patient) {
  return ageFromBirthDate(patient?.birthDate) || (Number.isInteger(patient?.ageYears) ? `만 ${patient.ageYears}세 · 직접 입력` : "나이 미상");
}

function selectedPatient() {
  return state.patients.find((patient) => patient.id === state.selectedPatientId) ?? null;
}

function encounterQueueStatus(encounter) {
  if (!encounter) return "none";
  if (encounter.recordStatus === "final" && encounter.status === "finished") {
    if (encounter.signature?.status === "external") return "external";
    if (encounter.signature?.status === "legacy") return "legacy";
    return "signed";
  }
  if (encounter.status === "finished") return "completed";
  if (encounter.status === "in-progress") return "in-progress";
  if (encounter.status === "arrived") return "waiting";
  return "none";
}

function unresolvedEncounterForPatient(patient) {
  return patient?.events
    ?.filter((event) => event.type === "encounter"
      && event.recordStatus === "draft"
      && event.source?.kind !== "import"
      && ["arrived", "in-progress", "finished"].includes(event.status))
    .sort((left, right) => {
      const priority = { "in-progress": 0, arrived: 1, finished: 2 };
      return (priority[left.status] ?? 9) - (priority[right.status] ?? 9)
        || String(right.arrivedAt).localeCompare(String(left.arrivedAt));
    })[0] ?? null;
}

function todayEncounterForPatient(patient) {
  const unresolved = unresolvedEncounterForPatient(patient);
  if (unresolved) return unresolved;
  return patient?.events
    ?.filter((event) => event.type === "encounter"
      && event.date === today()
      && event.source?.kind !== "import"
      && event.recordStatus !== "entered-in-error")
    .sort((left, right) => String(right.arrivedAt).localeCompare(String(left.arrivedAt)))[0] ?? null;
}

function currentEncounter(patient) {
  if (!patient) return null;
  const viewed = getEncounter(patient, viewedEncounterId);
  if (viewed && viewed.recordStatus !== "entered-in-error") return viewed;
  const unresolved = unresolvedEncounterForPatient(patient);
  if (unresolved) return unresolved;
  const explicitlySelected = getEncounter(patient, state.selectedEncounterId);
  if (explicitlySelected?.date === today()
    && explicitlySelected.source?.kind !== "import"
    && explicitlySelected.recordStatus !== "entered-in-error") return explicitlySelected;
  return patient.events
    .filter((event) => event.type === "encounter"
      && event.date === today()
      && event.source?.kind !== "import"
      && event.recordStatus !== "entered-in-error")
    .sort((left, right) => {
      const priority = { "in-progress": 0, arrived: 1, finished: 2 };
      return (priority[left.status] ?? 9) - (priority[right.status] ?? 9)
        || String(right.arrivedAt).localeCompare(String(left.arrivedAt));
    })[0] ?? null;
}

function preserveEncounterDraftIfChanged(stateInput) {
  const patient = stateInput.patients.find((item) => item.id === stateInput.selectedPatientId);
  const encounter = currentEncounter(patient);
  if (!patient || !encounter || encounter.recordStatus !== "draft" || encounter.status !== "in-progress") return stateInput;
  const draft = encounterDraftFromForm();
  const clean = (value) => String(value ?? "").trim();
  const same = clean(draft.date) === clean(encounter.date)
    && clean(draft.department) === clean(encounter.department)
    && clean(draft.clinician) === clean(encounter.clinician)
    && clean(draft.room) === clean(encounter.room)
    && clean(draft.chiefComplaint) === clean(encounter.chiefComplaint)
    && clean(draft.soap.subjective) === clean(encounter.soap?.subjective)
    && clean(draft.soap.objective) === clean(encounter.soap?.objective)
    && clean(draft.soap.assessment) === clean(encounter.soap?.assessment)
    && clean(draft.soap.plan) === clean(encounter.soap?.plan);
  return same ? stateInput : saveEncounterDraft(stateInput, patient.id, encounter.id, draft);
}

function finalizedPatient(patient) {
  return patient ? createFinalizedPatientView(patient) : null;
}

function claimEvaluations(patient, { includeCurrentDraft = false, encounterId = "", asOf = today() } = {}) {
  if (!patient) return [];
  const activeEncounter = getEncounter(patient, encounterId) ?? unresolvedEncounterForPatient(patient);
  const evaluationPatient = includeCurrentDraft && activeEncounter
    ? createClaimPreflightPatient(patient, activeEncounter.id)
    : createClaimPreflightPatient(patient);
  const board = buildClaimBoard([evaluationPatient], state.rules, asOf);
  return CLAIM_LANE_ORDER.flatMap((status) => board.lanes[status]).map((evaluation) => ({
    ...evaluation,
    preflight: includeCurrentDraft,
  }));
}

function restoreCopilotEvidenceIds(brief, aliasToEventId) {
  const restore = (items) => (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    evidenceEventIds: (Array.isArray(item.evidenceEventIds) ? item.evidenceEventIds : [])
      .map((id) => aliasToEventId.get(id))
      .filter(Boolean),
  }));
  return {
    ...brief,
    summary: restore(brief.summary),
    priorities: restore(brief.priorities),
    questions: restore(brief.questions),
    warnings: restore(brief.warnings),
    provenance: (Array.isArray(brief.provenance) ? brief.provenance : []).map((item) => ({
      ...item,
      eventId: aliasToEventId.get(item.eventId) ?? "",
    })).filter(({ eventId }) => eventId),
  };
}

function copilotRequestFingerprint(request) {
  return clinicalContextFingerprint({
    payload: request.payload,
    eventIdentities: [...request.aliasToEventId.entries()],
  });
}

function setStatus(message, tone = "") {
  refs.workspaceStatus.textContent = message;
  refs.workspaceStatus.className = "workspace-status" + (tone ? " is-" + tone : "");
}

function restoreWorkflowFocus(...targets) {
  queueMicrotask(() => {
    const target = targets
      .map((item) => typeof item === "string" ? byId(item) : item)
      .find((item) => item && !item.disabled && item.getClientRects().length > 0);
    target?.focus({ preventScroll: true });
  });
}

async function withStateTransition(operation) {
  if (stateTransitionBusy) throw new Error("다른 로컬 저장 작업이 진행 중입니다. 완료 후 다시 시도하세요.");
  stateTransitionBusy = true;
  refs.mainContent.inert = true;
  refs.mainContent.setAttribute("aria-busy", "true");
  try {
    return await operation();
  } finally {
    stateTransitionBusy = false;
    refs.mainContent.inert = false;
    refs.mainContent.removeAttribute("aria-busy");
  }
}

function assertCurrentStateGeneration(expectedGeneration) {
  if (expectedGeneration !== stateGeneration) {
    throw new Error("전체 삭제가 적용되어 이전 작업 결과를 폐기했습니다.");
  }
}

function reportFormValidity(form) {
  if (form.checkValidity()) return true;
  form.reportValidity();
  return false;
}

async function applyMutation(mutator, message, { preserveDraft = true, announce = true } = {}) {
  return withStateTransition(async () => {
    const wasDemo = state.demo;
    const expectedRevision = state.revision;
    const expectedGeneration = stateGeneration;
    if (!wasDemo && state.storageError) {
      throw new Error("손상된 로컬 저장을 먼저 원본으로 내보낸 뒤 백업 복원 또는 전체 삭제로 정리하세요.");
    }
    const base = preserveDraft ? preserveEncounterDraftIfChanged(state) : state;
    const candidate = mutator(base);
    if (wasDemo) {
      state = { ...candidate, demo: true };
    } else {
      const saved = await saveEmrState(candidate, undefined, expectedRevision);
      assertCurrentStateGeneration(expectedGeneration);
      state = saved;
      savedState = saved;
    }
    briefCache.clear();
    render();
    if (announce) setStatus(message + (wasDemo ? " · 데모 변경은 저장되지 않습니다." : ""), "success");
  });
}

function createEmptyMessage(text, className = "summary-empty") {
  return element("p", className, text);
}

function renderPatients() {
  const query = refs.patientSearch.value.trim().toLocaleLowerCase("ko");
  const patients = state.patients.filter((patient) => {
    const haystack = (patient.name + " " + patient.mrn).toLocaleLowerCase("ko");
    const status = encounterQueueStatus(todayEncounterForPatient(patient));
    const statusMatches = queueFilter === "all"
      || (queueFilter === "completed" ? ["completed", "signed", "legacy", "external"].includes(status) : status === queueFilter);
    return (!query || haystack.includes(query)) && statusMatches;
  }).sort((left, right) => {
    const priority = { "in-progress": 0, waiting: 1, completed: 2, signed: 3, legacy: 4, external: 5, none: 6 };
    const leftStatus = encounterQueueStatus(todayEncounterForPatient(left));
    const rightStatus = encounterQueueStatus(todayEncounterForPatient(right));
    return priority[leftStatus] - priority[rightStatus] || left.name.localeCompare(right.name, "ko");
  });
  clear(refs.patientList);
  for (const patient of patients) {
    const encounter = todayEncounterForPatient(patient);
    const queueStatus = encounterQueueStatus(encounter);
    const item = element("li");
    const button = element("button");
    button.type = "button";
    button.dataset.patientId = patient.id;
    button.setAttribute("aria-current", String(patient.id === state.selectedPatientId));
    button.append(
      element("strong", "", patient.name),
      element("small", "", [patient.mrn || "등록번호 없음", patientAgeLabel(patient), SEX_LABELS[patient.sex]].filter(Boolean).join(" · ")),
      element("em", `queue-badge queue-badge--${queueStatus}`, QUEUE_LABELS[queueStatus]),
    );
    item.append(button);
    refs.patientList.append(item);
  }
  const todayCount = state.patients.filter((patient) => encounterQueueStatus(todayEncounterForPatient(patient)) !== "none").length;
  refs.patientCount.textContent = `${todayCount}/${state.patients.length}명`;
  refs.patientListEmpty.hidden = state.patients.length > 0;
  if (state.patients.length > 0 && patients.length === 0) {
    refs.patientList.append(element("li", "rail-empty", "검색 결과가 없습니다."));
  }
  for (const button of refs.queueFilters.querySelectorAll("[data-queue-filter]")) {
    button.setAttribute("aria-pressed", String(button.dataset.queueFilter === queueFilter));
  }
}

function renderSafety(patient) {
  const chart = finalizedPatient(patient);
  clear(refs.safetyAlerts);
  const allergies = chart.events.filter((event) => event.type === "allergy");
  if (allergies.length) {
    for (const allergy of allergies.slice(0, 3)) {
      refs.safetyAlerts.append(element("span", "safety-chip safety-chip--allergy", "알레르기 · " + allergy.label));
    }
  } else {
    refs.safetyAlerts.append(element("span", "safety-chip", "알레르기 확인 필요"));
  }
  const activeMedications = chart.events.filter((event) => event.type === "medication" && !["stopped", "cancelled"].includes(event.status));
  refs.safetyAlerts.append(element("span", "safety-chip", "활성 약물 " + activeMedications.length + "건"));
}

function addMetric(label, value, detail, warning = false) {
  const card = element("article", "metric-card" + (warning ? " metric-card--warning" : ""));
  card.append(element("span", "", label), element("strong", "", value), element("small", "", detail));
  refs.patientMetrics.append(card);
}

function renderMetrics(patient, evaluations) {
  const chart = finalizedPatient(patient);
  clear(refs.patientMetrics);
  const conditions = chart.events.filter((event) => event.type === "condition" && !["inactive", "resolved", "remission"].includes(event.status));
  const medications = chart.events.filter((event) => event.type === "medication" && !["stopped", "cancelled"].includes(event.status));
  const latestObservation = chart.events.find((event) => event.type === "observation");
  const attention = evaluations.filter((item) => ["missing-evidence", "due-soon", "unknown"].includes(item.status));
  addMetric("ACTIVE PROBLEMS", conditions.length + "개", conditions[0]?.label ?? "구조화 문제 없음");
  addMetric("ACTIVE MEDICATIONS", medications.length + "개", medications[0]?.label ?? "활성 약물 없음");
  addMetric("LATEST MEASURE", latestObservation ? displayDate(latestObservation.date) : "없음", latestObservation?.label ?? "측정 기록 없음");
  addMetric("CLAIM ATTENTION", attention.length + "건", "결정 아님 · 담당자 확인", attention.length > 0);
}

function renderSummary(patient) {
  const chart = finalizedPatient(patient);
  clear(refs.clinicalSummary);
  const groups = [
    ["활성 문제", ["condition", "symptom"]],
    ["최근 검사·측정", ["observation"]],
    ["약물·알레르기", ["medication", "allergy"]],
    ["내원·처치", ["encounter", "procedure", "note"]],
  ];
  for (const [title, types] of groups) {
    const section = element("section", "summary-group");
    section.append(element("h4", "", title));
    const events = chart.events.filter((event) => types.includes(event.type)).slice(0, 4);
    if (!events.length) {
      section.append(createEmptyMessage("해당 구조화 기록이 없습니다."));
    } else {
      const list = element("ul");
      for (const event of events) {
        const item = element("li", "summary-item");
        const value = event.value === "" ? "" : String(event.value) + (event.unit ? " " + event.unit : "");
        item.append(
          element("b", "", event.label),
          element("small", "", displayDate(event.date)),
          element("span", "", [value, event.code, event.note].filter(Boolean).join(" · ") || EVENT_LABELS[event.type]),
        );
        list.append(item);
      }
      section.append(list);
    }
    refs.clinicalSummary.append(section);
  }
}

function normalizedQuestion(item) {
  if (typeof item === "string") return { question: item, reason: "로컬 모델이 만든 의료진 검토용 질문입니다." };
  return {
    question: item?.question || item?.title || "확인 질문",
    reason: item?.reason || item?.basis || "",
    evidenceEventIds: Array.isArray(item?.evidenceEventIds) ? item.evidenceEventIds : [],
  };
}

function appendGroundedItem(list, text, evidenceEventIds, patient) {
  const eventById = new Map(patient.events.map((event) => [event.id, event]));
  const citations = [...new Set(evidenceEventIds ?? [])].map((id) => eventById.get(id)).filter(Boolean);
  if (!citations.length) return false;
  const item = element("li");
  item.append(document.createTextNode(text));
  const citationRow = element("span", "copilot-citations");
  for (const event of citations.slice(0, 4)) {
    citationRow.append(element(
      "small",
      "",
      [event.label, displayDate(event.date), event.source?.label, event.source?.resourceId].filter(Boolean).join(" · "),
    ));
  }
  item.append(citationRow);
  list.append(item);
  return true;
}

function renderCopilot(patient, evaluations) {
  const brief = briefCache.get(patient.id) ?? createLocalCopilotBrief(patient, evaluations, today());
  if (!briefCache.has(patient.id)) briefCache.set(patient.id, brief);
  clear(refs.copilotContent);
  refs.copilotMode.textContent = brief.kind === "model" ? "로컬 AI" : "규칙 기반";

  const summary = element("section", "copilot-section");
  summary.append(element("h4", "", "기록 요약"));
  const summaryList = element("ul");
  for (const item of brief.summary ?? []) {
    const text = typeof item === "string" ? item : item?.text;
    if (text) appendGroundedItem(summaryList, text, item?.evidenceEventIds ?? [], patient);
  }
  if (!summaryList.childElementCount) summaryList.append(element("li", "", "요약할 기록이 없습니다."));
  summary.append(summaryList);
  refs.copilotContent.append(summary);

  const priorities = brief.priorities ?? brief.tasks ?? [];
  const prioritySection = element("section", "copilot-section");
  prioritySection.append(element("h4", "", "확인 우선순위"));
  const priorityList = element("ul");
  for (const item of priorities) {
    appendGroundedItem(
      priorityList,
      (item.title ? item.title + " · " : "") + (item.reason ?? item.text ?? ""),
      item.evidenceEventIds,
      patient,
    );
  }
  if (!priorityList.childElementCount) priorityList.append(element("li", "", "자동 표시된 우선 작업이 없습니다."));
  prioritySection.append(priorityList);
  refs.copilotContent.append(prioritySection);

  if (Array.isArray(brief.warnings) && brief.warnings.length) {
    const warningSection = element("section", "copilot-section");
    warningSection.append(element("h4", "", "확인 필요"));
    const warningList = element("ul");
    for (const warning of brief.warnings) {
      const text = typeof warning === "string" ? warning : warning?.text;
      if (text) appendGroundedItem(warningList, text, warning?.evidenceEventIds ?? [], patient);
    }
    warningSection.append(warningList);
    refs.copilotContent.append(warningSection);
  }

  const provenance = element("section", "copilot-section");
  provenance.append(element("h4", "", "사용한 근거"));
  const chips = element("div", "copilot-provenance");
  const explicitSources = Array.isArray(brief.provenance) ? brief.provenance : [];
  const referencedIds = new Set((brief.priorities ?? []).flatMap((item) => item.evidenceEventIds ?? []));
  const sources = explicitSources.length
    ? explicitSources
    : patient.events.filter((event) => referencedIds.has(event.id)).map((event) => ({ label: event.label, date: event.date }));
  for (const source of sources.slice(0, 8)) chips.append(element("span", "", source.label + " · " + displayDate(source.date)));
  if (!chips.childElementCount) chips.append(element("span", "", "직접 연결된 이벤트 근거 없음"));
  provenance.append(chips);
  refs.copilotContent.append(provenance);

  refs.runCopilot.disabled = copilotBusy;
  refs.runCopilot.textContent = copilotBusy ? "로컬 초안 생성 중…" : "근거로 초안 다시 만들기";
}

function renderNextWork(evaluations) {
  clear(refs.nextWorkList);
  const attention = evaluations
    .filter((item) => ["missing-evidence", "due-soon", "unknown", "ready"].includes(item.status))
    .slice(0, 3);
  for (const item of attention) {
    const card = element("article", "next-work-item");
    card.append(
      element("span", "", CLAIM_LANE_LABELS[item.status] ?? "확인"),
      element("b", "", item.title),
      element("p", "", item.explanation),
    );
    refs.nextWorkList.append(card);
  }
  if (!attention.length) refs.nextWorkList.append(createEmptyMessage("현재 샘플 규칙에서 바로 확인할 작업이 없습니다."));
}

function renderEventFilters(patient) {
  clear(refs.eventFilters);
  const types = ["all", ...new Set(patient.events.map((event) => event.type))];
  for (const type of types) {
    const button = element("button", "", type === "all" ? "전체" : EVENT_LABELS[type] ?? type);
    button.type = "button";
    button.dataset.eventFilter = type;
    button.setAttribute("aria-pressed", String(eventFilter === type));
    refs.eventFilters.append(button);
  }
}

function renderTimeline(patient) {
  renderEventFilters(patient);
  clear(refs.eventTimeline);
  const events = patient.events.filter((event) => eventFilter === "all" || event.type === eventFilter);
  refs.eventCount.textContent = events.length + "건";
  for (const event of events) {
    const item = element("li", "event-row");
    item.append(element("time", "", displayDate(event.date)));
    const body = element("div", "event-row__body");
    const header = element("header");
    header.append(
      element("span", "event-type-badge", EVENT_LABELS[event.type] ?? event.type),
      element("span", `event-type-badge event-type-badge--${event.recordStatus}`, event.recordStatus === "draft" ? "초안" : event.recordStatus === "entered-in-error" ? "취소" : "확정"),
      element("b", "", event.label),
    );
    body.append(header);
    const value = event.value === "" ? "" : String(event.value) + (event.unit ? " " + event.unit : "");
    const codedValue = event.code ? [event.system, event.code].filter(Boolean).join(" | ") : "";
    const detail = [value, codedValue, event.note].filter(Boolean).join(" · ");
    if (detail) body.append(element("p", "", detail));
    body.append(element("span", "event-source", "",));
    body.lastElementChild.textContent = (event.source?.label || "출처 없음") + (event.source?.resourceId ? " · " + event.source.resourceId : "");
    item.append(body);
    const isLockedEncounterRecord = Boolean(event.encounterId) || event.type === "encounter";
    if (!isLockedEncounterRecord && event.source?.kind !== "import" && event.recordStatus !== "entered-in-error") {
      const actions = element("div", "event-actions");
      if (event.recordStatus === "draft" && event.source?.kind === "manual") {
        const confirm = element("button", "event-confirm", "검토·확정");
        confirm.type = "button";
        confirm.dataset.confirmEvent = event.id;
        confirm.setAttribute("aria-label", event.label + " 기록 검토 후 확정");
        actions.append(confirm);
      }
      const remove = element("button", "event-remove", event.recordStatus === "draft" ? "폐기" : "취소");
      remove.type = "button";
      remove.dataset.removeEvent = event.id;
      remove.setAttribute("aria-label", event.label + " 기록 취소");
      actions.append(remove);
      item.append(actions);
    }
    refs.eventTimeline.append(item);
  }
  if (!events.length) refs.eventTimeline.append(createEmptyMessage("선택한 유형의 기록이 없습니다."));
}

function graphPositions(nodes) {
  const positions = new Map();
  if (!nodes.length) return positions;
  const columns = Math.min(6, Math.max(1, Math.ceil(Math.sqrt(nodes.length * (900 / 520)))));
  const rows = Math.ceil(nodes.length / columns);
  const horizontalMargin = 70;
  const verticalMargin = 60;
  const horizontalStep = columns === 1 ? 0 : Math.min(190, (900 - horizontalMargin * 2) / (columns - 1));
  const verticalStep = rows === 1 ? 0 : Math.min(140, (520 - verticalMargin * 2) / (rows - 1));
  const firstRowY = 260 - ((rows - 1) * verticalStep) / 2;
  nodes.forEach((node, index) => {
    const row = Math.floor(index / columns);
    const rowStart = row * columns;
    const rowCount = Math.min(columns, nodes.length - rowStart);
    const rowWidth = (rowCount - 1) * horizontalStep;
    positions.set(node.id, {
      x: 450 - rowWidth / 2 + (index - rowStart) * horizontalStep,
      y: firstRowY + row * verticalStep,
    });
  });
  return positions;
}

function renderGraph(patient) {
  const graph = createClinicalGraph(patient);
  const positions = graphPositions(graph.nodes);
  clear(refs.clinicalGraph);
  if (!graph.nodes.length) {
    const text = svgElement("text", { x: 450, y: 260, "text-anchor": "middle", fill: "currentColor" });
    text.textContent = "그래프로 표시할 구조화 임상기록이 없습니다.";
    refs.clinicalGraph.append(text);
  } else {
    const edgeGroup = svgElement("g", { "aria-hidden": "true" });
    for (const edge of graph.edges) {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) continue;
      const line = svgElement("line", {
        class: `clinical-edge${edge.kind === "inferred" ? " clinical-edge--inferred" : ""}`,
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
      });
      const title = svgElement("title");
      title.textContent = `${edge.kind === "inferred" ? "추론 관계" : "명시 관계"} · ${edge.label} · ${edge.basis || "관계 출처 없음"}`;
      line.append(title);
      edgeGroup.append(line);
      if (edge.kind === "inferred") {
        const label = svgElement("text", {
          class: "clinical-edge-label",
          x: (from.x + to.x) / 2,
          y: (from.y + to.y) / 2 - 5,
          "text-anchor": "middle",
        });
        label.textContent = "추론";
        edgeGroup.append(label);
      }
    }
    refs.clinicalGraph.append(edgeGroup);
    for (const node of graph.nodes) {
      const position = positions.get(node.id);
      const group = svgElement("g", {
        class: "clinical-node",
        "data-type": node.type,
        transform: "translate(" + position.x + " " + position.y + ")",
        tabindex: "0",
        role: "group",
        "aria-label": (EVENT_LABELS[node.type] ?? node.type) + " " + node.label + " " + displayDate(node.date),
      });
      const title = svgElement("title");
      title.textContent = node.label + " · " + (node.code || "코드 없음") + " · " + displayDate(node.date);
      const label = svgElement("text", { y: 4 });
      label.textContent = node.label.length > 12 ? node.label.slice(0, 11) + "…" : node.label;
      const meta = svgElement("text", { class: "node-meta", y: 21 });
      meta.textContent = node.code || EVENT_LABELS[node.type] || node.type;
      group.append(title, svgElement("circle", { r: node.type === "condition" ? 45 : 39 }), label, meta);
      refs.clinicalGraph.append(group);
    }
  }

  clear(refs.graphLegend);
  for (const type of ["condition", "observation", "medication", "allergy", "procedure", "symptom"]) {
    const item = element("span");
    const dot = element("i", "legend-dot");
    dot.style.background = GRAPH_COLORS[type];
    item.append(dot, document.createTextNode(EVENT_LABELS[type]));
    refs.graphLegend.append(item);
  }

  clear(refs.graphEvidenceList);
  for (const edge of graph.edges) {
    const from = graph.nodes.find(({ id }) => id === edge.from);
    const to = graph.nodes.find(({ id }) => id === edge.to);
    if (!from || !to) continue;
    const item = element("li", "graph-relation-note");
    item.append(
      element("b", "", `${edge.kind === "inferred" ? "추론 관계" : "명시 관계"} · ${from.label} → ${to.label}`),
      element("span", "", `${edge.label} · ${edge.basis || "관계 출처 없음"}${edge.kind === "inferred" ? " · 차트 사실 아님" : ""}`),
    );
    refs.graphEvidenceList.append(item);
  }
  for (const node of graph.nodes) {
    const item = element("li");
    item.append(
      element("b", "", node.label + (node.code ? " · " + node.code : "")),
      element("span", "", displayDate(node.date) + " · " + (node.source?.label || "출처 없음")),
    );
    refs.graphEvidenceList.append(item);
  }
  if (!graph.nodes.length) refs.graphEvidenceList.append(createEmptyMessage("연결할 차트 근거가 없습니다."));
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function renderRuleVersions() {
  clear(refs.ruleVersionList);
  const rules = [...state.rules].sort((left, right) => left.ruleSetId.localeCompare(right.ruleSetId)
    || right.effectiveFrom.localeCompare(left.effectiveFrom));
  for (const rule of rules) {
    const row = element("article", "rule-version-row");
    const summary = element("div", "rule-version-summary");
    summary.append(
      element("b", "", `${rule.title} · v${rule.version}`),
      element("span", "", `${rule.ruleSetId} · ${rule.effectiveFrom} ~ ${rule.effectiveTo || "현재"} · ${rule.sourceLabel}${rule.sample ? " · 샘플" : ""}`),
    );
    const actions = element("div", "rule-version-actions");
    const label = element("label", "", "종료일");
    const input = document.createElement("input");
    input.type = "date";
    input.min = rule.effectiveFrom;
    input.value = rule.effectiveTo || today();
    input.dataset.ruleEndDate = rule.id;
    const button = element("button", "clinical-button", rule.effectiveTo ? "종료일 수정" : "이 버전 종료");
    button.type = "button";
    button.dataset.retireRule = rule.id;
    label.append(input);
    actions.append(label, button);
    row.append(summary, actions);
    refs.ruleVersionList.append(row);
  }
  if (!rules.length) refs.ruleVersionList.append(createEmptyMessage("저장된 급여 규칙이 없습니다."));
}

function renderClaimBoard(patient) {
  renderRuleVersions();
  const patients = boardScope === "all" ? state.patients : [patient];
  const board = buildClaimBoard(patients, state.rules, today());
  clear(refs.claimBoard);
  for (const status of CLAIM_LANE_ORDER) {
    const lane = element("section", "claim-lane");
    const header = element("header");
    header.append(element("h4", "", CLAIM_LANE_LABELS[status]), element("span", "", board.lanes[status].length));
    lane.append(header);
    const cards = element("div", "claim-lane__cards");
    for (const evaluation of board.lanes[status]) {
      const card = element("article", "claim-card");
      card.dataset.status = status;
      const top = element("div", "claim-card__top");
      const serviceCode = element("code", "", evaluation.serviceCode);
      serviceCode.title = [evaluation.rule.serviceSystem, evaluation.serviceCode].filter(Boolean).join(" | ");
      top.append(element("b", "", evaluation.title), serviceCode);
      card.append(top);
      if (boardScope === "all") card.append(element("span", "claim-patient", evaluation.patientName + " · " + (evaluation.patientMrn || "등록번호 없음")));
      card.append(element("p", "", evaluation.explanation));
      if (evaluation.missingEvidence.length) {
        card.append(element("p", "claim-missing", "보완 확인 · " + evaluation.missingEvidence.join(", ")));
      }
      const facts = element("div", "claim-facts");
      facts.append(
        element("span", "", "차트 시행 " + evaluation.usedCount + "/" + evaluation.rule.maxCount + "건"),
        element("span", "", evaluation.nextEligibleDate ? "수동 대조 " + evaluation.nextEligibleDate : "기준일 수동 확인"),
      );
      card.append(facts);
      const evidenceEvents = evaluation.evidenceEventIds
        .map((id) => state.patients.find((item) => item.id === evaluation.patientId)?.events.find((event) => event.id === id))
        .filter(Boolean);
      if (evidenceEvents.length) {
        const evidence = element("div", "claim-evidence");
        evidence.append(element("b", "", "연결 차트 근거"));
        for (const event of evidenceEvents.slice(0, 5)) {
          evidence.append(element(
            "span",
            "",
            [event.label, event.date, [event.system, event.code].filter(Boolean).join(" | "), event.source?.label, event.source?.resourceId].filter(Boolean).join(" · "),
          ));
        }
        card.append(evidence);
      }
      card.append(element(
        "span",
        "claim-rule-version",
        "규칙 " + evaluation.rule.ruleSetId + " · v" + evaluation.rule.version + " · " + evaluation.rule.effectiveFrom + " ~ " + (evaluation.rule.effectiveTo || "현재"),
      ));
      card.append(element("span", "claim-manual-note", "Claim/ClaimResponse 미연결 · 청구·심사 이력 수동 대조"));
      const sourceUrl = safeExternalUrl(evaluation.rule.sourceUrl);
      if (sourceUrl) {
        const source = element("a", "claim-source", evaluation.rule.sourceLabel + " ↗");
        source.href = sourceUrl;
        source.target = "_blank";
        source.rel = "noreferrer";
        card.append(source);
      } else {
        card.append(element("span", "claim-source", evaluation.rule.sourceLabel));
      }
      cards.append(card);
    }
    if (!cards.childElementCount) cards.append(createEmptyMessage("해당 상태 없음", "claim-empty"));
    lane.append(cards);
    refs.claimBoard.append(lane);
  }
}

function renderJourney(patient, brief) {
  const chart = finalizedPatient(patient);
  clear(refs.clinicalJourney);
  const grouped = new Map();
  for (const event of chart.events) {
    if (!grouped.has(event.date)) grouped.set(event.date, []);
    grouped.get(event.date).push(event);
  }
  for (const [date, events] of grouped) {
    const item = element("li", "journey-day");
    item.append(element("time", "", displayDate(date)));
    const list = element("ul");
    for (const event of events) {
      const value = event.value === "" ? "" : " · " + String(event.value) + (event.unit ? " " + event.unit : "");
      list.append(element("li", "", (EVENT_LABELS[event.type] ?? event.type) + " · " + event.label + value));
    }
    item.append(list);
    refs.clinicalJourney.append(item);
  }
  if (!grouped.size) refs.clinicalJourney.append(createEmptyMessage("Journey로 묶을 임상기록이 없습니다."));

  clear(refs.visitQuestions);
  const eventById = new Map(chart.events.map((event) => [event.id, event]));
  for (const item of brief.questions ?? []) {
    const question = normalizedQuestion(item);
    const sources = question.evidenceEventIds.map((id) => eventById.get(id)).filter(Boolean);
    if (!sources.length) continue;
    const li = element("li");
    li.append(element("b", "", question.question), element("span", "", question.reason));
    li.append(element(
      "span",
      "question-citations",
      "근거 · " + sources.map((event) => [event.label, event.date, event.source?.label, event.source?.resourceId].filter(Boolean).join(" · ")).join(", "),
    ));
    refs.visitQuestions.append(li);
  }
  if (!refs.visitQuestions.childElementCount) refs.visitQuestions.append(createEmptyMessage("질문을 만들 구조화 문제가 없습니다."));
}

function renderAudit() {
  clear(refs.auditList);
  const events = [...state.audit].reverse();
  refs.auditCount.textContent = events.length + "건";
  for (const event of events) {
    const item = element("li");
    item.append(element("time", "", displayTimestamp(event.at)));
    const detail = element("div");
    detail.append(
      element("b", "", AUDIT_LABELS[event.action] ?? event.action),
      element("span", "", [event.actor, event.patientId, event.encounterId, event.entityId, event.detail].filter(Boolean).join(" · ")),
    );
    item.append(detail);
    refs.auditList.append(item);
  }
  if (!events.length) refs.auditList.append(createEmptyMessage("아직 로컬 변경 이력이 없습니다."));
}

function renderDataFacts() {
  clear(refs.dataFacts);
  const facts = [
    ["저장 위치", state.demo ? "메모리 전용 데모" : "브라우저 localStorage"],
    ["환자 수", state.patients.length + "명"],
    ["진료 회차", state.patients.reduce((sum, patient) => sum + patient.events.filter((event) => event.type === "encounter").length, 0) + "건"],
    ["임상 이벤트", state.patients.reduce((sum, patient) => sum + patient.events.length, 0) + "건"],
    ["데이터 스키마", `v${state.version} · revision ${state.revision}`],
    ["급여 규칙", state.rules.length + "개"],
    ["마지막 변경", displayTimestamp(state.updatedAt)],
    ["저장 상태", state.storageError ? "복구 필요" : "정상"],
    ["백업 암호화", "없음 · 별도 보호 필요"],
  ];
  for (const [term, description] of facts) {
    refs.dataFacts.append(element("dt", "", term), element("dd", "", description));
  }
  refs.exportRecoveryRaw.hidden = !state.recoveryRaw;
}

function renderFhirReport() {
  refs.fhirImportReport.hidden = !lastFhirReport;
  if (!lastFhirReport) {
    refs.fhirImportReportSummary.textContent = "";
    clear(refs.fhirImportIssues);
    return;
  }
  refs.fhirImportReportSummary.textContent = "외부 미검증 · 지원 " + lastFhirReport.supported + "건 · 제외 " + lastFhirReport.unsupported + "건";
  clear(refs.fhirImportIssues);
  refs.fhirImportIssues.append(element("li", "", "가져온 기록의 기관·작성자·전자서명은 검증되지 않았습니다. 타임라인에는 표시되지만 확정 요약·AI·급여 근거에서는 제외됩니다."));
  for (const item of lastFhirReport.unsupportedItems ?? []) {
    refs.fhirImportIssues.append(element(
      "li",
      "",
      item.resourceType + (item.id ? "/" + item.id : "") + " · " + item.reason,
    ));
  }
  if (lastFhirReport.unsupportedTruncated) {
    refs.fhirImportIssues.append(element("li", "", "추가 제외 항목 " + lastFhirReport.unsupportedTruncated + "건"));
  }
  if (!refs.fhirImportIssues.childElementCount) refs.fhirImportIssues.append(element("li", "", "제외된 리소스가 없습니다."));
}

function setFormControlsDisabled(form, disabled) {
  for (const control of form.querySelectorAll("input, textarea, select, button")) control.disabled = disabled;
}

function resetClinicalComposerForms() {
  refs.vitalForm.reset();
  refs.diagnosisForm.reset();
  refs.prescriptionForm.reset();
  refs.orderForm.reset();
  refs.diagnosisSystem.value = "urn:kr:kcd";
  syncVitalPreset();
}

function clinicalComposerHasPendingInput() {
  const hasTextInput = [
    refs.vitalValue,
    refs.vitalNote,
    refs.diagnosisCode,
    refs.diagnosisLabel,
    refs.medicationCode,
    refs.medicationSystem,
    refs.medicationName,
    refs.medicationDose,
    refs.medicationDoseUnit,
    refs.medicationRoute,
    refs.medicationFrequency,
    refs.medicationDurationDays,
    refs.medicationQuantity,
    refs.medicationInstructions,
    refs.orderCode,
    refs.orderSystem,
    refs.orderLabel,
    refs.orderInstructions,
  ].some((control) => String(control.value ?? "").trim());
  return hasTextInput
    || refs.vitalPreset.value !== ENCOUNTER_OBSERVATION_PRESETS[0]?.code
    || refs.diagnosisRole.value !== "primary"
    || refs.diagnosisSystem.value !== "urn:kr:kcd"
    || refs.diagnosisCertainty.value !== "confirmed"
    || refs.orderKind.value !== "laboratory"
    || refs.orderPriority.value !== "routine";
}

function manualEventFormHasPendingInput() {
  return refs.eventType.value !== "condition"
    || refs.eventDate.value !== today()
    || refs.eventSystem.value !== "urn:kr:kcd"
    || [refs.eventCode, refs.eventLabel, refs.eventValue, refs.eventUnit, refs.eventNote]
      .some((control) => String(control.value ?? "").trim());
}

function blockClinicalContextChange({ patientChanged = false } = {}) {
  const hasClinicalComposer = clinicalComposerHasPendingInput();
  const hasManualEvent = patientChanged && manualEventFormHasPendingInput();
  if (!hasClinicalComposer && !hasManualEvent) return false;
  const message = hasManualEvent
    ? "추가하지 않은 과거 기록 입력이 있습니다. 현재 환자에 추가하거나 입력을 지운 뒤 환자를 전환하세요."
    : "추가하지 않은 측정·진단·처방·오더 입력이 있습니다. 현재 진료에 추가하거나 입력을 지운 뒤 전환·완료·취소하세요.";
  refs.encounterFormMessage.textContent = message;
  setStatus(message, "error");
  return true;
}

function syncVitalPreset() {
  const preset = ENCOUNTER_OBSERVATION_PRESETS.find(({ code }) => code === refs.vitalPreset.value)
    ?? ENCOUNTER_OBSERVATION_PRESETS[0];
  if (!preset) return;
  refs.vitalUnit.value = preset.unit;
  refs.vitalValue.placeholder = preset.placeholder;
  refs.vitalValue.inputMode = preset.kind === "blood-pressure" ? "text" : "decimal";
  refs.vitalValue.setAttribute("aria-label", `${preset.label} 결과`);
}

function initializeVitalOptions() {
  clear(refs.vitalPreset);
  for (const preset of ENCOUNTER_OBSERVATION_PRESETS) {
    const option = element("option", "", `${preset.label} · ${preset.unit}`);
    option.value = preset.code;
    refs.vitalPreset.append(option);
  }
  syncVitalPreset();
}

function encounterDraftFromForm() {
  return {
    date: refs.encounterDate.value,
    department: refs.encounterDepartment.value,
    clinician: refs.encounterClinician.value,
    room: refs.encounterRoom.value,
    chiefComplaint: refs.chiefComplaint.value,
    soap: {
      subjective: refs.soapSubjective.value,
      objective: refs.soapObjective.value,
      assessment: refs.soapAssessment.value,
      plan: refs.soapPlan.value,
    },
  };
}

function appendEncounterEntry(list, { title, meta, detail = "", badge = "", entityId = "", editable = false }) {
  const item = element("li", "encounter-entry-row");
  const body = element("div", "encounter-entry-row__body");
  const heading = element("div", "encounter-entry-row__heading");
  heading.append(element("b", "", title));
  if (badge) heading.append(element("span", "event-type-badge", badge));
  body.append(heading, element("small", "", meta));
  if (detail) body.append(element("p", "", detail));
  item.append(body);
  if (editable && entityId) {
    const remove = element("button", "event-remove", "삭제");
    remove.type = "button";
    remove.dataset.removeEncounterItem = entityId;
    remove.setAttribute("aria-label", `${title} 초안 삭제`);
    item.append(remove);
  }
  list.append(item);
}

function renderEncounterClaims(patient, evaluations) {
  clear(refs.encounterClaimSummary);
  refs.encounterClaimSummary.append(element("p", "claim-preflight-note", "예비판정 · 서명 전 초안을 확정 사실과 분리해 가상 반영"));
  const attentionStatuses = new Set(["missing-evidence", "due-soon", "unknown"]);
  const counts = Object.fromEntries(CLAIM_LANE_ORDER.map((status) => [status, evaluations.filter((item) => item.status === status).length]));
  const countRow = element("div", "claim-mini-counts");
  for (const status of ["missing-evidence", "due-soon", "ready", "waiting", "unknown"]) {
    const chip = element("span", `claim-mini-count claim-mini-count--${status}`);
    chip.append(element("b", "", counts[status]), document.createTextNode(CLAIM_LANE_LABELS[status]));
    countRow.append(chip);
  }
  refs.encounterClaimSummary.append(countRow);
  const attention = evaluations.filter((item) => attentionStatuses.has(item.status)).slice(0, 3);
  refs.encounterSignoffSummary.textContent = attention.length
    ? `서명 전 확인 ${attention.length}건 · 오른쪽 청구 조정 위험에서 근거를 검토하세요.`
    : "즉시 보완 항목 없음 · 서명 전 기록과 실제 청구 기준을 다시 확인하세요.";
  refs.encounterSignoffSummary.dataset.tone = attention.length ? "attention" : "ready";
  for (const evaluation of attention) {
    const card = element("article", "claim-mini-risk");
    card.append(
      element("b", "", evaluation.title),
      element("span", "", CLAIM_LANE_LABELS[evaluation.status] ?? "확인"),
      element("p", "", evaluation.explanation),
    );
    refs.encounterClaimSummary.append(card);
  }
  if (!attention.length) refs.encounterClaimSummary.append(element("p", "context-ok", "현재 규칙에서 즉시 보완할 항목 없음 · 실제 청구 전 담당자 재확인"));
}

function renderEncounterContext(patient, encounter, evaluations) {
  renderEncounterClaims(patient, evaluations);
  clear(refs.recentEncounterList);
  const recent = patient.events
    .filter((event) => event.type === "encounter" && event.recordStatus === "final" && event.status === "finished")
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 3);
  for (const visit of recent) {
    const item = element("li");
    item.append(
      element("b", "", visit.label),
      element("span", "", [displayDate(visit.date), visit.department, visit.clinician].filter(Boolean).join(" · ")),
    );
    const open = element("button", "text-action", visit.id === encounter?.id ? "열림" : "진료 기록 열기");
    open.type = "button";
    open.dataset.viewEncounter = visit.id;
    open.disabled = visit.id === encounter?.id;
    item.append(open);
    refs.recentEncounterList.append(item);
  }
  if (!recent.length) refs.recentEncounterList.append(element("li", "", "완료·서명된 이전 진료 없음"));

  clear(refs.encounterGraphSummary);
  const graph = createClinicalGraph(patient);
  const types = new Map();
  for (const node of graph.nodes) types.set(node.type, (types.get(node.type) ?? 0) + 1);
  const summary = element("div", "graph-mini-facts");
  summary.append(
    element("strong", "", `${graph.nodes.length}개 임상 노드`),
    element("span", "", `${graph.edges.length}개 추론 관계 · 차트 사실 아님`),
    element("small", "", [...types].map(([type, count]) => `${EVENT_LABELS[type] ?? type} ${count}`).join(" · ") || "확정 구조화 기록 없음"),
  );
  refs.encounterGraphSummary.append(summary);
}

function renderEncounter(patient, evaluations) {
  const encounter = currentEncounter(patient);
  const nextComposerContextKey = `${patient?.id ?? ""}:${encounter?.id ?? ""}`;
  if (nextComposerContextKey !== clinicalComposerContextKey) {
    resetClinicalComposerForms();
    clinicalComposerContextKey = nextComposerContextKey;
  }
  const status = encounterQueueStatus(encounter);
  const unverifiedBackup = encounter?.source?.kind === "import";
  const editable = status === "in-progress" && encounter?.recordStatus === "draft" && !unverifiedBackup;
  const completed = status === "completed" && !unverifiedBackup;
  refs.encounterTitle.textContent = encounter ? `${displayDate(encounter.date)} ${encounter.label}` : "오늘 외래 진료";
  refs.encounterStatus.dataset.status = status;
  refs.encounterStatusText.textContent = QUEUE_LABELS[status];
  refs.returnCurrentEncounter.hidden = !viewedEncounterId;
  const finalized = ["signed", "legacy", "external"].includes(status);
  refs.checkInPatient.hidden = !unverifiedBackup && !["none", "signed", "legacy", "external"].includes(status);
  refs.checkInPatient.textContent = finalized || unverifiedBackup ? "새 로컬 진료 접수" : "오늘 접수";
  refs.startEncounter.hidden = status !== "waiting" || unverifiedBackup;
  refs.saveEncounterDraft.hidden = !editable;
  refs.completeEncounter.hidden = !editable;
  refs.signEncounter.hidden = !completed;
  refs.reopenEncounter.hidden = !completed;
  refs.cancelEncounter.hidden = unverifiedBackup || !["waiting", "in-progress"].includes(status);

  refs.encounterDate.value = encounter?.date || today();
  refs.encounterDepartment.value = encounter?.department || "";
  refs.encounterClinician.value = encounter?.clinician || "";
  refs.encounterRoom.value = encounter?.room || "";
  refs.chiefComplaint.value = encounter?.chiefComplaint || "";
  refs.soapSubjective.value = encounter?.soap?.subjective || "";
  refs.soapObjective.value = encounter?.soap?.objective || "";
  refs.soapAssessment.value = encounter?.soap?.assessment || "";
  refs.soapPlan.value = encounter?.soap?.plan || "";
  for (const control of refs.encounterForm.querySelectorAll("input, textarea, select")) control.disabled = !editable;
  refs.encounterFormMessage.textContent = unverifiedBackup
    ? "백업 복원 · 출처 미검증 진료. 진행·수정·완료·서명·취소할 수 없으며 새 로컬 진료로 접수해야 합니다."
    : status === "signed"
    ? `${encounter.signature?.signer || "의료진"} · ${displayTimestamp(encounter.signature?.signedAt)} 로컬 서명 완료. 법적 전자서명 아님.`
    : status === "external"
      ? "외부 완료 기록 · 원본 기관·작성자·전자서명 미검증. 로컬 서명으로 보지 않습니다."
      : status === "legacy"
        ? "이전 버전에서 이관된 완료 기록 · 원본 서명 상태를 별도로 확인하세요."
    : status === "completed"
      ? "진료 완료 · 최종 검토 후 서명하세요. 서명 전에는 다시 열 수 있습니다."
      : status === "waiting"
        ? "접수 완료 · 진료 시작 후 기록할 수 있습니다."
        : status === "none"
          ? "오늘 접수 후 진료를 시작하세요."
          : "";

  setFormControlsDisabled(refs.vitalForm, !editable);
  setFormControlsDisabled(refs.diagnosisForm, !editable);
  setFormControlsDisabled(refs.prescriptionForm, !editable);
  setFormControlsDisabled(refs.orderForm, !editable);
  clear(refs.vitalList);
  clear(refs.diagnosisList);
  clear(refs.prescriptionList);
  clear(refs.orderList);
  const records = encounter ? getEncounterRecords(patient, encounter.id).slice(1) : [];
  for (const observation of records.filter((event) => event.type === "observation")) {
    appendEncounterEntry(refs.vitalList, {
      title: observation.label,
      meta: ["LOINC", observation.code, displayDate(observation.date)].filter(Boolean).join(" · "),
      detail: [`${observation.value} ${observation.unit}`.trim(), observation.note].filter(Boolean).join(" · "),
      badge: observation.recordStatus === "final" ? "확정 측정" : "측정 초안",
      entityId: observation.id,
      editable,
    });
  }
  if (!refs.vitalList.childElementCount) refs.vitalList.append(element("li", "encounter-entry-empty", editable ? "이번 진료의 활력징후·검사 결과를 추가하세요." : "이번 진료 측정 없음"));

  for (const diagnosis of records.filter((event) => event.type === "condition")) {
    appendEncounterEntry(refs.diagnosisList, {
      title: diagnosis.label,
      meta: [diagnosis.diagnosisRole === "primary" ? "주상병" : "부상병", diagnosis.system, diagnosis.code].filter(Boolean).join(" · "),
      detail: diagnosis.note,
      badge: diagnosis.certainty === "provisional" ? "의증" : "확정",
      entityId: diagnosis.id,
      editable,
    });
  }
  if (!refs.diagnosisList.childElementCount) refs.diagnosisList.append(element("li", "encounter-entry-empty", editable ? "이번 진료 진단을 추가하세요." : "이번 진료 진단 없음"));

  for (const medication of records.filter((event) => event.type === "medication")) {
    const rx = medication.prescription ?? {};
    appendEncounterEntry(refs.prescriptionList, {
      title: medication.label,
      meta: [medication.system, medication.code].filter(Boolean).join(" · ") || "코드 없음",
      detail: [`1회 ${rx.dose ?? "—"}${rx.doseUnit || ""}`, rx.route, rx.frequency, `${rx.durationDays ?? "—"}일`, `총 ${rx.quantity ?? "—"}`, rx.instructions].filter(Boolean).join(" · "),
      badge: medication.recordStatus === "final" ? "확정 처방" : "처방 초안",
      entityId: medication.id,
      editable,
    });
  }
  if (!refs.prescriptionList.childElementCount) refs.prescriptionList.append(element("li", "encounter-entry-empty", editable ? "처방이 필요한 경우 구조화해 추가하세요." : "이번 진료 처방 없음"));

  for (const order of records.filter((event) => event.type === "service-request")) {
    const evaluation = evaluations
      .filter((item) => item.rule?.serviceCode === order.code && (!item.rule.serviceSystem || item.rule.serviceSystem === order.system))
      .sort((left, right) => Number(left.status === "not-applicable") - Number(right.status === "not-applicable")
        || String(right.rule?.effectiveFrom).localeCompare(String(left.rule?.effectiveFrom)))[0] ?? null;
    appendEncounterEntry(refs.orderList, {
      title: order.label,
      meta: [order.order?.kind, order.system, order.code, order.order?.priority].filter(Boolean).join(" · "),
      detail: order.order?.instructions,
      badge: evaluation ? `예비 · ${CLAIM_LANE_LABELS[evaluation.status]}` : "예비 · 기준 확인",
      entityId: order.id,
      editable,
    });
  }
  if (!refs.orderList.childElementCount) refs.orderList.append(element("li", "encounter-entry-empty", editable ? "검사·영상·처치·의뢰 오더를 추가하세요." : "이번 진료 오더 없음"));
  renderEncounterContext(patient, encounter, evaluations);
}

function renderTabs() {
  for (const tab of document.querySelectorAll("[data-tab]")) {
    const selected = tab.dataset.tab === activeTab;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const panel of document.querySelectorAll("[data-panel]")) panel.hidden = panel.dataset.panel !== activeTab;
  for (const link of document.querySelectorAll("[data-tab-target]")) {
    if (link.dataset.tabTarget === activeTab) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

function clearPatientWorkspaceUi() {
  viewedEncounterId = "";
  copilotBusy = false;
  copilotRequestController?.abort();
  copilotRequestController = null;
  resetPatientForm();
  refs.patientSearch.value = "";
  refs.encounterForm.reset();
  resetClinicalComposerForms();
  clinicalComposerContextKey = "";
  refs.eventForm.reset();
  refs.ruleForm.reset();
  refs.fhirImport.value = "";
  refs.importEmr.value = "";
  refs.encounterDate.value = today();
  refs.eventDate.value = today();
  refs.ruleEffectiveFrom.value = today();
  refs.patientBirthDate.max = today();
  refs.selectedPatientName.textContent = "";
  refs.selectedPatientMeta.textContent = "";
  refs.lastSavedAt.textContent = "";
  refs.encounterTitle.textContent = "오늘 외래 진료";
  refs.encounterStatus.dataset.status = "none";
  refs.encounterStatusText.textContent = QUEUE_LABELS.none;
  refs.encounterFormMessage.textContent = "";
  refs.eventFormMessage.textContent = "";
  refs.eventCount.textContent = "0건";
  refs.copilotMode.textContent = "규칙 기반";
  refs.returnCurrentEncounter.hidden = true;
  refs.checkInPatient.hidden = true;
  refs.startEncounter.hidden = true;
  refs.saveEncounterDraft.hidden = true;
  refs.completeEncounter.hidden = true;
  refs.signEncounter.hidden = true;
  refs.reopenEncounter.hidden = true;
  refs.cancelEncounter.hidden = true;
  refs.runCopilot.disabled = true;
  for (const control of refs.encounterForm.querySelectorAll("input, textarea, select")) control.disabled = true;
  setFormControlsDisabled(refs.vitalForm, true);
  setFormControlsDisabled(refs.diagnosisForm, true);
  setFormControlsDisabled(refs.prescriptionForm, true);
  setFormControlsDisabled(refs.orderForm, true);
  for (const node of [
    refs.safetyAlerts,
    refs.patientMetrics,
    refs.clinicalSummary,
    refs.copilotContent,
    refs.nextWorkList,
    refs.vitalList,
    refs.diagnosisList,
    refs.prescriptionList,
    refs.orderList,
    refs.encounterClaimSummary,
    refs.recentEncounterList,
    refs.encounterGraphSummary,
    refs.eventFilters,
    refs.eventTimeline,
    refs.clinicalGraph,
    refs.graphEvidenceList,
    refs.claimBoard,
    refs.ruleVersionList,
    refs.clinicalJourney,
    refs.visitQuestions,
  ]) clear(node);
}

function renderWorkspace() {
  const patient = selectedPatient();
  refs.workspaceEmpty.hidden = Boolean(patient);
  refs.workspaceContent.hidden = !patient;
  if (!patient) {
    clearPatientWorkspaceUi();
    return;
  }
  const evaluations = claimEvaluations(patient);
  const encounter = currentEncounter(patient);
  const preflightEvaluations = claimEvaluations(patient, {
    includeCurrentDraft: encounter?.recordStatus === "draft",
    encounterId: encounter?.id ?? "",
    asOf: encounter?.date ?? today(),
  });
  refs.selectedPatientName.textContent = patient.name;
  refs.selectedPatientMeta.textContent = [
    patient.mrn || "등록번호 없음",
    patient.birthDate ? displayDate(patient.birthDate) : "생년월일 미상",
    patientAgeLabel(patient),
    SEX_LABELS[patient.sex],
    patient.bloodType && patient.bloodType !== "unknown" ? `${patient.bloodType}형` : "혈액형 미상",
    INSURANCE_LABELS[patient.insuranceType],
  ].filter(Boolean).join(" · ");
  refs.lastSavedAt.textContent = state.demo ? "데모 · 저장 안 됨" : "저장 " + displayTimestamp(state.updatedAt);
  renderSafety(patient);
  renderEncounter(patient, preflightEvaluations);
  renderMetrics(patient, evaluations);
  renderSummary(patient);
  renderCopilot(patient, evaluations);
  renderNextWork(evaluations);
  renderTimeline(patient);
  renderGraph(patient);
  renderClaimBoard(patient);
  renderJourney(patient, briefCache.get(patient.id));
}

function render() {
  refs.demoBanner.hidden = !state.demo;
  refs.exitDemo.hidden = !state.demo;
  refs.loadDemo.hidden = state.demo;
  renderPatients();
  renderTabs();
  renderWorkspace();
  renderAudit();
  renderDataFacts();
  renderFhirReport();
}

function resetPatientForm() {
  refs.patientForm.reset();
  refs.patientAgeYears.disabled = false;
  refs.patientFormMode.value = "create";
  refs.patientFormMessage.textContent = "";
  refs.cancelPatientEdit.hidden = true;
  refs.patientComposer.querySelector("summary span").textContent = "새 환자 등록";
}

function isClearedEmrState(candidate) {
  return candidate?.demo === false
    && !candidate.storageError
    && !candidate.recoveryRaw
    && candidate.selectedPatientId === ""
    && candidate.selectedEncounterId === ""
    && Array.isArray(candidate.patients)
    && candidate.patients.length === 0
    && Array.isArray(candidate.audit)
    && candidate.audit.length === 0
    && Array.isArray(candidate.rules)
    && candidate.rules.every(({ sample }) => sample === true);
}

function adoptClearedEmrState(cleared) {
  stateGeneration += 1;
  state = cleared;
  savedState = cleared;
  briefCache.clear();
  lastFhirReport = null;
  render();
}

function patientFormHasPendingInput() {
  return refs.patientFormMode.value !== "create" || [
    refs.patientMrn,
    refs.patientName,
    refs.patientBirthDate,
    refs.patientAgeYears,
    refs.patientPhone,
    refs.patientAddress,
    refs.patientEmergencyName,
    refs.patientEmergencyRelation,
    refs.patientEmergencyPhone,
    refs.patientMemo,
  ].some((input) => String(input.value ?? "").trim())
    || refs.patientSex.value !== "unknown"
    || refs.patientBloodType.value !== "unknown"
    || refs.patientInsuranceType.value !== "unknown";
}

function encounterFormHasUnsavedInput() {
  if (clinicalComposerHasPendingInput()) return true;
  try {
    return preserveEncounterDraftIfChanged(state) !== state;
  } catch {
    return true;
  }
}

function patientContextHasUnsavedInput() {
  return encounterFormHasUnsavedInput() || manualEventFormHasPendingInput();
}

function beginPatientEdit() {
  const patient = selectedPatient();
  if (!patient) return;
  refs.patientFormMode.value = patient.id;
  refs.patientMrn.value = patient.mrn;
  refs.patientName.value = patient.name;
  refs.patientBirthDate.value = patient.birthDate;
  refs.patientAgeYears.value = patient.birthDate ? ageFromBirthDate(patient.birthDate).replace(/\D/g, "") : patient.ageYears ?? "";
  refs.patientAgeYears.disabled = Boolean(patient.birthDate);
  refs.patientSex.value = patient.sex;
  refs.patientPhone.value = patient.phone;
  refs.patientAddress.value = patient.address;
  refs.patientBloodType.value = patient.bloodType;
  refs.patientInsuranceType.value = patient.insuranceType;
  refs.patientEmergencyName.value = patient.emergencyContact?.name ?? "";
  refs.patientEmergencyRelation.value = patient.emergencyContact?.relation ?? "";
  refs.patientEmergencyPhone.value = patient.emergencyContact?.phone ?? "";
  refs.patientMemo.value = patient.memo;
  refs.patientFormMessage.textContent = "";
  refs.cancelPatientEdit.hidden = false;
  refs.patientComposer.querySelector("summary span").textContent = "환자 정보 편집";
  refs.patientComposer.open = true;
  refs.patientMrn.focus();
}

function switchTab(tab, focus = false) {
  if (!document.querySelector("[data-panel='" + tab + "']")) return;
  activeTab = tab;
  renderTabs();
  if (focus) byId("tab-" + tab)?.focus();
}

function downloadJson(value, filename) {
  downloadText(JSON.stringify(value, null, 2), filename, "application/json;charset=utf-8");
}

function setPatientTransferStatus(message, tone = "") {
  refs.patientTransferStatus.textContent = message;
  if (tone) refs.patientTransferStatus.dataset.tone = tone;
  else delete refs.patientTransferStatus.dataset.tone;
}

function currentExportBlocker(exportState = state) {
  if (exportState.storageError) return "손상된 로컬 저장을 정리하기 전에는 내보낼 수 없습니다.";
  if (patientFormHasPendingInput() || patientContextHasUnsavedInput()) return "미저장 환자·진료·임상항목·과거기록 입력을 먼저 저장하거나 취소한 뒤 내보내세요.";
  const persisted = loadEmrState();
  if (persisted.storageError) return "현재 저장 상태를 확인할 수 없어 내보내기를 차단했습니다.";
  if (isClearedEmrState(persisted) && !isClearedEmrState(exportState)) return "다른 탭에서 전체 삭제가 적용되어 내보내기를 차단했습니다.";
  if (persisted.revision !== exportState.revision) return "다른 탭의 최신 변경을 먼저 반영한 뒤 내보내세요.";
  return "";
}

function downloadText(value, filename, type = "text/plain;charset=utf-8") {
  const blob = new Blob([value], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}

async function readJsonFile(file, maximumBytes = 5 * 1024 * 1024) {
  if (!file) throw new Error("파일이 선택되지 않았습니다.");
  if (file.size > maximumBytes) throw new RangeError(`가져오기 파일은 ${Math.floor(maximumBytes / 1024 / 1024)}MB 이하여야 합니다.`);
  return JSON.parse(await file.text());
}

async function checkAiStatus() {
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(window.location.hostname);
  try {
    const response = await fetch("/api/clinical-copilot/status", { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("status");
    const result = await response.json();
    aiCapability = {
      checked: true,
      configured: loopback && result.configured === true,
      model: typeof result.model === "string" ? result.model : "",
    };
    if (aiCapability.configured) {
      refs.aiStatusDot.classList.add("is-ready");
      refs.aiStatusLabel.textContent = "로컬 AI 연결";
      refs.aiStatusDetail.textContent = aiCapability.model + " · 브리프만 생성";
    } else {
      refs.aiStatusLabel.textContent = "규칙 기반 모드";
      refs.aiStatusDetail.textContent = "Ollama 모델 미설정 · 기능 정상";
    }
  } catch {
    aiCapability = { checked: true, configured: false, model: "" };
    refs.aiStatusLabel.textContent = "규칙 기반 모드";
    refs.aiStatusDetail.textContent = "공개 빌드 · 환자 데이터 전송 안 함";
  }
}

async function runCopilot() {
  const patient = selectedPatient();
  if (!patient || copilotBusy) return;
  const evaluations = claimEvaluations(patient);
  briefCache.set(patient.id, createLocalCopilotBrief(patient, evaluations, today()));
  renderCopilot(patient, evaluations);
  if (!aiCapability.configured) {
    setStatus("규칙 기반 초안을 만들었습니다. 로컬 AI가 설정되지 않아 환자 데이터를 전송하지 않았습니다.", "success");
    renderJourney(patient, briefCache.get(patient.id));
    return;
  }
  copilotBusy = true;
  const controller = new AbortController();
  copilotRequestController = controller;
  renderCopilot(patient, evaluations);
  setStatus("규칙 기반 초안을 먼저 만들었습니다. 이름·등록번호·전화·자유메모를 제외한 구조화 차트를 로컬 AI에 보냅니다.");
  try {
    const request = createCopilotRequest(patient, evaluations, today());
    const requestFingerprint = copilotRequestFingerprint(request);
    const response = await fetch("/api/clinical-copilot", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(request.payload),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "로컬 AI를 사용할 수 없습니다.");
    if (result.kind !== "model") throw new Error("로컬 모델 초안 형식이 올바르지 않습니다.");
    const currentPatient = state.patients.find(({ id }) => id === patient.id);
    const currentRequest = currentPatient
      ? createCopilotRequest(currentPatient, claimEvaluations(currentPatient), today())
      : null;
    if (selectedPatient()?.id !== patient.id
      || !currentRequest
      || copilotRequestFingerprint(currentRequest) !== requestFingerprint) {
      throw new Error("차트 또는 급여 기준이 변경되어 오래된 로컬 AI 초안을 폐기했습니다.");
    }
    briefCache.set(patient.id, restoreCopilotEvidenceIds(result, request.aliasToEventId));
    setStatus("로컬 AI 초안을 만들었습니다. 의료진 검토 전 확정 기록이 아닙니다.", "success");
  } catch (error) {
    if (!controller.signal.aborted) {
      setStatus((error instanceof Error ? error.message : "로컬 AI 연결 실패") + " 규칙 기반 초안을 유지합니다.");
    }
  } finally {
    if (copilotRequestController === controller) {
      copilotRequestController = null;
      copilotBusy = false;
      const current = selectedPatient();
      if (current) {
        const currentEvaluations = claimEvaluations(current);
        renderCopilot(current, currentEvaluations);
        renderJourney(current, briefCache.get(current.id));
      }
    }
  }
}

refs.patientSearch.addEventListener("input", renderPatients);

refs.patientList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-patient-id]");
  if (!button) return;
  if (refs.patientFormMode.value !== "create" && refs.patientFormMode.value !== button.dataset.patientId) {
    setStatus("현재 환자 정보 편집을 저장하거나 취소한 뒤 다른 환자를 선택하세요.", "error");
    return;
  }
  if (button.dataset.patientId !== state.selectedPatientId && blockClinicalContextChange({ patientChanged: true })) return;
  try {
    await withStateTransition(async () => {
      const expectedRevision = state.revision;
      const expectedGeneration = stateGeneration;
      const base = preserveEncounterDraftIfChanged(state);
      const candidate = selectPatient(base, button.dataset.patientId);
      if (state.demo) {
        state = candidate;
      } else {
        const saved = await saveEmrState(candidate, undefined, expectedRevision);
        assertCurrentStateGeneration(expectedGeneration);
        state = saved;
        savedState = saved;
      }
      viewedEncounterId = "";
      eventFilter = "all";
      activeTab = "encounter";
      render();
    });
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "환자 선택을 저장하지 못했습니다.", "error");
  }
});

refs.patientForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!reportFormValidity(refs.patientForm)) return;
  refs.patientFormMessage.textContent = "";
  const mrn = refs.patientMrn.value.trim();
  const name = refs.patientName.value.trim();
  const mode = refs.patientFormMode.value;
  if (!mrn || !name) {
    refs.patientFormMessage.textContent = "등록번호와 이름을 입력하세요.";
    return;
  }
  const duplicate = state.patients.find((patient) => patient.mrn === mrn && patient.id !== mode);
  if (duplicate) {
    refs.patientFormMessage.textContent = "같은 등록번호가 이미 있습니다.";
    return;
  }
  const payload = {
    mrn,
    name,
    birthDate: refs.patientBirthDate.value,
    ageYears: refs.patientBirthDate.value ? null : refs.patientAgeYears.value,
    sex: refs.patientSex.value,
    phone: refs.patientPhone.value,
    address: refs.patientAddress.value,
    bloodType: refs.patientBloodType.value,
    insuranceType: refs.patientInsuranceType.value,
    emergencyContact: {
      name: refs.patientEmergencyName.value,
      relation: refs.patientEmergencyRelation.value,
      phone: refs.patientEmergencyPhone.value,
    },
    memo: refs.patientMemo.value,
  };
  try {
    if (mode !== "create" && mode !== state.selectedPatientId) {
      throw new Error("편집 대상 환자가 바뀌었습니다. 편집을 취소하고 다시 시작하세요.");
    }
    if (mode === "create") {
      if (selectedPatient() && blockClinicalContextChange({ patientChanged: true })) {
        refs.patientFormMessage.textContent = "현재 환자의 미등록 임상 입력을 먼저 추가하거나 지우세요.";
        return;
      }
      await applyMutation((current) => addPatient(current, payload), "환자를 등록했습니다.");
    } else {
      await applyMutation((current) => updatePatient(current, mode, payload), "환자 정보를 수정했습니다.");
    }
    resetPatientForm();
    refs.patientComposer.open = false;
  } catch (error) {
    refs.patientFormMessage.textContent = error instanceof Error ? error.message : "환자 저장에 실패했습니다.";
  }
});

refs.cancelPatientEdit.addEventListener("click", resetPatientForm);
refs.editPatient.addEventListener("click", beginPatientEdit);
refs.patientBirthDate.addEventListener("change", () => {
  const calculated = ageFromBirthDate(refs.patientBirthDate.value).replace(/\D/g, "");
  refs.patientAgeYears.disabled = Boolean(refs.patientBirthDate.value);
  if (calculated) refs.patientAgeYears.value = calculated;
  else if (!refs.patientBirthDate.value) refs.patientAgeYears.value = "";
});

refs.queueFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-queue-filter]");
  if (!button) return;
  queueFilter = button.dataset.queueFilter;
  renderPatients();
});

refs.recentEncounterList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-view-encounter]");
  const patient = selectedPatient();
  if (!button || !patient) return;
  if (button.dataset.viewEncounter !== currentEncounter(patient)?.id && blockClinicalContextChange()) return;
  try {
    await withStateTransition(async () => {
      const expectedRevision = state.revision;
      const expectedGeneration = stateGeneration;
      const preserved = preserveEncounterDraftIfChanged(state);
      if (preserved !== state) {
        if (state.demo) state = { ...preserved, demo: true };
        else {
          const saved = await saveEmrState(preserved, undefined, expectedRevision);
          assertCurrentStateGeneration(expectedGeneration);
          state = saved;
          savedState = saved;
        }
      }
      viewedEncounterId = button.dataset.viewEncounter;
      activeTab = "encounter";
      render();
      document.getElementById("panel-encounter")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "과거 진료를 열지 못했습니다.", "error");
  }
});

refs.returnCurrentEncounter.addEventListener("click", () => {
  if (blockClinicalContextChange()) return;
  viewedEncounterId = "";
  render();
});

refs.checkInPatient.addEventListener("click", async () => {
  const patient = selectedPatient();
  if (!patient) return;
  try {
    viewedEncounterId = "";
    await applyMutation((current) => checkInPatient(current, patient.id, {
      date: today(),
      department: refs.encounterDepartment.value,
      clinician: refs.encounterClinician.value,
      room: refs.encounterRoom.value,
    }), "오늘 진료에 접수했습니다.");
    restoreWorkflowFocus(refs.startEncounter, refs.encounterStatus);
  } catch (error) {
    refs.encounterFormMessage.textContent = error instanceof Error ? error.message : "접수에 실패했습니다.";
  }
});

refs.startEncounter.addEventListener("click", async () => {
  const patient = selectedPatient();
  const encounter = currentEncounter(patient);
  if (!patient || !encounter) return;
  try {
    await applyMutation((current) => startEncounter(current, patient.id, encounter.id), "진료를 시작했습니다.");
    refs.chiefComplaint.focus();
  } catch (error) {
    refs.encounterFormMessage.textContent = error instanceof Error ? error.message : "진료를 시작하지 못했습니다.";
  }
});

refs.encounterForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!reportFormValidity(refs.encounterForm)) return;
  const patient = selectedPatient();
  const encounter = currentEncounter(patient);
  if (!patient || !encounter) return;
  try {
    await applyMutation((current) => saveEncounterDraft(current, patient.id, encounter.id, encounterDraftFromForm()), "SOAP·진료 초안을 저장했습니다.", { preserveDraft: false });
    restoreWorkflowFocus(refs.saveEncounterDraft, refs.encounterStatus);
  } catch (error) {
    refs.encounterFormMessage.textContent = error instanceof Error ? error.message : "진료 초안을 저장하지 못했습니다.";
  }
});

refs.completeEncounter.addEventListener("click", async () => {
  const patient = selectedPatient();
  const encounter = currentEncounter(patient);
  if (!patient || !encounter) return;
  if (blockClinicalContextChange()) return;
  try {
    await applyMutation((current) => completeEncounter(current, patient.id, encounter.id, encounterDraftFromForm()), "진료를 완료했습니다. 최종 검토 후 서명하세요.", { preserveDraft: false });
    restoreWorkflowFocus(refs.signEncounter, refs.encounterStatus);
  } catch (error) {
    refs.encounterFormMessage.textContent = error instanceof Error ? error.message : "진료 완료 조건을 확인하세요.";
  }
});

refs.signEncounter.addEventListener("click", async () => {
  const patient = selectedPatient();
  const encounter = currentEncounter(patient);
  if (!patient || !encounter) return;
  if (!window.confirm("SOAP·측정·진단·처방·오더를 확정하고 로컬 서명할까요? 서명 후 직접 수정할 수 없습니다.")) return;
  try {
    await applyMutation((current) => signEncounter(current, patient.id, encounter.id, encounter.clinician), "진료를 완료·서명했습니다.");
    restoreWorkflowFocus(refs.encounterStatus, "tab-chart");
  } catch (error) {
    refs.encounterFormMessage.textContent = error instanceof Error ? error.message : "진료 서명에 실패했습니다.";
  }
});

refs.reopenEncounter.addEventListener("click", async () => {
  const patient = selectedPatient();
  const encounter = currentEncounter(patient);
  if (!patient || !encounter) return;
  try {
    await applyMutation((current) => reopenEncounter(current, patient.id, encounter.id), "서명 전 진료를 다시 열었습니다.");
    restoreWorkflowFocus(refs.chiefComplaint, refs.saveEncounterDraft);
  } catch (error) {
    refs.encounterFormMessage.textContent = error instanceof Error ? error.message : "진료를 다시 열지 못했습니다.";
  }
});

refs.cancelEncounter.addEventListener("click", async () => {
  const patient = selectedPatient();
  const encounter = currentEncounter(patient);
  if (!patient || !encounter) return;
  if (blockClinicalContextChange()) return;
  const reason = window.prompt("진료 취소 사유를 입력하세요. 연결된 초안도 취소됩니다.");
  if (reason === null) return;
  try {
    await applyMutation((current) => cancelEncounter(current, patient.id, encounter.id, reason), "진료를 취소했습니다.");
    restoreWorkflowFocus(refs.encounterStatus, refs.checkInPatient);
  } catch (error) {
    refs.encounterFormMessage.textContent = error instanceof Error ? error.message : "진료를 취소하지 못했습니다.";
  }
});

refs.vitalPreset.addEventListener("change", syncVitalPreset);

refs.vitalForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!reportFormValidity(refs.vitalForm)) return;
  const patient = selectedPatient();
  const encounter = currentEncounter(patient);
  if (!patient || !encounter) return;
  try {
    await applyMutation((current) => addEncounterObservation(current, patient.id, encounter.id, {
      code: refs.vitalPreset.value,
      value: refs.vitalValue.value,
      note: refs.vitalNote.value,
    }), "진료 측정 초안을 추가했습니다.");
    refs.vitalForm.reset();
    syncVitalPreset();
    refs.vitalValue.focus();
  } catch (error) {
    refs.encounterFormMessage.textContent = error instanceof Error ? error.message : "진료 측정을 추가하지 못했습니다.";
  }
});

refs.diagnosisForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!reportFormValidity(refs.diagnosisForm)) return;
  const patient = selectedPatient();
  const encounter = currentEncounter(patient);
  if (!patient || !encounter) return;
  try {
    await applyMutation((current) => addEncounterDiagnosis(current, patient.id, encounter.id, {
      diagnosisRole: refs.diagnosisRole.value,
      code: refs.diagnosisCode.value,
      system: refs.diagnosisSystem.value,
      label: refs.diagnosisLabel.value,
      certainty: refs.diagnosisCertainty.value === "confirmed" ? "confirmed" : "provisional",
    }), "진단 초안을 추가했습니다.");
    refs.diagnosisForm.reset();
    refs.diagnosisSystem.value = "urn:kr:kcd";
  } catch (error) {
    refs.encounterFormMessage.textContent = error instanceof Error ? error.message : "진단을 추가하지 못했습니다.";
  }
});

refs.prescriptionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!reportFormValidity(refs.prescriptionForm)) return;
  const patient = selectedPatient();
  const encounter = currentEncounter(patient);
  if (!patient || !encounter) return;
  try {
    await applyMutation((current) => addEncounterPrescription(current, patient.id, encounter.id, {
      code: refs.medicationCode.value,
      system: refs.medicationSystem.value,
      label: refs.medicationName.value,
      dose: refs.medicationDose.value,
      doseUnit: refs.medicationDoseUnit.value,
      route: refs.medicationRoute.value,
      frequency: refs.medicationFrequency.value,
      durationDays: refs.medicationDurationDays.value,
      quantity: refs.medicationQuantity.value,
      instructions: refs.medicationInstructions.value,
    }), "처방 초안을 추가했습니다.");
    refs.prescriptionForm.reset();
  } catch (error) {
    refs.encounterFormMessage.textContent = error instanceof Error ? error.message : "처방을 추가하지 못했습니다.";
  }
});

refs.orderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!reportFormValidity(refs.orderForm)) return;
  const patient = selectedPatient();
  const encounter = currentEncounter(patient);
  if (!patient || !encounter) return;
  try {
    await applyMutation((current) => addEncounterOrder(current, patient.id, encounter.id, {
      kind: refs.orderKind.value,
      code: refs.orderCode.value,
      system: refs.orderSystem.value,
      label: refs.orderLabel.value,
      priority: refs.orderPriority.value,
      instructions: refs.orderInstructions.value,
    }), "오더 초안을 추가했습니다.");
    refs.orderForm.reset();
  } catch (error) {
    refs.encounterFormMessage.textContent = error instanceof Error ? error.message : "오더를 추가하지 못했습니다.";
  }
});

async function removeEncounterItemFromClick(event) {
  const button = event.target.closest("[data-remove-encounter-item]");
  const patient = selectedPatient();
  const encounter = currentEncounter(patient);
  if (!button || !patient || !encounter) return;
  try {
    await applyMutation((current) => removeEncounterItem(current, patient.id, encounter.id, button.dataset.removeEncounterItem), "진료 초안 항목을 삭제했습니다.");
  } catch (error) {
    refs.encounterFormMessage.textContent = error instanceof Error ? error.message : "진료 항목을 삭제하지 못했습니다.";
  }
}

refs.vitalList.addEventListener("click", removeEncounterItemFromClick);
refs.diagnosisList.addEventListener("click", removeEncounterItemFromClick);
refs.prescriptionList.addEventListener("click", removeEncounterItemFromClick);
refs.orderList.addEventListener("click", removeEncounterItemFromClick);

refs.eventForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!reportFormValidity(refs.eventForm)) return;
  const patient = selectedPatient();
  refs.eventFormMessage.textContent = "";
  if (!patient) return;
  if (!refs.eventDate.value || !refs.eventLabel.value.trim()) {
    refs.eventFormMessage.textContent = "기록일과 이름을 입력하세요.";
    return;
  }
  try {
    await applyMutation((current) => appendPatientEvent(current, patient.id, {
      type: refs.eventType.value,
      date: refs.eventDate.value,
      system: refs.eventSystem.value,
      code: refs.eventCode.value,
      label: refs.eventLabel.value,
      value: refs.eventValue.value,
      unit: refs.eventUnit.value,
      note: refs.eventNote.value,
      source: state.demo ? { kind: "demo", label: "데모 입력" } : { kind: "manual", label: "직접 입력 · 검토 대기" },
    }), state.demo ? "데모 차트에 기록을 추가했습니다." : "검토 대기 기록을 추가했습니다. 확정 진료 사실·AI·급여 근거에는 포함되지 않습니다.");
    refs.eventForm.reset();
    refs.eventDate.value = today();
    refs.eventSystem.value = "urn:kr:kcd";
  } catch (error) {
    refs.eventFormMessage.textContent = error instanceof Error ? error.message : "기록 추가에 실패했습니다.";
  }
});

refs.eventType.addEventListener("change", () => {
  refs.eventSystem.value = refs.eventType.value === "condition"
    ? "urn:kr:kcd"
    : refs.eventType.value === "observation" ? "http://loinc.org" : "";
});

refs.eventFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-event-filter]");
  if (!button) return;
  eventFilter = button.dataset.eventFilter;
  const patient = selectedPatient();
  if (patient) renderTimeline(patient);
});

refs.eventTimeline.addEventListener("click", async (event) => {
  const patient = selectedPatient();
  if (!patient) return;
  const confirmButton = event.target.closest("[data-confirm-event]");
  if (confirmButton) {
    const record = patient.events.find((item) => item.id === confirmButton.dataset.confirmEvent);
    if (!window.confirm(`‘${record?.label ?? "이 기록"}’의 코드·값·날짜·출처를 대조했고 확정 차트 사실로 전환할까요? 이 확인은 법적 전자서명이 아닙니다.`)) return;
    try {
      await applyMutation(
        (current) => confirmPatientEvent(current, patient.id, confirmButton.dataset.confirmEvent),
        "과거자료를 의료진 검토 완료 기록으로 확정했습니다.",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "과거자료를 확정하지 못했습니다.", "error");
    }
    return;
  }
  const button = event.target.closest("[data-remove-event]");
  if (!button) return;
  const record = patient.events.find((item) => item.id === button.dataset.removeEvent);
  const reason = window.prompt("‘" + (record?.label ?? "이 기록") + "’을 취소할 사유를 입력하세요. 원문과 사유는 감사 이력에 남습니다.");
  if (reason === null) return;
  try {
    await applyMutation((current) => removePatientEvent(current, patient.id, button.dataset.removeEvent, reason), "임상 이벤트를 취소했습니다.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "임상 이벤트를 취소하지 못했습니다.", "error");
  }
});

refs.ruleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!reportFormValidity(refs.ruleForm)) return;
  refs.ruleFormMessage.textContent = "";
  const applicabilityCodes = refs.ruleApplicabilityCodes.value.split(",").map((value) => value.trim()).filter(Boolean);
  const evidenceCodes = refs.ruleEvidenceCodes.value.split(",").map((value) => value.trim()).filter(Boolean);
  const lookbackDays = refs.ruleEvidenceLookbackDays.value ? Number.parseInt(refs.ruleEvidenceLookbackDays.value, 10) : 0;
  try {
    await applyMutation((current) => addClaimRule(current, {
      ruleSetId: refs.ruleSetId.value,
      version: refs.ruleVersion.value,
      title: refs.ruleTitle.value,
      serviceCode: refs.ruleServiceCode.value,
      serviceSystem: refs.ruleServiceSystem.value,
      serviceEventType: refs.ruleServiceEventType.value,
      windowDays: refs.ruleWindowDays.value,
      maxCount: refs.ruleMaxCount.value,
      applicabilityCodes,
      applicabilitySystem: refs.ruleApplicabilitySystem.value,
      requiredEvidence: evidenceCodes.map((code) => ({
        code,
        system: refs.ruleEvidenceSystem.value.trim(),
        label: code,
        eventTypes: [refs.ruleEvidenceEventType.value],
        lookbackDays,
      })),
      effectiveFrom: refs.ruleEffectiveFrom.value,
      effectiveTo: refs.ruleEffectiveTo.value,
      sourceLabel: refs.ruleSourceLabel.value,
      sourceUrl: refs.ruleSourceUrl.value,
      sample: false,
    }), "기관 급여 규칙을 저장했습니다.");
    refs.ruleForm.reset();
    refs.ruleWindowDays.value = "365";
    refs.ruleMaxCount.value = "1";
    refs.ruleVersion.value = "1";
    refs.ruleEffectiveFrom.value = today();
  } catch (error) {
    refs.ruleFormMessage.textContent = error instanceof Error ? error.message : "규칙 저장에 실패했습니다.";
  }
});

refs.ruleVersionList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-retire-rule]");
  if (!button) return;
  const input = refs.ruleVersionList.querySelector(`[data-rule-end-date="${CSS.escape(button.dataset.retireRule)}"]`);
  if (!input?.reportValidity() || !input.value) return;
  try {
    await applyMutation(
      (current) => retireClaimRule(current, button.dataset.retireRule, input.value),
      `급여 규칙 버전 종료일을 ${input.value}로 저장했습니다.`,
    );
  } catch (error) {
    refs.ruleFormMessage.textContent = error instanceof Error ? error.message : "규칙 종료일을 저장하지 못했습니다.";
  }
});

document.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-tab]");
  if (tab) {
    switchTab(tab.dataset.tab);
    return;
  }
  const headerTab = event.target.closest("[data-tab-target]");
  if (headerTab) {
    event.preventDefault();
    switchTab(headerTab.dataset.tabTarget);
    document.querySelector(".patient-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const openTab = event.target.closest("[data-open-tab]");
  if (openTab) {
    switchTab(openTab.dataset.openTab, true);
    return;
  }
});

document.querySelector(".workspace-tabs").addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  const tabs = [...document.querySelectorAll("[data-tab]")];
  const focusedTab = event.target.closest("[data-tab]");
  const focusedIndex = tabs.indexOf(focusedTab);
  const current = focusedIndex >= 0 ? focusedIndex : tabs.findIndex((tab) => tab.dataset.tab === activeTab);
  const direction = event.key === "ArrowRight" ? 1 : -1;
  const next = tabs[(current + direction + tabs.length) % tabs.length];
  event.preventDefault();
  switchTab(next.dataset.tab, true);
});

for (const button of document.querySelectorAll("[data-board-scope]")) {
  button.addEventListener("click", () => {
    boardScope = button.dataset.boardScope;
    for (const item of document.querySelectorAll("[data-board-scope]")) item.setAttribute("aria-pressed", String(item === button));
    const patient = selectedPatient();
    if (patient) renderClaimBoard(patient);
  });
}

function loadDemo() {
  if (blockClinicalContextChange({ patientChanged: true })) return;
  state = createDemoEmrState();
  viewedEncounterId = "";
  activeTab = "encounter";
  eventFilter = "all";
  briefCache.clear();
  render();
  setStatus("가상 환자 2명을 열었습니다. 데모 변경은 저장되지 않습니다.", "success");
}

refs.loadDemo.addEventListener("click", loadDemo);
refs.exitDemo.addEventListener("click", () => {
  if (blockClinicalContextChange({ patientChanged: true })) return;
  savedState = loadEmrState();
  state = savedState;
  viewedEncounterId = "";
  briefCache.clear();
  const url = new URL(window.location.href);
  url.searchParams.delete("demo");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
  render();
  if (state.storageError) setStatus("로컬 저장을 읽지 못했습니다. 손상 원본을 내보낸 뒤 백업 복원 또는 전체 삭제로 정리하세요.", "error");
  else setStatus("브라우저에 저장된 로컬 기록으로 돌아왔습니다.", "success");
});

refs.fhirImport.addEventListener("change", async () => {
  const expectedGeneration = stateGeneration;
  try {
    if (blockClinicalContextChange({ patientChanged: true })) return;
    const file = refs.fhirImport.files?.[0];
    await withStateTransition(async () => {
      const bundle = await readJsonFile(file, 2 * 1024 * 1024);
      assertCurrentStateGeneration(expectedGeneration);
      const result = parseEmrFhirBundle(bundle);
      lastFhirReport = result.provenance;
      renderFhirReport();
      const persistedBase = state.demo ? loadEmrState() : state;
      const expectedRevision = persistedBase.revision;
      const base = state.demo ? persistedBase : preserveEncounterDraftIfChanged(state);
      if (base.storageError) throw new Error("손상된 로컬 저장을 먼저 원본으로 내보낸 뒤 복원 또는 삭제하세요.");
      const patient = result.patient;
      if (base.patients.some((item) => item.id === patient.id || (patient.mrn && item.mrn === patient.mrn))) {
        throw new Error("같은 FHIR 환자 ID 또는 등록번호가 이미 있습니다. 기존 환자 병합은 지원하지 않습니다.");
      }
      let candidate = addPatient(base, patient);
      candidate = appendStateAudit(
        candidate,
        "fhir.imported",
        `FHIR R4 · 지원 ${result.provenance.supported}건 · 제외 ${result.provenance.unsupported}건`,
        new Date().toISOString(),
        patient.id,
      );
      const saved = await saveEmrState(candidate, undefined, expectedRevision);
      assertCurrentStateGeneration(expectedGeneration);
      state = saved;
      savedState = saved;
      viewedEncounterId = "";
      activeTab = "encounter";
      briefCache.clear();
      render();
      setStatus("FHIR R4에서 환자 1명과 임상기록 " + patient.events.length + "건을 가져왔습니다. 외부 미검증 기록은 확정 요약·AI·급여 근거에서 제외하며 미지원 " + result.provenance.unsupported + "건입니다.", "success");
    });
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "FHIR 가져오기에 실패했습니다.", "error");
  } finally {
    refs.fhirImport.value = "";
  }
});

refs.importEmr.addEventListener("change", async () => {
  if (patientFormHasPendingInput() || patientContextHasUnsavedInput()) {
    refs.importEmr.value = "";
    setStatus("미저장 환자·진료·임상항목·과거기록 입력을 먼저 저장하거나 취소한 뒤 백업을 복원하세요.", "error");
    return;
  }
  const expectedGeneration = stateGeneration;
  try {
    const file = refs.importEmr.files?.[0];
    await withStateTransition(async () => {
      const backup = await readJsonFile(file);
      assertCurrentStateGeneration(expectedGeneration);
      const parsed = parseEmrBackup(backup);
      if (!window.confirm("이 JSON 백업은 암호화·전자서명·원본 기관을 검증하지 않습니다. 복원된 모든 임상 기록은 출처 미검증으로 격리되어 AI·급여 근거·FHIR 내보내기·환자 전달에서 제외되며, 복원 초안도 로컬 확정·서명할 수 없습니다. 백업의 기관 규칙과 감사 이력도 신뢰하지 않습니다. 현재 기록 교체는 별도 백업 없이는 복구할 수 없습니다.")) {
        setStatus("백업 복원을 취소했습니다.");
        return;
      }
      const persistedState = state.demo ? savedState : state;
      const restoreRevision = persistedState.storageError ? Date.now() * 1_000 : persistedState.revision;
      let candidate = prepareUnverifiedBackupRestore(parsed, persistedState, new Date().toISOString());
      candidate = { ...candidate, revision: restoreRevision };
      candidate = appendStateAudit(candidate, "backup.restored", `환자 ${candidate.patients.length}명`);
      const saved = persistedState.storageError && persistedState.recoveryRaw
        ? await recoverEmrState(candidate, persistedState.recoveryRaw)
        : await saveEmrState(candidate, undefined, persistedState.revision, { allowSignedRecordReplacement: true });
      assertCurrentStateGeneration(expectedGeneration);
      state = saved;
      savedState = saved;
      viewedEncounterId = "";
      lastFhirReport = null;
      resetPatientForm();
      briefCache.clear();
      render();
      setStatus("백업의 모든 임상 기록을 출처 미검증 상태로 복원·격리했습니다. 이 로컬 샌드박스에서는 AI·급여·FHIR·환자 전달·로컬 서명의 근거에서 제외합니다.", "success");
    });
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "백업 복원에 실패했습니다.", "error");
  } finally {
    refs.importEmr.value = "";
  }
});

function exportBackup() {
  const exportState = state.demo ? savedState : state;
  const blocker = currentExportBlocker(exportState);
  if (blocker) {
    setStatus(blocker, "error");
    return;
  }
  downloadJson(exportEmrBackup(exportState), "vitagraph-emr-backup-" + today() + ".json");
  setStatus(state.demo ? "데모가 아닌 기존 로컬 기록을 백업했습니다." : "전체 로컬 기록을 JSON으로 내보냈습니다.", "success");
}

refs.exportEmr.addEventListener("click", exportBackup);
refs.exportEmrSecondary.addEventListener("click", exportBackup);
refs.exportPatientTransfer.addEventListener("click", async () => {
  const patient = selectedPatient();
  if (!patient) {
    const message = "환자용 파일로 내보낼 환자를 먼저 선택하세요.";
    setPatientTransferStatus(message, "error");
    return;
  }
  if (state.demo) {
    setPatientTransferStatus("샘플 환자는 환자 전달 파일로 내보낼 수 없습니다. 로컬 실제 기록에서 선택하세요.", "error");
    return;
  }
  const blocker = currentExportBlocker();
  if (blocker) {
    setPatientTransferStatus(blocker, "error");
    return;
  }
  try {
    const exportedAt = new Date().toISOString();
    const transferPackage = createPatientTransferPackage(patient, exportedAt);
    const { includedConditions, includedMeasurements } = transferPackage.summary;
    if (!window.confirm(
      `${patient.name} 환자의 최소 건강정보를 내보낼까요?\n\n전달 확인 코드: ${transferPackage.transferCode}\n확정 질환 ${includedConditions}개 · 최종 측정 ${includedMeasurements}개\n\n환자명과 코드를 대조하세요. 코드는 파일과 다른 경로로 환자에게 안내해야 합니다.`,
    )) {
      setPatientTransferStatus("환자용 파일 내보내기를 취소했습니다.");
      return;
    }
    await applyMutation(
      (current) => appendStateAudit(
        current,
        "patient.transfer.exported",
        `확정 질환 ${includedConditions}개 · 최종 측정 ${includedMeasurements}개`,
        new Date().toISOString(),
        patient.id,
      ),
      "환자 전달 내보내기 이력을 저장했습니다.",
      { preserveDraft: false, announce: false },
    );
    downloadJson(transferPackage, patientTransferFilename(exportedAt));
    const message = `${patient.name} 환자용 JSON을 내보냈습니다. 전달 확인 코드 ${transferPackage.transferCode} · 확정 질환 ${includedConditions}개 · 최종 측정 ${includedMeasurements}개. 코드는 별도 경로로 안내하세요.`;
    setPatientTransferStatus(message, "success");
  } catch (error) {
    const message = error instanceof Error ? error.message : "환자용 VitaGraph JSON 내보내기에 실패했습니다.";
    setPatientTransferStatus(message, "error");
  }
});
refs.exportFhir.addEventListener("click", async () => {
  const patient = selectedPatient();
  if (!patient) {
    setStatus("FHIR로 내보낼 환자를 먼저 선택하세요.", "error");
    return;
  }
  if (!state.demo) {
    const blocker = currentExportBlocker();
    if (blocker) {
      setStatus(blocker, "error");
      return;
    }
  }
  try {
    const bundle = exportPatientFhirBundle(patient);
    if (!window.confirm(`${patient.name} 환자의 식별정보와 임상기록이 포함된 의료기관용 FHIR를 내보낼까요? 환자 앱 전달에는 사용하지 마세요.`)) return;
    if (!state.demo) {
      await applyMutation(
        (current) => appendStateAudit(current, "fhir.exported", "의료기관용 FHIR R4", new Date().toISOString(), patient.id),
        "FHIR 내보내기 이력을 저장했습니다.",
        { preserveDraft: false, announce: false },
      );
    }
    downloadJson(bundle, `vitagraph-fhir-${today()}.json`);
    setStatus(`선택 환자의 완료·서명 진료를 FHIR R4 Bundle로 내보냈습니다.${state.demo ? " · 합성 데모 파일" : ""}`, "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "FHIR 내보내기에 실패했습니다.", "error");
  }
});
refs.exportRecoveryRaw.addEventListener("click", () => {
  if (!state.recoveryRaw) {
    setStatus("내보낼 손상 저장 원본이 없습니다.");
    return;
  }
  downloadText(state.recoveryRaw, "vitagraph-emr-recovery-raw-" + today() + ".json", "application/json;charset=utf-8");
  setStatus("손상 저장 원본을 변경 없이 내보냈습니다.", "success");
});

refs.wipeEmr.addEventListener("click", async () => {
  if (!window.confirm("이 브라우저의 VitaGraph EMR 환자 기록과 기관 규칙을 모두 삭제할까요? 백업 없이는 복구할 수 없습니다.")) return;
  try {
    await withStateTransition(async () => {
      const cleared = await clearEmrState();
      adoptClearedEmrState(cleared);
      setStatus("이 브라우저의 VitaGraph EMR 기록을 모두 삭제했습니다.", "success");
    });
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "로컬 기록을 삭제하지 못했습니다.", "error");
  }
});

window.addEventListener("storage", (event) => {
  if (event.key !== EMR_STORAGE_KEY) return;
  const latest = loadEmrState();
  if (isClearedEmrState(latest)) {
    adoptClearedEmrState(latest);
    setStatus("다른 탭에서 전체 삭제한 기록을 이 탭에서도 폐기했습니다.", "success");
    return;
  }
  if (state.demo) {
    savedState = latest;
    return;
  }
  if (patientFormHasPendingInput() || patientContextHasUnsavedInput()) {
    setStatus("다른 탭에서 기록이 변경됐습니다. 현재 미저장 입력을 보존했습니다. 내용을 확인한 뒤 새로고침하세요.", "error");
    return;
  }
  state = latest;
  savedState = latest;
  briefCache.clear();
  render();
  setStatus(
    latest.storageError ? "다른 탭의 저장 변경을 읽지 못했습니다. 복구가 필요합니다." : "다른 탭의 로컬 기록 변경을 반영했습니다.",
    latest.storageError ? "error" : "success",
  );
});

refs.runCopilot.addEventListener("click", runCopilot);

refs.eventDate.value = today();
initializeVitalOptions();
refs.eventSystem.value = "urn:kr:kcd";
refs.ruleEffectiveFrom.value = today();
refs.encounterDate.value = today();
refs.patientBirthDate.max = today();
refs.diagnosisSystem.value = "urn:kr:kcd";
render();
if (!state.demo && state.storageError) {
  setStatus("로컬 저장을 읽지 못했습니다. 손상 원본을 내보낸 뒤 백업 복원 또는 전체 삭제로 정리하세요.", "error");
}
void checkAiStatus();
