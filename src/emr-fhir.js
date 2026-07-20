import {
  createPatient,
  KOREA_TIMEZONE_OFFSET_MINUTES,
  localCalendarDate,
  normalizePatientEvent,
} from "./emr-model.js";
import {
  clinicalObservationSpec,
  isCanonicalClinicalObservation,
  LOINC_SYSTEM,
  normalizeClinicalObservationValue,
} from "./clinical-observations.js";

const MAXIMUM_ENTRIES = 1_000;
const FHIR_BASE_URL = "https://vitagraph.local/fhir";
const AGE_AT_EXPORT_URL = `${FHIR_BASE_URL}/StructureDefinition/age-at-export`;
const RECORDED_BLOOD_TYPE_URL = `${FHIR_BASE_URL}/StructureDefinition/recorded-blood-type`;
const LOCAL_INSURANCE_TYPE_URL = `${FHIR_BASE_URL}/StructureDefinition/local-insurance-type`;
const SOURCE_PATIENT_IDENTITY_SYSTEM = `${FHIR_BASE_URL}/identifier/source-patient`;
const SOURCE_RESOURCE_IDENTITY_SYSTEM = `${FHIR_BASE_URL}/identifier/source-resource`;
const MR_IDENTIFIER_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/v2-0203";
const ENCOUNTER_LOCAL_DATE_URL = `${FHIR_BASE_URL}/StructureDefinition/encounter-local-date`;
const DIAGNOSIS_ROLE_SYSTEM = `${FHIR_BASE_URL}/CodeSystem/diagnosis-role`;
const ORDER_KIND_SYSTEM = `${FHIR_BASE_URL}/CodeSystem/order-kind`;
const ORDER_INTENTS = new Set(["order", "original-order", "reflex-order", "filler-order", "instance-order"]);
const ORDER_KINDS = new Set(["laboratory", "imaging", "procedure", "referral"]);
const ORDER_PRIORITIES = new Set(["routine", "urgent", "asap", "stat"]);
const SOAP_SECTION_FIELDS = new Map([
  ["61150-9", "subjective"],
  ["61149-1", "objective"],
  ["51848-0", "assessment"],
  ["18776-5", "plan"],
]);

function codings(concept) {
  return Array.isArray(concept?.coding) ? concept.coding : [];
}

function firstCoding(concept) {
  return codings(concept).find(({ code, display }) => code || display) ?? {};
}

function conceptCode(concept) {
  return String(firstCoding(concept).code ?? "").trim();
}

function conceptSystem(concept) {
  return String(firstCoding(concept).system ?? "").trim();
}

function conceptLabel(concept, fallback) {
  return String(concept?.text ?? firstCoding(concept).display ?? firstCoding(concept).code ?? fallback).trim();
}

function statusCodes(concept) {
  return codings(concept).map(({ code }) => code).filter(Boolean);
}

function resourceDate(resource) {
  const localEncounterDates = resource?.resourceType === "Encounter"
    ? (Array.isArray(resource.extension) ? resource.extension : [])
      .filter(({ url }) => url === ENCOUNTER_LOCAL_DATE_URL)
      .map(({ valueDate }) => String(valueDate ?? "").trim())
    : [];
  if (localEncounterDates.length > 1) return "";
  if (localEncounterDates.length === 1) {
    const value = localEncounterDates[0];
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : null;
    if (parsed && !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value) return value;
    return "";
  }
  const value = resource.effectiveDateTime
    ?? resource.effectivePeriod?.start
    ?? resource.performedDateTime
    ?? resource.performedPeriod?.start
    ?? resource.authoredOn
    ?? resource.recordedDate
    ?? resource.onsetDateTime
    ?? resource.period?.start
    ?? resource.issued
    ?? "";
  return typeof value === "string" ? value.slice(0, 10) : "";
}

function sourceResourceProvenance(resource) {
  if (Object.hasOwn(resource, "identifier") && !Array.isArray(resource.identifier)) {
    return { valid: false, identity: "", metaSource: "" };
  }
  const identities = (Array.isArray(resource.identifier) ? resource.identifier : [])
    .filter(({ system }) => String(system ?? "").trim() === SOURCE_RESOURCE_IDENTITY_SYSTEM)
    .map(({ value }) => String(value ?? "").trim());
  if (identities.some((value) => !value || value.length > 200)) {
    return { valid: false, identity: "", metaSource: "" };
  }
  const distinctIdentities = [...new Set(identities)];
  if (distinctIdentities.length > 1) return { valid: false, identity: "", metaSource: "" };
  const metaSource = resource.meta?.source;
  if (metaSource !== undefined && (typeof metaSource !== "string" || !metaSource.trim() || metaSource.trim().length > 200)) {
    return { valid: false, identity: "", metaSource: "" };
  }
  return {
    valid: true,
    identity: distinctIdentities[0] ?? "",
    metaSource: String(metaSource ?? "").trim(),
  };
}

function sourceFor(resource, fullUrl) {
  const provenance = sourceResourceProvenance(resource);
  const fallbackIdentity = String(fullUrl ?? `${resource.resourceType}/${resource.id ?? "unknown"}`);
  const resourceId = provenance.identity || fallbackIdentity;
  const metaSource = provenance.metaSource || resourceId;
  return {
    kind: "fhir",
    label: `FHIR R4 · ${resource.resourceType}`,
    resourceId,
    ...(metaSource ? { metaSource } : {}),
  };
}

function bundleResourceIdentity(resource, fullUrl) {
  const explicit = String(fullUrl ?? "").trim();
  if (explicit) return explicit;
  const id = String(resource?.id ?? "").trim();
  return id && resource?.resourceType ? `${resource.resourceType}/${id}` : "";
}

function eventBase(resource, fullUrl, type, codeConcept, fallbackLabel) {
  const identity = sourceResourceProvenance(resource).identity || bundleResourceIdentity(resource, fullUrl);
  return {
    id: `fhir-${resource.resourceType.toLowerCase()}-${stableIdentityToken(identity)}`,
    type,
    system: conceptSystem(codeConcept),
    code: conceptCode(codeConcept),
    label: conceptLabel(codeConcept, fallbackLabel),
    date: resourceDate(resource),
    status: resource.status ?? statusCodes(resource.clinicalStatus)[0] ?? "final",
    source: sourceFor(resource, fullUrl),
  };
}

function typedResourceIdentity(resource) {
  const resourceType = String(resource?.resourceType ?? "").trim();
  const id = String(resource?.id ?? "").trim();
  return resourceType && id ? `${resourceType}/${id}` : "";
}

function createResourceIdentityRegistry() {
  const exactIdentities = new Set();
  const unqualifiedTypedIdentities = new Set();
  const qualifiedTypedIdentities = new Map();
  return {
    add(resource, fullUrl) {
      const exact = bundleResourceIdentity(resource, fullUrl);
      if (!exact || exactIdentities.has(exact)) return false;
      const typed = typedResourceIdentity(resource);
      const explicit = String(fullUrl ?? "").trim();
      const unqualified = Boolean(typed) && (!explicit || explicit === typed || explicit === `/${typed}`);
      if (typed) {
        const qualified = qualifiedTypedIdentities.get(typed);
        if (unqualified && (unqualifiedTypedIdentities.has(typed) || qualified?.size)) return false;
        if (!unqualified && unqualifiedTypedIdentities.has(typed)) return false;
      }
      exactIdentities.add(exact);
      if (typed && unqualified) unqualifiedTypedIdentities.add(typed);
      if (typed && !unqualified) {
        const qualified = qualifiedTypedIdentities.get(typed) ?? new Set();
        qualified.add(exact);
        qualifiedTypedIdentities.set(typed, qualified);
      }
      return true;
    },
  };
}

function parseCondition(resource, fullUrl) {
  const verificationStatuses = statusCodes(resource.verificationStatus);
  const clinicalStatuses = statusCodes(resource.clinicalStatus);
  const acceptedClinicalStatuses = new Set(["active", "recurrence", "relapse"]);
  const verificationStatus = verificationStatuses[0];
  if (verificationStatuses.length !== 1 || (verificationStatus !== "confirmed" && !(verificationStatus === "provisional" && Object.hasOwn(resource, "encounter")))) return null;
  if (!clinicalStatuses.length || clinicalStatuses.some((status) => !acceptedClinicalStatuses.has(status))) return null;
  return normalizePatientEvent({
    ...eventBase(resource, fullUrl, "condition", resource.code, "진단"),
    status: clinicalStatuses[0],
    clinicalStatus: clinicalStatuses[0],
    verificationStatus: verificationStatuses[0],
    certainty: verificationStatuses[0],
    diagnosisRole: conditionDiagnosisRole(resource),
    onsetDate: typeof resource.onsetDateTime === "string" ? resource.onsetDateTime.slice(0, 10) : "",
  });
}

function conditionDiagnosisRole(resource) {
  const roles = (Array.isArray(resource.category) ? resource.category : [])
    .flatMap((category) => codings(category))
    .filter(({ system, code }) => system === DIAGNOSIS_ROLE_SYSTEM && ["primary", "secondary"].includes(code))
    .map(({ code }) => code);
  return roles.includes("primary") ? "primary" : "secondary";
}

function resourceNotes(resource) {
  return Array.isArray(resource.note)
    ? resource.note.map(({ text }) => text).filter((text) => typeof text === "string").join(", ")
    : "";
}

function bloodPressureObservationValue(resource) {
  if (Object.hasOwn(resource, "valueQuantity")
    || Object.hasOwn(resource, "valueString")
    || Object.hasOwn(resource, "valueCodeableConcept")) return null;
  const components = Array.isArray(resource.component) ? resource.component : [];
  const quantities = new Map();
  for (const component of components) {
    const system = conceptSystem(component?.code);
    const code = conceptCode(component?.code);
    if (system !== LOINC_SYSTEM || !["8480-6", "8462-4"].includes(code)) continue;
    if (quantities.has(code)) return null;
    const quantity = component?.valueQuantity;
    if (!quantity || !Number.isFinite(quantity.value)
      || quantity.system !== "http://unitsofmeasure.org"
      || quantity.code !== "mm[Hg]") return null;
    quantities.set(code, quantity.value);
  }
  if (quantities.size !== 2) return null;
  try {
    return {
      value: normalizeClinicalObservationValue(`${quantities.get("8480-6")}/${quantities.get("8462-4")}`, "85354-9"),
      unit: "mmHg",
    };
  } catch {
    return null;
  }
}

function observationValue(resource, system, code) {
  if (system === LOINC_SYSTEM && code === "85354-9") return bloodPressureObservationValue(resource);
  if (Number.isFinite(resource.valueQuantity?.value)) return { value: resource.valueQuantity.value, unit: resource.valueQuantity.unit ?? resource.valueQuantity.code ?? "" };
  if (typeof resource.valueString === "string") return { value: resource.valueString, unit: "" };
  if (resource.valueCodeableConcept) return { value: conceptLabel(resource.valueCodeableConcept, ""), unit: "" };
  return null;
}

function observationOccurrence(resource) {
  const value = resource.effectiveDateTime ?? resource.effectivePeriod?.start ?? resource.issued;
  if (typeof value !== "string" || !value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? "" : parsed.toISOString();
}

function parseObservation(resource, fullUrl) {
  if (!["final", "amended", "corrected"].includes(resource.status)) return null;
  const system = conceptSystem(resource.code);
  const code = conceptCode(resource.code);
  const value = observationValue(resource, system, code);
  if (!value) return null;
  if ((typeof value.value === "string" && !value.value.trim()) || (typeof value.value === "number" && !Number.isFinite(value.value))) return null;
  const event = normalizePatientEvent({
    ...eventBase(resource, fullUrl, "observation", resource.code, "검사 결과"),
    ...value,
    observedAt: observationOccurrence(resource),
    note: resourceNotes(resource),
  });
  if (system === LOINC_SYSTEM && clinicalObservationSpec(code) && !isCanonicalClinicalObservation(event)) return null;
  return event;
}

function positiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function medicationPrescription(resource) {
  if (resource.dosageInstruction !== undefined && !Array.isArray(resource.dosageInstruction)) return null;
  if (resource.dispenseRequest !== undefined && (!resource.dispenseRequest || typeof resource.dispenseRequest !== "object" || Array.isArray(resource.dispenseRequest))) return null;
  const dosages = Array.isArray(resource.dosageInstruction) ? resource.dosageInstruction : [];
  if (dosages.length > 1) return null;
  const dosage = dosages[0] ?? {};
  if (!dosage || typeof dosage !== "object" || Array.isArray(dosage)) return null;
  if (dosage.doseAndRate !== undefined && !Array.isArray(dosage.doseAndRate)) return null;
  const doseAndRate = Array.isArray(dosage.doseAndRate) ? dosage.doseAndRate : [];
  if (doseAndRate.length > 1) return null;

  const doseQuantity = doseAndRate[0]?.doseQuantity;
  if (doseQuantity !== undefined && (!doseQuantity || typeof doseQuantity !== "object" || Array.isArray(doseQuantity))) return null;
  const quantity = resource.dispenseRequest?.quantity;
  if (quantity !== undefined && (!quantity || typeof quantity !== "object" || Array.isArray(quantity))) return null;
  const duration = resource.dispenseRequest?.expectedSupplyDuration;
  if (duration !== undefined && (!duration || typeof duration !== "object" || Array.isArray(duration))) return null;

  const dose = doseQuantity?.value === undefined ? null : positiveNumber(doseQuantity.value);
  const dispenseQuantity = quantity?.value === undefined ? null : positiveNumber(quantity.value);
  const durationValue = duration?.value === undefined ? null : positiveNumber(duration.value);
  if (doseQuantity?.value !== undefined && dose === null) return null;
  if (quantity?.value !== undefined && dispenseQuantity === null) return null;
  if (duration?.value !== undefined && durationValue === null) return null;
  if (durationValue !== null && (duration.code !== "d" || duration.system !== "http://unitsofmeasure.org")) return null;
  if (durationValue !== null && !Number.isSafeInteger(durationValue)) return null;

  const instructions = typeof dosage.text === "string" ? dosage.text : "";
  return {
    note: instructions,
    prescription: {
      dose,
      doseUnit: typeof doseQuantity?.unit === "string" ? doseQuantity.unit : typeof quantity?.unit === "string" ? quantity.unit : "",
      route: conceptLabel(dosage.route, ""),
      frequency: conceptLabel(dosage.timing?.code, ""),
      durationDays: durationValue,
      quantity: dispenseQuantity,
      instructions,
    },
  };
}

function parseMedication(resource, fullUrl) {
  if (resource.status !== "active") return null;
  if (Object.hasOwn(resource, "doNotPerform") && typeof resource.doNotPerform !== "boolean") return null;
  if (resource.doNotPerform === true) return null;
  if (!ORDER_INTENTS.has(resource.intent)) return null;
  if (!resource.medicationCodeableConcept || Object.hasOwn(resource, "medicationReference")) return null;
  const medication = resource.medicationCodeableConcept;
  const parsedPrescription = medicationPrescription(resource);
  if (!parsedPrescription) return null;
  return normalizePatientEvent({
    ...eventBase(resource, fullUrl, "medication", medication, "처방 약물"),
    intent: resource.intent,
    note: parsedPrescription.note,
    prescription: parsedPrescription.prescription,
  });
}

function parseServiceRequest(resource, fullUrl) {
  if (resource.status !== "active" || !ORDER_INTENTS.has(resource.intent)) return null;
  const categoryCoding = (Array.isArray(resource.category) ? resource.category : [])
    .flatMap((category) => codings(category))
    .find(({ system, code }) => system === ORDER_KIND_SYSTEM && code);
  const requestedKind = String(categoryCoding?.code ?? "");
  const kind = requestedKind === "lab" ? "laboratory" : requestedKind;
  if (!ORDER_KINDS.has(kind)) return null;
  const priority = resource.priority ?? "routine";
  if (!ORDER_PRIORITIES.has(priority)) return null;
  const instructions = typeof resource.patientInstruction === "string"
    ? resource.patientInstruction
    : Array.isArray(resource.note)
      ? resourceNotes(resource)
      : "";
  return normalizePatientEvent({
    ...eventBase(resource, fullUrl, "service-request", resource.code, "검사·처치 오더"),
    intent: resource.intent,
    order: { kind, priority, instructions },
  });
}

function parseAllergy(resource, fullUrl) {
  const verificationStatuses = statusCodes(resource.verificationStatus);
  const clinicalStatuses = statusCodes(resource.clinicalStatus);
  if (!verificationStatuses.length || verificationStatuses.some((status) => status !== "confirmed")) return null;
  if (!clinicalStatuses.length || clinicalStatuses.some((status) => status !== "active")) return null;
  const reactions = (Array.isArray(resource.reaction) ? resource.reaction : []).flatMap(({ manifestation }) => Array.isArray(manifestation) ? manifestation.map((item) => conceptLabel(item, "")).filter(Boolean) : []);
  return normalizePatientEvent({
    ...eventBase(resource, fullUrl, "allergy", resource.code, "알레르기"),
    status: clinicalStatuses[0],
    clinicalStatus: clinicalStatuses[0],
    verificationStatus: verificationStatuses[0],
    note: reactions.join(", "),
  });
}

function parseProcedure(resource, fullUrl) {
  if (resource.status !== "completed") return null;
  return normalizePatientEvent({ ...eventBase(resource, fullUrl, "procedure", resource.code, "수술·처치"), note: resourceNotes(resource) });
}

function parseEncounter(resource, fullUrl) {
  if (resource.status !== "finished") return null;
  const label = resource.type?.[0] ?? { text: resource.class?.display ?? resource.class?.code ?? "내원" };
  return normalizePatientEvent({
    ...eventBase(resource, fullUrl, "encounter", label, "내원"),
    recordStatus: "final",
    arrivedAt: resource.period?.start,
    startedAt: resource.period?.start,
    finishedAt: resource.period?.end,
    department: conceptLabel(resource.serviceType, ""),
    clinician: String(resource.participant?.[0]?.individual?.display ?? "").trim(),
    room: String(resource.location?.[0]?.location?.display ?? "").trim(),
    chiefComplaint: conceptLabel(resource.reasonCode?.[0], ""),
    soap: {},
    signature: { status: "external", signer: "", signedAt: "" },
    note: resource.period?.end ? `종료 ${resource.period.end}` : "",
  });
}

function humanNameText(name, fallback = "") {
  if (!name || typeof name !== "object" || Array.isArray(name)) return fallback;
  const text = String(name.text ?? "").trim();
  if (text) return text;
  const family = String(name.family ?? "").trim();
  const given = Array.isArray(name.given) ? name.given.map((value) => String(value).trim()).filter(Boolean) : [];
  return [family, ...given].filter(Boolean).join(" ") || fallback;
}

function patientName(resource) {
  const names = Array.isArray(resource.name) ? resource.name : [];
  const name = names.find(({ use }) => use === "official") ?? names[0];
  return humanNameText(name, "FHIR 가져온 환자");
}

function patientMrn(resource) {
  const identifiers = Array.isArray(resource.identifier) ? resource.identifier : [];
  const mrIdentifiers = identifiers.filter((identifier) => {
    const system = String(identifier?.system ?? "").trim();
    const hasMedicalRecordType = codings(identifier?.type).some(({ system: typeSystem, code }) => (
      String(typeSystem ?? "").trim() === MR_IDENTIFIER_TYPE_SYSTEM
      && String(code ?? "").toUpperCase() === "MR"
    ));
    return system === `${FHIR_BASE_URL}/identifier/mrn` || hasMedicalRecordType;
  });
  const values = mrIdentifiers.map(({ value }) => String(value ?? "").trim());
  if (values.some((value) => !value)) throw new TypeError("FHIR Patient MR 식별자 값이 비어 있습니다.");
  const distinct = [...new Set(values)];
  if (distinct.length > 1) throw new TypeError("FHIR Patient에 서로 다른 MR 식별자가 둘 이상 있습니다.");
  return distinct[0] ?? "";
}

function patientSourceIdentity(resource, fallback) {
  const identifiers = Array.isArray(resource.identifier) ? resource.identifier : [];
  const values = identifiers
    .filter(({ system }) => String(system ?? "").trim() === SOURCE_PATIENT_IDENTITY_SYSTEM)
    .map(({ value }) => String(value ?? "").trim());
  if (values.some((value) => !value || value.length > 2_000)) {
    throw new TypeError("FHIR Patient 원본 식별자 값이 유효하지 않습니다.");
  }
  const distinct = [...new Set(values)];
  if (distinct.length > 1) throw new TypeError("FHIR Patient 원본 식별자가 서로 충돌합니다.");
  return distinct[0] ?? fallback;
}

function addressText(address) {
  if (!address || typeof address !== "object" || Array.isArray(address)) return "";
  const text = String(address.text ?? "").trim();
  if (text) return text;
  const line = Array.isArray(address.line) ? address.line.map((value) => String(value).trim()).filter(Boolean) : [];
  return [...line, address.city, address.district, address.state, address.postalCode, address.country]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

function stableIdentityToken(value) {
  const text = String(value);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function patientExtension(resource, url) {
  const matches = (Array.isArray(resource.extension) ? resource.extension : []).filter((extension) => extension?.url === url);
  if (matches.length > 1) throw new TypeError(`FHIR Patient 확장이 중복되었습니다: ${url}`);
  return matches[0] ?? null;
}

function ageYearsFromPatient(resource) {
  const extension = patientExtension(resource, AGE_AT_EXPORT_URL);
  if (!extension) return null;
  if (resource.birthDate) throw new TypeError("FHIR Patient 생년월일과 내보내기 시점 나이 확장을 동시에 적용할 수 없습니다.");
  const age = extension.valueAge;
  if (!age || typeof age !== "object" || Array.isArray(age)) throw new TypeError("FHIR Patient 나이 확장 형식이 유효하지 않습니다.");
  const value = age.value;
  if (!Number.isSafeInteger(value) || value < 0 || value > 130) throw new TypeError("FHIR Patient 나이 확장 값이 유효하지 않습니다.");
  if (age.code !== "a" || age.system !== "http://unitsofmeasure.org") throw new TypeError("FHIR Patient 나이 확장의 단위가 유효하지 않습니다.");
  return value;
}

function patientLocalDemographics(resource) {
  const bloodExtension = patientExtension(resource, RECORDED_BLOOD_TYPE_URL);
  const insuranceExtension = patientExtension(resource, LOCAL_INSURANCE_TYPE_URL);
  const bloodType = String(bloodExtension?.valueCodeableConcept?.text ?? "").trim();
  const insuranceType = String(insuranceExtension?.valueCode ?? "").trim();
  const contact = Array.isArray(resource.contact) ? resource.contact[0] : null;
  return {
    address: addressText(resource.address?.[0]),
    bloodType,
    insuranceType,
    emergencyContact: {
      name: humanNameText(contact?.name),
      relation: conceptLabel(contact?.relationship?.[0], ""),
      phone: String(contact?.telecom?.find(({ system }) => system === "phone")?.value ?? "").trim(),
    },
  };
}

function parsePatient(resource, timestamp, fullUrl) {
  const localDemographics = patientLocalDemographics(resource);
  const fhirIdentity = patientSourceIdentity(resource, String(fullUrl ?? "").trim());
  return createPatient({
    id: `fhir-patient-${stableIdentityToken(fhirIdentity)}`,
    fhirIdentity,
    mrn: patientMrn(resource),
    name: patientName(resource),
    birthDate: resource.birthDate,
    ageYears: ageYearsFromPatient(resource),
    sex: ["female", "male", "other", "unknown"].includes(resource.gender) ? resource.gender : "unknown",
    phone: Array.isArray(resource.telecom) ? String(resource.telecom.find(({ system }) => system === "phone")?.value ?? "") : "",
    ...localDemographics,
    events: [],
  }, timestamp);
}

const parsers = {
  Condition: parseCondition,
  Observation: parseObservation,
  MedicationRequest: parseMedication,
  ServiceRequest: parseServiceRequest,
  AllergyIntolerance: parseAllergy,
  Procedure: parseProcedure,
  Encounter: parseEncounter,
};

function subjectReference(resource) {
  return String(resource.subject?.reference ?? resource.patient?.reference ?? "").trim();
}

const MAX_FHIR_TRAVERSAL_DEPTH = 100;
const MAX_FHIR_TRAVERSAL_NODES = 50_000;

function inspectModifierSemantics(root) {
  const stack = [{ value: root, depth: 0 }];
  const seen = new WeakSet();
  let nodes = 0;
  let unknownModifierExtension = false;
  let implicitRules = false;
  while (stack.length) {
    const { value, depth } = stack.pop();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    nodes += 1;
    if (depth > MAX_FHIR_TRAVERSAL_DEPTH || nodes > MAX_FHIR_TRAVERSAL_NODES) {
      return { unknownModifierExtension: true, implicitRules: true, traversalLimitExceeded: true };
    }
    if (!Array.isArray(value)) {
      if (Object.hasOwn(value, "implicitRules")) implicitRules = true;
      if (Object.hasOwn(value, "modifierExtension")) {
        const modifiers = value.modifierExtension;
        if (!Array.isArray(modifiers) || modifiers.length > 0) unknownModifierExtension = true;
      }
    }
    if (unknownModifierExtension && implicitRules) break;
    const children = Array.isArray(value)
      ? value
      : Object.entries(value).filter(([key]) => key !== "modifierExtension").map(([, item]) => item);
    for (const child of children) stack.push({ value: child, depth: depth + 1 });
  }
  return { unknownModifierExtension, implicitRules, traversalLimitExceeded: false };
}

function hasUnknownModifierExtension(value) {
  return inspectModifierSemantics(value).unknownModifierExtension;
}

function hasUnsupportedModifierSemantics(value) {
  const result = inspectModifierSemantics(value);
  return result.unknownModifierExtension || result.implicitRules || result.traversalLimitExceeded;
}

function assertSupportedPatientModifiers(patientEntry) {
  const resource = patientEntry?.resource ?? {};
  if (hasUnsupportedModifierSemantics(patientEntry)) {
    throw new TypeError("FHIR Patient의 미지원 modifierExtension 또는 implicitRules 때문에 안전하게 가져올 수 없습니다.");
  }
  if (Object.hasOwn(resource, "active") && typeof resource.active !== "boolean") throw new TypeError("FHIR Patient.active 형식이 유효하지 않습니다.");
  if (Object.hasOwn(resource, "deceasedBoolean") && typeof resource.deceasedBoolean !== "boolean") throw new TypeError("FHIR Patient.deceasedBoolean 형식이 유효하지 않습니다.");
  if (Object.hasOwn(resource, "deceasedDateTime") && (typeof resource.deceasedDateTime !== "string" || !resource.deceasedDateTime.trim())) {
    throw new TypeError("FHIR Patient.deceasedDateTime 형식이 유효하지 않습니다.");
  }
  if (Object.hasOwn(resource, "link") && !Array.isArray(resource.link)) throw new TypeError("FHIR Patient.link 형식이 유효하지 않습니다.");
  if (Object.hasOwn(resource, "identifier") && !Array.isArray(resource.identifier)) throw new TypeError("FHIR Patient.identifier 형식이 유효하지 않습니다.");
  if (Object.hasOwn(resource, "gender") && !["female", "male", "other", "unknown"].includes(resource.gender)) {
    throw new TypeError("FHIR Patient.gender 값이 유효하지 않습니다.");
  }
  if (Object.hasOwn(resource, "birthDate")) {
    const birthDate = resource.birthDate;
    if (typeof birthDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
      throw new TypeError("FHIR Patient.birthDate는 완전한 YYYY-MM-DD 날짜여야 합니다.");
    }
    const parsed = new Date(`${birthDate}T00:00:00.000Z`);
    if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== birthDate) {
      throw new TypeError("FHIR Patient.birthDate 값이 유효하지 않습니다.");
    }
    if (birthDate > localCalendarDate(new Date(), KOREA_TIMEZONE_OFFSET_MINUTES)) {
      throw new TypeError("FHIR Patient.birthDate는 미래일 수 없습니다.");
    }
  }
  if (resource.active === false) throw new TypeError("비활성 FHIR Patient는 현재 EMR 모델로 안전하게 가져올 수 없습니다.");
  if (resource.deceasedBoolean === true || (typeof resource.deceasedDateTime === "string" && resource.deceasedDateTime.trim())) {
    throw new TypeError("사망 상태의 FHIR Patient는 현재 EMR 모델로 안전하게 가져올 수 없습니다.");
  }
  if (Array.isArray(resource.link) && resource.link.length > 0) {
    throw new TypeError("대체·연결된 FHIR Patient는 현재 EMR 모델로 안전하게 가져올 수 없습니다.");
  }
}

function absoluteHttpUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function isAbsoluteUri(value) {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(String(value ?? ""));
}

function resolveRelativeResourceReference(reference, entryFullUrl) {
  const match = /^([A-Z][A-Za-z]+)\/([A-Za-z0-9.-]{1,64})$/.exec(reference);
  const entryUrl = absoluteHttpUrl(entryFullUrl);
  if (!match || !entryUrl) return "";
  const path = entryUrl.pathname.split("/").filter(Boolean);
  const resourceTailLength = path.at(-2) === "_history" ? 4 : 2;
  if (path.length < resourceTailLength) return "";
  entryUrl.pathname = `/${[...path.slice(0, -resourceTailLength), match[1], match[2]].join("/")}`;
  entryUrl.search = "";
  entryUrl.hash = "";
  return entryUrl.href;
}

function referenceMatchesResource(reference, targetResource, targetFullUrl, entryFullUrl) {
  if (!reference) return false;
  if (targetFullUrl && reference === targetFullUrl) {
    if (isAbsoluteUri(targetFullUrl)) return true;
    return !isAbsoluteUri(entryFullUrl);
  }
  const resourceType = String(targetResource?.resourceType ?? "").trim();
  const id = String(targetResource?.id ?? "").trim();
  if (!id) return false;
  if (reference !== `${resourceType}/${id}`) return false;
  const absoluteTargetUrl = absoluteHttpUrl(targetFullUrl);
  if (!absoluteTargetUrl) return targetFullUrl === reference;
  const resolvedReference = resolveRelativeResourceReference(reference, entryFullUrl);
  return resolvedReference === absoluteTargetUrl.href;
}

function referenceMatchesPatient(reference, patientResource, patientFullUrl, entryFullUrl) {
  return referenceMatchesResource(reference, patientResource, patientFullUrl, entryFullUrl);
}

function encounterReference(resource) {
  if (!Object.hasOwn(resource, "encounter")) return "";
  return typeof resource.encounter?.reference === "string" ? resource.encounter.reference.trim() : null;
}

function findReferencedEncounter(reference, entryFullUrl, encounterDescriptors) {
  if (!reference) return null;
  const matches = encounterDescriptors.filter(({ entry, resource, event }) => event && referenceMatchesResource(
    reference,
    resource,
    bundleResourceIdentity(resource, entry.fullUrl),
    entryFullUrl,
  ));
  return matches.length === 1 ? matches[0] : null;
}

function validXhtmlCodePoint(codePoint) {
  return codePoint === 0x09
    || codePoint === 0x0A
    || codePoint === 0x0D
    || (codePoint >= 0x20 && codePoint <= 0xD7FF)
    || (codePoint >= 0xE000 && codePoint <= 0xFFFD)
    || (codePoint >= 0x10000 && codePoint <= 0x10FFFF);
}

function decodeXhtmlEntity(entity) {
  const named = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };
  if (Object.hasOwn(named, entity)) return named[entity];
  if (entity === "#39") return "'";
  const isHex = entity.startsWith("#x") || entity.startsWith("#X");
  const digits = isHex ? entity.slice(2) : entity.startsWith("#") ? entity.slice(1) : "";
  if (!digits || !(isHex ? /^[0-9A-Fa-f]+$/ : /^\d+$/).test(digits)) return null;
  const codePoint = Number.parseInt(digits, isHex ? 16 : 10);
  return validXhtmlCodePoint(codePoint) ? String.fromCodePoint(codePoint) : null;
}

function strictNarrativeText(text) {
  if (text === undefined) return "";
  if (!text || typeof text !== "object" || Array.isArray(text) || text.status !== "generated" || typeof text.div !== "string") return null;
  const match = /^\s*<div xmlns=(?:"http:\/\/www\.w3\.org\/1999\/xhtml"|'http:\/\/www\.w3\.org\/1999\/xhtml')><p>([^<>]*)<\/p><\/div>\s*$/.exec(text.div);
  if (!match) return null;
  let invalid = false;
  const decoded = match[1].replace(/&([^;]+);/g, (_, entity) => {
    const value = decodeXhtmlEntity(entity);
    if (value === null) invalid = true;
    return value ?? "";
  });
  const withoutEntities = match[1].replace(/&[^;]+;/g, "");
  if (invalid || withoutEntities.includes("&")) return null;
  return decoded;
}

function parseSoapComposition(resource) {
  if (resource.status !== "final" || !Array.isArray(resource.section)) return null;
  const soap = { subjective: "", objective: "", assessment: "", plan: "" };
  const seenFields = new Set();
  for (const section of resource.section) {
    const sectionCoding = codings(section?.code).find(({ system, code }) => system === "http://loinc.org" && SOAP_SECTION_FIELDS.has(code));
    const field = SOAP_SECTION_FIELDS.get(sectionCoding?.code);
    if (!field) continue;
    if (seenFields.has(field)) return null;
    seenFields.add(field);
    const narrativeText = strictNarrativeText(section?.text);
    if (narrativeText === null) return null;
    soap[field] = narrativeText;
  }
  if (!seenFields.size) return null;
  const attester = Array.isArray(resource.attester) ? resource.attester[0] : null;
  const signedAt = typeof attester?.time === "string" ? attester.time : "";
  if (signedAt && Number.isNaN(new Date(signedAt).valueOf())) return null;
  return {
    soap,
    signer: String(attester?.party?.display ?? "").trim(),
    signedAt,
  };
}

function unsupportedItem(resource, reason) {
  return {
    resourceType: String(resource?.resourceType ?? "Unknown"),
    id: String(resource?.id ?? ""),
    reason,
  };
}

export function parseEmrFhirBundle(input) {
  if (!input || typeof input !== "object" || input.resourceType !== "Bundle") throw new TypeError("FHIR Bundle 형식의 JSON 파일만 가져올 수 있습니다.");
  if (input.type && !["collection", "document"].includes(input.type)) {
    throw new TypeError("FHIR 가져오기는 collection 또는 document Bundle만 지원합니다.");
  }
  if (Object.hasOwn(input, "implicitRules") || hasUnknownModifierExtension({ modifierExtension: input.modifierExtension ?? [] })) {
    throw new TypeError("FHIR Bundle의 미지원 modifierExtension 또는 implicitRules 때문에 안전하게 가져올 수 없습니다.");
  }
  const entries = Array.isArray(input.entry) ? input.entry : [];
  if (entries.length > MAXIMUM_ENTRIES) throw new RangeError("한 번에 가져올 수 있는 FHIR 항목은 1,000개입니다.");
  if (Object.hasOwn(input, "timestamp") && (typeof input.timestamp !== "string" || Number.isNaN(new Date(input.timestamp).valueOf()))) {
    throw new TypeError("FHIR Bundle.timestamp 값이 유효하지 않습니다.");
  }
  const importedAt = new Date().toISOString();
  const bundleTimestamp = typeof input.timestamp === "string" ? new Date(input.timestamp).toISOString() : "";
  const timestamp = bundleTimestamp || importedAt;
  const patientEntries = entries.filter((entry) => entry?.resource?.resourceType === "Patient");
  if (patientEntries.length !== 1) {
    throw new TypeError("FHIR 가져오기는 정확히 한 명의 Patient가 포함된 Bundle만 지원합니다.");
  }
  const patientEntry = patientEntries[0];
  const patientResource = patientEntry?.resource ?? null;
  assertSupportedPatientModifiers(patientEntry);
  const patientFullUrl = String(patientEntry?.fullUrl ?? (patientResource?.id ? "Patient/" + patientResource.id : "")).trim();
  if (!patientFullUrl) throw new TypeError("FHIR Patient에 반복 가져오기를 식별할 id 또는 fullUrl이 필요합니다.");
  const patient = parsePatient(patientResource, timestamp, patientFullUrl);
  const events = [];
  const eventIds = new Set();
  const resourceIdentities = createResourceIdentityRegistry();
  resourceIdentities.add(patientResource, patientEntry.fullUrl);
  const sourceResourceIdentities = new Set();
  const unsupportedItems = [];
  let supported = 1;
  let unsupported = 0;
  const reject = (resource, reason) => {
    unsupported += 1;
    if (unsupportedItems.length < 100) unsupportedItems.push(unsupportedItem(resource, reason));
  };
  const descriptors = [];
  for (const entry of entries) {
    const resource = entry?.resource;
    if (!resource?.resourceType) {
      reject(resource, "resourceType이 없습니다.");
      continue;
    }
    if (resource.resourceType === "Patient") continue;
    if (hasUnsupportedModifierSemantics(entry)) {
      reject(resource, "미지원 modifierExtension 또는 implicitRules가 있어 의미를 안전하게 해석할 수 없습니다.");
      continue;
    }
    if (!bundleResourceIdentity(resource, entry.fullUrl)) {
      reject(resource, "FHIR 리소스에 반복 가져오기와 중복 검사를 위한 id 또는 fullUrl이 없습니다.");
      continue;
    }
    if (!resourceIdentities.add(resource, entry.fullUrl)) {
      reject(resource, "Bundle 안에 같은 FHIR 리소스 id, fullUrl 또는 상대·절대 별칭이 중복되었습니다.");
      continue;
    }
    const parser = parsers[resource.resourceType];
    if (!parser && resource.resourceType !== "Composition") {
      reject(resource, "현재 EMR 가져오기 범위에서 지원하지 않는 리소스입니다.");
      continue;
    }
    if (resource.resourceType !== "Composition") {
      const sourceProvenance = sourceResourceProvenance(resource);
      if (!sourceProvenance.valid) {
        reject(resource, "FHIR 원본 리소스 식별자 또는 meta.source 형식이 유효하지 않습니다.");
        continue;
      }
      if (sourceProvenance.identity && sourceResourceIdentities.has(sourceProvenance.identity)) {
        reject(resource, "Bundle 안에 같은 원본 FHIR 리소스 식별자가 중복되었습니다.");
        continue;
      }
      if (sourceProvenance.identity) sourceResourceIdentities.add(sourceProvenance.identity);
    }
    const reference = subjectReference(resource);
    if (!reference) {
      reject(resource, "환자 subject 참조가 없어 안전하게 귀속할 수 없습니다.");
      continue;
    }
    if (!referenceMatchesPatient(reference, patientResource, patientFullUrl, entry.fullUrl)) {
      reject(resource, "가져올 환자와 다른 환자 참조입니다.");
      continue;
    }
    descriptors.push({ entry, resource, parser, event: null });
  }

  const encounterDescriptors = descriptors.filter(({ resource }) => resource.resourceType === "Encounter");
  for (const descriptor of encounterDescriptors) {
    const event = descriptor.parser(descriptor.resource, descriptor.entry.fullUrl);
    if (!event) {
      reject(descriptor.resource, "완료되지 않은 Encounter는 확정 진료로 가져오지 않습니다.");
      continue;
    }
    if (eventIds.has(event.id)) {
      reject(descriptor.resource, "같은 유형과 ID의 FHIR 리소스가 중복되었습니다.");
      continue;
    }
    descriptor.event = event;
    eventIds.add(event.id);
    events.push(event);
    supported += 1;
  }

  for (const descriptor of descriptors) {
    const { entry, resource, parser } = descriptor;
    if (["Encounter", "Composition"].includes(resource.resourceType)) continue;
    let event = parser(resource, entry.fullUrl);
    if (!event) {
      reject(resource, "상태가 확정 범위가 아니거나 필수 날짜·코드가 없습니다.");
      continue;
    }
    if (Object.hasOwn(resource, "encounter")) {
      const reference = encounterReference(resource);
      const encounterDescriptor = reference && findReferencedEncounter(reference, entry.fullUrl, encounterDescriptors);
      if (!encounterDescriptor) {
        reject(resource, "완료된 동일 환자 Encounter 참조를 안전하게 해소할 수 없습니다.");
        continue;
      }
      event = normalizePatientEvent({ ...event, encounterId: encounterDescriptor.event.id });
      if (!event) {
        reject(resource, "Encounter 연결 후 임상 이벤트를 정규화할 수 없습니다.");
        continue;
      }
    }
    if (eventIds.has(event.id)) {
      reject(resource, "같은 유형과 ID의 FHIR 리소스가 중복되었습니다.");
      continue;
    }
    descriptor.event = event;
    eventIds.add(event.id);
    events.push(event);
    supported += 1;
  }

  const compositionsByEncounter = new Map();
  for (const descriptor of descriptors.filter(({ resource }) => resource.resourceType === "Composition")) {
    const reference = encounterReference(descriptor.resource);
    const encounterDescriptor = reference && findReferencedEncounter(reference, descriptor.entry.fullUrl, encounterDescriptors);
    const parsed = encounterDescriptor ? parseSoapComposition(descriptor.resource) : null;
    if (!encounterDescriptor || !parsed) {
      reject(descriptor.resource, "완료 진료 참조와 안전한 최종 SOAP 구성을 확인할 수 없습니다.");
      continue;
    }
    const candidates = compositionsByEncounter.get(encounterDescriptor.event.id) ?? [];
    candidates.push({ descriptor, encounterDescriptor, parsed });
    compositionsByEncounter.set(encounterDescriptor.event.id, candidates);
  }

  for (const candidates of compositionsByEncounter.values()) {
    if (candidates.length !== 1) {
      for (const { descriptor } of candidates) reject(descriptor.resource, "한 Encounter에 여러 SOAP Composition이 있어 임의로 선택하지 않습니다.");
      continue;
    }
    const [{ encounterDescriptor, parsed }] = candidates;
    const previous = encounterDescriptor.event;
    const updated = normalizePatientEvent({
      ...previous,
      soap: parsed.soap,
      signature: { status: "external", signer: parsed.signer, signedAt: parsed.signedAt },
    });
    if (!updated) {
      reject(candidates[0].descriptor.resource, "SOAP를 Encounter에 안전하게 연결할 수 없습니다.");
      continue;
    }
    encounterDescriptor.event = updated;
    const eventIndex = events.findIndex(({ id }) => id === updated.id);
    if (eventIndex >= 0) events[eventIndex] = updated;
    supported += 1;
  }
  const importedPatient = createPatient({
    ...patient,
    events,
    updatedAt: timestamp,
  }, timestamp);
  return {
    patient: importedPatient,
    provenance: {
      format: "FHIR R4",
      total: entries.length,
      supported,
      unsupported,
      unsupportedItems,
      unsupportedTruncated: Math.max(0, unsupported - unsupportedItems.length),
      importedAt,
      bundleTimestamp,
    },
  };
}
