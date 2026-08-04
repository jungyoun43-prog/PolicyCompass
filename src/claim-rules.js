import { clinicalObservationSpec, isCanonicalClinicalObservation, LOINC_SYSTEM } from "./clinical-observations.js";

const DAY_MS = 86_400_000;
const MAX_RULE_DAYS = 3_650;
const MAX_RULE_COUNT = 100;
const SERVICE_STATUS_BY_TYPE = {
  procedure: new Set(["completed"]),
  observation: new Set(["final", "amended", "corrected"]),
  encounter: new Set(["finished"]),
};
const EVIDENCE_STATUS_BY_TYPE = {
  condition: new Set(["active", "recurrence", "relapse"]),
  observation: new Set(["final", "amended", "corrected"]),
  medication: new Set(["active"]),
  allergy: new Set(["active"]),
  procedure: new Set(["completed"]),
  encounter: new Set(["finished"]),
  symptom: new Set(["active"]),
};
const DEFAULT_EVIDENCE_STATUS = {
  condition: "active",
  observation: "final",
  medication: "active",
  allergy: "active",
  procedure: "completed",
  encounter: "finished",
  symptom: "active",
};
const ORDER_INTENTS = new Set(["order", "original-order", "reflex-order", "filler-order", "instance-order"]);
export const KCD_SYSTEM = "urn:kr:kcd";

export const CLAIM_LANE_ORDER = [
  "missing-evidence",
  "due-soon",
  "ready",
  "waiting",
  "not-applicable",
  "unknown",
];

export const CLAIM_LANE_LABELS = {
  "missing-evidence": "근거 보완",
  "due-soon": "기간 임박",
  ready: "시행 준비",
  waiting: "기간 대기",
  "not-applicable": "적용 전·종료",
  unknown: "기준 확인",
};

export const DEFAULT_CLAIM_RULES = [
  {
    id: "demo-bp-follow-up",
    ruleSetId: "VG-2026-01",
    version: "2026.1",
    title: "고혈압 추적검사",
    serviceCode: "DEMO-BP-FOLLOWUP",
    serviceSystem: "urn:vitagraph:demo:service",
    serviceEventType: "procedure",
    windowDays: 90,
    maxCount: 1,
    dueSoonDays: 21,
    applicabilityCodes: ["I10"],
    applicabilitySystem: KCD_SYSTEM,
    requiredEvidence: [{ code: "85354-9", system: "http://loinc.org", label: "90일 이내 혈압 기록", eventTypes: ["observation"], lookbackDays: 90 }],
    effectiveFrom: "2026-01-01",
    sourceLabel: "내부 검토용 예시 규칙 · 실제 급여기준 아님",
    sourceUrl: "",
    sourceDocumentNumber: "기관 규칙 VG-2026-01",
    sample: true,
  },
  {
    id: "demo-diabetes-monitoring",
    ruleSetId: "VG-2026-02",
    version: "2026.1",
    title: "당뇨 추적검사",
    serviceCode: "DEMO-A1C-FOLLOWUP",
    serviceSystem: "urn:vitagraph:demo:service",
    serviceEventType: "procedure",
    windowDays: 120,
    maxCount: 1,
    dueSoonDays: 28,
    applicabilityCodes: ["E11"],
    applicabilitySystem: KCD_SYSTEM,
    requiredEvidence: [{ code: "4548-4", system: "http://loinc.org", label: "120일 이내 당화혈색소 기록", eventTypes: ["observation"], lookbackDays: 120 }],
    effectiveFrom: "2026-01-01",
    sourceLabel: "내부 검토용 예시 규칙 · 실제 급여기준 아님",
    sourceUrl: "",
    sourceDocumentNumber: "기관 규칙 VG-2026-02",
    sample: true,
  },
  {
    id: "demo-bone-density",
    ruleSetId: "VG-2026-03",
    version: "2026.1",
    title: "골밀도검사",
    serviceCode: "DEMO-BMD",
    serviceSystem: "urn:vitagraph:demo:service",
    serviceEventType: "procedure",
    windowDays: 365,
    maxCount: 1,
    dueSoonDays: 30,
    applicabilityCodes: ["DEMO-BMD-INDICATION"],
    applicabilitySystem: "urn:vitagraph:demo:condition",
    requiredEvidence: [],
    effectiveFrom: "2026-01-01",
    sourceLabel: "내부 검토용 예시 규칙 · 실제 급여기준 아님",
    sourceUrl: "",
    sourceDocumentNumber: "기관 규칙 VG-2026-03",
    sample: true,
  },
];

function cleanText(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function boundedInteger(value, fallback, { minimum, maximum }) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/.test(value.trim())
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function positiveInteger(value, fallback, maximum) {
  return boundedInteger(value, fallback, { minimum: 1, maximum });
}

function nonnegativeInteger(value, fallback, maximum) {
  return boundedInteger(value, fallback, { minimum: 0, maximum });
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) ? "" : parsed.toISOString().slice(0, 10) === value ? value : "";
}

function dateValue(value) {
  const normalized = validDate(value);
  return normalized ? new Date(`${normalized}T00:00:00.000Z`).valueOf() : null;
}

function addDays(value, days) {
  const timestamp = dateValue(value);
  if (timestamp === null) return "";
  return new Date(timestamp + days * DAY_MS).toISOString().slice(0, 10);
}

function differenceInDays(after, before) {
  const afterValue = dateValue(after);
  const beforeValue = dateValue(before);
  if (afterValue === null || beforeValue === null) return null;
  return Math.ceil((afterValue - beforeValue) / DAY_MS);
}

function uniqueStrings(values) {
  return [...new Set(Array.isArray(values) ? values.map((value) => cleanText(String(value))).filter(Boolean) : [])];
}

function normalizeEvidenceCriterion(input) {
  if (!input || typeof input !== "object") return null;
  const code = cleanText(input.code);
  if (!code) return null;
  const lookbackDays = nonnegativeInteger(input.lookbackDays, 0, MAX_RULE_DAYS);
  if (lookbackDays === null) return null;
  return {
    code,
    system: cleanText(input.system),
    label: cleanText(input.label, code),
    eventTypes: uniqueStrings(input.eventTypes),
    statuses: uniqueStrings(input.statuses),
    lookbackDays,
  };
}

export function normalizeClaimRule(input = {}) {
  if (!input || typeof input !== "object") return null;
  const id = cleanText(input.id);
  const title = cleanText(input.title);
  const serviceCode = cleanText(input.serviceCode);
  const serviceSystem = cleanText(input.serviceSystem);
  const effectiveFrom = validDate(input.effectiveFrom);
  const effectiveTo = validDate(input.effectiveTo);
  const windowDays = positiveInteger(input.windowDays, 365, MAX_RULE_DAYS);
  const maxCount = positiveInteger(input.maxCount, 1, MAX_RULE_COUNT);
  const dueSoonDays = positiveInteger(input.dueSoonDays, 30, MAX_RULE_DAYS);
  if (!id || !title || !serviceCode || !effectiveFrom || windowDays === null || maxCount === null || dueSoonDays === null) return null;
  if (effectiveTo && effectiveTo < effectiveFrom) return null;
  const legacyEvidenceCodes = uniqueStrings(input.requiredEvidenceCodes);
  const legacyLabels = input.evidenceLabels && typeof input.evidenceLabels === "object" ? input.evidenceLabels : {};
  const evidenceInput = Array.isArray(input.requiredEvidence)
    ? input.requiredEvidence
    : legacyEvidenceCodes.map((code) => ({ code, label: cleanText(legacyLabels[code], code) }));
  const requiredEvidence = evidenceInput.map(normalizeEvidenceCriterion);
  if (requiredEvidence.some((criterion) => !criterion)) return null;
  const requiredEvidenceCodes = requiredEvidence.map(({ code }) => code);
  const evidenceLabels = Object.fromEntries(requiredEvidence.map(({ code, label }) => [code, label]));
  const serviceEventType = cleanText(input.serviceEventType, "procedure");
  const sourceDocumentNumber = cleanText(input.sourceDocumentNumber).slice(0, 240);
  if (!SERVICE_STATUS_BY_TYPE[serviceEventType]) return null;
  return {
    id,
    ruleSetId: cleanText(input.ruleSetId, id),
    version: cleanText(input.version, "1"),
    title,
    serviceCode,
    serviceSystem,
    serviceEventType,
    windowDays,
    maxCount,
    dueSoonDays,
    applicabilityCodes: uniqueStrings(input.applicabilityCodes),
    applicabilitySystem: cleanText(input.applicabilitySystem),
    requiredEvidence,
    requiredEvidenceCodes,
    evidenceLabels,
    effectiveFrom,
    effectiveTo,
    sourceLabel: cleanText(input.sourceLabel, "기관 내부 규칙"),
    sourceUrl: cleanText(input.sourceUrl),
    ...(sourceDocumentNumber ? { sourceDocumentNumber } : {}),
    note: cleanText(input.note),
    sample: input.sample === true,
  };
}

function eventDate(event) {
  return validDate(event?.date ?? event?.recordedAt ?? event?.observedAt ?? "");
}

function hasRecordedObservationValue(event) {
  if (cleanText(event?.type) !== "observation") return true;
  const hasValue = (typeof event?.value === "number" && Number.isFinite(event.value))
    || (typeof event?.value === "string" && cleanText(event.value) !== "");
  if (!hasValue) return false;
  return !(event?.system === LOINC_SYSTEM && clinicalObservationSpec(event?.code))
    || isCanonicalClinicalObservation(event);
}

function hasCompatibleEvidenceLifecycle(event, type, status) {
  if (!event || typeof event !== "object") return false;
  if (["fhir", "import"].includes(event.source?.kind)) return false;
  if (["condition", "allergy"].includes(type)) {
    if (Object.hasOwn(event, "verificationStatus") && cleanText(event.verificationStatus) !== "confirmed") return false;
    if (Object.hasOwn(event, "clinicalStatus") && cleanText(event.clinicalStatus) !== status) return false;
    if (event.source?.kind === "fhir" && (cleanText(event.verificationStatus) !== "confirmed" || cleanText(event.clinicalStatus) !== status)) return false;
  }
  if (type === "medication") {
    if (Object.hasOwn(event, "intent") && !ORDER_INTENTS.has(cleanText(event.intent))) return false;
    if (event.source?.kind === "fhir" && !ORDER_INTENTS.has(cleanText(event.intent))) return false;
  }
  return true;
}

function matchesEvidence(event, criterion, asOf) {
  if (event?.recordStatus && cleanText(event.recordStatus) !== "final") return false;
  const date = eventDate(event);
  const type = cleanText(event?.type);
  const acceptedStatuses = EVIDENCE_STATUS_BY_TYPE[type];
  const status = cleanText(event?.status, DEFAULT_EVIDENCE_STATUS[type]);
  if (cleanText(event?.code) !== criterion.code || !date || date > asOf) return false;
  if (!acceptedStatuses?.has(status)) return false;
  if (!hasCompatibleEvidenceLifecycle(event, type, status)) return false;
  if (!hasRecordedObservationValue(event)) return false;
  if (criterion.system && cleanText(event?.system) !== criterion.system) return false;
  if (criterion.eventTypes.length && !criterion.eventTypes.includes(type)) return false;
  if (criterion.statuses.length && !criterion.statuses.includes(status)) return false;
  if (criterion.lookbackDays) {
    const cutoff = addDays(asOf, -(criterion.lookbackDays - 1));
    if (date < cutoff) return false;
  }
  return true;
}

function inactiveResult(patient, rule, status, asOf, explanation) {
  return {
    id: `${patient.id}:${rule.id}`,
    patientId: patient.id,
    patientName: patient.name,
    patientMrn: patient.mrn,
    ruleId: rule.id,
    title: rule.title,
    serviceCode: rule.serviceCode,
    status,
    asOf,
    calculationAvailable: false,
    windowStart: asOf && rule.windowDays ? addDays(asOf, -(rule.windowDays - 1)) : "",
    windowEnd: asOf,
    usedCount: 0,
    remainingCount: rule.maxCount,
    serviceEventIds: [],
    lastServiceDate: "",
    daysSinceLastService: null,
    nextEligibleDate: "",
    missingEvidence: [],
    evidenceEventIds: [],
    explanation,
    rule,
  };
}

export function evaluateClaimRule(patientInput, ruleInput, asOfInput = new Date().toISOString().slice(0, 10)) {
  const patient = patientInput && typeof patientInput === "object"
    ? { id: cleanText(patientInput.id), name: cleanText(patientInput.name, "이름 없음"), mrn: cleanText(patientInput.mrn), events: Array.isArray(patientInput.events) ? patientInput.events : [] }
    : { id: "", name: "이름 없음", mrn: "", events: [] };
  const rule = normalizeClaimRule(ruleInput);
  const asOf = validDate(asOfInput);
  if (!patient.id || !rule || !asOf) {
    const fallbackRule = rule ?? { id: cleanText(ruleInput?.id, "unknown"), title: cleanText(ruleInput?.title, "기준 확인 필요"), serviceCode: cleanText(ruleInput?.serviceCode), maxCount: 0 };
    return inactiveResult(patient, fallbackRule, "unknown", asOf || "", "환자, 기준 또는 판정일 정보가 부족합니다.");
  }

  if (asOf < rule.effectiveFrom || (rule.effectiveTo && asOf > rule.effectiveTo)) {
    return inactiveResult(patient, rule, "not-applicable", asOf, `이 규칙은 ${rule.effectiveFrom}${rule.effectiveTo ? `~${rule.effectiveTo}` : " 이후"}에 적용됩니다.`);
  }

  const applicabilityEvents = rule.applicabilityCodes.flatMap((code) => patient.events.filter((event) => matchesEvidence(event, {
    code,
    system: rule.applicabilitySystem,
    eventTypes: ["condition"],
    statuses: [],
    lookbackDays: 0,
  }, asOf)));
  if (rule.applicabilityCodes.length && applicabilityEvents.length === 0) {
    return inactiveResult(patient, rule, "not-applicable", asOf, "적용 조건 기록이 확인되지 않아 판정 대상에서 제외했습니다.");
  }

  const evidenceByCriterion = rule.requiredEvidence.map((criterion) => ({
    criterion,
    events: patient.events.filter((event) => matchesEvidence(event, criterion, asOf)),
  }));
  const evidenceEvents = evidenceByCriterion.flatMap(({ events }) => events);
  const missingEvidence = evidenceByCriterion
    .filter(({ events }) => events.length === 0)
    .map(({ criterion }) => criterion.label);

  const cutoff = addDays(asOf, -(rule.windowDays - 1));
  const acceptedServiceStatuses = SERVICE_STATUS_BY_TYPE[rule.serviceEventType];
  const allServiceEvents = patient.events
    .filter((event) => (!event?.recordStatus || cleanText(event.recordStatus) === "final")
      && !["fhir", "import"].includes(event.source?.kind)
      && cleanText(event?.code) === rule.serviceCode
      && (!rule.serviceSystem || cleanText(event?.system) === rule.serviceSystem)
      && cleanText(event?.type) === rule.serviceEventType
      && acceptedServiceStatuses.has(cleanText(event?.status))
      && hasRecordedObservationValue(event)
      && eventDate(event)
      && eventDate(event) <= asOf)
    .sort((a, b) => eventDate(a).localeCompare(eventDate(b)));
  const serviceEvents = allServiceEvents.filter((event) => eventDate(event) >= cutoff);
  const usedCount = serviceEvents.length;
  const remainingCount = Math.max(0, rule.maxCount - usedCount);
  const serviceEventIds = serviceEvents.map(({ id }) => cleanText(id)).filter(Boolean);
  const lastServiceEvent = allServiceEvents.at(-1);
  const lastServiceDate = eventDate(lastServiceEvent);
  const daysSinceLastService = lastServiceDate ? differenceInDays(asOf, lastServiceDate) : null;
  const evidenceEventIds = [...new Set([
    ...applicabilityEvents,
    ...evidenceEvents,
    ...serviceEvents,
    ...(lastServiceEvent ? [lastServiceEvent] : []),
  ].map(({ id }) => cleanText(id)).filter(Boolean))];
  const blockingIndex = Math.max(0, usedCount - rule.maxCount);
  const blockingServiceDate = eventDate(serviceEvents[blockingIndex]);
  const nextEligibleDate = usedCount >= rule.maxCount && blockingServiceDate ? addDays(blockingServiceDate, rule.windowDays) : "";

  let status = "ready";
  let explanation = `EMR 확정 기록에서 최근 ${rule.windowDays}일 시행 ${usedCount}/${rule.maxCount}회를 자동 집계했습니다. 남은 기준 횟수는 ${remainingCount}회이며, 실제 청구·심사 이력은 별도 대조가 필요합니다.`;
  if (missingEvidence.length > 0) {
    status = "missing-evidence";
    explanation = `EMR의 기간·횟수는 자동 집계했지만 필수 근거 ${missingEvidence.length}개를 더 확인해야 합니다.`;
  } else if (usedCount >= rule.maxCount) {
    const daysUntilEligible = differenceInDays(nextEligibleDate, asOf) ?? rule.windowDays;
    status = daysUntilEligible <= rule.dueSoonDays ? "due-soon" : "waiting";
    explanation = `EMR 확정 기록에서 최근 ${rule.windowDays}일 시행 ${usedCount}/${rule.maxCount}회를 자동 집계해 기준 횟수에 도달했습니다. 다음 기준일은 ${nextEligibleDate}이며 실제 청구·심사 이력은 별도 대조하세요.`;
  }

  return {
    id: `${patient.id}:${rule.id}`,
    patientId: patient.id,
    patientName: patient.name,
    patientMrn: patient.mrn,
    ruleId: rule.id,
    title: rule.title,
    serviceCode: rule.serviceCode,
    status,
    asOf,
    calculationAvailable: true,
    windowStart: cutoff,
    windowEnd: asOf,
    usedCount,
    remainingCount,
    serviceEventIds,
    lastServiceDate,
    daysSinceLastService,
    nextEligibleDate,
    missingEvidence,
    evidenceEventIds,
    explanation,
    rule,
  };
}

export function buildClaimBoard(patients = [], rules = [], asOf = new Date().toISOString().slice(0, 10)) {
  const lanes = Object.fromEntries(CLAIM_LANE_ORDER.map((status) => [status, []]));
  for (const patient of Array.isArray(patients) ? patients : []) {
    for (const rule of Array.isArray(rules) ? rules : []) {
      const evaluation = evaluateClaimRule(patient, rule, asOf);
      (lanes[evaluation.status] ?? lanes.unknown).push(evaluation);
    }
  }
  for (const lane of Object.values(lanes)) {
    lane.sort((a, b) => a.patientName.localeCompare(b.patientName, "ko") || a.title.localeCompare(b.title, "ko"));
  }
  return {
    asOf: validDate(asOf),
    total: Object.values(lanes).reduce((sum, lane) => sum + lane.length, 0),
    lanes,
  };
}
