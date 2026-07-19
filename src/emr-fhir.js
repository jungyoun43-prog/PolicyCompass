import { createPatient, normalizePatientEvent } from "./emr-model.js";

const MAXIMUM_ENTRIES = 1_000;

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

function sourceFor(resource, fullUrl) {
  return {
    kind: "fhir",
    label: `FHIR R4 · ${resource.resourceType}`,
    resourceId: String(fullUrl ?? `${resource.resourceType}/${resource.id ?? "unknown"}`),
  };
}

function bundleResourceIdentity(resource, fullUrl) {
  const explicit = String(fullUrl ?? "").trim();
  if (explicit) return explicit;
  const id = String(resource?.id ?? "").trim();
  return id && resource?.resourceType ? `${resource.resourceType}/${id}` : "";
}

function eventBase(resource, fullUrl, type, codeConcept, fallbackLabel) {
  const identity = bundleResourceIdentity(resource, fullUrl);
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

function parseCondition(resource, fullUrl) {
  const verificationStatuses = statusCodes(resource.verificationStatus);
  const clinicalStatuses = statusCodes(resource.clinicalStatus);
  const acceptedClinicalStatuses = new Set(["active", "recurrence", "relapse"]);
  if (!verificationStatuses.length || verificationStatuses.some((status) => status !== "confirmed")) return null;
  if (!clinicalStatuses.length || clinicalStatuses.some((status) => !acceptedClinicalStatuses.has(status))) return null;
  return normalizePatientEvent({
    ...eventBase(resource, fullUrl, "condition", resource.code, "진단"),
    status: clinicalStatuses[0],
    clinicalStatus: clinicalStatuses[0],
    verificationStatus: verificationStatuses[0],
  });
}

function observationValue(resource) {
  if (Number.isFinite(resource.valueQuantity?.value)) return { value: resource.valueQuantity.value, unit: resource.valueQuantity.unit ?? resource.valueQuantity.code ?? "" };
  if (typeof resource.valueString === "string") return { value: resource.valueString, unit: "" };
  if (resource.valueCodeableConcept) return { value: conceptLabel(resource.valueCodeableConcept, ""), unit: "" };
  const systolic = (Array.isArray(resource.component) ? resource.component : []).find(({ code }) => conceptCode(code) === "8480-6")?.valueQuantity;
  const diastolic = (Array.isArray(resource.component) ? resource.component : []).find(({ code }) => conceptCode(code) === "8462-4")?.valueQuantity;
  if (Number.isFinite(systolic?.value) && Number.isFinite(diastolic?.value)) return { value: `${systolic.value}/${diastolic.value}`, unit: systolic.unit ?? diastolic.unit ?? "mmHg" };
  return { value: "", unit: "" };
}

function parseObservation(resource, fullUrl) {
  if (!["final", "amended", "corrected"].includes(resource.status)) return null;
  const value = observationValue(resource);
  if ((typeof value.value === "string" && !value.value.trim()) || (typeof value.value === "number" && !Number.isFinite(value.value))) return null;
  return normalizePatientEvent({ ...eventBase(resource, fullUrl, "observation", resource.code, "검사 결과"), ...value });
}

function parseMedication(resource, fullUrl) {
  if (resource.status !== "active") return null;
  if (Object.hasOwn(resource, "doNotPerform") && typeof resource.doNotPerform !== "boolean") return null;
  if (resource.doNotPerform === true) return null;
  if (!["order", "original-order", "reflex-order", "filler-order", "instance-order"].includes(resource.intent)) return null;
  const medication = resource.medicationCodeableConcept ?? resource.medicationReference ?? {};
  const dosage = Array.isArray(resource.dosageInstruction) ? resource.dosageInstruction.map(({ text }) => text).filter(Boolean).join(", ") : "";
  return normalizePatientEvent({
    ...eventBase(resource, fullUrl, "medication", medication, "처방 약물"),
    intent: resource.intent,
    note: dosage,
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
  return normalizePatientEvent(eventBase(resource, fullUrl, "procedure", resource.code, "수술·처치"));
}

function parseEncounter(resource, fullUrl) {
  if (!["in-progress", "finished"].includes(resource.status)) return null;
  const label = resource.type?.[0] ?? { text: resource.class?.display ?? resource.class?.code ?? "내원" };
  return normalizePatientEvent({ ...eventBase(resource, fullUrl, "encounter", label, "내원"), note: resource.period?.end ? `종료 ${resource.period.end}` : "" });
}

function patientName(resource) {
  const name = Array.isArray(resource.name) ? resource.name[0] : null;
  if (!name) return "FHIR 가져온 환자";
  if (name.text) return name.text;
  return [...(Array.isArray(name.given) ? name.given : []), name.family].filter(Boolean).join(" ") || "FHIR 가져온 환자";
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

function parsePatient(resource, timestamp, fullUrl) {
  const fhirIdentity = String(fullUrl ?? "").trim();
  return createPatient({
    id: `fhir-patient-${stableIdentityToken(fhirIdentity)}`,
    fhirIdentity,
    mrn: Array.isArray(resource.identifier) ? String(resource.identifier.find(({ value }) => value)?.value ?? "") : "",
    name: patientName(resource),
    birthDate: resource.birthDate,
    sex: ["female", "male", "other", "unknown"].includes(resource.gender) ? resource.gender : "unknown",
    phone: Array.isArray(resource.telecom) ? String(resource.telecom.find(({ system }) => system === "phone")?.value ?? "") : "",
    events: [],
  }, timestamp);
}

const parsers = {
  Condition: parseCondition,
  Observation: parseObservation,
  MedicationRequest: parseMedication,
  AllergyIntolerance: parseAllergy,
  Procedure: parseProcedure,
  Encounter: parseEncounter,
};

function subjectReference(resource) {
  return String(resource.subject?.reference ?? resource.patient?.reference ?? "").trim();
}

function hasUnknownModifierExtension(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => hasUnknownModifierExtension(item, seen));
  if (Object.hasOwn(value, "modifierExtension")) {
    const modifiers = value.modifierExtension;
    if (!Array.isArray(modifiers) || modifiers.length > 0) return true;
  }
  return Object.entries(value).some(([key, item]) => key !== "modifierExtension" && hasUnknownModifierExtension(item, seen));
}

function hasImplicitRules(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => hasImplicitRules(item, seen));
  if (Object.hasOwn(value, "implicitRules")) return true;
  return Object.values(value).some((item) => hasImplicitRules(item, seen));
}

function hasUnsupportedModifierSemantics(value) {
  return hasUnknownModifierExtension(value) || hasImplicitRules(value);
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

function resolveRelativePatientReference(reference, entryFullUrl) {
  const match = /^Patient\/([A-Za-z0-9.-]{1,64})$/.exec(reference);
  const entryUrl = absoluteHttpUrl(entryFullUrl);
  if (!match || !entryUrl) return "";
  const path = entryUrl.pathname.split("/").filter(Boolean);
  const resourceTailLength = path.at(-2) === "_history" ? 4 : 2;
  if (path.length < resourceTailLength) return "";
  entryUrl.pathname = `/${[...path.slice(0, -resourceTailLength), "Patient", match[1]].join("/")}`;
  entryUrl.search = "";
  entryUrl.hash = "";
  return entryUrl.href;
}

function referenceMatchesPatient(reference, patientResource, patientFullUrl, entryFullUrl) {
  if (!reference) return false;
  if (patientFullUrl && reference === patientFullUrl) {
    if (isAbsoluteUri(patientFullUrl)) return true;
    return !isAbsoluteUri(entryFullUrl);
  }
  const id = String(patientResource?.id ?? "").trim();
  if (!id) return false;
  if (reference !== "Patient/" + id) return false;
  const absolutePatientUrl = absoluteHttpUrl(patientFullUrl);
  if (!absolutePatientUrl) return patientFullUrl === reference;
  const resolvedReference = resolveRelativePatientReference(reference, entryFullUrl);
  return resolvedReference === absolutePatientUrl.href;
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
  if (Object.hasOwn(input, "implicitRules") || hasUnknownModifierExtension({ modifierExtension: input.modifierExtension ?? [] })) {
    throw new TypeError("FHIR Bundle의 미지원 modifierExtension 또는 implicitRules 때문에 안전하게 가져올 수 없습니다.");
  }
  const entries = Array.isArray(input.entry) ? input.entry : [];
  if (entries.length > MAXIMUM_ENTRIES) throw new RangeError("한 번에 가져올 수 있는 FHIR 항목은 1,000개입니다.");
  const timestamp = typeof input.timestamp === "string" ? input.timestamp : new Date().toISOString();
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
  const resourceIdentities = new Set([patientFullUrl]);
  const unsupportedItems = [];
  let supported = 1;
  let unsupported = 0;
  const reject = (resource, reason) => {
    unsupported += 1;
    if (unsupportedItems.length < 100) unsupportedItems.push(unsupportedItem(resource, reason));
  };
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
    const resourceIdentity = bundleResourceIdentity(resource, entry.fullUrl);
    if (!resourceIdentity) {
      reject(resource, "FHIR 리소스에 반복 가져오기와 중복 검사를 위한 id 또는 fullUrl이 없습니다.");
      continue;
    }
    if (resourceIdentities.has(resourceIdentity)) {
      reject(resource, "Bundle 안에 같은 FHIR 리소스 id 또는 fullUrl이 중복되었습니다.");
      continue;
    }
    resourceIdentities.add(resourceIdentity);
    const parser = parsers[resource.resourceType];
    if (!parser) {
      reject(resource, "현재 EMR 가져오기 범위에서 지원하지 않는 리소스입니다.");
      continue;
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
    const event = parser?.(resource, entry.fullUrl);
    if (event) {
      if (eventIds.has(event.id)) {
        reject(resource, "같은 유형과 ID의 FHIR 리소스가 중복되었습니다.");
        continue;
      }
      eventIds.add(event.id);
      events.push(event);
      supported += 1;
    } else {
      reject(resource, "상태가 확정 범위가 아니거나 필수 날짜·코드가 없습니다.");
    }
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
      importedAt: timestamp,
    },
  };
}
