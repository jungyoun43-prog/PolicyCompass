import { encounterSigningOmissions } from "./emr-encounter.js";
import { sha256Hex } from "./emr-model.js";

const text = (value) => String(value ?? "").trim();
const UNVERIFIED_SOURCE_KINDS = new Set(["fhir", "import"]);
const INACTIVE_ALLERGY_STATUSES = new Set(["inactive", "resolved", "cancelled", "entered-in-error"]);
const INACTIVE_MEDICATION_STATUSES = new Set(["stopped", "completed", "cancelled", "entered-in-error"]);

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
}

function isReviewableHistoricalEvent(event) {
  return event?.recordStatus !== "entered-in-error" && event?.recordStatus !== "draft";
}

function isUnverified(event) {
  return UNVERIFIED_SOURCE_KINDS.has(event?.source?.kind);
}

function activeAllergy(event) {
  return event?.type === "allergy"
    && isReviewableHistoricalEvent(event)
    && !INACTIVE_ALLERGY_STATUSES.has(text(event.status).toLocaleLowerCase());
}

function activeMedication(event, encounterId) {
  return event?.type === "medication"
    && event.encounterId !== encounterId
    && isReviewableHistoricalEvent(event)
    && !INACTIVE_MEDICATION_STATUSES.has(text(event.status).toLocaleLowerCase());
}

function signingPatientSnapshot(patient, encounter, records) {
  const encounterId = text(encounter?.id);
  const unrelatedEvents = (patient?.events ?? []).filter((event) =>
    event.id !== encounterId && event.encounterId !== encounterId);
  const encounterSnapshot = {
    ...encounter,
    id: encounterId,
    type: "encounter",
    label: text(encounter?.label) || "진료",
    recordStatus: encounter?.recordStatus ?? "draft",
  };
  const recordSnapshots = records.map((record) => ({
    ...record,
    encounterId: text(record.encounterId) || encounterId,
    recordStatus: record.recordStatus ?? "draft",
  }));
  return {
    ...patient,
    events: [...unrelatedEvents, encounterSnapshot, ...recordSnapshots],
  };
}

export function encounterSignReviewIdentity(patient, encounter) {
  return {
    patientId: text(patient?.id),
    patientMrn: text(patient?.mrn),
    encounterId: text(encounter?.id),
  };
}

export function assertEncounterSignReviewContext(reviewedIdentity, patient, encounter) {
  const activeIdentity = encounterSignReviewIdentity(patient, encounter);
  if (!reviewedIdentity
    || !reviewedIdentity.patientId
    || !reviewedIdentity.encounterId
    || reviewedIdentity.patientId !== activeIdentity.patientId
    || reviewedIdentity.patientMrn !== activeIdentity.patientMrn
    || reviewedIdentity.encounterId !== activeIdentity.encounterId) {
    throw new Error("검토한 환자 또는 Encounter가 현재 맥락과 다릅니다. 현재 기록을 다시 검토한 뒤 서명하세요.");
  }
  return activeIdentity;
}

export function assertEncounterSignReviewHasNoConflicts(review) {
  const conflicts = Array.isArray(review?.conflicts) ? review.conflicts : [];
  if (conflicts.length) {
    throw new Error(`해결되지 않은 충돌 ${conflicts.length}건이 있어 로컬 서명할 수 없습니다. 충돌 항목을 수정한 뒤 다시 완료·검토하세요.`);
  }
  return review;
}

export function assertEncounterSignReviewReady(review) {
  const omissions = Array.isArray(review?.omissions) ? review.omissions : [];
  const conflicts = Array.isArray(review?.conflicts) ? review.conflicts : [];
  if (omissions.length || conflicts.length) {
    throw new Error(
      `서명 전 해결할 누락 ${omissions.length}건·충돌 ${conflicts.length}건이 있습니다. 진료를 다시 열어 수정한 뒤 검토하세요.`,
    );
  }
  return review;
}

export function encounterSignReviewFingerprint(review) {
  return sha256Hex(JSON.stringify(stableJson(review ?? null)));
}

export function assertEncounterSignReviewFingerprint(reviewedFingerprint, review) {
  const activeFingerprint = encounterSignReviewFingerprint(review);
  if (!reviewedFingerprint || reviewedFingerprint !== activeFingerprint) {
    throw new Error("서명 전 검토 뒤 기록 내용이 변경되었습니다. 현재 내용을 다시 확인하고 검토 완료를 선택하세요.");
  }
  return activeFingerprint;
}

export function buildEncounterSignReview(patient, encounter, records = []) {
  const reviewRecords = records.filter((record) => record?.recordStatus !== "entered-in-error");
  const byType = (type) => reviewRecords.filter((record) => record.type === type);
  const historicalEvents = patient?.events ?? [];
  const allergies = historicalEvents.filter((event) => activeAllergy(event) && !isUnverified(event));
  const unverifiedAllergies = historicalEvents.filter((event) => activeAllergy(event) && isUnverified(event));
  const activeMedications = historicalEvents.filter((event) =>
    activeMedication(event, encounter?.id) && !isUnverified(event));
  const unverifiedActiveMedications = historicalEvents.filter((event) =>
    activeMedication(event, encounter?.id) && isUnverified(event));
  const measurements = byType("observation");
  const diagnoses = byType("condition");
  const prescriptions = byType("medication");
  const orders = byType("service-request");
  const soap = encounter?.soap ?? {};
  const omissions = encounterSigningOmissions(
    signingPatientSnapshot(patient, encounter, reviewRecords),
    encounter?.id,
  );

  const conflicts = [];
  const normalizedAllergies = allergies
    .map((item) => ({ item, normalized: text(item.label).toLocaleLowerCase() }))
    .filter(({ normalized }) => normalized);
  for (const prescription of prescriptions) {
    const medication = text(prescription.label).toLocaleLowerCase();
    const matched = normalizedAllergies.find(({ normalized }) =>
      medication.includes(normalized) || normalized.includes(medication));
    if (matched) {
      conflicts.push({
        code: `allergy-name-match:${prescription.id}:${matched.item.id}`,
        message: `새 처방 '${text(prescription.label)}'이 알레르기 '${matched.item.label}'와 이름이 일치합니다. 임상적 관련성을 확인하세요.`,
        target: "medicationName",
        action: "처방 수정",
      });
    }
  }

  return {
    patient: {
      id: text(patient?.id),
      name: text(patient?.name) || "미입력",
      mrn: text(patient?.mrn) || "미입력",
    },
    encounter: {
      id: text(encounter?.id) || "미입력",
      date: text(encounter?.date) || "미입력",
      label: text(encounter?.label) || "진료",
      department: text(encounter?.department) || "진료과 미입력",
      clinician: text(encounter?.clinician) || "의료진 미입력",
      room: text(encounter?.room) || "진료실 미입력",
      chiefComplaint: text(encounter?.chiefComplaint) || "주호소 미입력",
    },
    allergies,
    unverifiedAllergies,
    activeMedications,
    unverifiedActiveMedications,
    measurements,
    prescriptions,
    soap,
    diagnoses,
    orders,
    omissions,
    conflicts,
  };
}
