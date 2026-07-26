import {
  addClaimRule,
  addPatient,
  appendStateAudit,
  appendPatientEvent,
  clinicalContextFingerprint,
  clearEmrState,
  confirmPatientEvent,
  createClinicalBodyAtlas,
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
  reconcileClaimReviews,
  recoverEmrState,
  removePatientEvent,
  resolveClaimReview,
  restoreEmrBackupState,
  retireClaimRule,
  saveEmrState,
  selectPatient,
  selectEncounter,
  setClaimReviewStage,
  updatePatient,
} from "./emr-model.js";
import { parseEmrFhirBundle } from "./emr-fhir.js";
import { exportPatientFhirBundle } from "./emr-fhir-export.js";
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
  assertEncounterSignReviewContext,
  assertEncounterSignReviewFingerprint,
  assertEncounterSignReviewReady,
  buildEncounterSignReview,
  encounterSignReviewFingerprint,
  encounterSignReviewIdentity,
} from "./emr-sign-review.js";
import {
  buildClaimBoard,
  CLAIM_LANE_LABELS,
  CLAIM_LANE_ORDER,
} from "./claim-rules.js";
import {
  CLINICAL_PATIENT_BRIEF_EVENT,
  normalizeClinicalPatientBrief,
} from "./clinical-question-assistant.js";
import {
  clinicalSnapshotFingerprint as careBridgeClinicalFingerprint,
  createClinicalSnapshot,
  publishClinicalSnapshot,
  readCareBridge,
  subscribeCareBridge,
} from "./care-bridge.js";

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
  "claim-review.stage.new": "급여 담당자 검토 · 미분류",
  "claim-review.stage.evidence": "급여 담당자 검토 · 근거 대조",
  "claim-review.stage.reviewing": "급여 담당자 검토 · 검토 중",
  "claim-review.stage.reviewed": "급여 담당자 검토 · 확인 완료",
  "claim-review.invalidated": "급여 담당자 검토 · 재검토 필요",
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

const CLAIM_REVIEW_STAGE_ORDER = ["new", "evidence", "reviewing", "reviewed"];
const CLAIM_REVIEW_STAGE_LABELS = {
  new: "미분류",
  evidence: "근거 대조",
  reviewing: "담당자 검토",
  reviewed: "확인 완료",
};
const WORKFLOW_DISCLOSURE_DEFAULTS = Object.freeze({
  none: ["visit-context"],
  waiting: ["visit-context"],
  "in-progress": ["visit-context", "soap"],
  completed: [],
  signed: [],
  legacy: [],
  external: [],
});

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
  encounterSignReview: byId("encounterSignReview"),
  encounterSignReviewTitle: byId("encounterSignReviewTitle"),
  encounterSignReviewContent: byId("encounterSignReviewContent"),
  encounterSignReviewAcknowledged: byId("encounterSignReviewAcknowledged"),
  encounterSignReviewAcknowledgementStatus: byId("encounterSignReviewAcknowledgementStatus"),
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
  encounterBodySummary: byId("encounterBodySummary"),
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
  bodyAreaCount: byId("bodyAreaCount"),
  bodyVisitCount: byId("bodyVisitCount"),
  bodyMedicationCount: byId("bodyMedicationCount"),
  bodySignalAreaCount: byId("bodySignalAreaCount"),
  bodyUnassignedMedicationCount: byId("bodyUnassignedMedicationCount"),
  bodyProjectionNotice: byId("bodyProjectionNotice"),
  bodyAreaControls: [...document.querySelectorAll("[data-body-area]")],
  bodyDetail: document.querySelector(".clinical-body-detail"),
  bodyDetailTitle: byId("bodyDetailTitle"),
  bodyDetailDepartment: byId("bodyDetailDepartment"),
  bodyDetailCount: byId("bodyDetailCount"),
  bodyVisitList: byId("bodyVisitList"),
  bodyMedicationList: byId("bodyMedicationList"),
  bodyConditionList: byId("bodyConditionList"),
  bodyDetailBoundary: byId("bodyDetailBoundary"),
  claimResultSummary: byId("claimResultSummary"),
  claimBoard: byId("claimBoard"),
  claimBoardLive: byId("claimBoardLive"),
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
  syncPersonalRecord: byId("syncPersonalRecord"),
  disconnectPersonalRecord: byId("disconnectPersonalRecord"),
  personalSyncStatus: byId("personalSyncStatus"),
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
let reviewedEncounterSignIdentity = null;
let reviewedEncounterSignFingerprint = "";
let bodySelectionAreaId = "";
let stateTransitionBusy = false;
let copilotBusy = false;
let stateGeneration = 0;
let copilotRequestController = null;
let aiCapability = { checked: false, configured: false, model: "" };
let lastFhirReport = null;
let draggedClaimReviewId = "";
let claimEvaluationById = new Map();
let lastPublishedPatientId = "";
let lastPublishedSnapshotFingerprint = "";
const PERSONAL_SYNC_SUSPENDED_KEY = "vitagraph-personal-sync-suspended-v1";
let personalConnectionSuspended = (() => {
  try {
    return localStorage.getItem(PERSONAL_SYNC_SUSPENDED_KEY) === "1";
  } catch {
    return false;
  }
})();
const briefCache = new Map();
const patientBriefCache = new Map();
const workflowDisclosureSessionState = new Map();
const pendingWorkflowDisclosureSync = new WeakMap();

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
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

function workflowDisclosureKey(disclosure, patient, encounter, status) {
  const name = disclosure.dataset.workflowDisclosure;
  if (name === "historical-entry") return `${patient.id}:patient:${name}`;
  return `${patient.id}:${encounter?.id ?? "no-encounter"}:${status}:${name}`;
}

function defaultWorkflowDisclosureOpen(disclosure, status) {
  const name = disclosure.dataset.workflowDisclosure;
  if (name === "historical-entry") return false;
  return (WORKFLOW_DISCLOSURE_DEFAULTS[status] ?? []).includes(name);
}

function syncWorkflowDisclosures(patient, encounter, status) {
  for (const disclosure of document.querySelectorAll("details[data-workflow-disclosure]")) {
    const key = workflowDisclosureKey(disclosure, patient, encounter, status);
    const nextOpen = workflowDisclosureSessionState.has(key)
      ? workflowDisclosureSessionState.get(key)
      : defaultWorkflowDisclosureOpen(disclosure, status);
    if (disclosure.open === nextOpen) continue;
    pendingWorkflowDisclosureSync.set(disclosure, nextOpen);
    disclosure.open = nextOpen;
  }
}

function setWorkflowDisclosureSummary(name, text, tone = "") {
  const summary = document.querySelector(`[data-disclosure-summary="${name}"]`);
  if (!summary) return;
  summary.textContent = text;
  if (tone) summary.dataset.tone = tone;
  else delete summary.dataset.tone;
}

function renderWorkflowDisclosureSummaries(encounter, status, records) {
  const contextValues = encounter
    ? [encounter.date, encounter.department, encounter.clinician, encounter.room, encounter.chiefComplaint]
    : [];
  const contextCount = contextValues.filter((value) => String(value ?? "").trim()).length;
  const contextTone = status === "in-progress" && contextCount < 2 ? "attention" : contextCount > 1 ? "ready" : "";
  setWorkflowDisclosureSummary("visit-context", status === "none" ? "접수 후 입력" : `${contextCount}/5 작성`, contextTone);

  const soapCount = Object.values(encounter?.soap ?? {}).filter((value) => String(value ?? "").trim()).length;
  const soapTone = status === "completed" && soapCount < 4 ? "attention" : soapCount === 4 ? "ready" : "";
  setWorkflowDisclosureSummary("soap", status === "none" || status === "waiting" ? "진료 시작 후 입력" : `${soapCount}/4 작성`, soapTone);

  const counts = {
    measurements: records.filter((event) => event.type === "observation").length,
    diagnoses: records.filter((event) => event.type === "condition").length,
    prescriptions: records.filter((event) => event.type === "medication").length,
    orders: records.filter((event) => event.type === "service-request").length,
  };
  for (const [name, count] of Object.entries(counts)) {
    setWorkflowDisclosureSummary(name, `${count}건`, count ? "ready" : "");
  }
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

function connectedPatientBrief(patient) {
  return patient ? patientBriefCache.get(patient.id) ?? null : null;
}

function comparableClinicalSnapshot(snapshot) {
  return {
    healthMap: snapshot?.healthMap ?? null,
    medications: Array.isArray(snapshot?.medications) ? snapshot.medications : [],
  };
}

function patientSnapshotMatchesBridge(patient, bridge) {
  if (!patient || !bridge?.clinical?.snapshot) return false;
  const bridgeSnapshot = bridge.clinical.snapshot;
  const bridgeFactCount = (bridgeSnapshot.healthMap?.conditions?.length ?? 0)
    + (bridgeSnapshot.healthMap?.measurements?.length ?? 0)
    + (bridgeSnapshot.medications?.length ?? 0);
  // The bridge intentionally carries no identity. An empty snapshot could match
  // more than one patient, so fail closed instead of attaching an ambiguous brief.
  if (bridgeFactCount === 0) return false;
  try {
    const currentSnapshot = createClinicalSnapshot(patient, bridgeSnapshot.preparedAt);
    return clinicalContextFingerprint(comparableClinicalSnapshot(currentSnapshot))
      === clinicalContextFingerprint(comparableClinicalSnapshot(bridgeSnapshot));
  } catch {
    return false;
  }
}

function bridgeMatchesPatient(patient, bridge) {
  if (!patient || state.demo) return false;
  const matchingPatientIds = state.patients
    .filter((candidate) => patientSnapshotMatchesBridge(candidate, bridge))
    .map(({ id }) => id);
  return matchingPatientIds.length === 1 && matchingPatientIds[0] === patient.id;
}

function storePatientBrief(patient, briefInput, {
  receivedAt = new Date().toISOString(),
  stale = false,
  channelId = "direct-local-hook",
} = {}) {
  if (!patient) return false;
  const brief = normalizeClinicalPatientBrief(briefInput, patient);
  const previous = connectedPatientBrief(patient);
  if (!brief.items.length) {
    if (!previous) return false;
    patientBriefCache.delete(patient.id);
    briefCache.delete(patient.id);
    return true;
  }
  const next = {
    brief,
    receivedAt: typeof receivedAt === "string" ? receivedAt : new Date().toISOString(),
    stale: stale === true,
    channelId,
  };
  if (previous && clinicalContextFingerprint(previous) === clinicalContextFingerprint(next)) return false;
  patientBriefCache.set(patient.id, next);
  briefCache.delete(patient.id);
  return true;
}

function syncPatientBriefFromCareBridge(bridge = readCareBridge(), patient = selectedPatient()) {
  const current = connectedPatientBrief(patient);
  if (!bridgeMatchesPatient(patient, bridge)) {
    if (!current || current.channelId === "direct-local-hook") return false;
    if (bridge?.channelId === current.channelId) {
      if (current.stale) return false;
      patientBriefCache.set(patient.id, { ...current, stale: true });
      briefCache.delete(patient.id);
      return true;
    }
    patientBriefCache.delete(patient.id);
    briefCache.delete(patient.id);
    return true;
  }
  const shared = bridge?.patient;
  if (!shared?.brief) {
    if (!connectedPatientBrief(patient)) return false;
    patientBriefCache.delete(patient.id);
    briefCache.delete(patient.id);
    return true;
  }
  const patientUpdatedAt = shared.updatedAt ?? shared.brief.preparedAt ?? bridge.updatedAt;
  const currentClinicalFingerprint = careBridgeClinicalFingerprint(bridge.clinical?.snapshot);
  return storePatientBrief(patient, shared.brief, {
    receivedAt: patientUpdatedAt,
    stale: !shared.basedOnClinicalFingerprint
      || shared.basedOnClinicalFingerprint !== currentClinicalFingerprint,
    channelId: bridge.channelId,
  });
}

function renderPatientBriefUpdate() {
  const patient = selectedPatient();
  if (!patient) return;
  const evaluations = claimEvaluations(patient);
  renderCopilot(patient, evaluations);
  renderJourney(patient, briefCache.get(patient.id));
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

function claimEvaluationsForState(stateInput, asOf = today()) {
  const board = buildClaimBoard(stateInput.patients, stateInput.rules, asOf);
  return CLAIM_LANE_ORDER.flatMap((status) => board.lanes[status]);
}

function restoreCopilotEvidenceIds(brief, aliasToEventId, aliasToPatientBriefId = new Map()) {
  const restore = (items) => (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    evidenceEventIds: (Array.isArray(item.evidenceEventIds) ? item.evidenceEventIds : [])
      .map((id) => aliasToEventId.get(id))
      .filter(Boolean),
    patientBriefIds: (Array.isArray(item.patientBriefIds) ? item.patientBriefIds : [])
      .map((id) => aliasToPatientBriefId.get(id))
      .filter(Boolean),
  }));
  return {
    ...brief,
    summary: restore(brief.summary),
    priorities: restore(brief.priorities),
    clinicianQuestions: restore(brief.clinicianQuestions),
    patientQuestions: restore(brief.patientQuestions),
    questions: restore(brief.patientQuestions ?? brief.questions),
    warnings: restore(brief.warnings),
    provenance: (Array.isArray(brief.provenance) ? brief.provenance : []).map((item) => ({
      ...item,
      eventId: aliasToEventId.get(item.eventId) ?? "",
    })).filter(({ eventId }) => eventId),
    patientBriefProvenance: (Array.isArray(brief.patientBriefProvenance) ? brief.patientBriefProvenance : [])
      .map((item) => ({
        ...item,
        id: aliasToPatientBriefId.get(item.id) ?? "",
      }))
      .filter(({ id }) => id),
  };
}

function copilotRequestFingerprint(request) {
  return clinicalContextFingerprint({
    payload: request.payload,
    eventIdentities: [...request.aliasToEventId.entries()],
    patientBriefIdentities: [...(request.aliasToPatientBriefId ?? new Map()).entries()],
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
    const mutated = mutator(base);
    const candidate = reconcileClaimReviews(
      mutated,
      claimEvaluationsForState(mutated),
      new Date().toISOString(),
    );
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
  if (typeof item === "string") {
    return {
      question: item,
      reason: "로컬 모델이 만든 의료진 검토용 질문입니다.",
      evidenceEventIds: [],
      patientBriefIds: [],
    };
  }
  return {
    question: item?.question || item?.title || "확인 질문",
    reason: item?.reason || item?.basis || "",
    evidenceEventIds: Array.isArray(item?.evidenceEventIds) ? item.evidenceEventIds : [],
    patientBriefIds: Array.isArray(item?.patientBriefIds) ? item.patientBriefIds : [],
  };
}

function groundedSources(evidenceEventIds, patientBriefIds, patient, patientBriefProvenance) {
  const eventById = new Map(patient.events.map((event) => [event.id, event]));
  const patientBriefById = new Map((Array.isArray(patientBriefProvenance) ? patientBriefProvenance : [])
    .map((item) => [item.id, item]));
  return {
    chart: [...new Set(evidenceEventIds ?? [])].map((id) => eventById.get(id)).filter(Boolean),
    patient: [...new Set(patientBriefIds ?? [])].map((id) => patientBriefById.get(id)).filter(Boolean),
  };
}

function appendCitationRow(item, sources) {
  const citationRow = element("span", "copilot-citations");
  for (const event of sources.chart.slice(0, 4)) {
    const source = element(
      "small",
      "",
      "확정 차트 · " + [event.label, displayDate(event.date), event.source?.label, event.source?.resourceId].filter(Boolean).join(" · "),
    );
    source.dataset.provenanceKind = "chart";
    citationRow.append(source);
  }
  for (const patientSource of sources.patient.slice(0, 3)) {
    const source = element(
      "small",
      "",
      [patientSource.label, patientSource.observedOn ? displayDate(patientSource.observedOn) : "", "환자보고 · 미검증"].filter(Boolean).join(" · "),
    );
    source.dataset.provenanceKind = "patient";
    citationRow.append(source);
  }
  item.append(citationRow);
}

function appendGroundedItem(
  list,
  text,
  evidenceEventIds,
  patient,
  patientBriefIds = [],
  patientBriefProvenance = [],
) {
  const sources = groundedSources(evidenceEventIds, patientBriefIds, patient, patientBriefProvenance);
  if (!sources.chart.length && !sources.patient.length) return false;
  const item = element("li");
  item.append(document.createTextNode(text));
  appendCitationRow(item, sources);
  list.append(item);
  return true;
}

function appendQuestionItem(list, value, patient, patientBriefProvenance) {
  const question = normalizedQuestion(value);
  const sources = groundedSources(
    question.evidenceEventIds,
    question.patientBriefIds,
    patient,
    patientBriefProvenance,
  );
  if (!sources.chart.length && !sources.patient.length) return false;
  const item = element("li", "copilot-question");
  item.append(
    element("b", "", question.question),
    element("p", "", question.reason),
  );
  appendCitationRow(item, sources);
  list.append(item);
  return true;
}

function renderCopilot(patient, evaluations) {
  const connectedBrief = connectedPatientBrief(patient);
  const brief = briefCache.get(patient.id)
    ?? createLocalCopilotBrief(patient, evaluations, today(), connectedBrief?.brief);
  if (!briefCache.has(patient.id)) briefCache.set(patient.id, brief);
  clear(refs.copilotContent);
  refs.copilotMode.textContent = brief.kind === "model" ? "로컬 AI" : "규칙 기반";
  const patientBriefProvenance = Array.isArray(brief.patientBriefProvenance) ? brief.patientBriefProvenance : [];

  if (connectedBrief?.brief?.items?.length) {
    const bridgeStatus = element("section", "copilot-bridge-status");
    bridgeStatus.dataset.stale = String(connectedBrief.stale === true);
    bridgeStatus.append(
      element("b", "", connectedBrief.stale ? "환자가 공유한 내용 · 다시 확인 필요" : "환자가 공유한 내용 · 로컬 연결"),
      element(
        "span",
        "",
        `${connectedBrief.brief.items.length}개 항목 · 수신 ${displayTimestamp(connectedBrief.receivedAt)} · 환자보고/미검증 · EMR 사실로 저장하지 않음`,
      ),
    );
    refs.copilotContent.append(bridgeStatus);
  }

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

  const questionSection = element("section", "copilot-section copilot-question-section");
  questionSection.append(element("h4", "", "진료 대화 질문 초안"));
  const questionGrid = element("div", "copilot-question-grid");
  const clinicianColumn = element("section", "copilot-question-column copilot-question-column--clinician");
  clinicianColumn.append(
    element("span", "copilot-question-kicker", "ASK THE PATIENT"),
    element("h5", "", "의사가 먼저 물어볼 질문"),
  );
  const clinicianList = element("ol");
  for (const item of brief.clinicianQuestions ?? []) {
    appendQuestionItem(clinicianList, item, patient, patientBriefProvenance);
  }
  if (!clinicianList.childElementCount) {
    clinicianList.append(element("li", "copilot-question copilot-question--empty", "질문을 만들 확정 차트 또는 공유 브리프 근거가 없습니다."));
  }
  clinicianColumn.append(clinicianList);

  const patientColumn = element("section", "copilot-question-column copilot-question-column--patient");
  patientColumn.append(
    element("span", "copilot-question-kicker", "ANTICIPATE"),
    element("h5", "", "환자가 물을 수 있는 질문"),
  );
  const patientList = element("ol");
  for (const item of brief.patientQuestions ?? brief.questions ?? []) {
    appendQuestionItem(patientList, item, patient, patientBriefProvenance);
  }
  if (!patientList.childElementCount) {
    patientList.append(element("li", "copilot-question copilot-question--empty", "예상 질문을 만들 확정 차트 또는 공유 브리프 근거가 없습니다."));
  }
  patientColumn.append(patientList);
  questionGrid.append(clinicianColumn, patientColumn);
  questionSection.append(
    questionGrid,
    element("p", "copilot-question-boundary", "질문 준비용 초안입니다. 증상과 약물의 시간 관계는 확인 질문으로만 제시하며 진단·처방·인과관계를 뜻하지 않습니다."),
  );
  refs.copilotContent.append(questionSection);

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
  if (patientBriefProvenance.length) {
    const labels = [...new Set(patientBriefProvenance.map(({ sourceLabel }) => sourceLabel).filter(Boolean))];
    chips.append(element(
      "span",
      "copilot-provenance__patient",
      `${labels.join(" · ") || "환자 공유 브리프"} ${patientBriefProvenance.length}개 · 미검증`,
    ));
  }
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
    item.dataset.eventId = event.id;
    item.tabIndex = -1;
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

const BODY_AREA_TONES = Object.freeze({
  neuro: "violet",
  mental: "violet",
  sensory: "amber",
  cardio: "coral",
  respiratory: "cyan",
  digestive: "coral",
  endocrine: "amber",
  renal: "cyan",
  pelvic: "violet",
  musculoskeletal: "lime",
  rheumatology: "lime",
  dermatology: "amber",
});
const BODY_TONE_CLASSES = ["tone-coral", "tone-cyan", "tone-lime", "tone-violet", "tone-amber"];

let renderedBodyContext = { atlas: null, patient: null };

function bodyAreaRecordCount(area) {
  return area.visits.length + area.medications.length + area.conditions.length;
}

function bodyAreaStatus(area) {
  const parts = [];
  if (area.declaredVisitCount) parts.push(`진료과 확인 진료 ${area.declaredVisitCount}건`);
  if (area.declaredMedicationCount) parts.push(`확인 진료 처방 ${area.declaredMedicationCount}건`);
  if (area.classifiedVisitCount) parts.push(`진료명 분류 후보 ${area.classifiedVisitCount}건`);
  if (area.classifiedMedicationCount) parts.push(`후보 진료 연결 처방 ${area.classifiedMedicationCount}건`);
  if (area.conditions.length) parts.push(`질환 기반 탐색 신호 ${area.conditions.length}개`);
  if (area.signalOnly) parts.push("진료 이력 없음");
  return parts.join(" · ") || "연결 기록 없음";
}

function bodySourceAction(eventId, label) {
  const button = element("button", "clinical-body-record__action", "차트 기록으로 이동");
  button.type = "button";
  button.dataset.bodySourceEvent = eventId;
  button.setAttribute("aria-label", `${label} 차트 기록으로 이동`);
  return button;
}

function bodySourceSummary(record = {}) {
  const source = record.source ?? {};
  const sourceParts = [
    source.label || "출처 정보 없음",
    source.resourceId || "",
  ].filter(Boolean);
  return `출처 · ${sourceParts.join(" · ")}`;
}

function bodyRecordShell(record, statusText) {
  const item = element("li", "clinical-body-record");
  const top = element("div", "clinical-body-record__top");
  const status = element("span", "clinical-body-record__status", statusText);
  if (record.lifecycle) status.dataset.lifecycle = record.lifecycle;
  top.append(element("b", "", record.label), status);
  item.append(top);
  return item;
}

function renderBodyVisits(area) {
  clear(refs.bodyVisitList);
  const groups = [
    {
      kind: "declared",
      label: "진료과 필드로 확인",
      associationText: "Encounter 진료과 필드에 단일 진료과로 명시",
    },
    {
      kind: "classified",
      label: "진료명 기반 분류 후보 · 진료과 이력 확정 아님",
      associationText: "Encounter 진료명에서 분류한 탐색 후보 · 실제 진료과 배정 아님",
    },
  ];
  for (const group of groups) {
    const visits = area.visits.filter(({ association }) => association.kind === group.kind);
    if (!visits.length) continue;
    refs.bodyVisitList.append(element("li", "clinical-body-list-group-label", group.label));
    for (const visit of visits) {
      const item = bodyRecordShell(visit, visit.lifecycleLabel);
      const visitMeta = [
        displayDate(visit.date),
        visit.department || (visit.association.kind === "classified" ? "진료과 필드 없음" : area.department),
        visit.clinician,
        visit.room,
      ].filter(Boolean).join(" · ");
      item.append(
        element("p", "", visitMeta),
        element("small", "", group.associationText),
        element("small", "clinical-body-record__source", bodySourceSummary(visit)),
        bodySourceAction(visit.id, visit.label),
      );
      refs.bodyVisitList.append(item);
    }
  }
  if (!area.visits.length) {
    refs.bodyVisitList.append(element("li", "clinical-body-empty", "이 영역에 진료과가 확인되거나 분류 후보로 제시된 진료 기록이 없습니다."));
  }
}

function prescriptionSummary(prescription = {}) {
  return [
    prescription.dose ? `1회 ${prescription.dose}${prescription.doseUnit || ""}` : "",
    prescription.route,
    prescription.frequency,
    prescription.durationDays ? `${prescription.durationDays}일` : "",
    prescription.quantity ? `총 ${prescription.quantity}` : "",
    prescription.instructions,
  ].filter(Boolean).join(" · ");
}

function renderBodyMedications(area) {
  clear(refs.bodyMedicationList);
  for (const medication of area.medications) {
    const item = bodyRecordShell(medication, medication.lifecycleLabel);
    const detail = prescriptionSummary(medication.prescription)
      || [medication.code, displayDate(medication.date)].filter(Boolean).join(" · ");
    item.append(
      element("p", "", detail || "처방 상세 없음"),
      element(
        "small",
        "",
        medication.association.encounterAreaKind === "declared"
          ? `Encounter ID ${medication.encounterId}에 직접 연결 · 진료과 필드 확인`
          : `Encounter ID ${medication.encounterId}에 직접 연결 · 진료명 기반 진료과 분류 후보 · 진료과 이력 확정 아님`,
      ),
      element("small", "clinical-body-record__source", bodySourceSummary(medication)),
      bodySourceAction(medication.id, medication.label),
    );
    refs.bodyMedicationList.append(item);
  }
  if (!area.medications.length) {
    refs.bodyMedicationList.append(element("li", "clinical-body-empty", "이 진료과의 진료 ID에 연결된 처방 약물이 없습니다."));
  }
}

function renderBodyConditions(area) {
  clear(refs.bodyConditionList);
  for (const condition of area.conditions) {
    const item = bodyRecordShell(condition, "확정 활성 문제");
    item.append(
      element("p", "", [condition.code || "코드 없음", displayDate(condition.date)].join(" · ")),
      element("small", "", "확정 active 진단의 코드·표시명 기반 탐색 분류 · 진료과 배정 또는 의뢰 판단 아님"),
      element("small", "clinical-body-record__source", bodySourceSummary(condition)),
      bodySourceAction(condition.id, condition.label),
    );
    refs.bodyConditionList.append(item);
  }
  if (!area.conditions.length) {
    refs.bodyConditionList.append(element("li", "clinical-body-empty", "이 영역에 분류된 확정 활성 문제는 없습니다."));
  }
}

function renderClinicalBodyDetail(area) {
  const { atlas } = renderedBodyContext;
  refs.bodyDetailTitle.textContent = area.title;
  refs.bodyDetailDepartment.textContent = area.department;
  refs.bodyDetailCount.textContent = `${bodyAreaRecordCount(area)}건`;
  renderBodyVisits(area);
  renderBodyMedications(area);
  renderBodyConditions(area);
  const exclusions = [
    atlas.totals.unassignedVisits
      ? `진료과가 모호하거나 확인되지 않은 진료 ${atlas.totals.unassignedVisits}건`
      : "",
    atlas.totals.unassignedMedications
      ? `진료과 연결 정보가 없는 약물 ${atlas.totals.unassignedMedications}건`
      : "",
  ].filter(Boolean);
  refs.bodyDetailBoundary.textContent = `${
    exclusions.length
      ? `${exclusions.join("과 ")}은 임의로 배정하지 않아 이 목록에서 제외했습니다. `
      : ""
  }약물은 같은 진료 ID가 있을 때만 해당 영역에 표시합니다. 진료명 기반 후보는 확인된 진료과 이력으로 집계하지 않으며, 질환 기반 탐색 신호는 진료과 배정·의뢰 또는 진료 이력이 아닙니다.`;
}

function syncClinicalBodyControls(area) {
  const { atlas } = renderedBodyContext;
  for (const control of refs.bodyAreaControls) {
    const controlArea = atlas.areas.find(({ id }) => id === control.dataset.bodyArea);
    if (!controlArea) continue;
    const isCurrent = controlArea.id === area.id;
    const tone = BODY_AREA_TONES[controlArea.id] || "cyan";
    control.classList.remove(
      "is-active",
      "is-current",
      "is-care-record",
      "is-classification-candidate",
      "is-candidate-only",
      "is-condition-signal",
      "is-signal-only",
      ...BODY_TONE_CLASSES,
    );
    if (controlArea.active) control.classList.add("is-active", `tone-${tone}`);
    if (controlArea.careActive) control.classList.add("is-care-record");
    if (controlArea.candidateActive) control.classList.add("is-classification-candidate");
    if (controlArea.candidateOnly) control.classList.add("is-candidate-only");
    if (controlArea.signalActive) control.classList.add("is-condition-signal");
    if (controlArea.signalOnly) control.classList.add("is-signal-only");
    if (isCurrent) control.classList.add("is-current", `tone-${tone}`);
    control.setAttribute("aria-pressed", String(isCurrent));
    control.setAttribute(
      "aria-label",
      `${controlArea.department}: ${bodyAreaStatus(controlArea)}${isCurrent ? ". 현재 선택됨" : ". 상세 보기"}`,
    );
    control.title = `${controlArea.department} · ${bodyAreaStatus(controlArea)}`;
    const status = control.querySelector(".body-caption__status");
    if (status) status.textContent = bodyAreaStatus(controlArea);
  }
}

function selectClinicalBodyArea(areaId, focus = false) {
  const { atlas } = renderedBodyContext;
  const area = atlas?.areas.find(({ id }) => id === areaId);
  if (!area) return;
  bodySelectionAreaId = area.id;
  syncClinicalBodyControls(area);
  renderClinicalBodyDetail(area);
  if (focus) {
    refs.bodyAreaControls.find((control) => control.dataset.bodyArea === area.id)?.focus();
  }
}

function preferredClinicalBodyArea(atlas) {
  return atlas.areas.find((area) => area.visits.some(({ lifecycle }) => lifecycle === "draft"))
    || atlas.areas.find((area) => area.visits.length)
    || atlas.areas.find(({ active }) => active)
    || atlas.areas[0];
}

function renderClinicalBody(patient) {
  const atlas = createClinicalBodyAtlas(patient);
  const patientChanged = renderedBodyContext.patient?.id !== patient.id;
  renderedBodyContext = { atlas, patient };
  refs.bodyAreaCount.textContent = `${atlas.totals.careAreas}개`;
  refs.bodyVisitCount.textContent = `${atlas.totals.visits}건`;
  refs.bodyMedicationCount.textContent = `${atlas.totals.medications}건`;
  refs.bodySignalAreaCount.textContent = `${atlas.totals.signalAreas}개`;
  refs.bodyUnassignedMedicationCount.textContent = `${atlas.totals.unassignedMedications}건`;
  const unassignedNotice = [
    atlas.totals.unassignedVisits
      ? `진료과를 확인할 수 없는 진료 ${atlas.totals.unassignedVisits}건`
      : "",
    atlas.totals.unassignedMedications
      ? `진료과를 확인할 수 없는 약물 ${atlas.totals.unassignedMedications}건`
      : "",
  ].filter(Boolean);
  const candidateNotice = atlas.totals.classifiedVisits
    ? ` 진료명 기반 분류 후보 ${atlas.totals.classifiedVisits}건과 연결 처방 ${atlas.totals.classifiedMedications}건은 ${atlas.totals.candidateAreas}개 영역에 이중 윤곽으로 표시하고 확인된 진료과 이력에서 제외했습니다.`
    : "";
  refs.bodyProjectionNotice.textContent = atlas.totals.careAreas
    ? `진료과 필드로 확인된 진료 ${atlas.totals.declaredVisits}건을 ${atlas.totals.careAreas}개 영역에 표시하고, 진료 ID로 연결된 처방 ${atlas.totals.declaredMedications}건을 함께 보여 줍니다.${candidateNotice} 질환 기반 탐색 영역 ${atlas.totals.signalAreas}개는 진료 이력과 분리했습니다.${unassignedNotice.length ? ` ${unassignedNotice.join("과 ")}은 별도로 남겼습니다.` : ""}`
    : `진료과 필드로 확인된 진료는 없습니다.${candidateNotice} 질환 기반 탐색 영역 ${atlas.totals.signalAreas}개는 진료 이력이 아닌 별도 신호로 표시합니다.${unassignedNotice.length ? ` ${unassignedNotice.join("과 ")}은 임의로 배정하지 않았습니다.` : ""}`;
  const selected = patientChanged
    ? preferredClinicalBodyArea(atlas)
    : atlas.areas.find(({ id }) => id === bodySelectionAreaId) || preferredClinicalBodyArea(atlas);
  selectClinicalBodyArea(selected.id);
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

async function moveClaimReview(evaluation, nextStage, inputMethod) {
  if (!evaluation || !CLAIM_REVIEW_STAGE_ORDER.includes(nextStage)) return false;
  const review = resolveClaimReview(state, evaluation);
  const currentStage = review.stage;
  const nextLabel = CLAIM_REVIEW_STAGE_LABELS[nextStage];
  if (currentStage === nextStage) {
    refs.claimBoardLive.textContent = `${evaluation.title} 카드는 이미 ${nextLabel} 단계입니다.`;
    return false;
  }
  const currentLabel = CLAIM_REVIEW_STAGE_LABELS[currentStage];
  const computedLabel = CLAIM_LANE_LABELS[evaluation.status] ?? CLAIM_LANE_LABELS.unknown;
  const detail = `${currentLabel} → ${nextLabel} · 규칙 판정 ${computedLabel} 유지 · ${inputMethod}`;
  try {
    await applyMutation(
      (current) => setClaimReviewStage(
        current,
        evaluation,
        nextStage,
        detail,
        new Date().toISOString(),
      ),
      `${evaluation.title}의 담당자 검토 단계를 '${nextLabel}' 단계로 옮겼습니다. 규칙 판정 '${computedLabel}'은 유지됩니다.`,
      { preserveDraft: false },
    );
    refs.claimBoardLive.textContent = `${evaluation.title} 카드: '${currentLabel}'에서 '${nextLabel}' 단계로 이동했습니다.${review.stale ? " 이전 검토는 자동 판정·근거·규칙 또는 판정일 변경으로 무효화했습니다." : ""} 자동 규칙 판정 '${computedLabel}'은 변경되지 않았습니다.`;
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "담당자 검토 단계를 옮기지 못했습니다.";
    refs.claimBoardLive.textContent = message;
    setStatus(message, "error");
    const patient = selectedPatient();
    if (patient) renderClaimBoard(patient);
    return false;
  }
}

function renderClaimBoard(patient) {
  renderRuleVersions();
  const patients = boardScope === "all" ? state.patients : [patient];
  const board = buildClaimBoard(patients, state.rules, today());
  const evaluations = CLAIM_LANE_ORDER
    .flatMap((status) => board.lanes[status])
    .sort((left, right) => left.patientName.localeCompare(right.patientName, "ko") || left.title.localeCompare(right.title, "ko"));
  claimEvaluationById = new Map(evaluations.map((evaluation) => [evaluation.id, evaluation]));

  clear(refs.claimResultSummary);
  refs.claimResultSummary.setAttribute("role", "list");
  for (const status of CLAIM_LANE_ORDER) {
    const result = element("span", "claim-result-chip");
    result.dataset.status = status;
    result.setAttribute("role", "listitem");
    result.append(
      element("span", "", CLAIM_LANE_LABELS[status]),
      element("b", "", board.lanes[status].length),
    );
    refs.claimResultSummary.append(result);
  }

  const reviewById = new Map(evaluations.map((evaluation) => [evaluation.id, resolveClaimReview(state, evaluation)]));
  const reviewLanes = Object.fromEntries(CLAIM_REVIEW_STAGE_ORDER.map((stage) => [stage, []]));
  for (const evaluation of evaluations) reviewLanes[reviewById.get(evaluation.id).stage].push(evaluation);
  clear(refs.claimBoard);
  for (const stage of CLAIM_REVIEW_STAGE_ORDER) {
    const lane = element("section", "claim-lane");
    const laneTitleId = `claim-review-lane-${stage}`;
    lane.dataset.claimReviewLane = stage;
    lane.setAttribute("aria-labelledby", laneTitleId);
    const header = element("header");
    const heading = element("div", "claim-lane__heading");
    const title = element("h4", "", CLAIM_REVIEW_STAGE_LABELS[stage]);
    title.id = laneTitleId;
    heading.append(
      title,
      element("p", "", stage === "new"
        ? "아직 담당 분류 없음"
        : stage === "evidence"
          ? "차트·청구 근거 수동 대조"
          : stage === "reviewing"
            ? "담당자가 현재 확인 중"
            : "검토 완료 · 급여 확정 아님"),
    );
    header.append(heading, element("span", "", reviewLanes[stage].length));
    lane.append(header);
    const cards = element("div", "claim-lane__cards");
    cards.dataset.claimReviewDropzone = stage;
    for (const [evaluationIndex, evaluation] of reviewLanes[stage].entries()) {
      const review = reviewById.get(evaluation.id);
      const card = element("article", "claim-card");
      const titleId = `claim-card-title-${stage}-${evaluationIndex}`;
      const detailsId = `claim-card-details-${stage}-${evaluationIndex}`;
      const detailTitleId = `claim-card-detail-title-${stage}-${evaluationIndex}`;
      const detailBoundaryId = `claim-card-detail-boundary-${stage}-${evaluationIndex}`;
      card.dataset.status = evaluation.status;
      card.dataset.claimEvaluationId = evaluation.id;
      card.dataset.claimReviewStale = String(review.stale);
      card.dataset.claimDetailOpen = "false";
      card.draggable = true;

      const summary = element("button", "claim-card__summary");
      summary.type = "button";
      summary.dataset.claimDetailToggle = evaluation.id;
      summary.setAttribute("aria-expanded", "false");
      summary.setAttribute("aria-controls", detailsId);
      summary.setAttribute("aria-haspopup", "dialog");
      summary.setAttribute("aria-describedby", "claimBoardInstructions");
      summary.dataset.claimDetailSummary = `${evaluation.title} · 자동 규칙 판정 ${CLAIM_LANE_LABELS[evaluation.status]} · 담당자 검토 ${CLAIM_REVIEW_STAGE_LABELS[stage]}${review.stale ? " · 이전 검토 무효화, 재검토 필요" : ""}`;
      summary.setAttribute("aria-label", `${summary.dataset.claimDetailSummary} · 근거·세부정보 보기`);

      const top = element("span", "claim-card__top");
      const title = element("b", "", evaluation.title);
      title.id = titleId;
      const serviceCode = element("code", "", evaluation.serviceCode);
      serviceCode.title = [evaluation.rule.serviceSystem, evaluation.serviceCode].filter(Boolean).join(" | ");
      const dragHandle = element("span", "claim-drag-handle", "⠿");
      dragHandle.setAttribute("aria-hidden", "true");
      top.append(title, serviceCode, dragHandle);
      summary.append(top);
      const computedStatus = element("span", "claim-computed-status", `자동 판정 · ${CLAIM_LANE_LABELS[evaluation.status]}`);
      computedStatus.dataset.status = evaluation.status;
      summary.append(computedStatus);
      if (review.stale) {
        const stale = element("span", "claim-review-stale");
        stale.append(
          element("b", "", "재검토 필요 · "),
          document.createTextNode(`자동 판정·근거·규칙 또는 판정일이 달라져 이전 '${CLAIM_REVIEW_STAGE_LABELS[review.invalidatedFrom] ?? "검토"}' 단계는 무효화되고 '미분류'로 돌아왔습니다.`),
        );
        summary.append(stale);
      }
      if (boardScope === "all") summary.append(element("span", "claim-patient", evaluation.patientName + " · " + (evaluation.patientMrn || "등록번호 없음")));
      if (evaluation.missingEvidence.length) {
        summary.append(element("span", "claim-missing", "보완 확인 · " + evaluation.missingEvidence.join(", ")));
      }
      const facts = element("span", "claim-facts");
      if (!evaluation.calculationAvailable) {
        facts.append(
          element("span", "", "EMR 자동 집계 · 기간·횟수 미집계"),
          element("span", "", `판정 제외 · ${evaluation.explanation}`),
        );
      } else {
        facts.append(
          element("span", "", `EMR 자동 집계 · 최근 ${evaluation.rule.windowDays}일 · 차트 시행 ${evaluation.usedCount}/${evaluation.rule.maxCount}회`),
          element(
            "span",
            "",
            evaluation.nextEligibleDate
              ? `다음 기준일 ${evaluation.nextEligibleDate}`
              : evaluation.usedCount > 0
                ? `구간 내 마지막 시행 ${evaluation.lastServiceDate} · ${evaluation.daysSinceLastService}일 전`
                : evaluation.lastServiceDate
                  ? `구간 밖 마지막 시행 ${evaluation.lastServiceDate} · 현재 구간 0/${evaluation.rule.maxCount}회`
                  : `차트 시행 기록 없음 · 남은 기준 ${evaluation.remainingCount}회`,
          ),
        );
      }
      summary.append(facts);
      const disclosure = element("span", "claim-card__disclosure");
      disclosure.dataset.claimDetailLabel = "";
      disclosure.textContent = "근거·세부정보 보기";
      summary.append(disclosure);
      card.append(summary);

      const details = document.createElement("dialog");
      details.className = "claim-card__details";
      details.id = detailsId;
      details.setAttribute("role", "dialog");
      details.setAttribute("aria-modal", "true");
      details.setAttribute("aria-labelledby", detailTitleId);
      details.setAttribute("aria-describedby", detailBoundaryId);
      const detailHeader = element("header", "claim-card__details-header");
      const detailHeading = element("div");
      detailHeading.append(
        element("span", "claim-card__details-eyebrow", "CLAIM EVIDENCE"),
      );
      const detailTitle = element("h5", "", evaluation.title);
      detailTitle.id = detailTitleId;
      const detailStatus = element("span", "claim-computed-status", `자동 판정 · ${CLAIM_LANE_LABELS[evaluation.status]}`);
      detailStatus.dataset.status = evaluation.status;
      detailHeading.append(detailTitle, detailStatus);
      const closeDetails = element("button", "clinical-button claim-card__details-close", "닫기");
      closeDetails.type = "button";
      closeDetails.dataset.claimDetailClose = evaluation.id;
      closeDetails.setAttribute("aria-label", `${evaluation.title} 근거·세부정보 닫기`);
      detailHeader.append(detailHeading, closeDetails);

      const detailContent = element("div", "claim-card__details-content");
      const evidenceEvents = evaluation.evidenceEventIds
        .map((id) => state.patients.find((item) => item.id === evaluation.patientId)?.events.find((event) => event.id === id))
        .filter(Boolean);
      const autoCalculation = element("section", "claim-auto-calculation");
      autoCalculation.append(element("b", "", "EMR 기간·횟수 자동 계산"));
      const autoMetrics = element("div", "claim-auto-calculation__metrics");
      const calculationFacts = evaluation.calculationAvailable
        ? [
            ["집계 구간", `${evaluation.windowStart} ~ ${evaluation.windowEnd}`],
            ["시행 횟수", `${evaluation.usedCount}/${evaluation.rule.maxCount}회`],
            [
              "최근 차트 시행",
              evaluation.lastServiceDate
                ? `${evaluation.lastServiceDate} · ${evaluation.daysSinceLastService}일 전 · ${evaluation.usedCount > 0 ? "집계 구간 내" : "집계 구간 밖"}`
                : "확정 기록 없음",
            ],
            ["다음 기준", evaluation.nextEligibleDate || `남은 기준 ${evaluation.remainingCount}회`],
          ]
        : [
            ["자동 계산", "기간·횟수 미집계"],
            ["제외 상태", CLAIM_LANE_LABELS[evaluation.status] ?? "판정 제외"],
          ];
      for (const [label, value] of calculationFacts) {
        const metric = element("span", "claim-auto-calculation__metric");
        metric.append(element("small", "", label), element("strong", "", value));
        autoMetrics.append(metric);
      }
      autoCalculation.append(
        autoMetrics,
        element("p", "claim-auto-calculation__result", evaluation.explanation),
        element(
          "p",
          "",
          evaluation.calculationAvailable
            ? `서명·확정된 EMR의 ${EVENT_LABELS[evaluation.rule.serviceEventType] ?? evaluation.rule.serviceEventType} 기록 중 코드·상태·집계일이 규칙과 일치하는 항목만 자동 계산했습니다.`
            : "규칙 적용 조건이 충족된 경우에만 기간과 횟수를 계산합니다.",
        ),
      );
      const evidence = element("section", "claim-evidence");
      evidence.append(element("b", "", "연결 차트 근거"));
      if (evidenceEvents.length) {
        for (const event of evidenceEvents.slice(0, 5)) {
          evidence.append(element(
            "span",
            "",
            [event.label, event.date, [event.system, event.code].filter(Boolean).join(" | "), event.source?.label, event.source?.resourceId].filter(Boolean).join(" · "),
          ));
        }
      } else {
        evidence.append(element("span", "claim-evidence__empty", "직접 연결된 확정 차트 근거가 없습니다."));
      }
      const detailAside = element("div", "claim-card__details-aside");
      detailAside.append(element(
        "span",
        "claim-rule-version",
        "규칙 " + evaluation.rule.ruleSetId + " · v" + evaluation.rule.version + " · " + evaluation.rule.effectiveFrom + " ~ " + (evaluation.rule.effectiveTo || "현재"),
      ));
      detailAside.append(element("span", "claim-manual-note", "Claim/ClaimResponse 미연결 · 청구·심사 이력 수동 대조"));
      const sourceUrl = safeExternalUrl(evaluation.rule.sourceUrl);
      if (sourceUrl) {
        const source = element("a", "claim-source", evaluation.rule.sourceLabel + " ↗");
        source.href = sourceUrl;
        source.target = "_blank";
        source.rel = "noreferrer";
        source.draggable = false;
        detailAside.append(source);
      } else {
        detailAside.append(element("span", "claim-source", evaluation.rule.sourceLabel));
      }
      const control = element("label", "claim-review-control");
      const selectId = `claim-stage-${stage}-${evaluationIndex}`;
      control.htmlFor = selectId;
      control.append(element("span", "", "담당자 검토 단계"));
      const select = document.createElement("select");
      select.id = selectId;
      select.dataset.claimReviewSelect = evaluation.id;
      select.setAttribute("aria-label", `${evaluation.title} 담당자 검토 단계 이동`);
      for (const optionStage of CLAIM_REVIEW_STAGE_ORDER) {
        const option = document.createElement("option");
        option.value = optionStage;
        option.textContent = CLAIM_REVIEW_STAGE_LABELS[optionStage];
        option.selected = optionStage === stage;
        select.append(option);
      }
      control.append(select);
      detailAside.append(control);
      const detailBoundary = element("p", "claim-detail-boundary", "차트 근거와 규칙은 사전 점검 정보입니다. 의료적 필요를 제한하거나 급여를 확정하지 않으며 청구·심사 이력은 별도로 대조해야 합니다.");
      detailBoundary.id = detailBoundaryId;
      detailContent.append(autoCalculation, evidence, detailAside, detailBoundary);
      details.append(detailHeader, detailContent);
      details.addEventListener("close", () => {
        summary.setAttribute("aria-expanded", "false");
        summary.setAttribute("aria-label", `${summary.dataset.claimDetailSummary} · 근거·세부정보 보기`);
        disclosure.textContent = "근거·세부정보 보기";
        card.dataset.claimDetailOpen = "false";
        refs.claimBoardLive.textContent = `${evaluation.title}의 연결 차트 근거와 규칙 세부정보를 닫았습니다.`;
        summary.focus({ preventScroll: true });
      });
      card.append(details);
      cards.append(card);
    }
    if (!cards.childElementCount) cards.append(createEmptyMessage("카드를 여기에 놓을 수 있습니다.", "claim-empty"));
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

  clear(refs.encounterBodySummary);
  const atlas = createClinicalBodyAtlas(patient);
  const summary = element("div", "body-mini-facts");
  summary.append(
    element("strong", "", `${atlas.totals.careAreas}/12개 영역에 진료 연결`),
    element("span", "", `진료과 확인 진료 ${atlas.totals.declaredVisits}건 · 연결 처방 ${atlas.totals.declaredMedications}건`),
    element(
      "small",
      "",
      [
        atlas.totals.classifiedVisits
          ? `진료명 분류 후보 ${atlas.totals.classifiedVisits}건 · 후보 진료 처방 ${atlas.totals.classifiedMedications}건`
          : "",
        `질환 기반 탐색 영역 ${atlas.totals.signalAreas}개 · 진료 이력과 분리`,
        atlas.totals.unassignedVisits
          ? `진료과 미확인 진료 ${atlas.totals.unassignedVisits}건 미배정`
          : "",
        atlas.totals.unassignedMedications
          ? `진료과 미지정 약물 ${atlas.totals.unassignedMedications}건 미배정`
          : "",
      ].filter(Boolean).join(" · "),
    ),
  );
  refs.encounterBodySummary.append(summary);
}

function reviewValues(items, format, emptyLabel) {
  const list = element("ul", "sign-review__values");
  if (!items.length) list.append(element("li", "sign-review__empty", emptyLabel));
  for (const item of items) list.append(element("li", "", format(item)));
  return list;
}

function sameEncounterSignReviewIdentity(left, right) {
  return Boolean(left
    && right
    && left.patientId
    && left.encounterId
    && left.patientId === right.patientId
    && left.patientMrn === right.patientMrn
    && left.encounterId === right.encounterId);
}

function resetEncounterSignReviewAcknowledgement() {
  reviewedEncounterSignIdentity = null;
  reviewedEncounterSignFingerprint = "";
  refs.encounterSignReviewAcknowledged.checked = false;
}

function renderEncounterSignReview(patient, encounter, records, completed) {
  refs.encounterSignReview.hidden = !completed;
  clear(refs.encounterSignReviewContent);
  if (!completed) {
    resetEncounterSignReviewAcknowledgement();
    refs.encounterSignReviewAcknowledged.disabled = true;
    refs.encounterSignReviewAcknowledgementStatus.textContent = "";
    refs.signEncounter.disabled = true;
    refs.signEncounter.removeAttribute("title");
    return;
  }
  const review = buildEncounterSignReview(patient, encounter, records);
  const activeIdentity = encounterSignReviewIdentity(patient, encounter);
  const activeFingerprint = encounterSignReviewFingerprint(review);
  const blockers = [...review.conflicts, ...review.omissions];
  const acknowledged = sameEncounterSignReviewIdentity(reviewedEncounterSignIdentity, activeIdentity)
    && reviewedEncounterSignFingerprint === activeFingerprint;
  if (!acknowledged) resetEncounterSignReviewAcknowledgement();
  refs.encounterSignReviewAcknowledged.disabled = blockers.length > 0;
  refs.encounterSignReviewAcknowledged.checked = acknowledged;
  refs.signEncounter.disabled = blockers.length > 0 || !acknowledged;
  if (blockers.length) {
    refs.signEncounter.title = `서명 전 누락·충돌 ${blockers.length}건을 먼저 수정하세요.`;
    refs.encounterSignReviewAcknowledgementStatus.textContent = `누락 ${review.omissions.length}건·충돌 ${review.conflicts.length}건을 해결해야 검토를 완료할 수 있습니다.`;
  } else if (!acknowledged) {
    refs.signEncounter.title = "현재 환자·Encounter와 전체 기록을 확인한 뒤 검토 완료를 선택하세요.";
    refs.encounterSignReviewAcknowledgementStatus.textContent = "전체 기록을 확인한 뒤 검토 완료를 선택하면 서명할 수 있습니다.";
  } else {
    refs.signEncounter.removeAttribute("title");
    refs.encounterSignReviewAcknowledgementStatus.textContent = "현재 내용의 검토 완료가 확인됐습니다. 내용이 바뀌면 이 확인은 자동으로 해제됩니다.";
  }
  const identity = element("div", "sign-review__identity");
  identity.append(
    element("strong", "", review.patient.name),
    element("span", "", `MRN ${review.patient.mrn}`),
    element("span", "", `${review.encounter.label} · ${review.encounter.date}`),
    element("span", "", `Encounter ID ${review.encounter.id}`),
    element("span", "", `${review.encounter.department} · ${review.encounter.clinician} · ${review.encounter.room}`),
    element("span", "", `주호소 · ${review.encounter.chiefComplaint}`),
  );
  refs.encounterSignReviewContent.append(identity);

  const alerts = element("section", "sign-review__alerts");
  alerts.setAttribute("aria-label", "서명 전 누락 및 충돌");
  const findings = [
    ...review.conflicts.map((item) => ({ ...item, kind: "충돌" })),
    ...review.omissions.map((item) => ({ ...item, kind: "누락" })),
  ];
  if (!findings.length) alerts.append(element("p", "sign-review__ok", "자동 확인에서 누락·이름 일치 충돌을 찾지 못했습니다. 임상적 안전성을 자동 판정한다는 의미는 아닙니다."));
  for (const finding of findings) {
    const row = element("div", "sign-review__finding");
    row.append(element("p", "", `${finding.kind} · ${finding.message}`));
    const action = element("button", "clinical-button", `${finding.action} — 진료 재개`);
    action.type = "button";
    action.dataset.signReviewTarget = finding.target;
    row.append(action);
    alerts.append(row);
  }
  refs.encounterSignReviewContent.append(alerts);

  const grid = element("div", "sign-review__grid");
  const addGroup = (title, content) => {
    const section = element("section", "sign-review__group");
    section.append(element("h4", "", title), content);
    grid.append(section);
  };
  addGroup("알레르기", reviewValues(review.allergies, (item) => item.label, "기록 없음 · 알레르기 상태를 확인하세요."));
  addGroup("활성 약물", reviewValues(review.activeMedications, (item) => item.label, "활성 약물 기록 없음"));
  addGroup("외부·미검증 알레르기", reviewValues(
    review.unverifiedAllergies,
    (item) => `${item.label} · ${item.source?.label || "출처 미검증"}`,
    "외부·미검증 알레르기 기록 없음",
  ));
  addGroup("외부·미검증 활성 약물", reviewValues(
    review.unverifiedActiveMedications,
    (item) => `${item.label} · ${item.source?.label || "출처 미검증"}`,
    "외부·미검증 활성 약물 기록 없음",
  ));
  addGroup("이번 진료 측정·활력징후", reviewValues(review.measurements, (item) => `${item.label}: ${item.value ?? "—"} ${item.unit ?? ""}`.trim(), "측정 없음"));
  addGroup("새 처방", reviewValues(review.prescriptions, (item) => `${item.label} · ${prescriptionSummary(item.prescription) || "용법 확인 필요"}`, "새 처방 없음"));
  addGroup("SOAP", reviewValues(
    [["S", review.soap.subjective], ["O", review.soap.objective], ["A", review.soap.assessment], ["P", review.soap.plan]],
    ([part, value]) => `${part} · ${String(value ?? "").trim() || "미입력"}`,
    "SOAP 없음",
  ));
  addGroup("KCD 진단", reviewValues(review.diagnoses, (item) => `${item.diagnosisRole === "primary" ? "주" : "부"} · ${item.system || "시스템 없음"} · ${item.code || "코드 없음"} ${item.label}`, "진단 없음"));
  addGroup("오더", reviewValues(review.orders, (item) => `${item.order?.kind || "오더"} · ${item.system || "시스템 없음"} · ${item.code || "코드 없음"} ${item.label}`, "오더 없음"));
  refs.encounterSignReviewContent.append(grid);
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
  renderEncounterSignReview(patient, encounter, records, completed);
  renderWorkflowDisclosureSummaries(encounter, status, records);
  syncWorkflowDisclosures(patient, encounter, status);
  renderEncounterContext(patient, encounter, evaluations);
}

function renderTabs() {
  for (const tab of document.querySelectorAll("[data-tab]")) {
    const selected = tab.dataset.tab === activeTab;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const panel of document.querySelectorAll("[data-panel]")) panel.hidden = panel.dataset.panel !== activeTab;
}

function clearPatientWorkspaceUi() {
  viewedEncounterId = "";
  bodySelectionAreaId = "";
  renderedBodyContext = { atlas: null, patient: null };
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
    refs.encounterBodySummary,
    refs.eventFilters,
    refs.eventTimeline,
    refs.bodyProjectionNotice,
    refs.bodyVisitList,
    refs.bodyMedicationList,
    refs.bodyConditionList,
    refs.claimResultSummary,
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
  syncPatientBriefFromCareBridge(readCareBridge(), patient);
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
  renderClinicalBody(patient);
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
  syncSelectedClinicalSnapshot();
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
    && Array.isArray(candidate.claimReviews)
    && candidate.claimReviews.length === 0
    && Array.isArray(candidate.rules)
    && candidate.rules.every(({ sample }) => sample === true);
}

function adoptClearedEmrState(cleared) {
  stateGeneration += 1;
  state = cleared;
  savedState = cleared;
  briefCache.clear();
  patientBriefCache.clear();
  clearPersonalClinicalSnapshot();
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

function blockUnsafePageExit(event) {
  if (!patientFormHasPendingInput() && !patientContextHasUnsavedInput()) return;
  event.preventDefault();
  event.returnValue = "";
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
  const activeTabButton = byId("tab-" + tab);
  if (focus) activeTabButton?.focus();
  const tabList = activeTabButton?.closest(".workspace-tabs");
  if (!tabList || !activeTabButton || tabList.scrollWidth <= tabList.clientWidth) return;
  const tabStart = activeTabButton.offsetLeft;
  const centered = tabStart - ((tabList.clientWidth - activeTabButton.offsetWidth) / 2);
  tabList.scrollLeft = Math.max(0, Math.min(
    tabList.scrollWidth - tabList.clientWidth,
    centered,
  ));
}

function downloadJson(value, filename) {
  downloadText(JSON.stringify(value, null, 2), filename, "application/json;charset=utf-8");
}

function setPersonalSyncStatus(message, tone = "") {
  refs.personalSyncStatus.textContent = message;
  if (tone) refs.personalSyncStatus.dataset.tone = tone;
  else delete refs.personalSyncStatus.dataset.tone;
}

function clinicalSnapshotFingerprint(snapshot) {
  return clinicalContextFingerprint(comparableClinicalSnapshot(snapshot));
}

function syncSelectedClinicalSnapshot({ announce = false, force = false } = {}) {
  if (personalConnectionSuspended && !force) {
    setPersonalSyncStatus("Personal 연결 해제됨 · “Personal 최신화”를 눌러 다시 연결할 수 있습니다.");
    return null;
  }
  const patient = selectedPatient();
  if (!patient || state.demo || state.storageError) {
    if (announce) {
      setPersonalSyncStatus(
        state.demo
          ? "샘플 환자는 Personal에 연결하지 않습니다."
          : "자동 연결할 로컬 환자를 먼저 선택하세요.",
        state.demo ? "" : "error",
      );
    }
    return null;
  }
  try {
    const snapshot = createClinicalSnapshot(patient, new Date());
    const fingerprint = clinicalSnapshotFingerprint(snapshot);
    const currentBridge = readCareBridge();
    const currentFingerprint = currentBridge?.clinical?.snapshot
      ? clinicalSnapshotFingerprint(currentBridge.clinical.snapshot)
      : "";
    const patientChanged = Boolean(lastPublishedPatientId && lastPublishedPatientId !== patient.id);
    const shouldPublish = force
      || patientChanged
      || lastPublishedPatientId !== patient.id
      || lastPublishedSnapshotFingerprint !== fingerprint
      || currentFingerprint !== fingerprint;
    const bridge = shouldPublish
      ? publishClinicalSnapshot(snapshot, {
        rotateChannel: patientChanged || currentFingerprint !== fingerprint,
      })
      : currentBridge;
    lastPublishedPatientId = patient.id;
    lastPublishedSnapshotFingerprint = fingerprint;
    syncPatientBriefFromCareBridge(bridge, patient);
    const count = snapshot.summary;
    const includedTotal = count.includedConditions
      + count.includedMeasurements
      + count.includedMedications;
    if (includedTotal > 0) {
      setPersonalSyncStatus(
        `Personal 자동 연결 · 확정 질환 ${count.includedConditions}개 · 최종 측정 ${count.includedMeasurements}개 · 서명 처방 ${count.includedMedications}개 · ${displayTimestamp(snapshot.preparedAt)}`,
        "success",
      );
    } else {
      setPersonalSyncStatus("Personal 연결 대기 · 아직 서명·확정된 환자용 항목이 없습니다.");
    }
    if (announce) {
      setStatus(
        includedTotal > 0
          ? "서명된 최종 기록과 처방을 환자용으로 정제해 Personal에 연결했습니다."
          : "연결할 서명·확정 항목이 없어 Personal의 이전 정제 기록을 비웠습니다.",
        "success",
      );
    }
    return bridge;
  } catch (error) {
    setPersonalSyncStatus(
      error instanceof Error ? error.message : "Personal 정제 기록 연결에 실패했습니다.",
      "error",
    );
    return null;
  }
}

function clearPersonalClinicalSnapshot() {
  try {
    const snapshot = createClinicalSnapshot({ events: [] }, new Date());
    publishClinicalSnapshot(snapshot, { rotateChannel: true });
    lastPublishedPatientId = "";
    lastPublishedSnapshotFingerprint = clinicalSnapshotFingerprint(snapshot);
    return true;
  } catch {
    // EMR deletion still completes if local bridge storage is unavailable.
    return false;
  }
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
      refs.aiStatusDetail.textContent = aiCapability.model + " · 질문 초안만 생성 · 외부 전송 없음";
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
  const patientBrief = connectedPatientBrief(patient)?.brief ?? {};
  briefCache.set(patient.id, createLocalCopilotBrief(patient, evaluations, today(), patientBrief));
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
  setStatus("규칙 기반 초안을 먼저 만들었습니다. 직접식별자·자유메모를 제외한 확정 차트와 환자가 공유한 브리프만 로컬 AI에 전달합니다. 외부로 전송하지 않습니다.");
  try {
    const request = createCopilotRequest(patient, evaluations, today(), patientBrief);
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
      ? createCopilotRequest(
        currentPatient,
        claimEvaluations(currentPatient),
        today(),
        connectedPatientBrief(currentPatient)?.brief ?? {},
      )
      : null;
    if (selectedPatient()?.id !== patient.id
      || !currentRequest
      || copilotRequestFingerprint(currentRequest) !== requestFingerprint) {
      throw new Error("차트 또는 급여 기준이 변경되어 오래된 로컬 AI 초안을 폐기했습니다.");
    }
    briefCache.set(
      patient.id,
      restoreCopilotEvidenceIds(result, request.aliasToEventId, request.aliasToPatientBriefId),
    );
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
    queueMicrotask(() => {
      if (refs.encounterSignReviewTitle.getClientRects().length === 0) return;
      refs.encounterSignReviewTitle.focus();
      refs.encounterSignReviewTitle.scrollIntoView({ block: "start" });
    });
  } catch (error) {
    refs.encounterFormMessage.textContent = error instanceof Error ? error.message : "진료 완료 조건을 확인하세요.";
  }
});

refs.encounterSignReviewAcknowledged.addEventListener("change", () => {
  const patient = selectedPatient();
  const encounter = currentEncounter(patient);
  if (!patient || !encounter || encounterQueueStatus(encounter) !== "completed") {
    resetEncounterSignReviewAcknowledgement();
    return;
  }
  const records = getEncounterRecords(patient, encounter.id).slice(1);
  const review = buildEncounterSignReview(patient, encounter, records);
  if (!refs.encounterSignReviewAcknowledged.checked) {
    resetEncounterSignReviewAcknowledgement();
    renderEncounterSignReview(patient, encounter, records, true);
    return;
  }
  try {
    assertEncounterSignReviewReady(review);
    reviewedEncounterSignIdentity = encounterSignReviewIdentity(patient, encounter);
    reviewedEncounterSignFingerprint = encounterSignReviewFingerprint(review);
    refs.encounterFormMessage.textContent = "";
  } catch (error) {
    resetEncounterSignReviewAcknowledgement();
    refs.encounterFormMessage.textContent = error instanceof Error ? error.message : "누락·충돌을 해결한 뒤 검토를 완료하세요.";
  }
  renderEncounterSignReview(patient, encounter, records, true);
});

refs.signEncounter.addEventListener("click", async () => {
  const patient = selectedPatient();
  const encounter = currentEncounter(patient);
  if (!patient || !encounter) return;
  try {
    const review = buildEncounterSignReview(patient, encounter, getEncounterRecords(patient, encounter.id).slice(1));
    assertEncounterSignReviewContext(reviewedEncounterSignIdentity, patient, encounter);
    assertEncounterSignReviewReady(review);
    assertEncounterSignReviewFingerprint(reviewedEncounterSignFingerprint, review);
  } catch (error) {
    refs.encounterFormMessage.textContent = error instanceof Error ? error.message : "현재 기록을 다시 검토한 뒤 서명하세요.";
    return;
  }
  if (!window.confirm("SOAP·측정·진단·처방·오더를 확정하고 로컬 서명할까요? 서명 후 직접 수정할 수 없습니다.")) return;
  try {
    await applyMutation((current) => {
      const activePatient = current.patients.find(({ id }) => id === current.selectedPatientId) ?? null;
      const activeEncounter = activePatient?.events.find(({ id }) => id === encounter.id && id === current.selectedEncounterId) ?? null;
      assertEncounterSignReviewContext(reviewedEncounterSignIdentity, activePatient, activeEncounter);
      const review = buildEncounterSignReview(
        activePatient,
        activeEncounter,
        getEncounterRecords(activePatient, activeEncounter.id).slice(1),
      );
      assertEncounterSignReviewReady(review);
      assertEncounterSignReviewFingerprint(reviewedEncounterSignFingerprint, review);
      return signEncounter(current, patient.id, encounter.id, encounter.clinician);
    }, "진료를 완료·서명했습니다.");
    restoreWorkflowFocus(refs.encounterStatus, "tab-chart");
  } catch (error) {
    refs.encounterFormMessage.textContent = error instanceof Error ? error.message : "진료 서명에 실패했습니다.";
  }
});

refs.encounterSignReview.addEventListener("click", async (event) => {
  const action = event.target.closest?.("[data-sign-review-target]");
  if (!action) return;
  const patient = selectedPatient();
  const encounter = currentEncounter(patient);
  if (!patient || !encounter) return;
  try {
    await applyMutation((current) => reopenEncounter(current, patient.id, encounter.id), "수정을 위해 서명 전 진료를 다시 열었습니다.");
    const target = document.getElementById(action.dataset.signReviewTarget);
    target?.closest("details")?.setAttribute("open", "");
    restoreWorkflowFocus(target, refs.saveEncounterDraft);
  } catch (error) {
    refs.encounterFormMessage.textContent = error instanceof Error ? error.message : "진료를 다시 열지 못했습니다.";
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

for (const control of refs.bodyAreaControls) {
  control.addEventListener("click", () => {
    selectClinicalBodyArea(control.dataset.bodyArea);
    if (control.classList.contains("body-caption") && window.matchMedia("(max-width: 760px)").matches) {
      window.requestAnimationFrame(() => {
        const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
        refs.bodyDetail.scrollIntoView({ behavior, block: "center", inline: "nearest" });
      });
    }
  });
}

refs.bodyDetail.addEventListener("click", (event) => {
  const button = event.target.closest("[data-body-source-event]");
  if (!button) return;
  const patient = selectedPatient();
  const eventId = button.dataset.bodySourceEvent;
  const record = patient?.events.find(({ id }) => id === eventId);
  if (!patient || !record) {
    setStatus("선택한 차트 기록을 찾을 수 없습니다. 신체 지도를 다시 열어 진료과를 선택하세요.", "error");
    return;
  }
  eventFilter = record.type;
  renderTimeline(patient);
  switchTab("chart");
  const target = refs.eventTimeline.querySelector(`[data-event-id="${CSS.escape(record.id)}"]`);
  if (!target) {
    setStatus(`‘${record.label}’ 차트 기록을 현재 필터에서 찾을 수 없습니다.`, "error");
    return;
  }
  target.classList.add("is-source-target");
  target.setAttribute("aria-current", "true");
  target.querySelector(".event-row__body header")?.prepend(element("span", "event-source-target-label", "신체 지도에서 선택한 기록"));
  window.requestAnimationFrame(() => {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    target.scrollIntoView({ behavior, block: "center", inline: "nearest" });
    target.focus({ preventScroll: true });
  });
  setStatus(`‘${record.label}’ 차트 기록으로 이동했습니다. 날짜·코드·출처 식별자를 확인하세요.`, "success");
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
  const openTab = event.target.closest("[data-open-tab]");
  if (openTab) {
    switchTab(openTab.dataset.openTab, true);
    return;
  }
});

for (const disclosure of document.querySelectorAll("details[data-workflow-disclosure]")) {
  disclosure.addEventListener("toggle", () => {
    if (pendingWorkflowDisclosureSync.has(disclosure)
      && pendingWorkflowDisclosureSync.get(disclosure) === disclosure.open) {
      pendingWorkflowDisclosureSync.delete(disclosure);
      return;
    }
    pendingWorkflowDisclosureSync.delete(disclosure);
    const patient = selectedPatient();
    if (!patient) return;
    const encounter = currentEncounter(patient);
    const status = encounterQueueStatus(encounter);
    workflowDisclosureSessionState.set(
      workflowDisclosureKey(disclosure, patient, encounter, status),
      disclosure.open,
    );
  });
}

document.querySelector(".workspace-tabs").addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = [...document.querySelectorAll(".workspace-tabs [role='tab']")];
  const focusedTab = event.target.closest("[data-tab]");
  const focusedIndex = tabs.indexOf(focusedTab);
  const current = focusedIndex >= 0 ? focusedIndex : tabs.findIndex((tab) => tab.dataset.tab === activeTab);
  const next = event.key === "Home"
    ? tabs[0]
    : event.key === "End"
      ? tabs.at(-1)
      : tabs[(current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
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

refs.claimBoard.addEventListener("click", (event) => {
  const close = event.target.closest?.("[data-claim-detail-close]");
  if (close) {
    close.closest("dialog")?.close();
    return;
  }
  const toggle = event.target.closest?.("[data-claim-detail-toggle]");
  if (!toggle) return;
  const evaluationId = toggle.dataset.claimDetailToggle;
  const details = document.getElementById(toggle.getAttribute("aria-controls"));
  const card = toggle.closest("[data-claim-evaluation-id]");
  if (!evaluationId || !details || !card) return;
  if (details.open) {
    details.close();
    return;
  }
  details.showModal();
  toggle.setAttribute("aria-expanded", "true");
  toggle.setAttribute("aria-label", `${toggle.dataset.claimDetailSummary} · 근거·세부정보 열림`);
  card.dataset.claimDetailOpen = "true";
  toggle.querySelector("[data-claim-detail-label]").textContent = "근거·세부정보 열림";
  details.querySelector("[data-claim-detail-close]")?.focus();
  const evaluation = claimEvaluationById.get(evaluationId);
  refs.claimBoardLive.textContent = `${evaluation?.title ?? "급여 항목"}의 연결 차트 근거와 규칙 세부정보를 열었습니다.`;
});

function clearClaimDragState() {
  draggedClaimReviewId = "";
  refs.claimBoard.querySelectorAll(".is-dragging, .is-drop-target").forEach((node) => {
    node.classList.remove("is-dragging", "is-drop-target");
  });
  delete refs.claimBoard.dataset.dragging;
}

refs.claimBoard.addEventListener("dragstart", (event) => {
  const card = event.target.closest?.("[data-claim-evaluation-id]");
  if (!card) return;
  if (event.target.closest?.("a, select, option")) {
    event.preventDefault();
    return;
  }
  draggedClaimReviewId = card.dataset.claimEvaluationId;
  refs.claimBoard.dataset.dragging = "true";
  card.classList.add("is-dragging");
  event.dataTransfer?.setData("text/plain", draggedClaimReviewId);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
});

refs.claimBoard.addEventListener("dragover", (event) => {
  const lane = event.target.closest?.("[data-claim-review-lane]");
  if (!lane || !draggedClaimReviewId) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  refs.claimBoard.querySelectorAll(".is-drop-target").forEach((node) => node.classList.remove("is-drop-target"));
  lane.classList.add("is-drop-target");
});

refs.claimBoard.addEventListener("dragleave", (event) => {
  const lane = event.target.closest?.("[data-claim-review-lane]");
  if (!lane || lane.contains(event.relatedTarget)) return;
  lane.classList.remove("is-drop-target");
});

refs.claimBoard.addEventListener("drop", async (event) => {
  const lane = event.target.closest?.("[data-claim-review-lane]");
  if (!lane) return;
  event.preventDefault();
  const evaluationId = event.dataTransfer?.getData("text/plain") || draggedClaimReviewId;
  const evaluation = claimEvaluationById.get(evaluationId);
  const nextStage = lane.dataset.claimReviewLane;
  clearClaimDragState();
  await moveClaimReview(evaluation, nextStage, "드래그 이동");
  refs.claimBoard
    .querySelector(`[data-claim-evaluation-id="${CSS.escape(evaluationId)}"] [data-claim-detail-toggle]`)
    ?.focus();
});

refs.claimBoard.addEventListener("dragend", clearClaimDragState);

refs.claimBoard.addEventListener("change", async (event) => {
  const select = event.target.closest?.("[data-claim-review-select]");
  if (!select) return;
  const evaluationId = select.dataset.claimReviewSelect;
  const evaluation = claimEvaluationById.get(evaluationId);
  await moveClaimReview(evaluation, select.value, "단계 선택");
  refs.claimBoard.querySelector(`[data-claim-review-select="${CSS.escape(evaluationId)}"]`)?.focus();
});

function loadDemo() {
  if (blockClinicalContextChange({ patientChanged: true })) return;
  state = createDemoEmrState();
  viewedEncounterId = "";
  activeTab = "encounter";
  eventFilter = "all";
  briefCache.clear();
  patientBriefCache.clear();
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
  patientBriefCache.clear();
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
      if (!window.confirm("이 JSON 백업은 암호화·전자서명·원본 기관을 검증하지 않습니다. 복원된 모든 임상 기록은 출처 미검증으로 격리되어 AI·급여 근거·FHIR 내보내기·환자용 정제 연결에서 제외되며, 복원 초안도 로컬 확정·서명할 수 없습니다. 백업의 기관 규칙·감사 이력·담당자 검토 단계도 신뢰하지 않고 복원하지 않습니다. 현재 기록 교체는 별도 백업 없이는 복구할 수 없습니다.")) {
        setStatus("백업 복원을 취소했습니다.");
        return;
      }
      const persistedState = state.demo ? savedState : state;
      const restoredAt = new Date().toISOString();
      let saved;
      if (persistedState.storageError && persistedState.recoveryRaw) {
        let candidate = prepareUnverifiedBackupRestore(parsed, persistedState, restoredAt);
        candidate = { ...candidate, revision: Date.now() * 1_000 };
        candidate = appendStateAudit(candidate, "backup.restored", `환자 ${candidate.patients.length}명`, restoredAt);
        saved = await recoverEmrState(candidate, persistedState.recoveryRaw);
      } else {
        saved = await restoreEmrBackupState(parsed, persistedState, undefined, restoredAt);
      }
      assertCurrentStateGeneration(expectedGeneration);
      state = saved;
      savedState = saved;
      viewedEncounterId = "";
      lastFhirReport = null;
      resetPatientForm();
      briefCache.clear();
      render();
      setStatus("백업의 모든 임상 기록을 출처 미검증 상태로 복원·격리했습니다. 이 로컬 샌드박스에서는 AI·급여·FHIR·환자용 정제 연결·로컬 서명의 근거에서 제외합니다.", "success");
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
refs.syncPersonalRecord.addEventListener("click", () => {
  personalConnectionSuspended = false;
  try {
    localStorage.removeItem(PERSONAL_SYNC_SUSPENDED_KEY);
  } catch {
    // The current tab can still resume even if the preference cannot persist.
  }
  syncSelectedClinicalSnapshot({ announce: true, force: true });
});
refs.disconnectPersonalRecord.addEventListener("click", () => {
  if (!window.confirm("이 브라우저의 Personal 연결 기록과 환자가 공유한 질문을 지울까요? EMR 원본은 삭제되지 않습니다.")) return;
  if (clearPersonalClinicalSnapshot()) {
    personalConnectionSuspended = true;
    try {
      localStorage.setItem(PERSONAL_SYNC_SUSPENDED_KEY, "1");
    } catch {
      // The bridge is already cleared for this tab even if suspension cannot persist.
    }
    setPersonalSyncStatus("Personal 연결을 해제했습니다.");
    setStatus("Personal의 정제 기록과 환자 공유 질문 연결을 지웠습니다.", "success");
  } else {
    setPersonalSyncStatus("Personal 연결을 해제하지 못했습니다.", "error");
    setStatus("이 브라우저의 Personal 연결 저장소를 사용할 수 없습니다.", "error");
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

window.addEventListener("beforeunload", blockUnsafePageExit);

window.addEventListener(CLINICAL_PATIENT_BRIEF_EVENT, (event) => {
  const patient = selectedPatient();
  if (!patient) return;
  const detail = event instanceof CustomEvent ? event.detail : null;
  if (!detail || typeof detail !== "object") return;
  const changed = storePatientBrief(patient, detail.brief ?? detail, {
    receivedAt: detail.receivedAt ?? detail.updatedAt ?? detail.preparedAt,
    stale: detail.stale,
  });
  if (changed) {
    renderPatientBriefUpdate();
    setStatus("환자가 명시적으로 공유한 질문 브리프를 질문 초안에 반영했습니다. EMR 확정 사실로 저장하지 않았습니다.", "success");
  }
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
subscribeCareBridge((bridge) => {
  if (!syncPatientBriefFromCareBridge(bridge)) return;
  renderPatientBriefUpdate();
});
void checkAiStatus();
