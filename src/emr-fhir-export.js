import {
  bloodPressureComponents,
  clinicalObservationSpec,
  isCanonicalClinicalObservation,
  LOINC_SYSTEM,
} from "./clinical-observations.js";

const FHIR_BASE_URL = "https://policycompass.local/fhir";
const SOURCE_PATIENT_IDENTITY_SYSTEM = `${FHIR_BASE_URL}/identifier/source-patient`;
const SOURCE_RESOURCE_IDENTITY_SYSTEM = `${FHIR_BASE_URL}/identifier/source-resource`;
const ENCOUNTER_LOCAL_DATE_URL = `${FHIR_BASE_URL}/StructureDefinition/encounter-local-date`;
const SIGNED_STATUSES = new Set(["signed", "legacy", "external"]);
const MEDICATION_STATUSES = new Set(["active", "on-hold", "stopped", "completed", "entered-in-error", "unknown"]);
const SERVICE_STATUSES = new Set(["active", "on-hold", "revoked", "completed", "entered-in-error", "unknown"]);
const CONDITION_CLINICAL_STATUSES = new Set(["active", "recurrence", "relapse", "inactive", "remission", "resolved"]);
const CONDITION_VERIFICATION_STATUSES = new Set(["unconfirmed", "provisional", "differential", "confirmed", "refuted", "entered-in-error"]);
const SERVICE_PRIORITIES = new Set(["routine", "urgent", "asap", "stat"]);
const ORDER_INTENTS = new Set(["order", "original-order", "reflex-order", "filler-order", "instance-order"]);

const SOAP_SECTIONS = [
  { field: "subjective", title: "S · 주관적 소견", code: "61150-9", display: "Subjective Narrative" },
  { field: "objective", title: "O · 객관적 소견", code: "61149-1", display: "Objective Narrative" },
  { field: "assessment", title: "A · 평가", code: "51848-0", display: "Assessment note" },
  { field: "plan", title: "P · 계획", code: "18776-5", display: "Plan of care note" },
];

function cleanText(value, maximum = 4_000) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, maximum)
    : "";
}

function finitePositiveNumber(value) {
  if (typeof value === "string" && !value.trim()) return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function validAgeYears(value) {
  if (typeof value === "string" && !value.trim()) return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 130 ? number : null;
}

function validDate(value) {
  const text = cleanText(value, 40);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === text ? text : "";
}

function validDateTime(value) {
  const date = validDate(value);
  if (date) return date;
  const text = cleanText(value, 80);
  if (!text) return "";
  const parsed = new Date(text);
  return Number.isNaN(parsed.valueOf()) ? "" : parsed.toISOString();
}

function exportInstant(exportedAt) {
  const parsed = exportedAt === undefined ? new Date() : new Date(exportedAt);
  if (Number.isNaN(parsed.valueOf())) throw new TypeError("FHIR 내보내기 시각이 유효하지 않습니다.");
  return parsed.toISOString();
}

function stableToken(value) {
  const text = String(value);
  const hashes = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    hashes[0] = Math.imul(hashes[0] ^ code, 0x01000193);
    hashes[1] = Math.imul(hashes[1] ^ code, 0x85ebca6b);
    hashes[2] = Math.imul(hashes[2] ^ code, 0xc2b2ae35);
    hashes[3] = Math.imul(hashes[3] ^ code, 0x27d4eb2f);
  }
  return hashes.map((hash) => (hash >>> 0).toString(16).padStart(8, "0")).join("");
}

function resourceIdentity(resourceType, sourceId, suffix = "") {
  const prefix = {
    Patient: "pt",
    Encounter: "enc",
    Composition: "doc",
    Condition: "dx",
    MedicationRequest: "rx",
    ServiceRequest: "ord",
    Observation: "obs",
    Procedure: "proc",
    AllergyIntolerance: "alg",
  }[resourceType] ?? "res";
  const id = `${prefix}-${stableToken(`${resourceType}:${sourceId}:${suffix}`)}`;
  return { id, fullUrl: `${FHIR_BASE_URL}/${resourceType}/${id}` };
}

function codeableConcept(event, fallback) {
  const system = cleanText(event?.system, 500);
  const code = cleanText(event?.code, 160);
  const label = cleanText(event?.label, 500) || fallback;
  const coding = {};
  if (system) coding.system = system;
  if (code) coding.code = code;
  if (label) coding.display = label;
  return {
    ...(Object.keys(coding).length ? { coding: [coding] } : {}),
    ...(label ? { text: label } : {}),
  };
}

function codingConcept(system, code, display) {
  return { coding: [{ system, code, display }], text: display };
}

function provenanceFields(event) {
  const source = event?.source && typeof event.source === "object" ? event.source : {};
  if (source.kind !== "fhir") return {};
  const sourceIdentity = cleanText(source.resourceId, 200);
  const metaSource = cleanText(source.metaSource, 200) || sourceIdentity;
  return {
    ...(metaSource ? { meta: { source: metaSource } } : {}),
    ...(sourceIdentity ? {
      identifier: [{ system: SOURCE_RESOURCE_IDENTITY_SYSTEM, value: sourceIdentity }],
    } : {}),
  };
}

function escapeXhtml(value) {
  return String(value)
    .replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, "\uFFFD")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function narrative(value) {
  return {
    status: "generated",
    div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>${escapeXhtml(value)}</p></div>`,
  };
}

function patientResource(patient, identity) {
  const name = cleanText(patient.name, 160);
  const mrn = cleanText(patient.mrn, 160);
  const sourcePatientIdentity = cleanText(patient.fhirIdentity, 2_000);
  const phone = cleanText(patient.phone, 100);
  const birthDate = validDate(patient.birthDate);
  const ageYears = validAgeYears(patient.ageYears);
  const gender = ["female", "male", "other", "unknown"].includes(patient.sex) ? patient.sex : "unknown";
  const address = cleanText(patient.address, 500);
  const bloodType = cleanText(patient.bloodType, 20);
  const insuranceType = cleanText(patient.insuranceType, 60);
  const emergency = patient.emergencyContact && typeof patient.emergencyContact === "object" ? patient.emergencyContact : {};
  const emergencyName = cleanText(emergency.name, 160);
  const emergencyRelation = cleanText(emergency.relation, 100);
  const emergencyPhone = cleanText(emergency.phone, 100);
  const extensions = [];
  if (!birthDate && ageYears !== null) {
    extensions.push({
      url: `${FHIR_BASE_URL}/StructureDefinition/age-at-export`,
      valueAge: { value: ageYears, unit: "year", system: "http://unitsofmeasure.org", code: "a" },
    });
  }
  if (bloodType && bloodType !== "unknown") {
    extensions.push({
      url: `${FHIR_BASE_URL}/StructureDefinition/recorded-blood-type`,
      valueCodeableConcept: { text: bloodType },
    });
  }
  if (insuranceType && insuranceType !== "unknown") {
    extensions.push({
      url: `${FHIR_BASE_URL}/StructureDefinition/local-insurance-type`,
      valueCode: insuranceType,
    });
  }
  return {
    resourceType: "Patient",
    id: identity.id,
    active: true,
    ...((mrn || sourcePatientIdentity) ? {
      identifier: [
        ...(mrn ? [{ system: `${FHIR_BASE_URL}/identifier/mrn`, value: mrn }] : []),
        ...(sourcePatientIdentity ? [{ system: SOURCE_PATIENT_IDENTITY_SYSTEM, value: sourcePatientIdentity }] : []),
      ],
    } : {}),
    ...(name ? { name: [{ use: "official", text: name }] } : {}),
    gender,
    ...(birthDate ? { birthDate } : {}),
    ...(extensions.length ? { extension: extensions } : {}),
    ...(phone ? { telecom: [{ system: "phone", value: phone }] } : {}),
    ...(address ? { address: [{ text: address }] } : {}),
    ...((emergencyName || emergencyRelation || emergencyPhone) ? {
      contact: [{
        ...(emergencyRelation ? { relationship: [{ text: emergencyRelation }] } : {}),
        ...(emergencyName ? { name: { text: emergencyName } } : {}),
        ...(emergencyPhone ? { telecom: [{ system: "phone", value: emergencyPhone }] } : {}),
      }],
    } : {}),
  };
}

function isCancelled(event) {
  return ["cancelled", "canceled"].includes(cleanText(event?.status, 40).toLowerCase());
}

function isExportableEncounter(event) {
  const signatureStatus = cleanText(event?.signature?.status, 40).toLowerCase();
  return event?.type === "encounter"
    && event.recordStatus === "final"
    && event.status === "finished"
    && event.source?.kind !== "import"
    && SIGNED_STATUSES.has(signatureStatus);
}

function eventDate(event, encounter, fallback) {
  return validDateTime(event?.date)
    || validDateTime(encounter?.finishedAt)
    || validDateTime(encounter?.startedAt)
    || validDateTime(encounter?.arrivedAt)
    || fallback;
}

function conditionResource(event, identity, patientReference, encounterReference, encounter, exportedAt) {
  const clinicalStatus = event.status;
  const requestedVerificationStatus = event.verificationStatus ?? event.certainty;
  const verificationStatus = requestedVerificationStatus;
  const diagnosisRole = cleanText(event.diagnosisRole, 40);
  return {
    resourceType: "Condition",
    id: identity.id,
    ...provenanceFields(event),
    ...(verificationStatus !== "entered-in-error" ? {
      clinicalStatus: codingConcept("http://terminology.hl7.org/CodeSystem/condition-clinical", clinicalStatus, clinicalStatus),
    } : {}),
    verificationStatus: codingConcept("http://terminology.hl7.org/CodeSystem/condition-ver-status", verificationStatus, verificationStatus),
    category: [
      codingConcept(
        "http://terminology.hl7.org/CodeSystem/condition-category",
        encounterReference ? "encounter-diagnosis" : "problem-list-item",
        encounterReference ? "Encounter Diagnosis" : "Problem List Item",
      ),
      codingConcept(`${FHIR_BASE_URL}/CodeSystem/diagnosis-role`, diagnosisRole, diagnosisRole),
    ],
    code: codeableConcept(event, "진단"),
    subject: { reference: patientReference },
    ...(encounterReference ? { encounter: { reference: encounterReference } } : {}),
    ...(validDate(event.onsetDate) ? { onsetDateTime: validDate(event.onsetDate) } : {}),
    recordedDate: eventDate(event, encounter, exportedAt),
  };
}

function dosageText(prescription) {
  if (cleanText(prescription.instructions, 2_000)) return cleanText(prescription.instructions, 2_000);
  return [
    [cleanText(String(prescription.dose ?? ""), 80), cleanText(prescription.doseUnit, 80)].filter(Boolean).join(" "),
    cleanText(prescription.route, 120),
    cleanText(prescription.frequency, 160),
    finitePositiveNumber(prescription.durationDays) ? `${finitePositiveNumber(prescription.durationDays)}일` : "",
  ].filter(Boolean).join(" · ");
}

function medicationResource(event, identity, patientReference, encounterReference, encounter, exportedAt) {
  const prescription = event.prescription && typeof event.prescription === "object" ? event.prescription : {};
  const requestedStatus = cleanText(event.status, 40);
  const status = requestedStatus;
  const dose = finitePositiveNumber(prescription.dose);
  const doseUnit = cleanText(prescription.doseUnit, 80);
  const route = cleanText(prescription.route, 160);
  const frequency = cleanText(prescription.frequency, 160);
  const instructions = dosageText(prescription);
  const quantity = finitePositiveNumber(prescription.quantity);
  const durationDays = finitePositiveNumber(prescription.durationDays);
  const dosage = {
    ...(instructions ? { text: instructions } : {}),
    ...(route ? { route: { text: route } } : {}),
    ...(frequency ? { timing: { code: { text: frequency } } } : {}),
    ...(dose ? { doseAndRate: [{ doseQuantity: { value: dose, ...(doseUnit ? { unit: doseUnit } : {}) } }] } : {}),
  };
  return {
    resourceType: "MedicationRequest",
    id: identity.id,
    ...provenanceFields(event),
    status,
    intent: ORDER_INTENTS.has(event.intent) ? event.intent : "order",
    medicationCodeableConcept: codeableConcept(event, "처방 약물"),
    subject: { reference: patientReference },
    ...(encounterReference ? { encounter: { reference: encounterReference } } : {}),
    authoredOn: eventDate(event, encounter, exportedAt),
    ...(Object.keys(dosage).length ? { dosageInstruction: [dosage] } : {}),
    ...((quantity || durationDays) ? {
      dispenseRequest: {
        ...(quantity ? { quantity: { value: quantity, ...(doseUnit ? { unit: doseUnit } : {}) } } : {}),
        ...(durationDays ? { expectedSupplyDuration: { value: durationDays, unit: "day", system: "http://unitsofmeasure.org", code: "d" } } : {}),
      },
    } : {}),
  };
}

function serviceCategory(kind) {
  const normalized = kind === "lab" ? "laboratory" : kind;
  const display = { laboratory: "Laboratory", imaging: "Imaging", procedure: "Procedure", referral: "Referral" }[normalized];
  return codingConcept(`${FHIR_BASE_URL}/CodeSystem/order-kind`, normalized, display);
}

function serviceResource(event, identity, patientReference, encounterReference, encounter, exportedAt) {
  const order = event.order && typeof event.order === "object" ? event.order : {};
  const requestedStatus = cleanText(event.status, 40);
  const status = requestedStatus;
  const requestedPriority = cleanText(order.priority, 40);
  const priority = requestedPriority;
  const instructions = cleanText(order.instructions, 2_000);
  return {
    resourceType: "ServiceRequest",
    id: identity.id,
    ...provenanceFields(event),
    status,
    intent: ORDER_INTENTS.has(event.intent) ? event.intent : "order",
    category: [serviceCategory(cleanText(order.kind, 40))],
    priority,
    code: codeableConcept(event, "검사·처치 오더"),
    subject: { reference: patientReference },
    ...(encounterReference ? { encounter: { reference: encounterReference } } : {}),
    authoredOn: eventDate(event, encounter, exportedAt),
    ...(instructions ? { patientInstruction: instructions, note: [{ text: instructions }] } : {}),
  };
}

function observationResource(event, identity, patientReference, encounterReference) {
  const observationSpec = event.system === LOINC_SYSTEM ? clinicalObservationSpec(event.code) : null;
  if (observationSpec && !isCanonicalClinicalObservation(event)) {
    throw new TypeError(`표준 Observation 값·단위가 유효하지 않습니다: ${event.id}`);
  }
  const value = typeof event.value === "number" && Number.isFinite(event.value) ? event.value : null;
  const textValue = value === null ? cleanText(event.value, 1_000) : "";
  const bloodPressure = event.system === LOINC_SYSTEM && event.code === "85354-9"
    ? bloodPressureComponents(textValue)
    : null;
  const bloodPressureComponent = (code, display, componentValue) => ({
    code: codingConcept("http://loinc.org", code, display),
    valueQuantity: {
      value: componentValue,
      unit: "mmHg",
      system: "http://unitsofmeasure.org",
      code: "mm[Hg]",
    },
  });
  return {
    resourceType: "Observation",
    id: identity.id,
    ...provenanceFields(event),
    status: ["final", "amended", "corrected"].includes(event.status) ? event.status : "final",
    code: codeableConcept(event, "검사 결과"),
    ...(bloodPressure ? {
      category: [codingConcept("http://terminology.hl7.org/CodeSystem/observation-category", "vital-signs", "Vital Signs")],
    } : {}),
    subject: { reference: patientReference },
    ...(encounterReference ? { encounter: { reference: encounterReference } } : {}),
    effectiveDateTime: validDateTime(event.observedAt) || validDateTime(event.date),
    ...(bloodPressure ? {
      component: [
        bloodPressureComponent("8480-6", "Systolic blood pressure", bloodPressure.systolic),
        bloodPressureComponent("8462-4", "Diastolic blood pressure", bloodPressure.diastolic),
      ],
    } : value !== null
      ? { valueQuantity: observationSpec
        ? {
          value,
          unit: observationSpec.unit,
          system: "http://unitsofmeasure.org",
          code: observationSpec.ucumCode,
        }
        : { value, ...(cleanText(event.unit, 80) ? { unit: cleanText(event.unit, 80) } : {}) } }
      : { valueString: textValue }),
    ...(cleanText(event.note, 2_000) ? { note: [{ text: cleanText(event.note, 2_000) }] } : {}),
  };
}

function procedureResource(event, identity, patientReference, encounterReference) {
  return {
    resourceType: "Procedure",
    id: identity.id,
    ...provenanceFields(event),
    status: "completed",
    code: codeableConcept(event, "시술·처치"),
    subject: { reference: patientReference },
    ...(encounterReference ? { encounter: { reference: encounterReference } } : {}),
    performedDateTime: validDateTime(event.date),
    ...(cleanText(event.note, 2_000) ? { note: [{ text: cleanText(event.note, 2_000) }] } : {}),
  };
}

function allergyResource(event, identity, patientReference, encounterReference, exportedAt) {
  const verificationStatus = event.verificationStatus ?? "confirmed";
  const note = cleanText(event.note, 2_000);
  return {
    resourceType: "AllergyIntolerance",
    id: identity.id,
    ...provenanceFields(event),
    clinicalStatus: codingConcept("http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", event.status, event.status),
    verificationStatus: codingConcept("http://terminology.hl7.org/CodeSystem/allergyintolerance-verification", verificationStatus, verificationStatus),
    code: codeableConcept(event, "알레르기"),
    patient: { reference: patientReference },
    ...(encounterReference ? { encounter: { reference: encounterReference } } : {}),
    recordedDate: validDateTime(event.date) || exportedAt,
    ...(note ? { reaction: [{ manifestation: [{ text: note }] }] } : {}),
  };
}

function compositionSection(definition, value, references) {
  const text = cleanText(value, 20_000);
  return {
    title: definition.title,
    code: codingConcept("http://loinc.org", definition.code, definition.display),
    ...(text ? { text: narrative(text) } : !references.length ? {
      emptyReason: codingConcept("http://terminology.hl7.org/CodeSystem/list-empty-reason", "nilknown", "Nil Known"),
    } : {}),
    ...(references.length ? { entry: references.map((reference) => ({ reference })) } : {}),
  };
}

function compositionResource(event, identity, patientReference, encounterReference, exportedAt, sectionReferences) {
  const soap = event.soap && typeof event.soap === "object" ? event.soap : {};
  const signature = event.signature && typeof event.signature === "object" ? event.signature : {};
  const signedAt = validDateTime(signature.signedAt);
  const authorDisplay = cleanText(signature.signer, 200) || cleanText(event.clinician, 200) || "PolicyCompass 로컬 내보내기";
  const documentDate = signedAt || validDateTime(event.finishedAt) || validDateTime(event.date) || exportedAt;
  return {
    resourceType: "Composition",
    id: identity.id,
    meta: {
      tag: [{
        system: `${FHIR_BASE_URL}/CodeSystem/export-trust`,
        code: "local-unverified",
        display: "Local record export without verified professional attestation",
      }],
    },
    status: "final",
    type: codingConcept("http://loinc.org", "11506-3", "Progress note"),
    subject: { reference: patientReference },
    encounter: { reference: encounterReference },
    date: documentDate,
    author: [{ display: authorDisplay }],
    title: `${validDate(event.date) || documentDate.slice(0, 10)} 외래 진료기록 · 로컬 미검증 교환본`,
    section: SOAP_SECTIONS.map((definition) => compositionSection(
      definition,
      soap[definition.field],
      sectionReferences[definition.field] ?? [],
    )),
  };
}

function encounterResource(event, identity, patientReference, diagnosisReferences, exportedAt) {
  const startedAt = validDateTime(event.startedAt) || validDateTime(event.arrivedAt) || validDateTime(event.date) || exportedAt;
  const finishedAt = validDateTime(event.finishedAt) || startedAt;
  if (new Date(finishedAt).valueOf() < new Date(startedAt).valueOf()) {
    throw new TypeError(`FHIR Encounter 종료 시각이 시작 시각보다 빠릅니다: ${event.id}`);
  }
  const clinician = cleanText(event.clinician, 200);
  const department = cleanText(event.department, 200);
  const chiefComplaint = cleanText(event.chiefComplaint, 2_000);
  const room = cleanText(event.room, 100);
  return {
    resourceType: "Encounter",
    id: identity.id,
    ...provenanceFields(event),
    status: "finished",
    class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "AMB", display: "ambulatory" },
    type: [{ text: cleanText(event.label, 500) || "외래 진료" }],
    subject: { reference: patientReference },
    period: { start: startedAt, end: finishedAt },
    ...(validDate(event.date) ? { extension: [{ url: ENCOUNTER_LOCAL_DATE_URL, valueDate: validDate(event.date) }] } : {}),
    ...(department ? { serviceType: { text: department } } : {}),
    ...(clinician ? { participant: [{ individual: { display: clinician } }] } : {}),
    ...(room ? { location: [{ location: { display: room }, status: "completed" }] } : {}),
    ...(chiefComplaint ? { reasonCode: [{ text: chiefComplaint }] } : {}),
    ...(diagnosisReferences.length ? {
      diagnosis: diagnosisReferences.map(({ reference }, index) => ({
        condition: { reference },
        rank: index + 1,
      })),
    } : {}),
  };
}

function assertPatient(patient) {
  if (!patient || typeof patient !== "object" || Array.isArray(patient)) throw new TypeError("FHIR로 내보낼 환자 데이터가 필요합니다.");
  if (!cleanText(patient.id, 200)) throw new TypeError("FHIR로 내보낼 환자 ID가 필요합니다.");
  if (patient.events !== undefined && !Array.isArray(patient.events)) throw new TypeError("환자 임상 이벤트 목록 형식이 유효하지 않습니다.");
}

function assertUniqueEventIds(events) {
  const seen = new Set();
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const id = cleanText(event.id, 200);
    if (["encounter", "condition", "medication", "service-request", "observation", "procedure", "allergy"].includes(event.type) && !id) {
      throw new TypeError(`FHIR 내보내기 대상 임상 이벤트 ID가 필요합니다: ${event.type}`);
    }
    if (!id) continue;
    if (seen.has(id)) throw new TypeError(`중복된 임상 이벤트 ID는 FHIR로 내보낼 수 없습니다: ${id}`);
    seen.add(id);
  }
}

function assertChildLifecycle(event) {
  const id = cleanText(event.id, 200) || "unknown";
  if (event.type === "condition") {
    const verificationStatus = event.verificationStatus ?? event.certainty;
    if (!CONDITION_CLINICAL_STATUSES.has(event.status) || !CONDITION_VERIFICATION_STATUSES.has(verificationStatus)) {
      throw new TypeError(`FHIR Condition 상태가 유효하지 않습니다: ${id}`);
    }
    if (!["primary", "secondary"].includes(event.diagnosisRole)) throw new TypeError(`FHIR 진단 역할이 유효하지 않습니다: ${id}`);
    return;
  }
  if (event.type === "medication") {
    const prescription = event.prescription && typeof event.prescription === "object" ? event.prescription : {};
    if (!MEDICATION_STATUSES.has(event.status) || !ORDER_INTENTS.has(event.intent)) {
      throw new TypeError(`FHIR MedicationRequest 상태·의도가 유효하지 않습니다: ${id}`);
    }
    if (event.source?.kind !== "fhir" && (
      finitePositiveNumber(prescription.dose) === null
      || !cleanText(prescription.doseUnit, 80)
      || !cleanText(prescription.route, 160)
      || !cleanText(prescription.frequency, 160)
      || finitePositiveNumber(prescription.durationDays) === null
      || finitePositiveNumber(prescription.quantity) === null
    )) {
      throw new TypeError(`FHIR MedicationRequest 처방 상세가 유효하지 않습니다: ${id}`);
    }
    return;
  }
  if (event.type === "allergy") {
    if (event.status !== "active" || (event.verificationStatus ?? "confirmed") !== "confirmed") {
      throw new TypeError(`FHIR AllergyIntolerance 상태가 유효하지 않습니다: ${id}`);
    }
    return;
  }
  const order = event.order && typeof event.order === "object" ? event.order : {};
  const kind = cleanText(order.kind, 40);
  if (
    !SERVICE_STATUSES.has(event.status)
    || !ORDER_INTENTS.has(event.intent)
    || !["lab", "laboratory", "imaging", "procedure", "referral"].includes(kind)
    || !SERVICE_PRIORITIES.has(order.priority)
  ) {
    throw new TypeError(`FHIR ServiceRequest 상태·의도·오더 상세가 유효하지 않습니다: ${id}`);
  }
}

/**
 * Export one local patient as a FHIR R4 collection Bundle.
 * Finalized, finished, attested encounters and their finalized child records are
 * emitted with finalized standalone clinical facts. The result is an exchange
 * artifact, not a server transaction request.
 */
export function exportPatientFhirBundle(patientInput, exportedAt) {
  assertPatient(patientInput);
  const timestamp = exportInstant(exportedAt);
  const events = Array.isArray(patientInput.events) ? patientInput.events : [];
  assertUniqueEventIds(events);

  const patientIdentity = resourceIdentity("Patient", patientInput.id);
  const patientScopedId = (sourceId) => `${patientInput.id}:${sourceId}`;
  const eligibleEncounters = events.filter(isExportableEncounter);
  const encounterById = new Map(eligibleEncounters.map((event) => [event.id, event]));
  const encounterIdentities = new Map(eligibleEncounters.map((event) => [event.id, resourceIdentity("Encounter", patientScopedId(event.id))]));

  const childEvents = events.filter((event) => {
    if (!["condition", "medication", "service-request", "allergy"].includes(event?.type)) return false;
    if (event.recordStatus !== "final" || isCancelled(event)) return false;
    if (event.source?.kind === "import") return false;
    return !event.encounterId || encounterById.has(event.encounterId);
  });
  const sourceEvents = events.filter((event) => {
    if (!["observation", "procedure"].includes(event?.type)) return false;
    if ((event.recordStatus && event.recordStatus !== "final") || isCancelled(event)) return false;
    if (event.source?.kind === "import") return false;
    if (event.encounterId && !encounterById.has(event.encounterId)) return false;
    if (event.type === "observation") {
      const hasValue = (typeof event.value === "number" && Number.isFinite(event.value)) || Boolean(cleanText(event.value, 1_000));
      return ["final", "amended", "corrected"].includes(event.status) && Boolean(validDateTime(event.date)) && hasValue;
    }
    return event.status === "completed" && Boolean(validDateTime(event.date));
  });

  const childDescriptors = childEvents.map((event) => {
    assertChildLifecycle(event);
    const resourceType = {
      condition: "Condition",
      medication: "MedicationRequest",
      "service-request": "ServiceRequest",
      allergy: "AllergyIntolerance",
    }[event.type];
    return { event, resourceType, identity: resourceIdentity(resourceType, patientScopedId(event.id)) };
  });
  const sourceDescriptors = sourceEvents.map((event) => {
    const resourceType = event.type === "observation" ? "Observation" : "Procedure";
    return { event, resourceType, identity: resourceIdentity(resourceType, patientScopedId(event.id)) };
  });

  const entries = [{ fullUrl: patientIdentity.fullUrl, resource: patientResource(patientInput, patientIdentity) }];

  for (const encounter of eligibleEncounters) {
    const encounterIdentity = encounterIdentities.get(encounter.id);
    const matchingChildren = childDescriptors.filter(({ event }) => event.encounterId === encounter.id);
    const matchingSources = sourceDescriptors.filter(({ event }) => event.encounterId === encounter.id);
    const diagnoses = matchingChildren
      .filter(({ event }) => event.type === "condition")
      .sort((left, right) => (left.event.diagnosisRole === "primary" ? -1 : 1) - (right.event.diagnosisRole === "primary" ? -1 : 1));
    const diagnosisReferences = diagnoses.map(({ event, identity }) => ({ reference: identity.fullUrl, diagnosisRole: event.diagnosisRole }));
    const sectionReferences = {
      subjective: [],
      objective: matchingSources.filter(({ event }) => event.type === "observation").map(({ identity }) => identity.fullUrl),
      assessment: diagnoses.map(({ identity }) => identity.fullUrl),
      plan: [
        ...matchingChildren.filter(({ event }) => ["medication", "service-request"].includes(event.type)),
        ...matchingSources.filter(({ event }) => event.type === "procedure"),
      ].map(({ identity }) => identity.fullUrl),
    };
    const compositionIdentity = resourceIdentity("Composition", patientScopedId(encounter.id), "soap");

    entries.push({
      fullUrl: encounterIdentity.fullUrl,
      resource: encounterResource(encounter, encounterIdentity, patientIdentity.fullUrl, diagnosisReferences, timestamp),
    });
    entries.push({
      fullUrl: compositionIdentity.fullUrl,
      resource: compositionResource(encounter, compositionIdentity, patientIdentity.fullUrl, encounterIdentity.fullUrl, timestamp, sectionReferences),
    });

    for (const descriptor of matchingChildren) {
      const { event, identity } = descriptor;
      const resource = event.type === "condition"
        ? conditionResource(event, identity, patientIdentity.fullUrl, encounterIdentity.fullUrl, encounter, timestamp)
        : event.type === "medication"
          ? medicationResource(event, identity, patientIdentity.fullUrl, encounterIdentity.fullUrl, encounter, timestamp)
          : event.type === "service-request"
            ? serviceResource(event, identity, patientIdentity.fullUrl, encounterIdentity.fullUrl, encounter, timestamp)
            : allergyResource(event, identity, patientIdentity.fullUrl, encounterIdentity.fullUrl, timestamp);
      entries.push({ fullUrl: identity.fullUrl, resource });
    }

    for (const descriptor of matchingSources) {
      const { event, identity } = descriptor;
      const resource = event.type === "observation"
        ? observationResource(event, identity, patientIdentity.fullUrl, encounterIdentity.fullUrl)
        : procedureResource(event, identity, patientIdentity.fullUrl, encounterIdentity.fullUrl);
      entries.push({ fullUrl: identity.fullUrl, resource });
    }
  }

  for (const descriptor of sourceDescriptors.filter(({ event }) => !event.encounterId)) {
    const { event, identity } = descriptor;
    const resource = event.type === "observation"
      ? observationResource(event, identity, patientIdentity.fullUrl, "")
      : procedureResource(event, identity, patientIdentity.fullUrl, "");
    entries.push({ fullUrl: identity.fullUrl, resource });
  }

  for (const descriptor of childDescriptors.filter(({ event }) => !event.encounterId)) {
    const { event, identity } = descriptor;
    const resource = event.type === "condition"
      ? conditionResource(event, identity, patientIdentity.fullUrl, "", null, timestamp)
      : event.type === "medication"
        ? medicationResource(event, identity, patientIdentity.fullUrl, "", null, timestamp)
        : event.type === "service-request"
          ? serviceResource(event, identity, patientIdentity.fullUrl, "", null, timestamp)
          : allergyResource(event, identity, patientIdentity.fullUrl, "", timestamp);
    entries.push({ fullUrl: identity.fullUrl, resource });
  }

  return {
    resourceType: "Bundle",
    type: "collection",
    timestamp,
    entry: entries,
  };
}
