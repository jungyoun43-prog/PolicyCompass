const maximumEntries = 1000;

const conditionRules = [
  ["hypertension", /(?:\bI10\b|hypertension|고혈압)/i],
  ["diabetes", /(?:\bE1[0-4](?:\.|\b)|diabetes|당뇨)/i],
  ["dyslipidemia", /(?:\bE78(?:\.|\b)|dyslipid|hyperlipid|고지혈|이상지질)/i],
  ["migraine", /(?:\bG43(?:\.|\b)|migraine|편두통)/i],
  ["reflux", /(?:\bK21(?:\.|\b)|gastro.?esophageal reflux|GERD|위식도역류|역류성 식도염)/i],
  ["asthma", /(?:\bJ45(?:\.|\b)|asthma|천식)/i],
  ["mood", /(?:\bF(?:3[2-4]|4[0-1])(?:\.|\b)|depress|anxiety|우울|불안)/i],
  ["arthritis", /(?:\bM(?:0[5-6]|1[5-9])(?:\.|\b)|arthritis|관절염)/i],
];

const measurementSpecs = new Map([
  ["2089-1", { key: "ldl", label: "LDL 콜레스테롤" }],
  ["1558-6", { key: "glucose", label: "공복 혈당" }],
  ["4548-4", { key: "hba1c", label: "당화혈색소" }],
]);

function codings(concept) {
  return Array.isArray(concept?.coding) ? concept.coding : [];
}

function conceptText(concept) {
  return [
    concept?.text,
    ...codings(concept).flatMap(({ code, display }) => [code, display]),
  ].filter(Boolean).join(" ");
}

function firstCode(concept) {
  return codings(concept).find(({ code }) => code)?.code ?? "";
}

function resourceDate(resource) {
  return resource.effectiveDateTime
    ?? resource.effectivePeriod?.start
    ?? resource.issued
    ?? resource.recordedDate
    ?? resource.onsetDateTime
    ?? "";
}

function parseCondition(resource) {
  const statuses = codings(resource.clinicalStatus).map(({ code }) => code);
  if (statuses.some((status) => ["inactive", "resolved", "remission"].includes(status))) return null;
  const searchable = conceptText(resource.code);
  const match = conditionRules.find(([, rule]) => rule.test(searchable));
  if (!match) return null;
  return {
    id: match[0],
    recordedAt: resourceDate(resource),
    sourceLabel: resource.code?.text ?? codings(resource.code)[0]?.display ?? match[0],
  };
}

function quantity(resource, spec, code = firstCode(resource.code)) {
  const value = resource.valueQuantity?.value;
  if (!Number.isFinite(value)) return null;
  return {
    key: spec.key,
    code,
    label: spec.label,
    value,
    unit: resource.valueQuantity?.unit ?? resource.valueQuantity?.code ?? "",
    observedAt: resourceDate(resource),
  };
}

function parseBloodPressure(resource) {
  const components = Array.isArray(resource.component) ? resource.component : [];
  const systolic = components.find(({ code }) => firstCode(code) === "8480-6")?.valueQuantity;
  const diastolic = components.find(({ code }) => firstCode(code) === "8462-4")?.valueQuantity;
  if (!Number.isFinite(systolic?.value) || !Number.isFinite(diastolic?.value)) return null;
  return {
    key: "blood-pressure",
    code: "85354-9",
    label: "혈압",
    value: `${systolic.value}/${diastolic.value}`,
    unit: systolic.unit ?? diastolic.unit ?? "mmHg",
    observedAt: resourceDate(resource),
  };
}

function parseObservation(resource) {
  if (["entered-in-error", "cancelled"].includes(resource.status)) return null;
  const code = firstCode(resource.code);
  if (code === "85354-9" || (Array.isArray(resource.component) && resource.component.length > 0)) {
    const bloodPressure = parseBloodPressure(resource);
    if (bloodPressure) return bloodPressure;
  }
  const spec = measurementSpecs.get(code);
  return spec ? quantity(resource, spec, code) : null;
}

export function parseFhirBundle(input) {
  if (!input || typeof input !== "object" || input.resourceType !== "Bundle") {
    throw new TypeError("FHIR Bundle 형식의 JSON 파일만 가져올 수 있습니다.");
  }
  const entries = Array.isArray(input.entry) ? input.entry : [];
  if (entries.length > maximumEntries) {
    throw new RangeError("한 번에 가져올 수 있는 FHIR 항목은 1,000개입니다.");
  }

  const conditionIds = new Set();
  const conditions = [];
  const measurements = [];
  let supported = 0;
  let unsupported = 0;

  for (const entry of entries) {
    const resource = entry?.resource;
    let parsed = null;
    if (resource?.resourceType === "Condition") parsed = parseCondition(resource);
    if (resource?.resourceType === "Observation") parsed = parseObservation(resource);
    if (!parsed) {
      unsupported += 1;
      continue;
    }
    supported += 1;
    if (resource.resourceType === "Condition") {
      if (!conditionIds.has(parsed.id)) conditions.push(parsed);
      conditionIds.add(parsed.id);
    } else {
      measurements.push(parsed);
    }
  }

  return {
    conditionIds: [...conditionIds],
    conditions,
    measurements,
    observedAt: input.timestamp ?? conditions[0]?.recordedAt ?? measurements[0]?.observedAt ?? "",
    provenance: {
      format: "FHIR R4",
      supported,
      unsupported,
      total: entries.length,
    },
  };
}
