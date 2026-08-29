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
  latestFinalAdjudication,
  resolveClaimAdjudicationPresentation,
  resolveClaimPreflightPresentation,
} from "./claim-presentation.js";
import {
  GOLD_COPD_2026_RULESET,
  HIRA_COPD_2026_RULESET,
} from "./copd-assessment.js";
import {
  HIRA_PNEUMONIA_2026_RULESET,
  KDCA_PNEUMONIA_2026_GUIDELINE,
} from "./pneumonia-assessment.js";
import {
  evaluateDiseaseAssessment,
  getCombinedDiseaseClaimProfile,
  getDiseaseAssessmentOptions,
  getDiseaseAssessmentProfiles,
  getPreferredDiseaseAssessmentId,
} from "./disease-assessment.js";
import { createClaimSearchEntry, searchClaimIndex } from "./claim-search.js";
import {
  findOrderInCatalog,
  orderKindLabel,
  searchOrderCatalog,
} from "./order-catalog.js";
import {
  findMedicationInCatalog,
  searchMedicationCatalog,
} from "./medication-catalog.js";
import {
  findDiagnosisInCatalog,
  KCD_SYSTEM,
  preferredDiagnosisCode,
  searchDiagnosisCatalog,
} from "./diagnosis-catalog.js";
import {
  applyMedicationReviewDraft,
  buildMedicationClaimComparison,
  MEDICATION_REVIEW_VERDICTS,
} from "./medication-claim-review.js";
import {
  createPatientTransferPackage,
  patientTransferFilename,
} from "./patient-transfer.js";
import {
  retireLegacyCareBridge,
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
  "claim-review.stage.new": "급여 담당자 검토 · 검토 대기",
  "claim-review.stage.evidence": "급여 담당자 검토 · 자료 확인",
  "claim-review.stage.reviewing": "급여 담당자 검토 · 담당자 검토",
  "claim-review.stage.reviewed": "급여 담당자 검토 · 최종 판정",
  "claim-review.invalidated": "급여 담당자 검토 · 재검토 필요",
  "fhir.imported": "FHIR 가져오기",
  "fhir.exported": "의료기관용 FHIR 내보내기",
  "patient.transfer.exported": "환자용 PolicyCompass 전달",
  "backup.restored": "백업 복원",
  "demo.loaded": "예시 환자 불러오기",
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
  new: "검토 대기",
  evidence: "자료 확인",
  reviewing: "담당자 검토",
  reviewed: "최종 판정",
};
const ENCOUNTER_WORKFLOW_DISCLOSURES = Object.freeze([
  "visit-context",
  "soap",
  "measurements",
  "diagnoses",
  "prescriptions",
  "orders",
]);
/**
 * The encounter tab opens every step so one visit reads as a single page.
 * Collapsing a step still works and is remembered for the rest of the session.
 */
const WORKFLOW_DISCLOSURE_DEFAULTS = Object.freeze({
  none: ENCOUNTER_WORKFLOW_DISCLOSURES,
  waiting: ENCOUNTER_WORKFLOW_DISCLOSURES,
  "in-progress": ENCOUNTER_WORKFLOW_DISCLOSURES,
  completed: ENCOUNTER_WORKFLOW_DISCLOSURES,
  signed: ENCOUNTER_WORKFLOW_DISCLOSURES,
  legacy: ENCOUNTER_WORKFLOW_DISCLOSURES,
  external: ENCOUNTER_WORKFLOW_DISCLOSURES,
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
  selectedPatientConditions: byId("selectedPatientConditions"),
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
  openVitalDialog: byId("openVitalDialog"),
  closeVitalDialog: byId("closeVitalDialog"),
  vitalDialog: byId("vitalDialog"),
  vitalDialogContext: byId("vitalDialogContext"),
  vitalSearchForm: byId("vitalSearchForm"),
  vitalSearchInput: byId("vitalSearchInput"),
  vitalResultList: byId("vitalResultList"),
  vitalResultCount: byId("vitalResultCount"),
  vitalSelectedSummary: byId("vitalSelectedSummary"),
  diagnosisForm: byId("diagnosisForm"),
  diagnosisRole: byId("diagnosisRole"),
  diagnosisCode: byId("diagnosisCode"),
  diagnosisSystem: byId("diagnosisSystem"),
  diagnosisLabel: byId("diagnosisLabel"),
  diagnosisCertainty: byId("diagnosisCertainty"),
  diagnosisList: byId("diagnosisList"),
  openDiagnosisDialog: byId("openDiagnosisDialog"),
  closeDiagnosisDialog: byId("closeDiagnosisDialog"),
  diagnosisDialog: byId("diagnosisDialog"),
  dxDialogContext: byId("dxDialogContext"),
  diagnosisSearchForm: byId("diagnosisSearchForm"),
  diagnosisSearchInput: byId("diagnosisSearchInput"),
  diagnosisResultList: byId("diagnosisResultList"),
  diagnosisResultCount: byId("diagnosisResultCount"),
  diagnosisSelectedSummary: byId("diagnosisSelectedSummary"),
  diagnosisCodeChoices: byId("diagnosisCodeChoices"),
  diagnosisCodeOptions: byId("diagnosisCodeOptions"),
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
  openPrescriptionDialog: byId("openPrescriptionDialog"),
  closePrescriptionDialog: byId("closePrescriptionDialog"),
  prescriptionDialog: byId("prescriptionDialog"),
  rxDialogContext: byId("rxDialogContext"),
  medicationSearchForm: byId("medicationSearchForm"),
  medicationSearchInput: byId("medicationSearchInput"),
  medicationResultList: byId("medicationResultList"),
  medicationResultCount: byId("medicationResultCount"),
  medicationSelectedSummary: byId("medicationSelectedSummary"),
  medicationReviewMode: byId("medicationReviewMode"),
  medicationReviewEmpty: byId("medicationReviewEmpty"),
  medicationReviewBody: byId("medicationReviewBody"),
  medicationReviewVerdict: byId("medicationReviewVerdict"),
  medicationReviewPipeline: byId("medicationReviewPipeline"),
  medicationReviewProcess: byId("medicationReviewProcess"),
  medicationReviewProcessSummary: byId("medicationReviewProcessSummary"),
  medicationReviewSources: byId("medicationReviewSources"),
  orderForm: byId("orderForm"),
  orderKind: byId("orderKind"),
  orderCode: byId("orderCode"),
  orderSystem: byId("orderSystem"),
  orderLabel: byId("orderLabel"),
  orderPriority: byId("orderPriority"),
  orderInstructions: byId("orderInstructions"),
  orderList: byId("orderList"),
  openOrderDialog: byId("openOrderDialog"),
  closeOrderDialog: byId("closeOrderDialog"),
  orderDialog: byId("orderDialog"),
  orderDialogContext: byId("orderDialogContext"),
  orderSearchForm: byId("orderSearchForm"),
  orderSearchInput: byId("orderSearchInput"),
  orderResultList: byId("orderResultList"),
  orderResultCount: byId("orderResultCount"),
  orderSelectedSummary: byId("orderSelectedSummary"),
  encounterClaimSummary: byId("encounterClaimSummary"),
  encounterMobileClaimSummary: byId("encounterMobileClaimSummary"),
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
  claimBoardKpis: byId("claimBoardKpis"),
  claimRuleTrust: byId("claimRuleTrust"),
  claimSearch: byId("claimSearch"),
  claimSearchClear: byId("claimSearchClear"),
  claimSearchSummary: byId("claimSearchSummary"),
  claimSearchResults: byId("claimSearchResults"),
  claimAttentionSummary: byId("claimAttentionSummary"),
  claimAttentionList: byId("claimAttentionList"),
  claimAttentionAllDisclosure: byId("claimAttentionAllDisclosure"),
  claimAttentionAllDisclosureHint: byId("claimAttentionAllDisclosureHint"),
  claimAttentionAllList: byId("claimAttentionAllList"),
  claimAdjudicationSummary: byId("claimAdjudicationSummary"),
  claimAdjudicationList: byId("claimAdjudicationList"),
  diseaseAssessmentTabs: byId("diseaseAssessmentTabs"),
  diseaseAssessmentPanel: byId("diseaseAssessmentPanel"),
  diseaseProgramEyebrow: byId("diseaseProgramEyebrow"),
  diseaseProgramTitle: byId("diseaseProgramTitle"),
  diseaseProgramStatus: byId("diseaseProgramStatus"),
  diseaseProgramIntro: byId("diseaseProgramIntro"),
  diseaseQualitySummary: byId("diseaseQualitySummary"),
  diseaseQualityMetrics: byId("diseaseQualityMetrics"),
  diseaseQualityDisclosure: byId("diseaseQualityDisclosure"),
  diseaseQualityDisclosureHint: byId("diseaseQualityDisclosureHint"),
  diseaseQualityDetails: byId("diseaseQualityDetails"),
  diseaseDiagnosticEyebrow: byId("diseaseDiagnosticEyebrow"),
  diseaseDiagnosticTitle: byId("diseaseDiagnosticTitle"),
  diseaseDiagnosticSummary: byId("diseaseDiagnosticSummary"),
  diseaseDiagnosticDisclosure: byId("diseaseDiagnosticDisclosure"),
  diseaseDiagnosticDisclosureHint: byId("diseaseDiagnosticDisclosureHint"),
  diseaseDiagnosticDetails: byId("diseaseDiagnosticDetails"),
  diseaseAssessmentMeta: byId("diseaseAssessmentMeta"),
  diseaseAssessmentSources: byId("diseaseAssessmentSources"),
  claimBoard: byId("claimBoard"),
  claimReviewDetailHost: byId("claimReviewDetailHost"),
  claimReviewDetailEmpty: byId("claimReviewDetailEmpty"),
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
  ruleSourceDocumentNumber: byId("ruleSourceDocumentNumber"),
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
/**
 * A first visit lands on the sample chart rather than an empty workspace: every
 * patient here is synthetic, and an empty list teaches nothing. A stored chart
 * always wins, and the sample is never written to storage.
 */
let state = new URL(window.location.href).searchParams.get("demo") === "1"
  || (!savedState.patients.length && !savedState.storageError && !savedState.recoveryRaw)
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
let medicationReviewCapability = { checked: false, local: false, frontier: false, model: "" };
let medicationSearchResults = [];
let selectedCatalogMedicationId = "";
const medicationReviewById = new Map();
const medicationReviewBusyIds = new Set();
const expandedMedicationIds = new Set();
const expandedSourceIds = new Set();
let diagnosisSearchResults = [];
let selectedCatalogDiagnosisId = "";
let vitalSearchResults = [];
let orderSearchResults = [];
let selectedCatalogOrderId = "";
let activeMedicationReviewId = "";
let lastFhirReport = null;
let draggedClaimReviewId = "";
let claimEvaluationById = new Map();
let claimAttentionById = new Map();
let claimSearchIndex = [];
let claimSearchEntryById = new Map();
let activeClaimDetailId = "";
const claimDetailMediaQuery = window.matchMedia("(max-width: 900px)");
const briefCache = new Map();
const selectedDiseaseByPatientId = new Map();
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
    if (announce) setStatus(message + (wasDemo ? " · 예시 환자 변경은 저장되지 않습니다." : ""), "success");
  });
}

function createEmptyMessage(text, className = "summary-empty") {
  return element("p", className, text);
}

function updateHorizontalScrollPosition(container) {
  if (!container) return;
  const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);
  const position = maxScroll <= 1
    ? "none"
    : container.scrollLeft <= 1
      ? "start"
      : container.scrollLeft >= maxScroll - 1
        ? "end"
        : "middle";
  container.dataset.scrollPosition = position;
}

function centerSelectedPatientCard(patientId, behavior = "smooth") {
  const button = refs.patientList.querySelector(`[data-patient-id="${CSS.escape(patientId)}"]`);
  const item = button?.closest("li");
  const maxScroll = Math.max(0, refs.patientList.scrollWidth - refs.patientList.clientWidth);
  if (!item || maxScroll <= 1) return;
  const centered = item.offsetLeft - ((refs.patientList.clientWidth - item.offsetWidth) / 2);
  refs.patientList.scrollTo({
    left: Math.max(0, Math.min(maxScroll, centered)),
    behavior,
  });
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
  requestAnimationFrame(() => updateHorizontalScrollPosition(refs.patientList));
}

function isInternalExampleCoding(event = {}) {
  return String(event.code ?? "").toUpperCase().startsWith("DEMO-")
    || String(event.system ?? "").toLowerCase().includes("policycompass:demo");
}

function displayCoding(event = {}) {
  return isInternalExampleCoding(event)
    ? ""
    : [event.system, event.code].filter(Boolean).join(" | ");
}

function confirmedActiveConditions(patient) {
  const chart = finalizedPatient(patient);
  const seen = new Set();
  return (chart?.events ?? [])
    .filter((event) => (
      event.type === "condition"
      && event.recordStatus === "final"
      && event.status === "active"
      && event.certainty === "confirmed"
      && (!event.verificationStatus || event.verificationStatus === "confirmed")
      && !isInternalExampleCoding(event)
    ))
    .sort((left, right) => String(right.date).localeCompare(String(left.date))
      || Number(right.diagnosisRole === "primary") - Number(left.diagnosisRole === "primary"))
    .filter((event) => {
      const key = [event.system, event.code, event.label].filter(Boolean).join("|").toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function renderPatientConditions(patient) {
  const conditions = confirmedActiveConditions(patient);
  clear(refs.selectedPatientConditions);
  refs.selectedPatientConditions.setAttribute(
    "aria-label",
    conditions.length
      ? `확정 활성 질환: ${conditions.map(({ label }) => label).join(", ")}`
      : "확정 활성 질환 없음",
  );
  if (!conditions.length) {
    const empty = element("span", "patient-condition-summary__empty", "확정 활성 질환 없음");
    empty.setAttribute("role", "listitem");
    refs.selectedPatientConditions.append(empty);
    return;
  }
  for (const condition of conditions.slice(0, 2)) {
    const item = element("span", "patient-condition-chip");
    item.setAttribute("role", "listitem");
    item.append(element("strong", "", condition.label));
    if (condition.code) item.append(element("small", "", condition.code));
    refs.selectedPatientConditions.append(item);
  }
  if (conditions.length > 2) {
    const more = element("span", "patient-condition-summary__more", `외 ${conditions.length - 2}개`);
    more.setAttribute("role", "listitem");
    refs.selectedPatientConditions.append(more);
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
  const conditions = confirmedActiveConditions(patient);
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
  const activeConditionIds = new Set(confirmedActiveConditions(patient).map(({ id }) => id));
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
    const events = chart.events.filter((event) => (
      types.includes(event.type)
      && (event.type !== "condition" || activeConditionIds.has(event.id))
    )).slice(0, 4);
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
          element("span", "", [value, displayCoding(event), event.note].filter(Boolean).join(" · ") || EVENT_LABELS[event.type]),
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
  const brief = briefCache.get(patient.id)
    ?? createLocalCopilotBrief(patient, evaluations, today());
  if (!briefCache.has(patient.id)) briefCache.set(patient.id, brief);
  clear(refs.copilotContent);
  refs.copilotMode.textContent = brief.kind === "model" ? "로컬 AI" : "규칙 기반";
  const patientBriefProvenance = Array.isArray(brief.patientBriefProvenance) ? brief.patientBriefProvenance : [];

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
    clinicianList.append(element("li", "copilot-question copilot-question--empty", "질문을 만들 선택 환자의 확정 구조화 차트 근거가 없습니다."));
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
    patientList.append(element("li", "copilot-question copilot-question--empty", "예상 질문을 만들 선택 환자의 확정 구조화 차트 근거가 없습니다."));
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
  if (!attention.length) refs.nextWorkList.append(createEmptyMessage("현재 연결 규칙에서 바로 확인할 작업이 없습니다."));
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
    const codedValue = displayCoding(event);
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

function claimRuleDisplayReference(rule) {
  if (!rule || typeof rule !== "object") return "규칙 식별자 미연결";
  if (rule.sample === true) return rule.sourceDocumentNumber || "기관 내부 규칙";
  return [rule.ruleSetId, rule.version ? `v${rule.version}` : ""].filter(Boolean).join(" · ") || "규칙 식별자 미연결";
}

function renderRuleVersions() {
  clear(refs.ruleVersionList);
  const rules = [...state.rules].sort((left, right) => left.ruleSetId.localeCompare(right.ruleSetId)
    || right.effectiveFrom.localeCompare(left.effectiveFrom));
  for (const rule of rules) {
    const row = element("article", "rule-version-row");
    row.dataset.ruleVersionRow = rule.id;
    const summary = element("div", "rule-version-summary");
    summary.append(
      element("b", "", `${rule.title} · ${claimRuleDisplayReference(rule)}`),
      element(
        "span",
        "",
        rule.sample
          ? ["기관 내부 규칙", rule.sourceDocumentNumber, `${rule.effectiveFrom} ~ ${rule.effectiveTo || "현재"}`, rule.sourceLabel].filter(Boolean).join(" · ")
          : [rule.ruleSetId, rule.sourceDocumentNumber, `${rule.effectiveFrom} ~ ${rule.effectiveTo || "현재"}`, rule.sourceLabel].filter(Boolean).join(" · "),
      ),
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

const CLAIM_ATTENTION_ORDER = Object.freeze({ "high-risk": 0, "needs-review": 1, insufficient: 2, verified: 3 });
const CLAIM_ATTENTION_ICON = Object.freeze({ "high-risk": "!", "needs-review": "!", insufficient: "…", verified: "✓" });
const CLAIM_WORKFLOW_LABELS = Object.freeze({
  DRAFT: "청구 전",
  PERFORMED: "시행됨",
  CLAIMED: "제출됨",
  SUBMITTED: "제출됨",
  ADJUDICATED: "심사 완료",
  "EMR 자동 집계": "EMR 자동 집계",
});
const DEMO_CLAIM_REASON_LABELS = Object.freeze({
  DEMO_REQUIRED_EVIDENCE_VERIFIED: "필요 근거 확인",
  DEMO_TIME_COUNT_PASS: "기간·횟수 사전점검 통과",
  DEMO_RULE_NOT_APPLICABLE: "이 항목에 적용할 규칙 없음",
  DEMO_DIAGNOSTIC_EVIDENCE_MISSING: "COPD 진단 근거 확인 필요",
  DEMO_RECORD_CONTEXT_MISSING: "증상·노출력 기록 확인 필요",
  DEMO_REQUIRED_DATA_MISSING: "필수 자료 부족",
  DEMO_EXTERNAL_PROVENANCE_UNVERIFIED: "타기관 자료 출처·환자 일치 미검증",
  DEMO_CAP_CONTEXT_VERIFIED: "폐렴 진료 맥락 확인",
  DEMO_IV_COURSE_VERIFIED: "정맥 항생제 투여 기간 확인",
  DEMO_IMAGE_REPORT_VERIFIED: "흉부 영상 판독 확인",
  DEMO_REPEAT_IMAGE_INDICATION_NOTE_MISSING: "추적 영상 적응증 기록 확인 필요",
  DEMO_SPECIMEN_TIMING_VERIFIED: "검체 채취 시점 확인",
});

function profileEvidenceSnapshots(profile, item) {
  const context = profile?.clinicalContext && typeof profile.clinicalContext === "object" ? profile.clinicalContext : {};
  const candidates = [
    profile?.admission,
    ...(profile?.diagnoses ?? []),
    ...(profile?.visits ?? []),
    ...(profile?.pftSessions ?? []),
    ...(profile?.medications ?? []),
    ...(context.symptoms ?? []),
    ...(context.chestImaging ?? []),
    ...(profile?.observations ?? []),
    ...(profile?.severityAssessments ?? []),
    ...(profile?.microbiologyOrders ?? []),
    ...(profile?.specimenCollections ?? []),
    ...(profile?.medicationAdministrations ?? []),
  ].filter((record) => record && typeof record === "object" && !Array.isArray(record));
  const candidateById = new Map(candidates.map((record) => [record.id, record]).filter(([id]) => typeof id === "string" && id));
  return (item?.preflight?.evidenceIds ?? []).map((id) => {
    const record = candidateById.get(id);
    if (!record) return null;
    const provenance = record.provenance || record.source || {};
    const rawDate = record.date || record.serviceDate || record.recordedAt || record.prescribedAt || record.arrivedAt
      || record.performedAt || record.administeredAt || record.orderedAt || record.collectedAt || record.assessedAt || "";
    const label = record.label || record.purpose || record.tool || (record.procedureCode ? `검사 ${record.procedureCode}` : "연결 임상 기록");
    return {
      id,
      label,
      date: typeof rawDate === "string" ? rawDate.slice(0, 10) : "",
      sourceId: provenance.sourceId || "",
      sourceLabel: provenance.sourceLabel || provenance.label || "",
      verificationStatus: provenance.verificationStatus || "",
      patientMatch: provenance.patientMatch || "",
      reviewerId: provenance.reviewerId || "",
      verifiedAt: provenance.verifiedAt || "",
      synthetic: provenance.synthetic === true,
    };
  }).filter(Boolean);
}

function profileClaimSourceId(item) {
  const assessmentId = String(item?.assessmentId || "linked-claim").trim().toLowerCase();
  const claimItemId = String(item?.id || "claim-line").trim();
  return `${assessmentId}.${claimItemId}`;
}

function profileClaimRule(item) {
  const assessmentId = String(item?.assessmentId || "linked-claim").trim().toLowerCase();
  const sourceId = String(item?.id || "claim-line").trim();
  const serviceCode = String(item?.code || "UNLINKED").trim();
  return {
    id: `profile-${assessmentId}-${sourceId}`,
    ruleSetId: `PC-PROFILE-${assessmentId.toUpperCase()}`,
    version: "2026.1",
    title: `${item?.label || "청구 항목"} 사전점검`,
    serviceCode,
    serviceSystem: serviceCode.startsWith("DEMO-") ? "urn:policycompass:linked-claim" : "urn:hira:fee-code",
    serviceEventType: "procedure",
    windowDays: 365,
    maxCount: 1,
    dueSoonDays: 30,
    applicabilityCodes: [],
    applicabilitySystem: "",
    requiredEvidence: [],
    requiredEvidenceCodes: [],
    evidenceLabels: {},
    effectiveFrom: "2026-01-01",
    effectiveTo: "",
    sourceLabel: "연결된 청구 line 사전점검 프로필",
    sourceDocumentNumber: `기관 프로필 ${assessmentId.toUpperCase()}`,
    note: "실제 보험자 심사결과가 아닌 연결 자료 기반 사전점검",
    sample: true,
  };
}

function profileClaimEvaluation(patient, item, diseaseProfile = null) {
  const status = item?.preflight?.status;
  const evaluationStatus = status === "GREEN"
    ? "ready"
    : status === "YELLOW" ? "missing-evidence" : "unknown";
  const reasonLabels = (item?.preflight?.reasonCodes ?? [])
    .map((code) => DEMO_CLAIM_REASON_LABELS[code] ?? code);
  const rule = profileClaimRule(item);
  const serviceDate = item?.serviceDate || today();
  const evidenceRecords = profileEvidenceSnapshots(diseaseProfile, item);
  const sourceId = profileClaimSourceId(item);
  return {
    id: `${patient.id}:profile:${sourceId}`,
    sourceKind: "profile",
    sourceId,
    patientId: patient.id,
    patientName: patient.name,
    patientMrn: patient.mrn,
    ruleId: rule.id,
    title: item.label,
    serviceCode: item.code,
    status: evaluationStatus,
    asOf: serviceDate,
    calculationAvailable: status !== "GRAY",
    windowStart: serviceDate,
    windowEnd: serviceDate,
    usedCount: status === "GREEN" ? 1 : 0,
    remainingCount: status === "GREEN" ? 0 : 1,
    serviceEventIds: [],
    lastServiceDate: serviceDate,
    daysSinceLastService: 0,
    nextEligibleDate: "",
    missingEvidence: status === "YELLOW" || status === "RED" ? reasonLabels : [],
    evidenceEventIds: [],
    explanation: item.preflight?.disclaimer ?? "연결 사전점검 자료",
    rule,
    claimContext: {
      assessmentId: item.assessmentId || "",
      claimItemId: item.id,
      serviceDate,
      workflowStatus: item.workflowStatus || "",
      claimUnit: item.claimUnit || null,
      preflightStatus: status || "GRAY",
      riskConfirmed: item?.preflight?.riskConfirmed === true,
      reasonCodes: Array.isArray(item?.preflight?.reasonCodes) ? item.preflight.reasonCodes : [],
      reasonLabels,
      evidenceIds: Array.isArray(item?.preflight?.evidenceIds) ? item.preflight.evidenceIds : [],
      evidenceCount: item?.preflight?.evidenceIds?.length ?? 0,
      evidenceRecords,
      disclaimer: item?.preflight?.disclaimer || "",
      provenance: item?.provenance || null,
      provenanceLabel: item?.provenance?.sourceLabel || item?.provenance?.sourceId || "연결 출처 확인 필요",
    },
  };
}

function claimReviewEvaluationsForPatient(patient) {
  const profile = state.demo ? getCombinedDiseaseClaimProfile(patient) : null;
  const profileItems = Array.isArray(profile?.claimItems) ? profile.claimItems : [];
  const diseaseProfileById = new Map((state.demo ? getDiseaseAssessmentProfiles(patient) : [])
    .map((diseaseProfile) => [diseaseProfile.assessmentId, diseaseProfile]));
  const profileEvaluations = profileItems.map((item) => profileClaimEvaluation(patient, item, diseaseProfileById.get(item.assessmentId)));
  const board = buildClaimBoard([patient], state.rules, today());
  const ruleEvaluations = CLAIM_LANE_ORDER
    .flatMap((status) => board.lanes[status])
    .filter((evaluation) => evaluation.status !== "not-applicable");
  return [...profileEvaluations, ...ruleEvaluations];
}

function claimReviewEvaluationsForPatients(patients) {
  return patients.flatMap((patient) => claimReviewEvaluationsForPatient(patient))
    .sort((left, right) => left.patientName.localeCompare(right.patientName, "ko")
      || left.title.localeCompare(right.title, "ko")
      || String(left.asOf).localeCompare(String(right.asOf)));
}

function demoClaimInput(item) {
  const reason = (item?.preflight?.reasonCodes ?? [])
    .map((code) => DEMO_CLAIM_REASON_LABELS[code] ?? code)
    .join(" · ");
  return {
    claimItemId: item.id,
    riskConfirmed: item?.preflight?.status === "RED" && item?.preflight?.riskConfirmed === true,
    riskEvaluable: item?.preflight?.status !== "GRAY",
    riskReason: reason,
    insufficientReason: item?.preflight?.status === "GRAY" ? reason || item.preflight.disclaimer : "",
    requiredEvidenceVerified: item?.preflight?.status === "GREEN",
    verifiedReason: reason,
    missingData: item?.preflight?.status === "YELLOW" ? (item.preflight.reasonCodes ?? []).map((code) => DEMO_CLAIM_REASON_LABELS[code] ?? code) : [],
  };
}

function claimAttentionEntries(patient, evaluations, profile) {
  const profileItems = Array.isArray(profile?.claimItems) ? profile.claimItems : [];
  const profileEvaluationBySourceId = new Map(evaluations
    .filter(({ sourceKind }) => sourceKind === "profile")
    .map((evaluation) => [evaluation.sourceId, evaluation]));
  const entries = profileItems.map((item) => {
    const evaluation = profileEvaluationBySourceId.get(profileClaimSourceId(item)) || profileClaimEvaluation(patient, item);
    return {
      id: profileClaimSourceId(item),
      workItemId: evaluation.id,
      evaluation,
      title: item.label,
      code: item.code,
      displayCode: String(item.code || "").startsWith("DEMO-") ? "" : item.code,
      date: item.serviceDate,
      dateLabel: "진료일",
      workflowStatus: item.workflowStatus,
      claimUnit: item.claimUnit || null,
      rule: null,
      evidenceCount: item?.preflight?.evidenceIds?.length ?? 0,
      synthetic: true,
      presentation: resolveClaimPreflightPresentation({
        evaluation,
        claimItem: demoClaimInput(item),
      }),
    };
  });
  for (const evaluation of evaluations) {
    if (evaluation.sourceKind === "profile") continue;
    if (evaluation.status === "not-applicable") continue;
    entries.push({
      id: evaluation.id,
      workItemId: evaluation.id,
      evaluation,
      title: evaluation.title,
      code: evaluation.serviceCode,
      displayCode: evaluation.rule?.sample === true ? "" : evaluation.serviceCode,
      date: evaluation.asOf,
      dateLabel: "판정 기준일",
      workflowStatus: "EMR 자동 집계",
      claimUnit: null,
      rule: evaluation.rule,
      evidenceCount: evaluation.evidenceEventIds?.length ?? 0,
      synthetic: evaluation.rule?.sample === true,
      presentation: resolveClaimPreflightPresentation({ evaluation }),
    });
  }
  const ordered = entries.sort((left, right) => CLAIM_ATTENTION_ORDER[left.presentation.state] - CLAIM_ATTENTION_ORDER[right.presentation.state]
    || left.title.localeCompare(right.title, "ko"));
  return ordered;
}

function priorityClaimAttentionEntries(entries) {
  const actionable = entries.filter(({ presentation }) => ["high-risk", "needs-review"].includes(presentation.state));
  return (actionable.length ? actionable : entries).slice(0, 3);
}

function profileClaimUnitLabel(claimUnit) {
  if (!claimUnit || typeof claimUnit !== "object") return "단위 정보 미연결";
  return [
    claimUnit.lineNumber ? `line ${claimUnit.lineNumber}` : "",
    claimUnit.quantity !== undefined && claimUnit.quantity !== null && claimUnit.quantity !== ""
      ? `${claimUnit.quantity}${claimUnit.unit || ""}`
      : claimUnit.unit || "",
  ].filter(Boolean).join(" · ") || "단위 정보 미연결";
}

function claimRequiredActions(evaluation) {
  const actions = [];
  const add = (id, label, completionCriterion) => {
    if (!label || actions.some((item) => item.id === id || item.label === label)) return;
    actions.push({ id, label, completionCriterion });
  };
  if (evaluation.sourceKind === "profile") {
    for (const [index, reason] of (evaluation.claimContext?.reasonLabels ?? []).entries()) {
      add(`profile-reason-${index + 1}`, reason, `${reason} 항목의 원본·기록 위치와 환자 일치 여부가 확인됨`);
    }
    if (evaluation.claimContext?.preflightStatus === "GRAY") {
      add("profile-data-scope", "판정 가능한 자료 범위 확인", "원내·외부 자료의 연결 여부와 판정 제외 사유가 기록됨");
    }
    add("claim-line-context", "진료일·청구 line·상병 연결 대조", "진료일, 청구 단위, 적용 상병이 같은 진료 맥락으로 확인됨");
  } else {
    for (const [index, evidence] of (evaluation.missingEvidence ?? []).entries()) {
      add(`evidence-${index + 1}`, `${evidence} 확인·연결`, `${evidence}의 확정 결과·기록일·출처가 EMR에 연결됨`);
    }
    if (["waiting", "due-soon"].includes(evaluation.status)) {
      add("prior-service", "원내·외부 최근 시행일 확인", "동일 행위의 최근 시행일과 집계 구간 포함 여부가 확인됨");
      add("eligibility-date", "다음 기준일 확인", "다음 적용 가능일과 예외 조건을 담당자가 검토함");
    }
    if (evaluation.status === "ready") {
      add("claim-context", "적용 상병·진료일·청구 line 대조", "현재 규칙과 청구 단위가 같은 진료 맥락으로 확인됨");
    }
    if (evaluation.status === "unknown") {
      add("rule-scope", "규칙 적용기간·필수값 확인", "규칙 버전, 적용일, 환자 조건의 누락 여부가 확인됨");
    }
  }
  add("human-decision", "담당자 의견과 내부 결론 기록", "자동 판정과 별도로 검토자·담당·사유·결론이 이력에 저장됨");
  return actions.slice(0, 5);
}

function appendClaimAttentionEntry(container, entry) {
  const { presentation } = entry;
  const row = element("li", "claim-attention-item");
  row.dataset.claimState = presentation.state;
  const itemSummary = element("button", "claim-attention-item__summary");
  itemSummary.type = "button";
  itemSummary.dataset.claimWorkItemOpen = entry.workItemId;
  itemSummary.setAttribute("aria-label", `${entry.title} · 보험심사팀 검토와 근거 패널 열기`);
  const icon = element("span", "claim-attention-item__mark", CLAIM_ATTENTION_ICON[presentation.state]);
  icon.setAttribute("aria-hidden", "true");
  const meta = [entry.displayCode, entry.date ? `${entry.dateLabel} ${entry.date}` : "진료일 미연결"].filter(Boolean).join(" · ");
  const identity = element("span", "claim-attention-item__identity");
  identity.append(element("strong", "", entry.title));
  if (meta) identity.append(element("small", "", meta));
  itemSummary.append(
    icon,
    identity,
    element("span", "claim-attention-item__status", presentation.label),
    element("span", "claim-attention-item__open", "검토 열기"),
  );
  row.append(itemSummary);
  container.append(row);
}

function renderClaimAttention(patient, evaluations, profile) {
  const entries = claimAttentionEntries(patient, evaluations, profile);
  claimAttentionById = new Map(entries.map((entry) => [entry.workItemId, entry]));
  const priorityEntries = priorityClaimAttentionEntries(entries);
  const priorityIds = new Set(priorityEntries.map(({ id }) => id));
  const otherEntries = entries.filter(({ id }) => !priorityIds.has(id));
  clear(refs.claimAttentionSummary);
  clear(refs.claimAttentionList);
  clear(refs.claimAttentionAllList);
  refs.claimAttentionAllDisclosure.open = false;
  const counts = Object.fromEntries(Object.keys(CLAIM_ATTENTION_ORDER).map((stateName) => [stateName, 0]));
  for (const entry of entries) counts[entry.presentation.state] += 1;

  const summary = element("div", "claim-attention-summary__content");
  const headline = counts["high-risk"]
    ? `내부 규칙상 근거 누락 ${counts["high-risk"]}건을 먼저 확인하세요.`
    : counts["needs-review"]
      ? `급여기준을 확인할 항목 ${counts["needs-review"]}건이 있습니다.`
      : counts.insufficient
        ? `판정 자료를 보완할 항목 ${counts.insufficient}건이 있습니다.`
        : counts.verified
          ? "확인된 자료 범위에서 즉시 발견된 위험은 없습니다."
        : "현재 자료로는 청구 위험을 판정하기 어렵습니다.";
  const countList = element("div", "claim-attention-counts");
  countList.setAttribute("role", "list");
  for (const [stateName, label] of [
    ["high-risk", "내부 규칙상 근거 누락"],
    ["needs-review", "확인 필요"],
    ["insufficient", "자료 부족"],
    ["verified", "등록 규칙 조건 일치"],
  ]) {
    const count = element("span", "claim-attention-count");
    count.dataset.claimState = stateName;
    count.setAttribute("role", "listitem");
    count.append(element("b", "", String(counts[stateName])), element("small", "", label));
    countList.append(count);
  }
  summary.append(element("strong", "", headline), countList);
  refs.claimAttentionSummary.append(summary);

  if (!entries.length) {
    refs.claimAttentionList.hidden = false;
    refs.claimAttentionList.append(element("li", "claim-overview-empty", "연결된 규칙 또는 심사 자료가 없습니다."));
    refs.claimAttentionAllDisclosure.hidden = true;
    return counts;
  }
  refs.claimAttentionList.hidden = priorityEntries.length === 0;
  for (const entry of priorityEntries) appendClaimAttentionEntry(refs.claimAttentionList, entry);
  refs.claimAttentionAllDisclosure.hidden = otherEntries.length === 0;
  refs.claimAttentionAllDisclosureHint.textContent = `${otherEntries.length}건 · 등록 규칙 조건 일치·자료 부족·추가 확인`;
  for (const entry of otherEntries) appendClaimAttentionEntry(refs.claimAttentionAllList, entry);
  return counts;
}

function claimAdjudicationEntries(profile) {
  const items = Array.isArray(profile?.claimItems) ? profile.claimItems : [];
  const adjudications = Array.isArray(profile?.adjudications) ? profile.adjudications : [];
  const scopeKey = (assessmentId, claimItemId) => `${assessmentId || "unscoped"}:${claimItemId}`;
  const itemById = new Map(items.map((item) => [scopeKey(item.assessmentId, item.id), item]));
  const claimItemKeys = [...new Set(adjudications
    .map(({ assessmentId, claimItemId }) => claimItemId ? scopeKey(assessmentId, claimItemId) : "")
    .filter(Boolean))];
  return claimItemKeys.map((claimItemKey) => {
    const [assessmentId, ...claimItemIdParts] = claimItemKey.split(":");
    const claimItemId = claimItemIdParts.join(":");
    const scopedAdjudications = adjudications.filter((item) => scopeKey(item.assessmentId, item.claimItemId) === claimItemKey);
    const adjudication = latestFinalAdjudication(scopedAdjudications, claimItemId);
    if (!adjudication) return null;
    const item = itemById.get(claimItemKey);
    return {
      id: `${assessmentId}:${adjudication.id || claimItemId}`,
      title: item?.label || "연결된 청구 항목",
      code: String(item?.code || "").startsWith("DEMO-") ? "" : item?.code || "",
      serviceDate: item?.serviceDate || "",
      presentation: resolveClaimAdjudicationPresentation(adjudication),
      adjudication,
    };
  }).filter(Boolean).sort((left, right) => String(right.adjudication.decidedAt).localeCompare(String(left.adjudication.decidedAt)));
}

function formatClaimAmount(value, currency = "KRW") {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "금액 미연결";
  return new Intl.NumberFormat("ko-KR", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

function renderClaimAdjudications(profile) {
  const entries = claimAdjudicationEntries(profile);
  if (!refs.claimAdjudicationSummary || !refs.claimAdjudicationList) return entries;
  clear(refs.claimAdjudicationSummary);
  clear(refs.claimAdjudicationList);
  const adjustedCount = entries.filter(({ presentation }) => presentation.state === "adjusted").length;
  refs.claimAdjudicationSummary.append(element(
    "strong",
    "",
    entries.length
      ? `보험자 최종 결과 ${entries.length}건 · 조정 ${adjustedCount}건`
      : "연결된 보험자 최종 결과가 없습니다.",
  ));
  if (!entries.length) {
    refs.claimAdjudicationList.append(element("li", "claim-overview-empty", "심사기관 결과가 연결되면 인정·조정·보류를 여기에 표시합니다."));
    return entries;
  }
  for (const entry of entries) {
    const { adjudication, presentation } = entry;
    const row = element("li", "claim-adjudication-item");
    row.dataset.adjudicationState = presentation.state;
    row.dataset.claimAdjudicationId = entry.id;
    row.tabIndex = -1;
    const heading = element("div", "claim-adjudication-item__heading");
    const identity = element("span", "");
    identity.append(
      element("strong", "", entry.title),
      element("small", "", [entry.code, entry.serviceDate ? `진료일 ${entry.serviceDate}` : "진료일 미연결"].filter(Boolean).join(" · ")),
    );
    heading.append(identity, element("b", "claim-adjudication-item__status", presentation.label));
    const amounts = element("dl", "claim-adjudication-item__amounts");
    for (const [label, value] of [
      ["청구", adjudication.claimedAmount ?? adjudication.originalAmount],
      ["인정", adjudication.allowedAmount],
      ["조정", adjudication.reductionAmount],
    ]) amounts.append(element("dt", "", label), element("dd", "", formatClaimAmount(value, adjudication.currency || "KRW")));
    row.append(
      heading,
      amounts,
      element("p", "", presentation.reason),
      element("small", "claim-adjudication-item__meta", `결정일 ${displayTimestamp(adjudication.decidedAt)} · 출처 ${adjudication.provenance?.sourceLabel || adjudication.sourceId} · 사유코드 ${adjudication.reasonCode}`),
      element("small", "claim-adjudication-item__boundary", presentation.paymentBoundary),
    );
    refs.claimAdjudicationList.append(row);
  }
  return entries;
}

function buildClaimSearchIndex(patient, evaluations, profile) {
  const entries = [];
  for (const evaluation of evaluations) {
    entries.push(createClaimSearchEntry({
      id: `workflow:${evaluation.id}`,
      kind: "workflow",
      domain: "claim",
      title: evaluation.title,
      subtitle: `${evaluation.patientName} · ${evaluation.asOf || "판정일 미연결"} · ${CLAIM_LANE_LABELS[evaluation.status] || "기준 확인"}`,
      searchText: [
        evaluation.patientName,
        evaluation.patientMrn,
        evaluation.serviceCode,
        evaluation.rule?.title,
        evaluation.rule?.ruleSetId,
        evaluation.rule?.sourceLabel,
        evaluation.rule?.sourceDocumentNumber,
        evaluation.explanation,
        evaluation.sourceKind === "profile" ? profileClaimUnitLabel(evaluation.claimContext?.claimUnit) : "",
        ...(evaluation.missingEvidence ?? []),
        ...(evaluation.claimContext?.evidenceRecords ?? []).flatMap(({ id, label, sourceId, sourceLabel }) => [id, label, sourceId, sourceLabel]),
        ...claimRequiredActions(evaluation).flatMap(({ label, completionCriterion }) => [label, completionCriterion]),
      ].filter(Boolean).join(" "),
      target: { targetType: "workflow", evaluationId: evaluation.id },
    }));
  }
  for (const entry of claimAdjudicationEntries(profile)) {
    entries.push(createClaimSearchEntry({
      id: `adjudication:${entry.id}`,
      kind: "adjudication",
      domain: "adjudication",
      title: entry.title,
      subtitle: `${entry.presentation.label} · ${entry.serviceDate || "진료일 미연결"}`,
      searchText: [entry.code, entry.adjudication.reasonCode, entry.adjudication.sourceId, entry.adjudication.provenance?.sourceLabel, entry.presentation.reason].filter(Boolean).join(" "),
      target: { targetType: "adjudication", adjudicationId: entry.id },
    }));
  }
  for (const option of state.demo ? getDiseaseAssessmentOptions(patient) : []) {
    const assessment = evaluateDiseaseAssessment(patient, option.id);
    if (!assessment) continue;
    for (const metric of assessment.quality?.metrics ?? []) {
      entries.push(createClaimSearchEntry({
        id: `quality:${patient.id}:${option.id}:${metric.id}`,
        kind: "quality",
        domain: "quality",
        title: `${option.label} · ${metric.label || metric.title || metric.id}`,
        subtitle: `${QUALITY_METRIC_STATUS[metric.status]?.label || "자료 확인"} · 기관 질 평가 예상`,
        searchText: [patient.name, patient.mrn, option.shortLabel, option.description, metric.observedLabel, metric.displayValue, metric.reason, ...(metric.evidence ?? [])].filter(Boolean).join(" "),
        target: { targetType: "quality", diseaseId: option.id, metricId: metric.id },
      }));
    }
  }
  for (const rule of state.rules) {
    entries.push(createClaimSearchEntry({
      id: `rule:${rule.id}`,
      kind: "rule",
      domain: "rule",
      title: rule.title,
      subtitle: [rule.sourceDocumentNumber || "고시·문서번호 미연결", rule.sample ? "기관 내부 규칙" : `v${rule.version}`, `적용 ${rule.effectiveFrom}–${rule.effectiveTo || "현재"}`].join(" · "),
      searchText: [rule.ruleSetId, rule.serviceCode, rule.serviceSystem, rule.sourceLabel, rule.sourceDocumentNumber, rule.note].filter(Boolean).join(" "),
      target: { targetType: "rule", ruleId: rule.id },
    }));
  }
  return entries.filter(Boolean);
}

function renderClaimSearchResults() {
  if (!refs.claimSearch || !refs.claimSearchResults || !refs.claimSearchSummary) return;
  const query = refs.claimSearch.value;
  const results = searchClaimIndex(claimSearchIndex, query, 12);
  clear(refs.claimSearchResults);
  refs.claimSearchClear.hidden = !query.trim();
  if (!query.trim()) {
    refs.claimSearchResults.hidden = true;
    refs.claimSearchSummary.textContent = "환자, 청구 항목, 실제 심사 결과, 적정성 지표와 규칙을 함께 찾습니다.";
    return;
  }
  refs.claimSearchResults.hidden = false;
  refs.claimSearchSummary.textContent = results.length
    ? `검색 결과 ${results.length}건 · 업무 항목을 선택하면 같은 카드와 근거 패널로 이동합니다.`
    : "일치하는 급여 업무가 없습니다. 환자명, 코드, 검사·약제명 또는 고시·문서번호를 확인해 주세요.";
  const domainLabel = { claim: "청구·Workflow", workflow: "Workflow", adjudication: "심사 결과", quality: "적정성 평가", rule: "규칙" };
  for (const result of results) {
    const item = element("li", "claim-search-result");
    const button = element("button", "");
    button.type = "button";
    button.dataset.claimSearchResult = result.id;
    button.append(
      element("strong", "claim-search-result__title", result.title),
      element("span", "claim-search-result__type", domainLabel[result.domain] || result.kind),
      element("small", "claim-search-result__meta", result.subtitle),
    );
    item.append(button);
    refs.claimSearchResults.append(item);
  }
}

function renderClaimSearch(patient, evaluations, profile) {
  claimSearchIndex = buildClaimSearchIndex(patient, evaluations, profile);
  claimSearchEntryById = new Map(claimSearchIndex.map((entry) => [entry.id, entry]));
  renderClaimSearchResults();
}

function renderClaimBoardKpis(counts, quality) {
  if (!refs.claimBoardKpis) return;
  clear(refs.claimBoardKpis);
  const metrics = Array.isArray(quality?.metrics) ? quality.metrics : [];
  const included = metrics.filter(({ status }) => status === "included").length;
  const applicable = metrics.filter(({ status }) => status !== "not-applicable").length;
  for (const [state, label, value, description] of [
    ["high-risk", "청구 고위험", counts["high-risk"] ?? 0, "청구 전 점검"],
    ["needs-review", "확인 필요", counts["needs-review"] ?? 0, "급여조건·기록"],
    ["insufficient", "자료 보완", counts.insufficient ?? 0, "판정 불가 포함"],
    ["quality", "적정성 지표", applicable ? `${included}/${applicable}` : "—", "기관 평가 예상"],
  ]) {
    const item = element("div", "claim-board-kpi");
    item.dataset.claimKpi = state;
    item.append(element("span", "", label), element("strong", "", value), element("small", "", description));
    refs.claimBoardKpis.append(item);
  }
}

function renderClaimRuleTrust(evaluations) {
  if (!refs.claimRuleTrust) return;
  clear(refs.claimRuleTrust);
  const rules = [...new Map(evaluations.map(({ rule }) => [rule?.id, rule]).filter(([id]) => id)).values()];
  const latest = rules[0];
  const identity = element("div", "");
  identity.append(
    element("span", "claim-rule-trust__label", "판정 기준"),
    element("strong", "", latest ? `${latest.title} · ${claimRuleDisplayReference(latest)}` : "연결된 급여 규칙 확인 필요"),
    element("small", "", latest
      ? [`적용 ${latest.effectiveFrom}–${latest.effectiveTo || "현재"}`, `산출 ${displayDate(today())}`, latest.sourceDocumentNumber ? `고시·문서번호 ${latest.sourceDocumentNumber}` : "고시·문서번호 미연결", `출처 ${latest.sourceLabel}`, latest.sample ? "기관 내부 규칙" : "공식 출처 연결"].join(" · ")
      : "규칙 버전·적용일·출처를 연결한 뒤 판정할 수 있습니다."),
  );
  const boundary = element("p", "");
  boundary.append(
    element("b", "", "판정 경계 "),
    document.createTextNode("자동 규칙은 검토 대상을 제안합니다. 청구 전 예상, 실제 심사 결과, 기관 적정성 평가는 서로 대체하지 않으며 최종 적용은 담당자가 결정합니다."),
  );
  const link = element("a", "claim-rule-trust__link", "규칙 버전 관리");
  link.href = "#ruleVersionManager";
  refs.claimRuleTrust.append(
    identity,
    boundary,
    link,
  );
}

const QUALITY_METRIC_STATUS = Object.freeze({
  included: { label: "충족 예상", icon: "✓" },
  "not-included": { label: "미충족 예상", icon: "!" },
  insufficient: { label: "자료 확인 필요", icon: "…" },
  "not-applicable": { label: "평가대상 제외 가능", icon: "—" },
});

function qualityObservedLabel(metric) {
  if (typeof metric.displayValue === "string" && metric.displayValue.trim()) return metric.displayValue;
  if (typeof metric.observedLabel === "string" && metric.observedLabel.trim()) return metric.observedLabel;
  if (!Number.isFinite(Number(metric.observed))) return "자료 확인";
  if (metric.id === "continuing-visits") return `${metric.observed}회`;
  return `${metric.observed}건`;
}

function appendSourceLink(container, rule) {
  const href = safeExternalUrl(rule?.sourceUrl);
  if (!href) return;
  const link = element("a", "quality-source-link", `${rule.sourceLabel} ↗`);
  link.href = href;
  link.target = "_blank";
  link.rel = "noreferrer";
  container.append(link);
}

function metricReferenceLabel(metric, diseaseId) {
  const parts = [];
  if (Number.isFinite(metric.weight)) {
    parts.push(diseaseId === "copd" ? `지표 가중치 ${metric.weight}%` : `공식 상대가중치 ${metric.weight}`);
  }
  if (Number.isFinite(metric.minimum)) parts.push(`기준 ${metric.minimum}회 이상`);
  if (metric.denominatorIncluded === false) parts.push("이번 사례는 지표 분모 제외");
  return parts.join(" · ") || "공식 기준과 연결 자료 대조";
}

function qualityTargetHeadline(quality) {
  const includedCount = quality.metrics.filter(({ status }) => status === "included").length;
  const applicableCount = quality.metrics.filter(({ status }) => status !== "not-applicable").length;
  const excludedCount = quality.metrics.length - applicableCount;
  const countLabel = excludedCount
    ? `평가 분모 ${applicableCount}개 중 ${includedCount}개 충족 예상 · ${excludedCount}개 분모 제외`
    : `${quality.metrics.length}개 지표 중 ${includedCount}개 충족 예상`;
  if (quality.target.status === "eligible") return `평가대상 예상 · ${countLabel}`;
  if (quality.target.status === "insufficient") return "평가대상 여부를 판단할 자료가 부족합니다.";
  return "현재 연결 자료에서는 평가대상으로 예상되지 않습니다.";
}

function qualityTargetDetail(quality, diseaseId) {
  const target = quality.target;
  const labels = [
    `평가기간 ${quality.period.start}~${quality.period.end}`,
    `만 ${target.ageYears ?? "?"}세`,
    `상병 ${target.diagnosisCode || "확인 안 됨"}`,
  ];
  if (diseaseId === "pneumonia") {
    labels.push(`정맥 항생제 ${target.ivAntibioticDays ?? "?"}일`, `기관 ${target.institutionType || "확인 안 됨"}`);
  }
  return labels.join(" · ");
}

function renderDiseaseQuality(quality, profile, program) {
  clear(refs.diseaseQualitySummary);
  clear(refs.diseaseQualityMetrics);
  clear(refs.diseaseQualityDetails);
  const summary = element("div", "quality-program-summary__content");
  summary.dataset.status = quality.target.status;
  const includedCount = quality.metrics.filter(({ status }) => status === "included").length;
  const applicableCount = quality.metrics.filter(({ status }) => status !== "not-applicable").length;
  const score = element("span", "quality-program-score");
  score.append(element("b", "", `${includedCount}/${applicableCount}`), element("small", "", "지표 충족 예상"));
  const copy = element("span", "quality-program-summary__copy");
  copy.append(element("strong", "", qualityTargetHeadline(quality)));
  const exceptions = quality.metrics.filter(({ status }) => ["not-included", "insufficient"].includes(status));
  if (exceptions.length) {
    copy.append(element("p", "quality-program-summary__exceptions", `확인할 지표 · ${exceptions.map(({ label }) => label).join(" · ")}`));
  }
  summary.append(score, copy);
  refs.diseaseQualitySummary.append(summary);

  for (const metric of quality.metrics) {
    const status = QUALITY_METRIC_STATUS[metric.status] ?? QUALITY_METRIC_STATUS.insufficient;
    const card = element("details", "quality-program-metric");
    card.dataset.metricStatus = metric.status;
    card.dataset.qualityMetricId = metric.id;
    const metricSummary = element("summary", "quality-program-metric__summary");
    const label = element("span", "quality-program-metric__label");
    label.append(element("b", "", metric.label), element("small", "quality-program-metric__status", status.label));
    metricSummary.append(
      element("span", "quality-program-metric__mark", status.icon),
      label,
      element("strong", "quality-program-metric__value", qualityObservedLabel(metric)),
    );
    const detail = element("div", "quality-program-metric__detail");
    detail.append(
      element("small", "", metricReferenceLabel(metric, program.id)),
      element("p", "", metric.reason),
    );
    card.append(metricSummary, detail);
    refs.diseaseQualityMetrics.append(card);
  }

  const target = element("section", "quality-detail-section");
  target.append(
    element("h5", "", "평가대상 예상 근거"),
    element("p", "", quality.target.reason),
    element("p", "", qualityTargetDetail(quality, program.id)),
  );
  const codeBoundary = element("section", "quality-detail-section quality-detail-section--boundary");
  codeBoundary.append(element("h5", "", "코드·판정 경계"));
  if (program.id === "copd") {
    codeBoundary.append(element("p", "", `PFT 코드는 ${HIRA_COPD_2026_RULESET.pftCodes.join(", ")}를 확인합니다. 타기관 검사는 출처·환자 일치·검토자·검증 시각이 모두 확인된 경우에만 기여 근거로 사용합니다.`));
  } else {
    codeBoundary.append(
      element("p", "", "병원급 이상에서 만 18세 이상 지역사회획득 폐렴 입원, 주상병·제1부상병, 정맥 항생제 3일 이상을 환자 단위로 확인합니다."),
      element("p", "", "혈액배양을 시행하지 않은 사례는 이 과정지표의 실패가 아니라 환자 분모 제외로 표시합니다."),
    );
  }
  codeBoundary.append(element("p", "", quality.disclaimer));
  appendSourceLink(codeBoundary, quality.rule);
  refs.diseaseQualityDetails.append(target, codeBoundary);
}

function copdDiagnosticHeadline(diagnostic) {
  if (diagnostic.status === "matched-repeat-confirmed") return "별도 시점 검사에서도 폐활량측정 기준이 반복 확인됐습니다.";
  if (diagnostic.status === "matched-repeat-pending") return "이번 검사에서 기준 일치 · 별도 시점 반복확인이 필요합니다.";
  if (diagnostic.status === "clinician-review") return "별도 시점 검사 결과가 달라 의료진 검토가 필요합니다.";
  if (diagnostic.status === "not-matched-repeat-pending") return "이번 값은 기준에 일치하지 않지만 반복확인 범위에 있습니다.";
  if (diagnostic.status === "criterion-not-demonstrated") return "현재 검증 자료에서는 폐활량측정 기준이 확인되지 않았습니다.";
  if (diagnostic.status === "matched") return "이번 검사에서 폐활량측정 기준에 일치합니다.";
  return "진단 근거 정합성을 판단할 자료가 부족합니다.";
}

function diagnosticAxis(label, status, value) {
  const item = element("div", "quality-diagnostic-axis");
  item.dataset.axisStatus = status;
  item.append(element("small", "", label), element("strong", "", value));
  return item;
}

function renderCopdDiagnostic(diagnostic, profile) {
  refs.diseaseDiagnosticDisclosureHint.textContent = copdDiagnosticHeadline(diagnostic);
  const summary = element("div", "quality-diagnostic-summary__content");
  summary.dataset.status = diagnostic.status;
  summary.append(element("strong", "", copdDiagnosticHeadline(diagnostic)));
  const axes = element("div", "quality-diagnostic-axes");
  axes.append(
    diagnosticAxis("임상 맥락", diagnostic.clinicalContext.status, diagnostic.clinicalContext.status === "documented" ? "기록 확인" : "자료 부족"),
    diagnosticAxis("post-BD 기준", diagnostic.criterion.status, diagnostic.criterion.status === "matched" ? "< 0.70 일치" : diagnostic.criterion.status === "not-matched" ? "≥ 0.70" : "판정 불가"),
    diagnosticAxis("반복 확인", diagnostic.repeatConfirmation.status, diagnostic.repeatConfirmation.status === "confirmed" ? "별도 시점 확인" : diagnostic.repeatConfirmation.status === "pending" ? "대기" : diagnostic.repeatConfirmation.status === "clinician-review" ? "의료진 검토" : "해당 상태 확인"),
    diagnosticAxis("의료진 진단", diagnostic.clinicianDiagnosis.status, diagnostic.clinicianDiagnosis.status === "documented" ? "기록 있음" : "기록 없음"),
  );
  summary.append(axes, element("p", "quality-diagnostic-boundary", diagnostic.disclaimer));
  refs.diseaseDiagnosticSummary.append(summary);

  const calculation = element("section", "quality-detail-section");
  calculation.append(element("h5", "", "post-BD 계산과 엄격한 경계"));
  if (diagnostic.criterion.latestRatio !== null) {
    calculation.append(
      element("p", "quality-highlight-result", `FEV₁/FVC ${diagnostic.criterion.displayRatio} ${diagnostic.criteriaMatch ? "<" : "≥"} 0.70`),
      element("p", "", `검사 ${diagnostic.criterion.sessionDate} · 세션 ${diagnostic.criterion.sessionId} · ${diagnostic.criterion.basis === "reported-ratio" ? "보고 비율" : "같은 세션 FEV₁÷FVC 계산"}`),
    );
  } else {
    calculation.append(element("p", "", diagnostic.criterion.reason));
  }
  calculation.append(element("p", "", "정확히 0.70은 ‘< 0.70’에 해당하지 않습니다. 화면 반올림값이 아니라 원시 비율로 판정합니다."));

  const repeat = element("section", "quality-detail-section");
  repeat.append(element("h5", "", "별도 시점 반복확인"), element("p", "", diagnostic.repeatConfirmation.reason));
  if (diagnostic.sessions.length) {
    const list = element("ol", "quality-evidence-list");
    for (const [index, session] of diagnostic.sessions.entries()) {
      const item = element("li");
      const ratio = session.ratio === null ? "비율 판정 불가" : `post-BD ${session.ratio.toFixed(3)}`;
      item.append(
        element("b", "", `${index + 1}차 · ${session.date || "날짜 없음"} · ${ratio}`),
        element("span", "", session.valid ? `${session.id} · 출처·품질 확인` : session.reasons.join(" · ")),
      );
      list.append(item);
    }
    repeat.append(list);
  }
  if (profile?.scenario?.kind === "NORMAL_STAGED") {
    repeat.append(element("p", "quality-stage-note", "1차 0.640만 있을 때는 ‘기준 일치 + 반복확인 대기’였고, 별도 날짜의 2차 0.650이 연결된 뒤 ‘반복 확인’으로 바뀐 변화 흐름입니다."));
  }

  const context = element("section", "quality-detail-section");
  const symptomText = diagnostic.clinicalContext.symptoms.length ? diagnostic.clinicalContext.symptoms.join(", ") : "확인 안 됨";
  const exposure = diagnostic.clinicalContext.exposure;
  context.append(
    element("h5", "", "임상 맥락과 최종 판단"),
    element("p", "", `증상: ${symptomText}`),
    element("p", "", exposure ? `노출력: ${exposure.kind === "TOBACCO" ? "흡연" : exposure.kind}${exposure.packYears ? ` ${exposure.packYears}갑년` : ""}` : "노출력: 확인 안 됨"),
    element("p", "", diagnostic.clinicianDiagnosis.reason),
    element("p", "", "수치만으로 진단명을 자동 입력·삭제하지 않으며 천식·기관지확장증 등 다른 원인은 의료진이 함께 판단합니다."),
  );
  appendSourceLink(context, diagnostic.rule);
  refs.diseaseDiagnosticDetails.append(calculation, repeat, context);
}

function pneumoniaDiagnosticHeadline(diagnostic) {
  if (diagnostic.status === "supported") return "영상·감염 근거·지역사회 발생 맥락과 의료진 진단이 함께 확인됩니다.";
  if (diagnostic.status === "clinician-review") return "임상 근거는 연결됐지만 의료진의 최종 폐렴 진단 기록을 확인해야 합니다.";
  if (diagnostic.status === "outside-cap-scope") return "지역사회획득 폐렴 범위와 맞지 않아 의료진의 재확인이 필요합니다.";
  return "폐렴 진단 근거 정합성을 확인할 자료가 더 필요합니다.";
}

function axisValue(status, supported, missing, mismatch) {
  if (["documented", "supported", "matched", "confirmed"].includes(status)) return supported;
  if (["not-demonstrated", "outside-scope", "not-matched"].includes(status)) return mismatch;
  return missing;
}

function renderPneumoniaDiagnostic(diagnostic) {
  refs.diseaseDiagnosticDisclosureHint.textContent = pneumoniaDiagnosticHeadline(diagnostic);
  const summary = element("div", "quality-diagnostic-summary__content");
  summary.dataset.status = diagnostic.status;
  summary.append(element("strong", "", pneumoniaDiagnosticHeadline(diagnostic)));
  const axes = element("div", "quality-diagnostic-axes");
  axes.append(
    diagnosticAxis("흉부 영상", diagnostic.imaging.status, axisValue(diagnostic.imaging.status, "새 침윤 확인", "판독 확인 필요", "새 침윤 없음")),
    diagnosticAxis("감염 근거", diagnostic.infectionEvidence.status, axisValue(diagnostic.infectionEvidence.status, "기록 확인", "자료 확인 필요", "근거 없음")),
    diagnosticAxis("발생 맥락", diagnostic.communitySetting.status, axisValue(diagnostic.communitySetting.status, "지역사회 발생", "시점 확인 필요", "CAP 범위 밖")),
    diagnosticAxis("의료진 진단", diagnostic.clinicianDiagnosis.status, diagnostic.clinicianDiagnosis.documented ? "기록 있음" : "기록 없음"),
  );
  summary.append(axes, element("p", "quality-diagnostic-boundary", diagnostic.disclaimer));
  refs.diseaseDiagnosticSummary.append(summary);

  const evidence = element("section", "quality-detail-section");
  evidence.append(element("h5", "", "진단 정합성 네 축"));
  const list = element("ul", "quality-detail-list");
  for (const [label, item] of [
    ["흉부 영상", diagnostic.imaging],
    ["감염을 시사하는 근거", diagnostic.infectionEvidence],
    ["지역사회 발생 맥락", diagnostic.communitySetting],
    ["의료진 최종 진단", diagnostic.clinicianDiagnosis],
  ]) {
    const row = element("li");
    row.append(element("b", "", label), element("span", "", item.reason));
    list.append(row);
  }
  evidence.append(list);

  const boundary = element("section", "quality-detail-section quality-detail-section--boundary");
  boundary.append(
    element("h5", "", "임상 판단과 적정성 평가 분리"),
    element("p", "", "CURB-65·PSI는 중증도를 확인하는 도구이며, 점수만으로 폐렴 진단·입원·항생제를 자동 결정하지 않습니다."),
    element("p", "", "과정지표의 미포함 예상은 기관 적정성 평가 기여 가능성을 뜻하며 개별 진료비 삭감 확정과 같지 않습니다."),
  );
  appendSourceLink(boundary, diagnostic.rule);
  refs.diseaseDiagnosticDetails.append(evidence, boundary);
}

function diseaseTabId(patientId, diseaseId) {
  const patientToken = String(patientId ?? "patient").replace(/[^a-zA-Z0-9_-]/g, "-");
  return `disease-assessment-tab-${patientToken}-${diseaseId}`;
}

function clearDiseaseAssessment(message = "이 환자에게 연결된 질환별 평가가 없습니다.") {
  clear(refs.diseaseAssessmentTabs);
  refs.diseaseAssessmentTabs.append(element("span", "claim-overview-empty", message));
  refs.diseaseAssessmentPanel.setAttribute("aria-labelledby", "diseaseAssessmentTitle");
  refs.diseaseProgramEyebrow.textContent = "SUPPORTED PROGRAM";
  refs.diseaseProgramTitle.textContent = "연결된 질환 평가 없음";
  refs.diseaseProgramStatus.textContent = "해당 없음";
  refs.diseaseProgramIntro.textContent = "확정 질환과 연결된 지원 평가가 생기면 환자별 기여 예상과 진단 근거를 구분해 보여 줍니다.";
  refs.diseaseDiagnosticEyebrow.textContent = "CLINICAL CONCORDANCE";
  refs.diseaseDiagnosticTitle.textContent = "진단 근거 확인";
  for (const node of [
    refs.diseaseQualitySummary,
    refs.diseaseQualityMetrics,
    refs.diseaseQualityDetails,
    refs.diseaseDiagnosticSummary,
    refs.diseaseDiagnosticDetails,
    refs.diseaseAssessmentMeta,
  ]) clear(node);
  refs.diseaseQualitySummary.append(element("p", "claim-overview-empty", message));
  refs.diseaseQualityMetrics.append(element("p", "claim-overview-empty", "관련 질환이 연결될 때만 지표 카드를 표시합니다."));
  refs.diseaseDiagnosticSummary.append(element("p", "claim-overview-empty", "진단 근거 프로필이 연결되지 않았습니다."));
  refs.diseaseQualityDisclosure.open = false;
  refs.diseaseDiagnosticDisclosure.open = false;
  refs.diseaseAssessmentSources.open = false;
  refs.diseaseQualityDisclosure.hidden = true;
  refs.diseaseDiagnosticDisclosure.hidden = true;
  refs.diseaseAssessmentSources.hidden = true;
}

function renderDiseaseAssessment(patient, requestedDiseaseId = "") {
  if (!state.demo) {
    clearDiseaseAssessment("질환별 적정성 평가는 검증된 기관 데이터 연결 뒤 표시합니다.");
    return "";
  }
  const options = getDiseaseAssessmentOptions(patient);
  if (!options.length) {
    clearDiseaseAssessment();
    return "";
  }
  const requested = requestedDiseaseId || selectedDiseaseByPatientId.get(patient.id) || getPreferredDiseaseAssessmentId(patient);
  const selectedId = options.some(({ id }) => id === requested) ? requested : options[0].id;
  selectedDiseaseByPatientId.set(patient.id, selectedId);
  const result = evaluateDiseaseAssessment(patient, selectedId);
  if (!result) {
    clearDiseaseAssessment("선택한 질환의 평가 자료를 연결하지 못했습니다.");
    return "";
  }

  clear(refs.diseaseAssessmentTabs);
  for (const option of options) {
    const selected = option.id === selectedId;
    const button = element("button", "disease-assessment-tab");
    button.type = "button";
    button.id = diseaseTabId(patient.id, option.id);
    button.dataset.diseaseAssessmentId = option.id;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(selected));
    button.setAttribute("aria-controls", "diseaseAssessmentPanel");
    button.tabIndex = selected ? 0 : -1;
    button.append(element("b", "", option.label), element("small", "", option.shortLabel));
    refs.diseaseAssessmentTabs.append(button);
  }
  refs.diseaseAssessmentPanel.setAttribute("aria-labelledby", diseaseTabId(patient.id, selectedId));
  refs.diseaseQualityDisclosure.hidden = false;
  refs.diseaseDiagnosticDisclosure.hidden = false;
  refs.diseaseAssessmentSources.hidden = false;
  refs.diseaseProgramEyebrow.textContent = result.program.eyebrow;
  refs.diseaseProgramTitle.textContent = result.program.label;
  refs.diseaseProgramStatus.textContent = result.quality.target.status === "eligible"
    ? "평가대상 예상"
    : result.quality.target.status === "insufficient" ? "대상 확인 필요" : "대상 아님 예상";
  refs.diseaseProgramIntro.textContent = result.program.description;
  refs.diseaseDiagnosticEyebrow.textContent = result.program.diagnostic.eyebrow;
  refs.diseaseDiagnosticTitle.textContent = result.program.diagnostic.title;
  const includedMetricCount = result.quality.metrics.filter(({ status }) => status === "included").length;
  const attentionMetricCount = result.quality.metrics.filter(({ status }) => ["not-included", "insufficient"].includes(status)).length;
  refs.diseaseQualityDisclosureHint.textContent = `${result.quality.metrics.length}개 지표 · 충족 예상 ${includedMetricCount} · 확인 ${attentionMetricCount}`;
  clear(refs.diseaseDiagnosticSummary);
  clear(refs.diseaseDiagnosticDetails);
  renderDiseaseQuality(result.quality, result.profile, result.program);
  if (selectedId === "copd") renderCopdDiagnostic(result.diagnostic, result.profile);
  else renderPneumoniaDiagnostic(result.diagnostic);

  refs.diseaseAssessmentMeta.replaceChildren();
  const qualityRule = selectedId === "copd" ? HIRA_COPD_2026_RULESET : HIRA_PNEUMONIA_2026_RULESET;
  const diagnosticRule = selectedId === "copd" ? GOLD_COPD_2026_RULESET : KDCA_PNEUMONIA_2026_GUIDELINE;
  refs.diseaseAssessmentMeta.append(document.createTextNode(
    `${qualityRule.version} · ${diagnosticRule.version} · 평가 기준 시점 ${displayTimestamp(result.evaluatedAt)} · `,
  ));
  appendSourceLink(refs.diseaseAssessmentMeta, qualityRule);
  refs.diseaseAssessmentMeta.append(document.createTextNode(" · "));
  appendSourceLink(refs.diseaseAssessmentMeta, diagnosticRule);
  return selectedId;
}

async function moveClaimReview(evaluation, nextStage, inputMethod, metadata = {}) {
  if (!evaluation || !CLAIM_REVIEW_STAGE_ORDER.includes(nextStage)) return false;
  const review = resolveClaimReview(state, evaluation);
  const currentStage = review.stage;
  const nextLabel = CLAIM_REVIEW_STAGE_LABELS[nextStage];
  const assignee = String(metadata.assignee || "").trim();
  const reviewer = String(metadata.reviewer || "").trim();
  const reason = String(metadata.reason || "").trim();
  const opinion = String(metadata.opinion || "").trim();
  const outcome = String(metadata.outcome || "").trim();
  if (nextStage !== "new" && !assignee) throw new Error("담당자를 배정해 주세요.");
  if (!reviewer) throw new Error("기록자 이름을 입력해 주세요.");
  if (currentStage !== nextStage && !reason) throw new Error("단계를 이동한 이유를 입력해 주세요.");
  if (nextStage === "reviewed" && !["approved", "hold", "exception"].includes(outcome)) {
    throw new Error("최종 판정에서 승인·보류·예외 인정 중 하나를 선택해 주세요.");
  }
  const currentLabel = CLAIM_REVIEW_STAGE_LABELS[currentStage];
  const computedLabel = CLAIM_LANE_LABELS[evaluation.status] ?? CLAIM_LANE_LABELS.unknown;
  const detail = `${currentLabel} → ${nextLabel} · ${reason || "담당자 의견 갱신"} · 규칙 판정 ${computedLabel} 유지`;
  try {
    await applyMutation(
      (current) => setClaimReviewStage(
        current,
        evaluation,
        nextStage,
        detail,
        new Date().toISOString(),
        { assignee, reviewer, reason, opinion, outcome: nextStage === "reviewed" ? outcome : "", inputMethod },
      ),
      `${evaluation.title}의 담당자 검토 단계를 '${nextLabel}' 단계로 옮겼습니다. 규칙 판정 '${computedLabel}'은 유지됩니다.`,
      { preserveDraft: false },
    );
    refs.claimBoardLive.textContent = `${evaluation.title}: '${currentLabel}'에서 '${nextLabel}' 단계로 기록했습니다.${review.stale ? " 이전 검토는 자동 판정·근거·규칙 또는 판정일 변경으로 무효화했습니다." : ""} 자동 규칙 판정 '${computedLabel}'과 보험자 심사결과는 변경되지 않았습니다.`;
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
  const evaluations = claimReviewEvaluationsForPatients(patients);
  claimEvaluationById = new Map(evaluations.map((evaluation) => [evaluation.id, evaluation]));
  const selectedEvaluations = evaluations.filter((evaluation) => evaluation.patientId === patient.id);
  const diseaseClaimProfile = state.demo ? getCombinedDiseaseClaimProfile(patient) : null;
  const claimCounts = renderClaimAttention(patient, selectedEvaluations, diseaseClaimProfile);
  renderClaimAdjudications(diseaseClaimProfile);
  const selectedDiseaseId = renderDiseaseAssessment(patient);
  const selectedAssessment = state.demo && selectedDiseaseId ? evaluateDiseaseAssessment(patient, selectedDiseaseId) : null;
  renderClaimBoardKpis(claimCounts, selectedAssessment?.quality);
  renderClaimRuleTrust(selectedEvaluations.filter(({ sourceKind }) => sourceKind !== "profile"));

  clear(refs.claimResultSummary);
  refs.claimResultSummary.setAttribute("role", "list");
  const calculatedCounts = Object.fromEntries(CLAIM_LANE_ORDER.map((status) => [status, 0]));
  for (const evaluation of evaluations) calculatedCounts[evaluation.status] = (calculatedCounts[evaluation.status] ?? 0) + 1;
  for (const status of CLAIM_LANE_ORDER) {
    const result = element("span", "claim-result-chip");
    result.dataset.status = status;
    result.setAttribute("role", "listitem");
    result.append(
      element("span", "", CLAIM_LANE_LABELS[status]),
      element("b", "", calculatedCounts[status] ?? 0),
    );
    refs.claimResultSummary.append(result);
  }

  const reviewById = new Map(evaluations.map((evaluation) => [evaluation.id, resolveClaimReview(state, evaluation)]));
  const reviewLanes = Object.fromEntries(CLAIM_REVIEW_STAGE_ORDER.map((stage) => [stage, []]));
  for (const evaluation of evaluations) reviewLanes[reviewById.get(evaluation.id).stage].push(evaluation);
  clear(refs.claimBoard);
  clear(refs.claimReviewDetailHost);
  const detailEmpty = element("div", "claim-review-detail-empty");
  detailEmpty.id = "claimReviewDetailEmpty";
  detailEmpty.append(
    element("span", "claim-review-detail-empty__mark", "↗"),
    element("strong", "", "검토할 항목을 선택하세요."),
    element("p", "", "왼쪽 업무 카드나 위 청구 전 점검 행을 누르면 적용 규칙, EMR 근거, 해야 할 작업과 담당자 기록이 이곳에 이어집니다."),
  );
  refs.claimReviewDetailHost.append(detailEmpty);
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
        ? "자동 판정 완료 · 담당 배정"
        : stage === "evidence"
          ? "검사·처방·외부 자료 확인"
          : stage === "reviewing"
            ? "담당자가 현재 확인 중"
            : "내부 의견 기록 · 보험자 확정 아님"),
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
      const isExampleRule = evaluation.rule.sample === true;
      const serviceCode = element("code", "", isExampleRule ? "기관 규칙" : evaluation.serviceCode);
      serviceCode.title = isExampleRule
        ? "내부 검토용 기관 규칙"
        : [evaluation.rule.serviceSystem, evaluation.serviceCode].filter(Boolean).join(" | ");
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
          document.createTextNode(`자동 판정·근거·규칙 또는 판정일이 달라져 이전 '${CLAIM_REVIEW_STAGE_LABELS[review.invalidatedFrom] ?? "검토"}' 단계는 무효화되고 '검토 대기'로 돌아왔습니다.`),
        );
        summary.append(stale);
      }
      if (boardScope === "all") summary.append(element("span", "claim-patient", evaluation.patientName + " · " + (evaluation.patientMrn || "등록번호 없음")));
      const owner = element("span", "claim-card__owner", `담당 · ${review.assignee || "미배정"}`);
      owner.dataset.assigned = String(Boolean(review.assignee));
      summary.append(owner);
      const quickFacts = element("span", "claim-card__quick-facts");
      const connectedEvidenceCount = evaluation.sourceKind === "profile"
        ? evaluation.claimContext?.evidenceCount ?? 0
        : evaluation.evidenceEventIds?.length ?? 0;
      for (const [label, value] of [
        ["환자", evaluation.patientName],
        [evaluation.sourceKind === "profile" ? "진료일" : "판정 기준일", evaluation.asOf || "미연결"],
        ["자료", `${connectedEvidenceCount ? `${connectedEvidenceCount}건 연결` : "자료 미연결"}${evaluation.missingEvidence?.length ? ` · ${evaluation.missingEvidence.length}건 보완` : ""}`],
        [evaluation.sourceKind === "profile" ? "청구 단위" : "예상 영향", evaluation.sourceKind === "profile" ? profileClaimUnitLabel(evaluation.claimContext?.claimUnit) : "기관 단가 미연결"],
      ]) {
        const fact = element("span", "claim-card__quick-fact");
        fact.append(element("small", "", label), element("b", "", value));
        quickFacts.append(fact);
      }
      summary.append(quickFacts);
      const requiredActions = claimRequiredActions(evaluation);
      const nextAction = element("span", "claim-card__next-action");
      nextAction.append(
        element("small", "", "해야 할 작업"),
        element("b", "", requiredActions[0]?.label || "담당자 확인"),
        requiredActions.length > 1 ? element("em", "", `외 ${requiredActions.length - 1}개`) : document.createTextNode(""),
      );
      summary.append(nextAction);
      const disclosure = element("span", "claim-card__disclosure");
      disclosure.dataset.claimDetailLabel = "";
      disclosure.textContent = "근거·세부정보 보기";
      summary.append(disclosure);
      card.append(summary);

      const details = document.createElement("dialog");
      details.className = "claim-card__details";
      details.id = detailsId;
      details.setAttribute("role", "dialog");
      details.setAttribute("aria-modal", "false");
      details.setAttribute("aria-labelledby", detailTitleId);
      details.setAttribute("aria-describedby", detailBoundaryId);
      details.dataset.claimReviewCurrentStage = stage;
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
      const profileEvidenceRecords = evaluation.sourceKind === "profile"
        ? evaluation.claimContext?.evidenceRecords ?? []
        : [];
      const judgment = element("section", "claim-xai-section claim-xai-section--judgment");
      judgment.dataset.claimDetailSection = "judgment";
      judgment.append(
        element("span", "claim-xai-section__step", "01"),
        element("h6", "", "판정 요약"),
        element("strong", "claim-auto-calculation__result", CLAIM_LANE_LABELS[evaluation.status]),
        element("p", "", evaluation.explanation),
        element("small", "claim-xai-boundary", "자동 규칙 판정은 담당자 검토를 돕는 사전점검이며 보험자 심사결과가 아닙니다."),
      );

      const ruleDetail = element("section", "claim-xai-section claim-xai-section--rule");
      ruleDetail.dataset.claimDetailSection = "rule";
      ruleDetail.append(
        element("span", "claim-xai-section__step", "02"),
        element("h6", "", "적용 규칙"),
        element("strong", "", evaluation.rule.title),
        element(
          "p",
          "claim-rule-version",
          `${claimRuleDisplayReference(evaluation.rule)} · 적용 ${evaluation.rule.effectiveFrom}–${evaluation.rule.effectiveTo || "현재"}`,
        ),
      );
      if (evaluation.rule.sourceDocumentNumber) {
        ruleDetail.append(element("p", "claim-rule-document", `고시·문서번호 · ${evaluation.rule.sourceDocumentNumber}`));
      }
      const sourceUrl = safeExternalUrl(evaluation.rule.sourceUrl);
      if (sourceUrl) {
        const source = element("a", "claim-source", evaluation.rule.sourceLabel + " ↗");
        source.href = sourceUrl;
        source.target = "_blank";
        source.rel = "noreferrer";
        source.draggable = false;
        ruleDetail.append(source);
      } else {
        ruleDetail.append(element("span", "claim-source", evaluation.rule.sourceLabel));
      }

      const autoCalculation = element("section", "claim-xai-section claim-xai-section--timeline claim-auto-calculation");
      autoCalculation.dataset.claimDetailSection = "timeline";
      autoCalculation.append(
        element("span", "claim-xai-section__step", "04"),
        element("h6", "", "시간·횟수 계산"),
      );
      const autoMetrics = element("div", "claim-auto-calculation__metrics");
      const calculationFacts = evaluation.sourceKind === "profile"
        ? [
            ["진료일", evaluation.claimContext?.serviceDate || "미연결"],
            ["명세서 상태", CLAIM_WORKFLOW_LABELS[evaluation.claimContext?.workflowStatus] || "상태 미연결"],
            ["청구 단위", profileClaimUnitLabel(evaluation.claimContext?.claimUnit)],
            ["연결 자료", evaluation.claimContext?.evidenceCount ? `${evaluation.claimContext.evidenceCount}건` : "자료 미연결"],
          ]
        : evaluation.calculationAvailable
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
        element(
          "p",
          "",
          evaluation.sourceKind === "profile"
            ? "질환별 연결 프로필의 청구 line 사실만 표시합니다. 기간·횟수 급여기준은 별도 규칙이 연결된 경우에만 계산합니다."
            : evaluation.calculationAvailable
            ? `서명·확정된 EMR의 ${EVENT_LABELS[evaluation.rule.serviceEventType] ?? evaluation.rule.serviceEventType} 기록 중 코드·상태·집계일이 규칙과 일치하는 항목만 자동 계산했습니다.`
            : "규칙 적용 조건이 충족된 경우에만 기간과 횟수를 계산합니다.",
        ),
      );
      if (evaluation.missingEvidence.length) {
        autoCalculation.append(element(
          "p",
          "claim-auto-calculation__missing",
          `보완 확인 · ${evaluation.missingEvidence.join(", ")}`,
        ));
      }
      const evidence = element("section", "claim-xai-section claim-xai-section--evidence claim-evidence");
      evidence.dataset.claimDetailSection = "evidence";
      evidence.append(
        element("span", "claim-xai-section__step", "03"),
        element("h6", "", "EMR에서 확인한 사실"),
      );
      if (profileEvidenceRecords.length) {
        for (const record of profileEvidenceRecords.slice(0, 5)) {
          evidence.append(element(
            "span",
            "",
            [record.label, record.date, record.sourceLabel, record.sourceId].filter(Boolean).join(" · "),
          ));
        }
      } else if (evidenceEvents.length) {
        for (const event of evidenceEvents.slice(0, 5)) {
          const coding = isExampleRule ? "" : [event.system, event.code].filter(Boolean).join(" | ");
          evidence.append(element(
            "span",
            "",
            [event.label, event.date, coding, event.source?.label, event.source?.resourceId].filter(Boolean).join(" · "),
          ));
        }
      } else {
        evidence.append(element(
          "span",
          "claim-evidence__empty",
          evaluation.sourceKind === "profile"
            ? `청구 line 연결 자료 · 진료일 ${evaluation.claimContext?.serviceDate || "미연결"} · ${evaluation.claimContext?.provenanceLabel || "출처 확인 필요"}`
            : "직접 연결된 확정 차트 근거가 없습니다.",
        ));
      }
      const unresolvedProfileEvidence = evaluation.sourceKind === "profile"
        ? Math.max(0, (evaluation.claimContext?.evidenceCount ?? 0) - Math.min(5, profileEvidenceRecords.length))
        : 0;
      if (unresolvedProfileEvidence) {
        evidence.append(element("span", "claim-evidence__excluded", `상세 연결을 확인할 프로필 근거 · ${unresolvedProfileEvidence}건`));
      }
      if (evaluation.missingEvidence.length) {
        evidence.append(element("span", "claim-evidence__excluded", `확인되지 않은 후보 · ${evaluation.missingEvidence.join(", ")}`));
      }

      const actionPanel = element("section", "claim-xai-section claim-xai-section--actions");
      actionPanel.dataset.claimDetailSection = "actions";
      actionPanel.append(
        element("span", "claim-xai-section__step", "05"),
        element("h6", "", "해야 할 작업·완료 조건"),
        element("p", "", "카드를 다음 단계로 옮기기 전에 확인할 작업입니다. 자동 판정과 별도로 담당자가 완료 여부를 판단합니다."),
      );
      const actionList = element("ol", "claim-required-actions");
      for (const action of requiredActions) {
        const actionItem = element("li", "");
        actionItem.append(
          element("span", "claim-required-actions__check", "□"),
          element("b", "", action.label),
          element("small", "", `완료 조건 · ${action.completionCriterion}`),
        );
        actionList.append(actionItem);
      }
      actionPanel.append(actionList);

      const reviewPanel = element("section", "claim-xai-section claim-xai-section--review");
      reviewPanel.dataset.claimDetailSection = "review";
      reviewPanel.append(
        element("span", "claim-xai-section__step", "06"),
        element("h6", "", "담당자 의견·결론"),
        element("p", "", "자동 판정의 근거를 확인한 뒤 내부 업무 단계와 의견을 기록합니다. 이 결론은 보험자 심사결과를 바꾸지 않습니다."),
      );
      const reviewGrid = element("div", "claim-review-form");
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
      const assigneeControl = element("label", "claim-review-control");
      assigneeControl.append(element("span", "", "담당"));
      const assigneeInput = document.createElement("input");
      assigneeInput.type = "text";
      assigneeInput.maxLength = 120;
      assigneeInput.required = stage !== "new";
      assigneeInput.value = review.assignee || "";
      assigneeInput.placeholder = "예: 김심사 · 보험심사팀";
      assigneeInput.dataset.claimReviewAssignee = evaluation.id;
      assigneeControl.append(assigneeInput);
      const reviewerControl = element("label", "claim-review-control");
      reviewerControl.append(element("span", "", "기록자"));
      const reviewerInput = document.createElement("input");
      reviewerInput.type = "text";
      reviewerInput.maxLength = 120;
      reviewerInput.required = true;
      reviewerInput.value = typeof review.reviewer === "string" ? review.reviewer : review.reviewer?.display || "";
      reviewerInput.placeholder = "이름 또는 담당 역할";
      reviewerInput.dataset.claimReviewReviewer = evaluation.id;
      reviewerControl.append(reviewerInput);

      const reasonControl = element("label", "claim-review-control claim-review-control--wide");
      reasonControl.append(element("span", "", "이동·판정 사유"));
      const reasonInput = document.createElement("textarea");
      reasonInput.maxLength = 800;
      reasonInput.rows = 2;
      reasonInput.required = false;
      reasonInput.placeholder = "예: 외부 검사 결과 확인 필요";
      reasonInput.value = review.transitionReason || "";
      reasonInput.dataset.claimReviewReason = evaluation.id;
      reasonControl.append(reasonInput);

      const opinionControl = element("label", "claim-review-control claim-review-control--wide");
      opinionControl.append(element("span", "", "담당자 의견"));
      const opinionInput = document.createElement("textarea");
      opinionInput.maxLength = 2_000;
      opinionInput.rows = 3;
      opinionInput.placeholder = "확인한 근거와 후속 조치를 기록하세요.";
      opinionInput.value = review.opinion || "";
      opinionInput.dataset.claimReviewOpinion = evaluation.id;
      opinionControl.append(opinionInput);

      const outcomeControl = element("label", "claim-review-control");
      outcomeControl.append(element("span", "", "내부 최종 의견"));
      const outcomeSelect = document.createElement("select");
      outcomeSelect.dataset.claimReviewOutcome = evaluation.id;
      for (const [value, label] of [
        ["", "최종 판정에서 선택"],
        ["approved", "승인"],
        ["hold", "보류"],
        ["exception", "예외 인정"],
      ]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        option.selected = review.outcome === value;
        outcomeSelect.append(option);
      }
      outcomeSelect.disabled = stage !== "reviewed";
      outcomeControl.append(outcomeSelect);

      const applyReview = element("button", "clinical-button clinical-button--primary claim-review-apply", "검토 기록 저장");
      applyReview.type = "button";
      applyReview.dataset.claimReviewApply = evaluation.id;
      const reviewMessage = element("p", "claim-review-message");
      reviewMessage.dataset.claimReviewMessage = evaluation.id;
      reviewMessage.setAttribute("role", "alert");
      reviewMessage.setAttribute("aria-live", "assertive");
      reviewMessage.hidden = true;
      reviewGrid.append(control, assigneeControl, reviewerControl, reasonControl, opinionControl, outcomeControl, applyReview);
      reviewPanel.append(reviewMessage, reviewGrid);

      const historyPanel = element("section", "claim-xai-section claim-xai-section--history");
      historyPanel.dataset.claimDetailSection = "history";
      historyPanel.append(element("span", "claim-xai-section__step", "07"), element("h6", "", "검토 이력"));
      const historyList = element("ol", "claim-review-history");
      const outcomeLabels = { approved: "승인", hold: "보류", exception: "예외 인정" };
      for (const item of [...(review.history || [])].reverse().slice(0, 10)) {
        const historyItem = element("li", "");
        historyItem.append(
          element("time", "", displayTimestamp(item.at)),
          element("b", "", `${CLAIM_REVIEW_STAGE_LABELS[item.from] || item.from || "기록"} → ${CLAIM_REVIEW_STAGE_LABELS[item.to] || item.to || stage}`),
          element("span", "", [item.assignee ? `담당 ${item.assignee}` : "", item.reviewer ? `기록 ${item.reviewer}` : "", item.reason, outcomeLabels[item.outcome]].filter(Boolean).join(" · ")),
        );
        historyList.append(historyItem);
      }
      if (!historyList.childElementCount) historyList.append(element("li", "claim-review-history__empty", "아직 담당자 이동 이력이 없습니다."));
      historyPanel.append(historyList);

      const detailBoundary = element("p", "claim-detail-boundary", "자동 규칙 판정 → 사람 검토 → 내부 최종 의견의 순서로 기록합니다. 실제 인정·조정·삭감은 보험자 또는 심사기관 결과 영역에서만 표시합니다.");
      detailBoundary.id = detailBoundaryId;
      detailContent.append(judgment, ruleDetail, evidence, autoCalculation, actionPanel, reviewPanel, historyPanel, detailBoundary);
      details.append(detailHeader, detailContent);
      details.addEventListener("close", () => {
        const closeReason = details.dataset.claimCloseReason || "";
        delete details.dataset.claimCloseReason;
        summary.setAttribute("aria-expanded", "false");
        summary.setAttribute("aria-label", `${summary.dataset.claimDetailSummary} · 근거·세부정보 보기`);
        disclosure.textContent = "근거·세부정보 보기";
        card.dataset.claimDetailOpen = "false";
        card.removeAttribute("aria-current");
        if (closeReason !== "switch") {
          activeClaimDetailId = "";
          refs.claimReviewDetailHost.dataset.active = "false";
          refs.claimReviewDetailHost.querySelector(".claim-review-detail-empty")?.removeAttribute("hidden");
          refs.claimBoardLive.textContent = `${evaluation.title}의 연결 차트 근거와 규칙 세부정보를 닫았습니다.`;
          summary.focus({ preventScroll: true });
        }
      });
      refs.claimReviewDetailHost.append(details);
      cards.append(card);
    }
    if (!cards.childElementCount) cards.append(createEmptyMessage("카드를 여기에 놓을 수 있습니다.", "claim-empty"));
    lane.append(cards);
    refs.claimBoard.append(lane);
  }
  if (activeClaimDetailId && claimEvaluationById.has(activeClaimDetailId)) {
    requestAnimationFrame(() => openClaimReviewDetail(activeClaimDetailId, {
      inputMethod: "선택 유지",
      focus: false,
      announce: false,
    }));
  } else {
    activeClaimDetailId = "";
    refs.claimReviewDetailHost.dataset.active = "false";
  }
  renderClaimSearch(patient, evaluations, diseaseClaimProfile);
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
    ["저장 위치", state.demo ? "메모리 전용 예시 환자" : "브라우저 localStorage"],
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

function renderEncounterClaimSummary(target, evaluations, attention) {
  clear(target);
  target.append(element("p", "claim-preflight-note", "예비판정 · 서명 전 초안을 확정 사실과 분리해 가상 반영"));
  const counts = Object.fromEntries(CLAIM_LANE_ORDER.map((status) => [status, evaluations.filter((item) => item.status === status).length]));
  const countRow = element("div", "claim-mini-counts");
  for (const status of ["missing-evidence", "due-soon", "ready", "waiting", "unknown"]) {
    const chip = element("span", `claim-mini-count claim-mini-count--${status}`);
    chip.append(element("b", "", counts[status]), document.createTextNode(CLAIM_LANE_LABELS[status]));
    countRow.append(chip);
  }
  target.append(countRow);
  for (const evaluation of attention) {
    const card = element("article", "claim-mini-risk");
    card.append(
      element("b", "", evaluation.title),
      element("span", "", CLAIM_LANE_LABELS[evaluation.status] ?? "확인"),
      element("p", "", evaluation.explanation),
    );
    target.append(card);
  }
  if (!attention.length) target.append(element("p", "context-ok", "현재 규칙에서 즉시 보완할 항목 없음 · 실제 청구 전 담당자 재확인"));
}

function renderEncounterClaims(patient, evaluations) {
  const attentionStatuses = new Set(["missing-evidence", "due-soon", "unknown"]);
  const attention = evaluations.filter((item) => attentionStatuses.has(item.status)).slice(0, 3);
  refs.encounterSignoffSummary.textContent = attention.length
    ? `서명 전 확인 ${attention.length}건 · 급여 점검에서 기간·횟수·근거를 검토하세요.`
    : "즉시 보완 항목 없음 · 서명 전 기록과 실제 청구 기준을 다시 확인하세요.";
  refs.encounterSignoffSummary.dataset.tone = attention.length ? "attention" : "ready";
  renderEncounterClaimSummary(refs.encounterClaimSummary, evaluations, attention);
  renderEncounterClaimSummary(refs.encounterMobileClaimSummary, evaluations, attention);
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
  addGroup("KCD 진단", reviewValues(review.diagnoses, (item) => {
    const coding = displayCoding(item);
    return [item.diagnosisRole === "primary" ? "주" : "부", coding, item.label].filter(Boolean).join(" · ");
  }, "진단 없음"));
  addGroup("오더", reviewValues(review.orders, (item) => {
    const coding = displayCoding(item);
    return [item.order?.kind || "오더", coding, item.label].filter(Boolean).join(" · ");
  }, "오더 없음"));
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
  refs.openVitalDialog.disabled = !editable;
  setFormControlsDisabled(refs.diagnosisForm, !editable);
  refs.openDiagnosisDialog.disabled = !editable;
  setFormControlsDisabled(refs.prescriptionForm, !editable);
  refs.openPrescriptionDialog.disabled = !editable;
  setFormControlsDisabled(refs.orderForm, !editable);
  refs.openOrderDialog.disabled = !editable;
  if (!editable) {
    closeVitalDialog();
    closeDiagnosisDialog();
    closePrescriptionDialog();
    closeOrderDialog();
  }
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
    const coding = displayCoding(diagnosis);
    appendEncounterEntry(refs.diagnosisList, {
      title: diagnosis.label,
      meta: [diagnosis.diagnosisRole === "primary" ? "주상병" : "부상병", coding].filter(Boolean).join(" · "),
      detail: diagnosis.note,
      badge: diagnosis.certainty === "provisional" ? "의증" : "확정",
      entityId: diagnosis.id,
      editable,
    });
  }
  if (!refs.diagnosisList.childElementCount) refs.diagnosisList.append(element("li", "encounter-entry-empty", editable ? "이번 진료 진단을 추가하세요." : "이번 진료 진단 없음"));

  for (const medication of records.filter((event) => event.type === "medication")) {
    const rx = medication.prescription ?? {};
    const coding = displayCoding(medication);
    appendEncounterEntry(refs.prescriptionList, {
      title: medication.label,
      meta: coding || "처방 항목",
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
    const coding = displayCoding(order);
    appendEncounterEntry(refs.orderList, {
      title: order.label,
      meta: [order.order?.kind, coding, order.order?.priority].filter(Boolean).join(" · "),
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
  clear(refs.selectedPatientConditions);
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
  refs.openVitalDialog.disabled = true;
  closeVitalDialog();
  setFormControlsDisabled(refs.diagnosisForm, true);
  refs.openDiagnosisDialog.disabled = true;
  closeDiagnosisDialog();
  setFormControlsDisabled(refs.prescriptionForm, true);
  refs.openPrescriptionDialog.disabled = true;
  closePrescriptionDialog();
  setFormControlsDisabled(refs.orderForm, true);
  refs.openOrderDialog.disabled = true;
  closeOrderDialog();
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
    refs.encounterMobileClaimSummary,
    refs.recentEncounterList,
    refs.encounterBodySummary,
    refs.eventFilters,
    refs.eventTimeline,
    refs.bodyProjectionNotice,
    refs.bodyVisitList,
    refs.bodyMedicationList,
    refs.bodyConditionList,
    refs.claimBoardKpis,
    refs.claimRuleTrust,
    refs.claimSearchSummary,
    refs.claimSearchResults,
    refs.claimAttentionSummary,
    refs.claimAttentionList,
    refs.claimAdjudicationSummary,
    refs.claimAdjudicationList,
    refs.diseaseAssessmentTabs,
    refs.diseaseQualitySummary,
    refs.diseaseQualityMetrics,
    refs.diseaseDiagnosticSummary,
    refs.diseaseDiagnosticDetails,
    refs.diseaseQualityDetails,
    refs.diseaseAssessmentMeta,
    refs.claimResultSummary,
    refs.claimBoard,
    refs.claimReviewDetailHost,
    refs.ruleVersionList,
    refs.clinicalJourney,
    refs.visitQuestions,
  ]) clear(node);
  refs.claimSearch.value = "";
  refs.claimSearchResults.hidden = true;
  refs.claimSearchClear.hidden = true;
  claimSearchIndex = [];
  claimSearchEntryById = new Map();
  claimAttentionById = new Map();
  activeClaimDetailId = "";
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
  renderPatientConditions(patient);
  refs.lastSavedAt.textContent = state.demo ? "예시 · 미저장" : "저장 " + displayTimestamp(state.updatedAt);
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
  requestAnimationFrame(() => updateHorizontalScrollPosition(document.querySelector(".workspace-tabs")));
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
  retireLegacyCareBridge();
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
  updateHorizontalScrollPosition(tabList);
}

function downloadJson(value, filename) {
  downloadText(JSON.stringify(value, null, 2), filename, "application/json;charset=utf-8");
}

function setPersonalSyncStatus(message, tone = "") {
  if (!refs.personalSyncStatus) return;
  refs.personalSyncStatus.textContent = message;
  if (tone) refs.personalSyncStatus.dataset.tone = tone;
  else delete refs.personalSyncStatus.dataset.tone;
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

async function exportPatientTransfer() {
  const patient = selectedPatient();
  if (!patient) {
    setPersonalSyncStatus("환자 전달 파일로 내보낼 환자를 먼저 선택하세요.", "error");
    return;
  }
  if (state.demo) {
    setPersonalSyncStatus("예시 환자는 환자 전달 파일로 내보낼 수 없습니다. 로컬 실제 기록에서 선택하세요.", "error");
    return;
  }
  const blocker = currentExportBlocker();
  if (blocker) {
    setPersonalSyncStatus(blocker, "error");
    return;
  }
  try {
    const exportedAt = new Date().toISOString();
    const transferPackage = createPatientTransferPackage(patient, exportedAt);
    const { includedConditions, includedMeasurements } = transferPackage.summary;
    if (!window.confirm(
      `${patient.name} 환자의 최소 건강정보를 파일로 내보낼까요?\n\n전달 확인 코드: ${transferPackage.transferCode}\n확정 질환 ${includedConditions}개 · 최종 측정 ${includedMeasurements}개\n\n환자명과 코드를 대조하세요. 코드는 파일과 다른 경로로 환자에게 안내해야 합니다.`,
    )) {
      setPersonalSyncStatus("환자 전달 파일 내보내기를 취소했습니다.");
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
    setPersonalSyncStatus(
      `${patient.name} 환자용 JSON을 내보냈습니다. 전달 확인 코드 ${transferPackage.transferCode} · 확정 질환 ${includedConditions}개 · 최종 측정 ${includedMeasurements}개. 코드는 별도 경로로 안내하세요.`,
      "success",
    );
  } catch (error) {
    setPersonalSyncStatus(
      error instanceof Error ? error.message : "환자용 PolicyCompass JSON 내보내기에 실패했습니다.",
      "error",
    );
  }
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
      refs.aiStatusDetail.textContent = aiCapability.model + " · 질문 초안 · 외부 전송 없음";
    } else {
      refs.aiStatusLabel.textContent = "규칙 기반 모드";
      refs.aiStatusDetail.textContent = "모델 미연결 · 규칙 기능 사용";
    }
  } catch {
    aiCapability = { checked: true, configured: false, model: "" };
    refs.aiStatusLabel.textContent = "규칙 기반 모드";
    refs.aiStatusDetail.textContent = "환자 데이터 전송 안 함";
  }
}

async function runCopilot() {
  const patient = selectedPatient();
  if (!patient || copilotBusy) return;
  const evaluations = claimEvaluations(patient);
  const patientBrief = {};
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
  setStatus("규칙 기반 초안을 먼저 만들었습니다. 선택 환자의 확정 구조화 차트만 이 기기의 로컬 AI에 전달합니다. 직접식별자·자유메모는 제외하고 외부로 전송하지 않습니다.");
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
        {},
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
  const patientChanged = button.dataset.patientId !== state.selectedPatientId;
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
      if (patientChanged) activeClaimDetailId = "";
      render();
      centerSelectedPatientCard(button.dataset.patientId);
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
    refs.soapSubjective.focus();
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
    restoreWorkflowFocus(refs.soapSubjective, refs.saveEncounterDraft);
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

function renderVitalResults() {
  clear(refs.vitalResultList);
  refs.vitalResultCount.textContent = `${vitalSearchResults.length}건`;
  if (!vitalSearchResults.length) {
    refs.vitalResultList.append(element("li", "rx-result-empty", "검색어와 맞는 측정 항목이 없습니다."));
    return;
  }
  for (const preset of vitalSearchResults) {
    const item = element("li", "rx-result");
    if (preset.code === refs.vitalPreset.value) item.classList.add("is-selected");
    const heading = element("div", "rx-result__heading");
    heading.append(element("b", "rx-result__label", preset.label));
    item.append(heading, element("span", "rx-result__ingredient", `LOINC ${preset.code} · ${preset.unit}`));
    const actions = element("div", "rx-result__actions");
    const pickButton = element("button", "clinical-button clinical-button--primary", "이 항목 선택");
    pickButton.type = "button";
    pickButton.dataset.pickVital = preset.code;
    actions.append(pickButton);
    item.append(actions);
    refs.vitalResultList.append(item);
  }
}

function searchVitalPresets(query) {
  const normalized = String(query ?? "").trim().toLowerCase();
  if (!normalized) return [...ENCOUNTER_OBSERVATION_PRESETS];
  return ENCOUNTER_OBSERVATION_PRESETS.filter((preset) => (
    [preset.label, preset.code, preset.unit, preset.key].join(" ").toLowerCase().includes(normalized)
  ));
}

function pickVitalPreset(code) {
  const preset = ENCOUNTER_OBSERVATION_PRESETS.find((item) => item.code === code);
  if (!preset) return;
  refs.vitalPreset.value = preset.code;
  syncVitalPreset();
  refs.vitalSelectedSummary.textContent = `${preset.label} · LOINC ${preset.code} · ${preset.unit}`;
  renderVitalResults();
  refs.vitalValue.focus();
}

function openVitalDialog() {
  const patient = selectedPatient();
  const encounter = currentEncounter(patient);
  if (!patient || !encounter || encounter.recordStatus !== "draft" || encounter.status !== "in-progress") {
    setStatus("진료를 시작한 뒤 측정을 담을 수 있습니다.", "error");
    return;
  }
  refs.vitalDialog.closest("details")?.setAttribute("open", "");
  refs.vitalDialogContext.textContent = encounterDialogContext(patient, encounter);
  vitalSearchResults = searchVitalPresets(refs.vitalSearchInput.value);
  renderVitalResults();
  if (!refs.vitalDialog.open) refs.vitalDialog.showModal();
  refs.vitalSearchInput.focus();
}

function closeVitalDialog() {
  if (refs.vitalDialog.open) refs.vitalDialog.close();
}

refs.openVitalDialog.addEventListener("click", openVitalDialog);
refs.closeVitalDialog.addEventListener("click", closeVitalDialog);

refs.vitalSearchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  vitalSearchResults = searchVitalPresets(refs.vitalSearchInput.value);
  renderVitalResults();
});

refs.vitalSearchInput.addEventListener("input", () => {
  vitalSearchResults = searchVitalPresets(refs.vitalSearchInput.value);
  renderVitalResults();
});

refs.vitalResultList.addEventListener("click", (event) => {
  const pickButton = event.target.closest("[data-pick-vital]");
  if (pickButton) pickVitalPreset(pickButton.dataset.pickVital);
});

// ---------- order dialog ----------

function renderOrderResults() {
  clear(refs.orderResultList);
  refs.orderResultCount.textContent = `${orderSearchResults.length}건`;
  if (!orderSearchResults.length) {
    refs.orderResultList.append(element(
      "li",
      "rx-result-empty",
      refs.orderSearchInput.value.trim()
        ? "검색어와 맞는 오더가 없습니다. 오더명이나 유형으로 다시 검색하세요."
        : "오더명·유형·코드로 검색하세요.",
    ));
    return;
  }
  for (const entry of orderSearchResults) {
    const item = element("li", "rx-result");
    if (entry.id === selectedCatalogOrderId) item.classList.add("is-selected");
    const heading = element("div", "rx-result__heading");
    heading.append(element("b", "rx-result__label", entry.label));
    heading.append(element("span", "dx-result__category", orderKindLabel(entry.kind)));
    item.append(heading, element("span", "rx-result__ingredient", displayCoding(entry) || "기관 코드"));
    const actions = element("div", "rx-result__actions");
    const pickButton = element("button", "clinical-button clinical-button--primary", "이 오더 선택");
    pickButton.type = "button";
    pickButton.dataset.pickOrder = entry.id;
    actions.append(pickButton);
    item.append(actions);
    refs.orderResultList.append(item);
  }
}

function pickCatalogOrder(orderId) {
  const entry = findOrderInCatalog(orderId);
  if (!entry) return;
  selectedCatalogOrderId = entry.id;
  refs.orderKind.value = entry.kind;
  refs.orderCode.value = entry.code;
  refs.orderSystem.value = entry.system;
  refs.orderLabel.value = entry.label;
  refs.orderPriority.value = entry.priority;
  refs.orderInstructions.value = entry.instructions;
  refs.orderSelectedSummary.textContent = `${entry.label} · ${orderKindLabel(entry.kind)}`;
  renderOrderResults();
  refs.orderPriority.focus();
}

function resetOrderSelection() {
  selectedCatalogOrderId = "";
  refs.orderSelectedSummary.textContent = "검색 결과에서 오더를 선택하면 유형과 코드가 채워집니다.";
}

function openOrderDialog() {
  const patient = selectedPatient();
  const encounter = currentEncounter(patient);
  if (!patient || !encounter || encounter.recordStatus !== "draft" || encounter.status !== "in-progress") {
    setStatus("진료를 시작한 뒤 오더를 담을 수 있습니다.", "error");
    return;
  }
  refs.orderDialog.closest("details")?.setAttribute("open", "");
  refs.orderDialogContext.textContent = encounterDialogContext(patient, encounter);
  renderOrderResults();
  if (!refs.orderDialog.open) refs.orderDialog.showModal();
  refs.orderSearchInput.focus();
}

function closeOrderDialog() {
  if (refs.orderDialog.open) refs.orderDialog.close();
}

refs.openOrderDialog.addEventListener("click", openOrderDialog);
refs.closeOrderDialog.addEventListener("click", closeOrderDialog);

refs.orderSearchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  orderSearchResults = searchOrderCatalog(refs.orderSearchInput.value, 8);
  renderOrderResults();
});

refs.orderSearchInput.addEventListener("input", () => {
  orderSearchResults = searchOrderCatalog(refs.orderSearchInput.value, 8);
  renderOrderResults();
});

refs.orderResultList.addEventListener("click", (event) => {
  const pickButton = event.target.closest("[data-pick-order]");
  if (pickButton) pickCatalogOrder(pickButton.dataset.pickOrder);
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
    closeVitalDialog();
  } catch (error) {
    refs.encounterFormMessage.textContent = error instanceof Error ? error.message : "진료 측정을 추가하지 못했습니다.";
  }
});

function renderDiagnosisResults() {
  clear(refs.diagnosisResultList);
  refs.diagnosisResultCount.textContent = `${diagnosisSearchResults.length}건`;
  if (!diagnosisSearchResults.length) {
    refs.diagnosisResultList.append(element(
      "li",
      "rx-result-empty",
      refs.diagnosisSearchInput.value.trim()
        ? "검색어와 맞는 상병이 없습니다. 다른 진단명이나 코드로 다시 검색하세요."
        : "진단명·증상·코드로 검색하세요.",
    ));
    return;
  }
  for (const entry of diagnosisSearchResults) {
    const item = element("li", "rx-result");
    if (entry.id === selectedCatalogDiagnosisId) item.classList.add("is-selected");
    const heading = element("div", "rx-result__heading");
    heading.append(element("b", "rx-result__label", entry.label));
    heading.append(element("span", "dx-result__category", entry.category));
    const preferred = preferredDiagnosisCode(entry);
    item.append(
      heading,
      element("span", "rx-result__ingredient", `${preferred?.code ?? ""} · 코드 후보 ${entry.codes.length}개`),
    );
    const actions = element("div", "rx-result__actions");
    const pickButton = element("button", "clinical-button clinical-button--primary", "이 상병 선택");
    pickButton.type = "button";
    pickButton.dataset.pickDiagnosis = entry.id;
    actions.append(pickButton);
    item.append(actions);
    refs.diagnosisResultList.append(item);
  }
}

function renderDiagnosisCodeOptions(entry, selectedCode) {
  clear(refs.diagnosisCodeOptions);
  refs.diagnosisCodeChoices.hidden = false;
  for (const candidate of entry.codes) {
    const option = element("label", "dx-code-option");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "diagnosisCodeChoice";
    input.value = candidate.code;
    input.checked = candidate.code === selectedCode;
    input.dataset.diagnosisCodeChoice = candidate.code;
    const text = element("span", "dx-code-option__text");
    text.append(
      element("b", "", candidate.code),
      element("span", "", candidate.label),
    );
    option.append(input, text);
    refs.diagnosisCodeOptions.append(option);
  }
}

function applyDiagnosisCode(code) {
  const entry = findDiagnosisInCatalog(selectedCatalogDiagnosisId);
  const candidate = entry?.codes.find((item) => item.code === code);
  if (!entry || !candidate) return;
  refs.diagnosisCode.value = candidate.code;
  refs.diagnosisLabel.value = candidate.label;
  renderDiagnosisCodeOptions(entry, candidate.code);
  refs.diagnosisSelectedSummary.textContent = `${entry.label} · ${candidate.code} ${candidate.label}`;
}

function pickCatalogDiagnosis(diagnosisId) {
  const entry = findDiagnosisInCatalog(diagnosisId);
  if (!entry) return;
  selectedCatalogDiagnosisId = entry.id;
  const preferred = preferredDiagnosisCode(entry);
  refs.diagnosisSystem.value = KCD_SYSTEM;
  applyDiagnosisCode(preferred.code);
  renderDiagnosisResults();
  refs.diagnosisRole.focus();
}

function resetDiagnosisSelection() {
  selectedCatalogDiagnosisId = "";
  refs.diagnosisCodeChoices.hidden = true;
  clear(refs.diagnosisCodeOptions);
  refs.diagnosisSelectedSummary.textContent = "검색 결과에서 진단명을 선택하면 코드 후보가 표시됩니다.";
}

function encounterDialogContext(patient, encounter) {
  return [
    patient.name,
    patientAgeLabel(patient),
    INSURANCE_LABELS[patient.insuranceType] ?? INSURANCE_LABELS.unknown,
    `진료일 ${displayDate(encounter.date)}`,
  ].filter(Boolean).join(" · ");
}

function openDiagnosisDialog() {
  const patient = selectedPatient();
  const encounter = currentEncounter(patient);
  if (!patient || !encounter || encounter.recordStatus !== "draft" || encounter.status !== "in-progress") {
    setStatus("진료를 시작한 뒤 진단을 담을 수 있습니다.", "error");
    return;
  }
  refs.diagnosisDialog.closest("details")?.setAttribute("open", "");
  refs.dxDialogContext.textContent = encounterDialogContext(patient, encounter);
  renderDiagnosisResults();
  if (!refs.diagnosisDialog.open) refs.diagnosisDialog.showModal();
  refs.diagnosisSearchInput.focus();
}

function closeDiagnosisDialog() {
  if (refs.diagnosisDialog.open) refs.diagnosisDialog.close();
}

refs.openDiagnosisDialog.addEventListener("click", openDiagnosisDialog);
refs.closeDiagnosisDialog.addEventListener("click", closeDiagnosisDialog);

refs.diagnosisSearchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  diagnosisSearchResults = searchDiagnosisCatalog(refs.diagnosisSearchInput.value, 8);
  renderDiagnosisResults();
});

refs.diagnosisSearchInput.addEventListener("input", () => {
  diagnosisSearchResults = searchDiagnosisCatalog(refs.diagnosisSearchInput.value, 8);
  renderDiagnosisResults();
});

refs.diagnosisResultList.addEventListener("click", (event) => {
  const pickButton = event.target.closest("[data-pick-diagnosis]");
  if (pickButton) pickCatalogDiagnosis(pickButton.dataset.pickDiagnosis);
});

refs.diagnosisCodeOptions.addEventListener("change", (event) => {
  const choice = event.target.closest("[data-diagnosis-code-choice]");
  if (choice) applyDiagnosisCode(choice.dataset.diagnosisCodeChoice);
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
    resetDiagnosisSelection();
    closeDiagnosisDialog();
  } catch (error) {
    refs.encounterFormMessage.textContent = error instanceof Error ? error.message : "진단을 추가하지 못했습니다.";
  }
});

const MEDICATION_REVIEW_ENDPOINT = "/api/medication-claim-review";

async function checkMedicationReviewStatus() {
  try {
    const response = await fetch(`${MEDICATION_REVIEW_ENDPOINT}/status`, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("status");
    const result = await response.json();
    medicationReviewCapability = {
      checked: true,
      local: result?.local?.configured === true,
      frontier: result?.frontier?.configured === true,
      model: String(result?.local?.model || result?.frontier?.model || ""),
    };
  } catch {
    medicationReviewCapability = { checked: true, local: false, frontier: false, model: "" };
  }
  renderMedicationReviewMode();
}

function medicationReviewProvider() {
  if (medicationReviewCapability.local) return "local";
  return medicationReviewCapability.frontier ? "frontier" : "";
}

function renderMedicationReviewMode(review = null) {
  if (review && review.generatedBy !== "rule") {
    refs.medicationReviewMode.textContent = `AI 검토 · ${review.model || review.generatedBy}`;
    return;
  }
  const provider = medicationReviewProvider();
  refs.medicationReviewMode.textContent = provider
    ? `AI 검토 가능 · ${provider === "local" ? "로컬 모델" : medicationReviewCapability.model || "연결된 모델"}`
    : "규칙 기반 · 모델 미설정";
}

function catalogDosingDraft(medication) {
  if (selectedCatalogMedicationId !== medication.id) return medication.dosing;
  return {
    dose: refs.medicationDose.value,
    doseUnit: refs.medicationDoseUnit.value,
    route: refs.medicationRoute.value,
    frequency: refs.medicationFrequency.value,
    durationDays: refs.medicationDurationDays.value,
    quantity: refs.medicationQuantity.value,
    instructions: refs.medicationInstructions.value,
  };
}

function selectIfPresent(select, value) {
  const wanted = String(value ?? "");
  if ([...select.options].some((option) => option.value === wanted)) select.value = wanted;
}

function pickCatalogMedication(medicationId) {
  const medication = findMedicationInCatalog(medicationId);
  if (!medication) return;
  selectedCatalogMedicationId = medication.id;
  refs.medicationCode.value = medication.code;
  refs.medicationSystem.value = medication.system;
  refs.medicationName.value = medication.label;
  refs.medicationDose.value = medication.dosing.dose;
  selectIfPresent(refs.medicationDoseUnit, medication.dosing.doseUnit);
  selectIfPresent(refs.medicationRoute, medication.dosing.route);
  selectIfPresent(refs.medicationFrequency, medication.dosing.frequency);
  refs.medicationDurationDays.value = String(medication.dosing.durationDays);
  refs.medicationQuantity.value = String(medication.dosing.quantity);
  refs.medicationInstructions.value = medication.dosing.instructions;
  refs.medicationSelectedSummary.textContent = `${medication.label} · ${medication.ingredient}`;
  renderMedicationResults();
  refs.prescriptionForm.scrollIntoView({ block: "end", behavior: "smooth" });
  refs.medicationDose.focus({ preventScroll: true });
}

function medicationDetailRows(medication) {
  return [
    ["계열", medication.classLabel],
    ["적응증", medication.indication || "등록된 적응증 없음"],
    ["약품 코드", `${medication.system} | ${medication.code}`],
    ["급여 인정 상병", medication.coverage.indications.map(({ code, label }) => `${code} ${label}`).join(", ") || "등록된 인정 상병 없음"],
    ["기본 용법", `1회 ${medication.dosing.dose}${medication.dosing.doseUnit} · ${medication.dosing.route} · ${medication.dosing.frequency} · ${medication.dosing.durationDays}일 · 총 ${medication.dosing.quantity}`],
    ["복약 안내", medication.dosing.instructions || "등록된 복약 안내 없음"],
    ["인정 일수", medication.coverage.maxDurationDays ? `1회 최대 ${medication.coverage.maxDurationDays}일` : "등록된 인정 일수 없음"],
  ];
}

/**
 * A result row carries only the two things a clinician scans by: the product
 * name and its ingredient. Coding, dosing and coverage detail stay one click away.
 */
function renderMedicationResults() {
  clear(refs.medicationResultList);
  refs.medicationResultCount.textContent = `${medicationSearchResults.length}건`;
  if (!medicationSearchResults.length) {
    refs.medicationResultList.append(element(
      "li",
      "rx-result-empty",
      refs.medicationSearchInput.value.trim()
        ? "검색어와 맞는 약품이 없습니다. 성분명이나 계열로 다시 검색하세요."
        : "약품명·성분명·계열·상병코드로 검색하세요.",
    ));
    return;
  }
  for (const medication of medicationSearchResults) {
    const item = element("li", "rx-result");
    if (medication.id === selectedCatalogMedicationId) item.classList.add("is-selected");
    const review = medication.id === activeMedicationReviewId ? medicationReviewById.get(medication.id) : null;
    const heading = element("div", "rx-result__heading");
    heading.append(element("b", "rx-result__label", medication.label));
    if (review) {
      const chip = element("span", "rx-verdict-chip", `${review.verdictSymbol} ${review.verdictLabel}`);
      chip.dataset.tone = review.verdictTone;
      heading.append(chip);
    }
    item.append(heading, element("span", "rx-result__ingredient", medication.ingredient));

    const actions = element("div", "rx-result__actions");
    const busy = medicationReviewBusyIds.has(medication.id);
    const pickButton = element("button", "clinical-button clinical-button--primary", "처방 담기");
    pickButton.type = "button";
    pickButton.dataset.pickMedication = medication.id;
    const reviewButton = element("button", "clinical-button rx-result__review", busy ? "AI 검토 중…" : "AI 검토");
    reviewButton.type = "button";
    reviewButton.dataset.reviewMedication = medication.id;
    reviewButton.disabled = busy;
    actions.append(pickButton, element("span", "rx-result__actions-divider"), reviewButton);
    item.append(actions);

    const details = element("details", "rx-result__details");
    details.open = expandedMedicationIds.has(medication.id);
    details.dataset.medicationDetails = medication.id;
    details.append(element("summary", "rx-result__details-summary", "자세히 보기"));
    const list = element("dl", "rx-detail-list");
    for (const [term, value] of medicationDetailRows(medication)) {
      list.append(element("dt", "", term), element("dd", "", value));
    }
    details.append(list);
    item.append(details);

    refs.medicationResultList.append(item);
  }
}

/**
 * Marks the decisive phrases inside the rule text without building HTML from
 * strings, so a clinician can read the criterion wording itself, not a paraphrase.
 */
const HIGHLIGHT_PAIR_COLORS = 5;

function phrasesOverlap(left, right) {
  return left === right || left.includes(right) || right.includes(left);
}

/**
 * Groups the phrases that stand for the same fact on both sides of a criterion -
 * "J18" in the rule and "J18.9" in the chart - and gives each group its own
 * colour, so a reader can see which sentence answers which record. Phrases that
 * appear on only one side stay neutral: they are emphasis, not a pairing.
 */
function buildHighlightPairs(check, counter) {
  const chartPhrases = [...new Set(
    (check.chart.findings ?? []).flatMap(({ highlights }) => highlights ?? []).filter(Boolean),
  )];
  const pairs = new Map();
  for (const { rule, chart } of check.source.pairs ?? []) {
    if (pairs.has(rule)) continue;
    // The counter runs across the whole review, so neighbouring criteria do not
    // both come out in the same colour.
    const tone = counter.next % HIGHLIGHT_PAIR_COLORS;
    counter.next += 1;
    pairs.set(rule, tone);
    pairs.set(chart, tone);
    // A record shows the fact in its own wording too - J18.9 for J18 - so the
    // colour follows onto whichever form the chart happens to store.
    for (const candidate of chartPhrases) {
      if (!pairs.has(candidate) && phrasesOverlap(chart, candidate)) pairs.set(candidate, tone);
    }
  }
  return pairs;
}

function appendHighlightedText(node, text, highlights = [], pairs = new Map()) {
  const phrases = [...new Set(highlights.filter(Boolean))];
  let rest = String(text ?? "");
  while (rest) {
    let bestIndex = -1;
    let bestPhrase = "";
    for (const phrase of phrases) {
      const index = rest.indexOf(phrase);
      if (index !== -1 && (bestIndex === -1 || index < bestIndex || (index === bestIndex && phrase.length > bestPhrase.length))) {
        bestIndex = index;
        bestPhrase = phrase;
      }
    }
    if (bestIndex === -1) {
      node.append(rest);
      return;
    }
    if (bestIndex > 0) node.append(rest.slice(0, bestIndex));
    const mark = element("mark", "rx-source__mark-text", bestPhrase);
    if (pairs.has(bestPhrase)) mark.dataset.pair = String(pairs.get(bestPhrase));
    node.append(mark);
    rest = rest.slice(bestIndex + bestPhrase.length);
  }
}

function medicationReviewTransmission(review) {
  const findings = review.checks.reduce((total, item) => total + item.chart.findings.filter(({ eventId }) => eventId).length, 0);
  return [
    ["약품", `${review.medication.label} · ${review.medication.ingredient} · ${review.medication.code}`],
    ["이번 처방", [
      review.prescription.dose ? `1회 ${review.prescription.dose}${review.prescription.doseUnit}` : "",
      review.prescription.route,
      review.prescription.frequency,
      review.prescription.durationDays ? `${review.prescription.durationDays}일` : "",
    ].filter(Boolean).join(" · ") || "용법 미입력"],
    ["환자 컨텍스트", [
      Number.isInteger(review.patient.ageYears) ? `만 ${review.patient.ageYears}세` : "나이 미상",
      SEX_LABELS[review.patient.sex] ?? "성별 미상",
      INSURANCE_LABELS[review.patient.insuranceType] ?? INSURANCE_LABELS.unknown,
      `확인 상병 ${review.patient.conditionCount}건`,
    ].join(" · ")],
    ["대조 자료", `등록 기준 ${review.checks.length}개 · 연결된 차트 기록 ${findings}건`],
    ["전송하지 않음", "환자 이름·등록번호·연락처·주소·자유 메모"],
  ];
}

function renderMedicationReviewPipeline(review) {
  clear(refs.medicationReviewPipeline);
  refs.medicationReviewProcess.hidden = true;
  setReviewProcessOpen(false);
  const provider = medicationReviewProvider();
  const cloudLabel = provider === "frontier"
    ? `클라우드 LLM 규칙 재검토 · ${medicationReviewCapability.model || "연결된 모델"}`
    : provider === "local"
      ? "LLM 규칙 재검토 · 이 기기의 로컬 모델"
      : "클라우드 LLM 규칙 재검토 · 모델 미설정";
  const steps = [
    ["1", "이 브라우저에서 규칙 대조", "선택 환자의 확정 차트와 등록된 급여기준을 항목별로 맞춥니다."],
    ["2", "대조 결과 전송", `같은 출처 API ${MEDICATION_REVIEW_ENDPOINT}로 아래 내역만 보냅니다.`],
    ["3", cloudLabel, "기준 문구와 환자 기록을 다시 대조해 판정과 근거 문장을 작성합니다."],
    ["4", "판정·근거·출처 반환", "규칙 판정보다 관대한 답과 없는 근거 인용은 서버가 되돌립니다."],
  ];
  const list = element("ol", "rx-pipeline");
  for (const [index, title, detail] of steps) {
    const item = element("li", "rx-pipeline__step");
    item.append(
      element("span", "rx-pipeline__index", index),
      (() => {
        const text = element("span", "rx-pipeline__text");
        text.append(element("b", "", title), element("span", "", detail));
        return text;
      })(),
    );
    list.append(item);
  }
  const payload = element("details", "rx-pipeline__payload");
  payload.append(element("summary", "rx-result__details-summary", "전송 내역 보기"));
  const rows = element("dl", "rx-detail-list");
  for (const [term, value] of medicationReviewTransmission(review)) {
    rows.append(element("dt", "", term), element("dd", "", value));
  }
  payload.append(rows);
  refs.medicationReviewPipeline.append(list, payload);
  if (!provider) {
    refs.medicationReviewPipeline.append(element(
      "p",
      "rx-review__boundary",
      "지금은 모델이 설정되지 않아 2~3단계를 실행하지 않았습니다. 환자 자료를 전송하지 않고 규칙 판정만 표시합니다.",
    ));
  }
}

/**
 * Hovering peeks, clicking pins. Used for anything that should be available on
 * demand without taking room from the work: the review pipeline and the
 * boundary notices.
 */
function attachHoverPopover(host, trigger, panel) {
  if (!host || !trigger || !panel) return () => {};
  let pinned = false;
  const setOpen = (open) => {
    panel.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
  };
  trigger.addEventListener("click", () => {
    pinned = !pinned;
    setOpen(pinned);
  });
  host.addEventListener("mouseenter", () => {
    if (!pinned) setOpen(true);
  });
  host.addEventListener("mouseleave", () => {
    if (!pinned) setOpen(false);
  });
  host.addEventListener("focusin", () => {
    if (!pinned) setOpen(true);
  });
  host.addEventListener("focusout", (event) => {
    if (!pinned && !host.contains(event.relatedTarget)) setOpen(false);
  });
  return () => {
    pinned = false;
    setOpen(false);
  };
}

const setReviewProcessOpen = (() => {
  const reset = attachHoverPopover(
    refs.medicationReviewProcess,
    refs.medicationReviewProcessSummary,
    refs.medicationReviewPipeline,
  );
  return (open) => {
    if (!open) reset();
  };
})();

for (const host of document.querySelectorAll("[data-rx-popover]")) {
  attachHoverPopover(host, host.querySelector(".rx-notice__summary"), host.querySelector(".rx-notice__body"));
}

/**
 * Both sides of a criterion get their own source text: the rule wording on the
 * left, the stored chart row on the right, each with the deciding part marked.
 */
function chartRecordPane(check, pairs) {
  const records = check.chart.findings.filter(({ record }) => Array.isArray(record) && record.length);
  if (!records.length) return null;
  const pane = element("div", "rx-source__pane");
  pane.append(element("h6", "rx-source__pane-title", "환자 기록 원문"));
  for (const item of records.slice(0, 3)) {
    pane.append(element("p", "rx-source__article", `${item.label}${item.provenance ? ` · ${item.provenance}` : ""}`));
    const rows = element("dl", "rx-detail-list rx-source__record");
    for (const [term, value] of item.record) {
      const definition = element("dd", "");
      appendHighlightedText(definition, value, item.highlights, pairs);
      rows.append(element("dt", "", term), definition);
    }
    pane.append(rows);
  }
  return pane;
}

function rulePane(check, pairs) {
  if (!check.source.excerpt) return null;
  const pane = element("div", "rx-source__pane");
  pane.append(element("h6", "rx-source__pane-title", "기준 원문"));
  if (check.source.article) pane.append(element("p", "rx-source__article", check.source.article));
  const excerpt = element("blockquote", "rx-source__excerpt");
  appendHighlightedText(excerpt, check.source.excerpt, check.source.highlights, pairs);
  pane.append(excerpt);
  return pane;
}

function renderMedicationReviewSources(review) {
  clear(refs.medicationReviewSources);
  const pairCounter = { next: 0 };
  for (const check of review.checks) {
    const item = element("li", "rx-source");
    item.dataset.verdict = check.verdict;
    const title = element("div", "rx-source__title");
    title.append(
      element("span", "rx-source__mark", MEDICATION_REVIEW_VERDICTS[check.verdict].symbol),
      element("b", "", check.title),
    );
    const grid = element("div", "rx-source__grid");
    const criterion = element("div", "rx-source__cell");
    criterion.append(
      element("span", "rx-source__cell-label", "삭감 근거"),
      element("b", "", check.criterion.requirement),
      element("span", "rx-source__cell-detail", check.criterion.detail),
    );
    const chart = element("div", "rx-source__cell");
    chart.append(
      element("span", "rx-source__cell-label", "환자 정보"),
      element("b", "", check.chart.detail),
    );
    const findings = element("ul", "rx-source__findings");
    for (const record of check.chart.findings) {
      const entry = element("li", "");
      entry.append(
        element("b", "", record.label),
        element("span", "", [
          record.code,
          record.date ? displayDate(record.date) : "",
          record.provenance,
          record.detail,
        ].filter(Boolean).join(" · ")),
      );
      findings.append(entry);
    }
    if (!check.chart.findings.length) {
      findings.append(element("li", "rx-source__findings-empty", "대조된 환자 기록 없음"));
    }
    chart.append(findings);
    grid.append(criterion, chart);
    item.append(title, grid);

    const pairs = buildHighlightPairs(check, pairCounter);
    const panes = [rulePane(check, pairs), chartRecordPane(check, pairs)].filter(Boolean);
    if (panes.length) {
      const open = expandedSourceIds.has(check.id);
      const trigger = element("button", "rx-source__origin-trigger", "근거 원문과 환자 기록 원문 확인");
      trigger.type = "button";
      trigger.dataset.sourceOrigin = check.id;
      trigger.setAttribute("aria-expanded", String(open));
      const origins = element("div", "rx-source__origins");
      origins.hidden = !open;
      origins.append(...panes);
      item.append(trigger, origins);
    }

    item.append(element("p", "rx-source__document", [
      check.source.documentNumber,
      check.source.version ? `v${check.source.version}` : "",
      check.source.effectiveFrom ? `시행 ${check.source.effectiveFrom}` : "",
    ].filter(Boolean).join(" · ")));
    refs.medicationReviewSources.append(item);
  }
}

function renderMedicationReview(review) {
  refs.medicationReviewEmpty.hidden = true;
  refs.medicationReviewBody.hidden = false;
  clear(refs.medicationReviewVerdict);
  refs.medicationReviewVerdict.dataset.tone = review.verdictTone;
  const text = element("span", "rx-verdict__text");
  text.append(element("b", "", review.verdictLabel), element("span", "", review.summary));
  refs.medicationReviewVerdict.append(element("span", "rx-verdict__symbol", review.verdictSymbol), text);
  renderMedicationReviewMode(review);
  renderMedicationReviewPipeline(review);
  refs.medicationReviewProcess.hidden = false;
  if (review.note) text.append(element("span", "rx-verdict__note", review.note));
  renderMedicationReviewSources(review);
}

function resetMedicationReviewPanel() {
  refs.medicationReviewEmpty.hidden = false;
  refs.medicationReviewBody.hidden = true;
  clear(refs.medicationReviewVerdict);
  clear(refs.medicationReviewPipeline);
  clear(refs.medicationReviewSources);
  activeMedicationReviewId = "";
  expandedSourceIds.clear();
  renderMedicationReviewMode();
}

async function runMedicationReview(medicationId) {
  const medication = findMedicationInCatalog(medicationId);
  const patient = selectedPatient();
  if (!medication || !patient || medicationReviewBusyIds.has(medicationId)) return;
  const encounter = currentEncounter(patient);
  let review;
  try {
    review = buildMedicationClaimComparison({
      patient,
      medication,
      prescription: catalogDosingDraft(medication),
      encounterId: encounter?.id ?? "",
      asOf: today(),
    });
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "약제 사전점검을 만들지 못했습니다.", "error");
    return;
  }
  medicationReviewById.clear();
  expandedSourceIds.clear();
  medicationReviewById.set(medicationId, review);
  activeMedicationReviewId = medicationId;
  renderMedicationResults();
  renderMedicationReview(review);
  const provider = medicationReviewProvider();
  if (!provider) {
    setStatus("등록된 예시 기준과 이 환자 기록을 대조한 규칙 기반 사전점검입니다. AI 모델이 설정되지 않아 환자 자료를 전송하지 않았습니다.");
    return;
  }
  medicationReviewBusyIds.add(medicationId);
  renderMedicationResults();
  try {
    const response = await fetch(MEDICATION_REVIEW_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ comparison: review, provider }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "AI 검토를 사용할 수 없습니다.");
    const merged = applyMedicationReviewDraft(review, result.draft ?? {});
    if (selectedPatient()?.id !== patient.id) return;
    medicationReviewById.set(medicationId, merged);
    if (refs.prescriptionDialog.open) renderMedicationReview(merged);
    setStatus("AI 검토 초안을 만들었습니다. 급여 인정·삭감을 확정하지 않습니다.", "success");
  } catch (error) {
    setStatus(`${error instanceof Error ? error.message : "AI 검토 연결 실패"} 규칙 기반 사전점검을 유지합니다.`);
  } finally {
    medicationReviewBusyIds.delete(medicationId);
    renderMedicationResults();
  }
}

function openPrescriptionDialog() {
  const patient = selectedPatient();
  const encounter = currentEncounter(patient);
  if (!patient || !encounter || encounter.recordStatus !== "draft" || encounter.status !== "in-progress") {
    setStatus("진료를 시작한 뒤 처방을 담을 수 있습니다.", "error");
    return;
  }
  refs.prescriptionDialog.closest("details")?.setAttribute("open", "");
  refs.rxDialogContext.textContent = encounterDialogContext(patient, encounter);
  medicationReviewById.clear();
  resetMedicationReviewPanel();
  renderMedicationResults();
  if (!refs.prescriptionDialog.open) refs.prescriptionDialog.showModal();
  refs.medicationSearchInput.focus();
}

function closePrescriptionDialog() {
  if (refs.prescriptionDialog.open) refs.prescriptionDialog.close();
}

refs.openPrescriptionDialog.addEventListener("click", openPrescriptionDialog);
refs.closePrescriptionDialog.addEventListener("click", closePrescriptionDialog);
refs.medicationSearchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  medicationSearchResults = searchMedicationCatalog(refs.medicationSearchInput.value, 8);
  renderMedicationResults();
});

refs.medicationSearchInput.addEventListener("input", () => {
  medicationSearchResults = searchMedicationCatalog(refs.medicationSearchInput.value, 8);
  renderMedicationResults();
});

/**
 * The rule text and the chart row are one comparison, so a single control reveals
 * both panes at once - reached from the trigger or from the row around it.
 */
function toggleSourceOrigins(source) {
  const trigger = source?.querySelector("[data-source-origin]");
  const origins = source?.querySelector(".rx-source__origins");
  if (!trigger || !origins) return;
  const nextOpen = origins.hidden;
  origins.hidden = !nextOpen;
  trigger.setAttribute("aria-expanded", String(nextOpen));
  if (nextOpen) expandedSourceIds.add(trigger.dataset.sourceOrigin);
  else expandedSourceIds.delete(trigger.dataset.sourceOrigin);
}

refs.medicationReviewSources.addEventListener("click", (event) => {
  if (!event.target.closest("[data-source-origin]")) return;
  toggleSourceOrigins(event.target.closest(".rx-source"));
});

refs.medicationResultList.addEventListener("toggle", (event) => {
  const details = event.target.closest("[data-medication-details]");
  if (!details) return;
  const id = details.dataset.medicationDetails;
  if (details.open) expandedMedicationIds.add(id);
  else expandedMedicationIds.delete(id);
}, true);

refs.medicationResultList.addEventListener("click", (event) => {
  const reviewButton = event.target.closest("[data-review-medication]");
  if (reviewButton) {
    void runMedicationReview(reviewButton.dataset.reviewMedication);
    return;
  }
  const pickButton = event.target.closest("[data-pick-medication]");
  if (pickButton) pickCatalogMedication(pickButton.dataset.pickMedication);
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
    selectedCatalogMedicationId = "";
    refs.medicationSelectedSummary.textContent = "검색 결과에서 약을 선택하면 기본 용법이 채워집니다. 용법은 의료진이 직접 확인하고 수정하세요.";
    closePrescriptionDialog();
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
    resetOrderSelection();
    closeOrderDialog();
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
      source: state.demo ? { kind: "demo", label: "예시 입력" } : { kind: "manual", label: "직접 입력 · 검토 대기" },
    }), state.demo ? "예시 차트에 기록을 추가했습니다." : "검토 대기 기록을 추가했습니다. 확정 진료 사실·AI·급여 근거에는 포함되지 않습니다.");
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
      sourceDocumentNumber: refs.ruleSourceDocumentNumber.value,
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

const workspaceTabList = document.querySelector(".workspace-tabs");

workspaceTabList.addEventListener("keydown", (event) => {
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

workspaceTabList.addEventListener("scroll", () => updateHorizontalScrollPosition(workspaceTabList), { passive: true });
refs.patientList.addEventListener("scroll", () => updateHorizontalScrollPosition(refs.patientList), { passive: true });
window.addEventListener("resize", () => {
  updateHorizontalScrollPosition(workspaceTabList);
  updateHorizontalScrollPosition(refs.patientList);
}, { passive: true });

for (const button of document.querySelectorAll("[data-board-scope]")) {
  button.addEventListener("click", () => {
    boardScope = button.dataset.boardScope;
    for (const item of document.querySelectorAll("[data-board-scope]")) item.setAttribute("aria-pressed", String(item === button));
    const patient = selectedPatient();
    if (patient) renderClaimBoard(patient);
  });
}

function handleClaimAttentionOpen(event) {
  const target = event.target.closest?.("[data-claim-work-item-open]");
  if (!target) return;
  const evaluationId = target.dataset.claimWorkItemOpen;
  if (!claimAttentionById.has(evaluationId)) return;
  openClaimWorkflowItem(evaluationId, { inputMethod: "청구 전 점검", focus: true });
}

refs.claimAttentionList.addEventListener("click", handleClaimAttentionOpen);
refs.claimAttentionAllList.addEventListener("click", handleClaimAttentionOpen);

function activateClaimSearchEntry(entry) {
  const target = entry?.target || {};
  if (target.targetType === "workflow") {
    return openClaimWorkflowItem(target.evaluationId, { inputMethod: "통합 검색", focus: true });
  }
  if (target.targetType === "adjudication") {
    const row = refs.claimAdjudicationList.querySelector(`[data-claim-adjudication-id="${CSS.escape(target.adjudicationId)}"]`);
    row?.scrollIntoView({ behavior: "smooth", block: "center" });
    row?.focus({ preventScroll: true });
    return row;
  }
  if (target.targetType === "quality") {
    selectDiseaseAssessment(target.diseaseId);
    refs.diseaseQualityDisclosure.open = true;
    const metric = refs.diseaseQualityMetrics.querySelector(`[data-quality-metric-id="${CSS.escape(target.metricId)}"]`);
    if (metric) {
      metric.open = true;
      metric.scrollIntoView({ behavior: "smooth", block: "center" });
      metric.querySelector("summary")?.focus({ preventScroll: true });
      return metric;
    }
    refs.diseaseAssessmentPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    refs.diseaseAssessmentPanel.focus({ preventScroll: true });
    return refs.diseaseAssessmentPanel;
  }
  if (target.targetType === "rule") {
    const evaluation = [...claimEvaluationById.values()].find(({ ruleId }) => ruleId === target.ruleId);
    if (evaluation) return openClaimWorkflowItem(evaluation.id, { inputMethod: "규칙 검색", focus: true });
    const manager = byId("ruleVersionManager");
    if (manager) manager.open = true;
    const row = refs.ruleVersionList.querySelector(`[data-rule-version-row="${CSS.escape(target.ruleId)}"]`);
    row?.scrollIntoView({ behavior: "smooth", block: "center" });
    return row;
  }
  return null;
}

refs.claimSearch.addEventListener("input", renderClaimSearchResults);
refs.claimSearch.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  refs.claimSearch.value = "";
  renderClaimSearchResults();
});
refs.claimSearchClear.addEventListener("click", () => {
  refs.claimSearch.value = "";
  renderClaimSearchResults();
  refs.claimSearch.focus();
});
refs.claimSearchResults.addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-claim-search-result]");
  if (!button) return;
  const entry = claimSearchEntryById.get(button.dataset.claimSearchResult);
  if (entry) activateClaimSearchEntry(entry);
});

function selectDiseaseAssessment(diseaseId, { focus = false } = {}) {
  const patient = selectedPatient();
  if (!patient || !diseaseId) return;
  refs.diseaseQualityDisclosure.open = false;
  refs.diseaseDiagnosticDisclosure.open = false;
  refs.diseaseAssessmentSources.open = false;
  const selectedId = renderDiseaseAssessment(patient, diseaseId);
  if (!selectedId) return;
  if (focus) document.getElementById(diseaseTabId(patient.id, selectedId))?.focus();
  const selectedTab = refs.diseaseAssessmentTabs.querySelector(`[data-disease-assessment-id="${CSS.escape(selectedId)}"]`);
  refs.claimBoardLive.textContent = `${selectedTab?.querySelector("b")?.textContent ?? "질환"} 적정성·진단 근거를 표시했습니다. 왼쪽 급여 주의사항은 전체 질환 기준으로 유지됩니다.`;
}

refs.diseaseAssessmentTabs.addEventListener("click", (event) => {
  const tab = event.target.closest?.("[data-disease-assessment-id]");
  if (!tab) return;
  selectDiseaseAssessment(tab.dataset.diseaseAssessmentId);
});

refs.diseaseAssessmentTabs.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = [...refs.diseaseAssessmentTabs.querySelectorAll("[role='tab']")];
  if (!tabs.length) return;
  const current = Math.max(0, tabs.indexOf(event.target.closest?.("[role='tab']")));
  const next = event.key === "Home"
    ? tabs[0]
    : event.key === "End"
      ? tabs.at(-1)
      : tabs[(current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
  event.preventDefault();
  selectDiseaseAssessment(next.dataset.diseaseAssessmentId, { focus: true });
});

function openClaimReviewDetail(evaluationId, {
  targetStage = "",
  inputMethod = "카드 선택",
  focus = true,
  announce = true,
} = {}) {
  const card = refs.claimBoard.querySelector(`[data-claim-evaluation-id="${CSS.escape(evaluationId)}"]`);
  const toggle = card?.querySelector("[data-claim-detail-toggle]");
  const details = toggle ? document.getElementById(toggle.getAttribute("aria-controls")) : null;
  if (!toggle || !details || !card) return null;
  for (const opened of refs.claimReviewDetailHost.querySelectorAll("dialog[open]")) {
    if (opened === details) continue;
    opened.dataset.claimCloseReason = "switch";
    opened.close();
  }
  const isMobileDetail = claimDetailMediaQuery.matches;
  if (!details.open) {
    details.setAttribute("aria-modal", String(isMobileDetail));
    if (isMobileDetail) details.showModal();
    else details.show();
  }
  activeClaimDetailId = evaluationId;
  refs.claimReviewDetailHost.dataset.active = "true";
  refs.claimReviewDetailHost.querySelector(".claim-review-detail-empty")?.setAttribute("hidden", "");
  details.dataset.claimReviewInputMethod = inputMethod;
  refs.claimBoard.querySelectorAll('[aria-current="true"]').forEach((node) => node.removeAttribute("aria-current"));
  card.setAttribute("aria-current", "true");
  toggle.setAttribute("aria-expanded", "true");
  toggle.setAttribute("aria-label", `${toggle.dataset.claimDetailSummary} · 근거·세부정보 열림`);
  card.dataset.claimDetailOpen = "true";
  toggle.querySelector("[data-claim-detail-label]").textContent = "근거·세부정보 열림";
  if (targetStage && CLAIM_REVIEW_STAGE_ORDER.includes(targetStage)) {
    const select = details.querySelector("[data-claim-review-select]");
    if (select) {
      select.value = targetStage;
      const outcome = details.querySelector("[data-claim-review-outcome]");
      if (outcome) outcome.disabled = targetStage !== "reviewed";
    }
    if (focus) details.querySelector("[data-claim-review-reason]")?.focus();
  } else if (focus) {
    details.querySelector("[data-claim-detail-close]")?.focus();
  }
  const evaluation = claimEvaluationById.get(evaluationId);
  if (announce) {
    refs.claimBoardLive.textContent = `${evaluation?.title ?? "급여 항목"}의 자동 판정 근거와 담당자 검토 기록을 열었습니다.`;
  }
  return details;
}

function openClaimWorkflowItem(evaluationId, { inputMethod = "청구 전 점검", focus = true } = {}) {
  if (!claimEvaluationById.has(evaluationId)) {
    refs.claimBoardLive.textContent = "이 항목과 연결된 보험심사팀 업무 카드를 찾지 못했습니다.";
    return null;
  }
  const workflow = byId("claimWorkflowDisclosure");
  if (workflow) workflow.open = true;
  const open = () => {
    const card = refs.claimBoard.querySelector(`[data-claim-evaluation-id="${CSS.escape(evaluationId)}"]`);
    if (!card) return null;
    card.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    return openClaimReviewDetail(evaluationId, { inputMethod, focus });
  };
  requestAnimationFrame(() => requestAnimationFrame(open));
  return evaluationId;
}

claimDetailMediaQuery.addEventListener("change", () => {
  if (!activeClaimDetailId) return;
  const details = refs.claimReviewDetailHost.querySelector("dialog[open]");
  if (!details) return;
  const evaluationId = activeClaimDetailId;
  const focusedControl = details.contains(document.activeElement) ? document.activeElement : null;
  details.dataset.claimCloseReason = "switch";
  details.close();
  requestAnimationFrame(() => {
    if (activeClaimDetailId !== evaluationId || !claimEvaluationById.has(evaluationId)) return;
    openClaimReviewDetail(evaluationId, { inputMethod: "화면 크기 전환", focus: false, announce: false });
    focusedControl?.focus({ preventScroll: true });
  });
});

refs.claimReviewDetailHost.addEventListener("click", async (event) => {
  const applyReview = event.target.closest?.("[data-claim-review-apply]");
  if (applyReview) {
    const evaluationId = applyReview.dataset.claimReviewApply;
    const evaluation = claimEvaluationById.get(evaluationId);
    const details = applyReview.closest("dialog");
    if (!evaluation || !details) return;
    const reviewMessage = details.querySelector("[data-claim-review-message]");
    for (const control of details.querySelectorAll("[data-claim-review-assignee], [data-claim-review-reviewer], [data-claim-review-reason], [data-claim-review-outcome]")) {
      control.setCustomValidity?.("");
    }
    if (reviewMessage) {
      reviewMessage.hidden = true;
      reviewMessage.textContent = "";
    }
    const nextStage = details.querySelector("[data-claim-review-select]")?.value;
    const metadata = {
      assignee: details.querySelector("[data-claim-review-assignee]")?.value,
      reviewer: details.querySelector("[data-claim-review-reviewer]")?.value,
      reason: details.querySelector("[data-claim-review-reason]")?.value,
      opinion: details.querySelector("[data-claim-review-opinion]")?.value,
      outcome: details.querySelector("[data-claim-review-outcome]")?.value,
    };
    applyReview.disabled = true;
    try {
      await moveClaimReview(evaluation, nextStage, details.dataset.claimReviewInputMethod || "상세 패널", metadata);
    } catch (error) {
      const message = error instanceof Error ? error.message : "검토 기록을 저장하지 못했습니다.";
      refs.claimBoardLive.textContent = message;
      setStatus(message, "error");
      if (reviewMessage) {
        reviewMessage.textContent = message;
        reviewMessage.hidden = false;
      }
      const invalidControl = message.includes("담당자를")
        ? details.querySelector("[data-claim-review-assignee]")
        : message.includes("기록자")
          ? details.querySelector("[data-claim-review-reviewer]")
          : message.includes("이유")
            ? details.querySelector("[data-claim-review-reason]")
            : message.includes("승인·보류·예외")
              ? details.querySelector("[data-claim-review-outcome]")
              : null;
      invalidControl?.setCustomValidity?.(message);
      invalidControl?.focus?.({ preventScroll: true });
      invalidControl?.reportValidity?.();
      applyReview.disabled = false;
    }
    return;
  }
  const close = event.target.closest?.("[data-claim-detail-close]");
  if (close) {
    close.closest("dialog")?.close();
    return;
  }
});

refs.claimBoard.addEventListener("click", (event) => {
  const toggle = event.target.closest?.("[data-claim-detail-toggle]");
  if (!toggle) return;
  const evaluationId = toggle.dataset.claimDetailToggle;
  const details = document.getElementById(toggle.getAttribute("aria-controls"));
  if (!evaluationId || !details) return;
  if (details.open) {
    details.close();
    return;
  }
  openClaimReviewDetail(evaluationId);
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
  if (evaluation) openClaimReviewDetail(evaluationId, { targetStage: nextStage, inputMethod: "드래그 이동" });
});

refs.claimBoard.addEventListener("dragend", clearClaimDragState);

refs.claimReviewDetailHost.addEventListener("change", (event) => {
  const select = event.target.closest?.("[data-claim-review-select]");
  if (!select) return;
  const evaluationId = select.dataset.claimReviewSelect;
  const details = select.closest("dialog");
  const outcome = details?.querySelector(`[data-claim-review-outcome="${CSS.escape(evaluationId)}"]`);
  const assignee = details?.querySelector(`[data-claim-review-assignee="${CSS.escape(evaluationId)}"]`);
  const reason = details?.querySelector(`[data-claim-review-reason="${CSS.escape(evaluationId)}"]`);
  if (outcome) outcome.disabled = select.value !== "reviewed";
  if (assignee) assignee.required = select.value !== "new";
  if (reason) reason.required = select.value !== details.dataset.claimReviewCurrentStage;
  if (details) details.dataset.claimReviewInputMethod = "단계 선택";
  refs.claimBoardLive.textContent = `${CLAIM_REVIEW_STAGE_LABELS[select.value]} 단계를 선택했습니다. 담당·이동 사유·기록자를 확인한 뒤 저장하세요.`;
});

refs.claimReviewDetailHost.addEventListener("input", (event) => {
  const control = event.target.closest?.("[data-claim-review-assignee], [data-claim-review-reviewer], [data-claim-review-reason], [data-claim-review-outcome]");
  if (!control) return;
  control.setCustomValidity?.("");
  const message = control.closest("dialog")?.querySelector("[data-claim-review-message]");
  if (message) {
    message.hidden = true;
    message.textContent = "";
  }
});

function loadDemo() {
  if (blockClinicalContextChange({ patientChanged: true })) return;
  state = createDemoEmrState();
  viewedEncounterId = "";
  activeTab = "encounter";
  eventFilter = "all";
  briefCache.clear();
  render();
  setStatus(`예시 환자 ${state.patients.length}명을 불러왔습니다. 변경 내용은 저장되지 않습니다.`, "success");
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
  downloadJson(exportEmrBackup(exportState), "policycompass-emr-backup-" + today() + ".json");
  setStatus(state.demo ? "기존 로컬 기록을 백업했습니다." : "전체 로컬 기록을 JSON으로 내보냈습니다.", "success");
}

refs.exportEmr.addEventListener("click", exportBackup);
refs.exportEmrSecondary.addEventListener("click", exportBackup);
refs.syncPersonalRecord?.addEventListener("click", exportPatientTransfer);
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
    downloadJson(bundle, `policycompass-fhir-${today()}.json`);
    setStatus(`선택 환자의 완료·서명 진료를 FHIR R4 Bundle로 내보냈습니다.${state.demo ? " · 예시 환자 파일" : ""}`, "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "FHIR 내보내기에 실패했습니다.", "error");
  }
});
refs.exportRecoveryRaw.addEventListener("click", () => {
  if (!state.recoveryRaw) {
    setStatus("내보낼 손상 저장 원본이 없습니다.");
    return;
  }
  downloadText(state.recoveryRaw, "policycompass-emr-recovery-raw-" + today() + ".json", "application/json;charset=utf-8");
  setStatus("손상 저장 원본을 변경 없이 내보냈습니다.", "success");
});

refs.wipeEmr.addEventListener("click", async () => {
  if (!window.confirm("이 브라우저의 PolicyCompass EMR 환자 기록과 기관 규칙을 모두 삭제할까요? 백업 없이는 복구할 수 없습니다.")) return;
  try {
    await withStateTransition(async () => {
      const cleared = await clearEmrState();
      adoptClearedEmrState(cleared);
      setStatus("이 브라우저의 PolicyCompass EMR 기록을 모두 삭제했습니다.", "success");
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

refs.runCopilot.addEventListener("click", runCopilot);

refs.eventDate.value = today();
initializeVitalOptions();
refs.eventSystem.value = "urn:kr:kcd";
refs.ruleEffectiveFrom.value = today();
refs.encounterDate.value = today();
refs.patientBirthDate.max = today();
refs.diagnosisSystem.value = "urn:kr:kcd";
retireLegacyCareBridge();
render();
if (!state.demo && state.storageError) {
  setStatus("로컬 저장을 읽지 못했습니다. 손상 원본을 내보낸 뒤 백업 복원 또는 전체 삭제로 정리하세요.", "error");
}
void checkAiStatus();
void checkMedicationReviewStatus();
