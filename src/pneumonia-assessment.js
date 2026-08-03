const HIRA_PNEUMONIA_SOURCE_URL = "https://www.hira.or.kr/bbs/bbsCDownLoad.do?apndNo=1&apndBrdBltNo=12191&apndBrdTyNo=2&apndBltNo=157";
const KDCA_PNEUMONIA_SOURCE_URL = "https://www.kdca.go.kr/bbs/kdca/263/306697/download.do";

export const HIRA_PNEUMONIA_2026_RULESET = Object.freeze({
  id: "hira-pneumonia-quality-7th",
  version: "2026-7th-plan",
  sourceLabel: "심평원 2026년(7차) 폐렴 적정성 평가 세부시행계획",
  sourceUrl: HIRA_PNEUMONIA_SOURCE_URL,
  effectivePeriod: Object.freeze({ start: "2026-10-01", end: "2027-03-31" }),
  patientScope: Object.freeze({ minimumAge: 18, minimumIntravenousAntibioticDays: 3 }),
  institutionScope: Object.freeze({ minimumCapAdmissions: 10, nursingHospitalsExcluded: true }),
  arrivalWindows: Object.freeze({ preAdmissionHours: 48, processMetricHours: 24, antibioticMetricHours: 8 }),
  metrics: Object.freeze([
    Object.freeze({ id: "oxygen-saturation", label: "병원도착 24시간 이내 산소포화도검사", weight: 2 }),
    Object.freeze({ id: "severity-tool", label: "병원도착 24시간 이내 중증도 판정도구", weight: 3 }),
    Object.freeze({ id: "sputum-culture", label: "병원도착 24시간 이내 객담배양검사 처방", weight: 1.5 }),
    Object.freeze({ id: "blood-culture-before-antibiotic", label: "첫 정맥 항생제 투여 전 혈액배양검사", weight: 1 }),
    Object.freeze({ id: "appropriate-first-antibiotic", label: "병원도착 8시간 이내 적합한 첫 정맥 항생제", weight: 2.5 }),
  ]),
  monitoringMetrics: Object.freeze([
    Object.freeze({ id: "length-of-stay-index", label: "건당입원일수 장기도지표(LI)", weighted: false }),
    Object.freeze({ id: "costliness-index", label: "건당진료비 고가도지표(CI)", weighted: false }),
    Object.freeze({ id: "readmission-30d", label: "퇴원 30일 이내 재입원율", weighted: false }),
    Object.freeze({ id: "mortality-30d", label: "입원 30일 이내 사망률", weighted: false }),
  ]),
});

export const KDCA_PNEUMONIA_2026_GUIDELINE = Object.freeze({
  id: "kdca-community-acquired-pneumonia-concordance",
  version: "2026-publication",
  sourceLabel: "질병관리청 지역사회획득 폐렴 항생제 적정사용 실무지침",
  sourceUrl: KDCA_PNEUMONIA_SOURCE_URL,
  diagnosticElements: Object.freeze(["new-pulmonary-infiltrate", "infection-evidence", "community-onset"]),
  communityOnsetMaximumHoursAfterAdmission: 48,
});

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const FINAL_STATUSES = new Set([
  "CONFIRMED",
  "CLINICIAN_CONFIRMED",
  "FINAL",
  "VERIFIED",
  "DOCUMENTED",
  "ACTIVE",
  "ORDERED",
  "COLLECTED",
  "COMPLETED",
]);
const CAP_DIAGNOSIS_ROLES = new Set(["PRIMARY", "FIRST_SECONDARY", "FIRSTSECONDARY"]);
const HOSPITAL_TYPES = new Set([
  "HOSPITAL",
  "GENERAL_HOSPITAL",
  "TERTIARY_HOSPITAL",
  "SECONDARY_HOSPITAL",
  "상급종합병원",
  "종합병원",
  "병원",
]);
const NURSING_HOSPITAL_TYPES = new Set(["NURSING_HOSPITAL", "LONG_TERM_CARE_HOSPITAL", "요양병원"]);

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedToken(value) {
  return cleanText(value).toUpperCase().replace(/[\s./-]+/g, "_");
}

function datePart(value) {
  const match = cleanText(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "";
  const normalized = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === normalized ? normalized : "";
}

function instantMillis(value) {
  const text = cleanText(value);
  if (!text || !/[T ]\d{2}:\d{2}/.test(text)) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.valueOf();
}

function validInstant(value) {
  const milliseconds = instantMillis(value);
  return milliseconds === null ? "" : new Date(milliseconds).toISOString();
}

function valueAtPath(object, paths) {
  for (const path of paths) {
    let value = object;
    for (const key of path.split(".")) value = value?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function eventTimestamp(event, keys = []) {
  return valueAtPath(event, [
    ...keys,
    "performedAt",
    "recordedAt",
    "collectedAt",
    "orderedAt",
    "administeredAt",
    "timestamp",
    "dateTime",
    "occurredAt",
  ]);
}

function inDatePeriod(value, period) {
  const date = datePart(value);
  return Boolean(date) && date >= period.start && date <= period.end;
}

function ageOnDate(birthDate, onDate) {
  const birth = datePart(birthDate);
  const date = datePart(onDate);
  if (!birth || !date || birth > date) return null;
  const [birthYear, birthMonth, birthDay] = birth.split("-").map(Number);
  const [year, month, day] = date.split("-").map(Number);
  return year - birthYear - (month < birthMonth || (month === birthMonth && day < birthDay) ? 1 : 0);
}

function asArray(value) {
  return Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
}

function uniqueObjects(values) {
  return [...new Set(values.filter((value) => value && typeof value === "object"))];
}

function eventText(event) {
  return [event?.kind, event?.type, event?.code, event?.label, event?.name, event?.test]
    .map(normalizedToken)
    .filter(Boolean)
    .join("_");
}

function verifiedOrUnspecified(event) {
  const status = normalizedToken(event?.status ?? event?.recordStatus ?? event?.verificationStatus);
  return !status || FINAL_STATUSES.has(status);
}

export function isPneumoniaDiagnosisCode(value) {
  const code = cleanText(value).toUpperCase().replaceAll(".", "");
  if (/^J1[2-8]/.test(code)) return true;
  return /^J10[01]/.test(code) || /^J11[01]/.test(code);
}

function isCapDiagnosis(diagnosis) {
  if (!diagnosis || typeof diagnosis !== "object") return false;
  if (diagnosis.targetPneumonia === true || diagnosis.isCommunityAcquiredPneumonia === true) return true;
  const label = cleanText(diagnosis.label ?? diagnosis.name);
  return isPneumoniaDiagnosisCode(diagnosis.code) || /지역사회획득\s*폐렴|community[- ]acquired pneumonia/i.test(label);
}

function diagnosisRole(diagnosis) {
  return normalizedToken(diagnosis?.claimPosition ?? diagnosis?.diagnosisRole ?? diagnosis?.role);
}

function arrivalValue(input) {
  return valueAtPath(input, [
    "admission.emergencyArrivalAt",
    "admission.arrivedAt",
    "encounter.emergencyArrivalAt",
    "encounter.arrivedAt",
    "admission.admittedAt",
    "encounter.admittedAt",
    "admittedAt",
  ]);
}

function dischargeValue(input) {
  return valueAtPath(input, ["admission.dischargedAt", "encounter.dischargedAt", "dischargedAt"]);
}

function admissionSetting(input) {
  const setting = normalizedToken(valueAtPath(input, ["admission.setting", "encounter.setting", "setting"]));
  if (setting) return setting;
  return valueAtPath(input, ["admission.admittedAt", "encounter.admittedAt"]) ? "INPATIENT" : "";
}

function institutionType(input) {
  return normalizedToken(valueAtPath(input, [
    "institution.type",
    "institution.institutionType",
    "admission.institutionType",
    "encounter.institutionType",
    "institutionType",
  ]));
}

function communityAcquisition(input, diagnosis = null) {
  const explicit = valueAtPath(input, [
    "admission.communityOnset",
    "encounter.communityOnset",
    "clinicalContext.communityAcquired",
    "communityAcquired",
  ]);
  if (explicit === true) return { status: "documented", communityAcquired: true, reason: "지역사회 발생으로 기록되어 있습니다." };
  if (explicit === false || diagnosis?.communityAcquired === false) {
    return { status: "outside-scope", communityAcquired: false, reason: "지역사회획득 폐렴이 아닌 것으로 기록되어 있습니다." };
  }
  const withinHoursValue = valueAtPath(input, ["admission.diagnosedWithinHours", "encounter.diagnosedWithinHours"]);
  const withinHours = withinHoursValue === null ? Number.NaN : Number(withinHoursValue);
  if (Number.isFinite(withinHours) && withinHours >= 0) {
    return withinHours <= KDCA_PNEUMONIA_2026_GUIDELINE.communityOnsetMaximumHoursAfterAdmission
      ? { status: "documented", communityAcquired: true, diagnosedWithinHours: withinHours, reason: "입원 후 48시간 이내 발생·진단 기록입니다." }
      : { status: "outside-scope", communityAcquired: false, diagnosedWithinHours: withinHours, reason: "입원 48시간 이후 발생·진단되어 CAP 범위를 벗어납니다." };
  }
  if (diagnosis?.communityAcquired === true) {
    return { status: "documented", communityAcquired: true, reason: "진단 기록에 지역사회획득 여부가 확인됩니다." };
  }
  const onsetAt = valueAtPath(input, ["admission.onsetAt", "encounter.onsetAt", "clinicalContext.onsetAt"]);
  const admissionAt = valueAtPath(input, ["admission.admittedAt", "encounter.admittedAt", "admittedAt"]);
  const onsetMs = instantMillis(onsetAt);
  const admissionMs = instantMillis(admissionAt);
  if (onsetMs !== null && admissionMs !== null) {
    const hours = (onsetMs - admissionMs) / HOUR_MS;
    return hours <= 48
      ? { status: "documented", communityAcquired: true, diagnosedWithinHours: hours, reason: "발생시점이 입원 후 48시간 이내입니다." }
      : { status: "outside-scope", communityAcquired: false, diagnosedWithinHours: hours, reason: "발생시점이 입원 48시간 이후입니다." };
  }
  return { status: "insufficient", communityAcquired: null, reason: "지역사회 발생 또는 입원 후 48시간 이내 여부를 확인해야 합니다." };
}

function normalizedAge(input, arrival) {
  const explicit = valueAtPath(input, [
    "patient.ageAtAdmission",
    "patient.ageAtEvaluation",
    "patient.ageYears",
    "ageAtAdmission",
    "ageAtEvaluation",
    "ageYears",
  ]);
  if (Number.isInteger(explicit) && explicit >= 0) return explicit;
  return ageOnDate(valueAtPath(input, ["patient.birthDate", "birthDate"]), arrival);
}

function isIvAdministration(event) {
  const route = normalizedToken(event?.route ?? event?.administration?.route ?? event?.prescription?.route);
  return route === "IV" || route === "INTRAVENOUS" || route === "정맥" || route === "정주";
}

function medicationAdministrations(input) {
  const candidates = uniqueObjects([
    ...asArray(input?.medicationAdministrations),
    ...asArray(input?.antibiotics),
    ...asArray(input?.medications),
    ...asArray(input?.events).filter(({ type }) => normalizedToken(type) === "MEDICATION"),
  ]);
  return candidates.filter((event) => isIvAdministration(event)
    && event?.isAntibiotic !== false
    && !["NON_ANTIBIOTIC", "STEROID"].includes(normalizedToken(event?.medicationClass ?? event?.class)));
}

function ivAntibioticDays(input, administrations) {
  const explicitValue = valueAtPath(input, [
    "admission.ivAntibioticDays",
    "encounter.ivAntibioticDays",
    "ivAntibioticDays",
    "ivAntibioticCourse.days",
  ]);
  const explicit = explicitValue === null ? Number.NaN : Number(explicitValue);
  if (Number.isFinite(explicit) && explicit >= 0) return Math.floor(explicit);
  const dates = new Set(administrations.map((event) => datePart(eventTimestamp(event, ["administeredAt"]))).filter(Boolean));
  return dates.size || null;
}

function windowEvidence(events, arrivalMs, beforeHours, afterHours, keys = []) {
  const lower = arrivalMs - beforeHours * HOUR_MS;
  const upper = arrivalMs + afterHours * HOUR_MS;
  return events.map((event) => {
    const timestamp = eventTimestamp(event, keys);
    const milliseconds = instantMillis(timestamp);
    return {
      event,
      timestamp: validInstant(timestamp),
      milliseconds,
      withinWindow: milliseconds !== null && milliseconds >= lower && milliseconds <= upper,
    };
  });
}

function isOxygenAssessment(event) {
  const text = eventText(event);
  return /SPO2|OXYGEN_SATURATION|PULSE_OX|PULSEOX|ARTERIAL_BLOOD_GAS|ABG|산소포화도/.test(text);
}

function oxygenAssessments(input) {
  return uniqueObjects([
    ...asArray(input?.oxygenAssessments),
    ...asArray(input?.observations).filter(isOxygenAssessment),
    ...asArray(input?.events).filter(isOxygenAssessment),
  ]).filter(verifiedOrUnspecified);
}

function isSeverityAssessment(event) {
  const tool = normalizedToken(event?.tool ?? event?.name ?? event?.code);
  return ["CURB_65", "CURB65", "CRB", "PSI", "PNEUMONIA_SEVERITY_INDEX"].includes(tool);
}

function severityAssessments(input) {
  return uniqueObjects([
    ...asArray(input?.severityAssessments),
    ...asArray(input?.events).filter(isSeverityAssessment),
  ]).filter((event) => isSeverityAssessment(event) && verifiedOrUnspecified(event));
}

function isSputumCulture(event) {
  const text = eventText(event);
  return /SPUTUM|객담/.test(text) && /CULTURE|CX|배양/.test(text);
}

function sputumCultureOrders(input) {
  return uniqueObjects([
    ...asArray(input?.sputumCultureOrders),
    ...asArray(input?.microbiologyOrders).filter(isSputumCulture),
    ...asArray(input?.events).filter(isSputumCulture),
  ]).filter(verifiedOrUnspecified);
}

function isBloodCulture(event) {
  const text = eventText(event);
  return /BLOOD/.test(text) && /CULTURE|CX/.test(text) || /혈액배양/.test(text);
}

function bloodCultureCollections(input) {
  const microbiologyWithCollection = asArray(input?.microbiologyOrders)
    .filter((event) => isBloodCulture(event) && eventTimestamp(event, ["collectedAt", "performedAt"]));
  return uniqueObjects([
    ...asArray(input?.bloodCultures),
    ...asArray(input?.specimenCollections).filter(isBloodCulture),
    ...microbiologyWithCollection,
    ...asArray(input?.events).filter((event) => isBloodCulture(event) && eventTimestamp(event, ["collectedAt", "performedAt"])),
  ]).filter(verifiedOrUnspecified);
}

function antibioticAppropriateness(event) {
  if (event?.appropriateForCap === true || event?.appropriate === true) return true;
  if (event?.appropriateForCap === false || event?.appropriate === false) return false;
  const status = normalizedToken(event?.appropriatenessReview?.status ?? event?.appropriatenessStatus);
  if (["APPROPRIATE", "VERIFIED", "CONFIRMED", "MATCHED"].includes(status)) return true;
  if (["INAPPROPRIATE", "NOT_APPROPRIATE", "REJECTED", "NOT_MATCHED"].includes(status)) return false;
  return null;
}

function metricResult(spec, status, reason, evidence = [], extra = {}) {
  return {
    id: spec.id,
    label: spec.label,
    weight: spec.weight,
    status,
    included: status === "included",
    denominatorIncluded: status !== "not-applicable",
    reason,
    evidence,
    ...extra,
  };
}

function unavailableMetrics(targetStatus) {
  const status = targetStatus === "insufficient" ? "insufficient" : "not-applicable";
  return HIRA_PNEUMONIA_2026_RULESET.metrics.map((spec) => metricResult(
    spec,
    status,
    targetStatus === "insufficient"
      ? "평가대상 여부를 확정할 자료가 부족합니다."
      : "폐렴 적정성 평가 대상 사례가 아닙니다.",
  ));
}

function targetAssessment(input, arrival, administrations) {
  const period = HIRA_PNEUMONIA_2026_RULESET.effectivePeriod;
  const diagnoses = asArray(input?.diagnoses);
  const capDiagnoses = diagnoses.filter(isCapDiagnosis);
  const eligibleDiagnosis = capDiagnoses.find((diagnosis) => CAP_DIAGNOSIS_ROLES.has(diagnosisRole(diagnosis))) ?? null;
  const roleMissing = capDiagnoses.length > 0 && capDiagnoses.every((diagnosis) => !diagnosisRole(diagnosis));
  const acquisition = communityAcquisition(input, eligibleDiagnosis ?? capDiagnoses[0]);
  const ageYears = normalizedAge(input, arrival);
  const type = institutionType(input);
  const setting = admissionSetting(input);
  const ivDays = ivAntibioticDays(input, administrations);
  const periodEligible = inDatePeriod(arrival, period);
  const inpatient = setting === "INPATIENT" || setting === "입원";
  const institutionEligible = HOSPITAL_TYPES.has(type);
  const nursingHospital = NURSING_HOSPITAL_TYPES.has(type);
  const reasons = [];
  const missing = [];

  if (!datePart(arrival)) missing.push("병원도착일");
  else if (!periodEligible) reasons.push("7차 평가기간 밖의 입원");
  if (ageYears === null) missing.push("입원일 기준 만 나이");
  else if (ageYears < HIRA_PNEUMONIA_2026_RULESET.patientScope.minimumAge) reasons.push("만 18세 미만");
  if (!type) missing.push("요양기관 종별");
  else if (nursingHospital) reasons.push("요양병원 제외");
  else if (!institutionEligible) reasons.push("병원급 이상 요양기관이 아님");
  if (!setting) missing.push("입원 여부");
  else if (!inpatient) reasons.push("입원 진료가 아님");
  if (!eligibleDiagnosis) {
    if (roleMissing) missing.push("폐렴 상병의 주상병·제1부상병 구분");
    else reasons.push("CAP 주상병 또는 제1부상병이 확인되지 않음");
  }
  if (acquisition.status === "insufficient") missing.push("지역사회획득 여부");
  else if (!acquisition.communityAcquired) reasons.push("지역사회획득 폐렴 범위 아님");
  if (ivDays === null) missing.push("정맥 항생제 투여 일수");
  else if (ivDays < HIRA_PNEUMONIA_2026_RULESET.patientScope.minimumIntravenousAntibioticDays) reasons.push("정맥 항생제 3일 미만");

  const blockingReason = reasons.length > 0;
  const status = blockingReason ? "not-eligible" : missing.length ? "insufficient" : "eligible";
  if (status === "eligible") reasons.push("만 18세 이상 CAP 입원·정맥 항생제 3일 이상 대상 사례");
  return {
    status,
    eligible: status === "eligible",
    ageYears,
    admissionDate: datePart(arrival),
    institutionType: type,
    diagnosisCode: cleanText(eligibleDiagnosis?.code),
    diagnosisRole: diagnosisRole(eligibleDiagnosis),
    communityAcquisition: acquisition,
    ivAntibioticDays: ivDays,
    missing,
    reason: [...reasons, ...missing.map((item) => `${item} 확인 필요`)].join(" · "),
  };
}

export function evaluateHiraPneumonia2026Contribution(input = {}, options = {}) {
  const arrival = arrivalValue(input);
  const arrivalMs = instantMillis(arrival);
  const administrations = medicationAdministrations(input);
  const target = targetAssessment(input, arrival, administrations);
  const period = { ...HIRA_PNEUMONIA_2026_RULESET.effectivePeriod };
  if (target.status !== "eligible" || arrivalMs === null) {
    return {
      domain: "hira-pneumonia-patient-contribution-preview",
      status: target.status,
      target,
      metrics: target.status === "eligible" ? unavailableMetrics("insufficient") : unavailableMetrics(target.status),
      period,
      evaluatedAt: validInstant(options.evaluatedAt ?? input?.evaluatedAt),
      rule: HIRA_PNEUMONIA_2026_RULESET,
      disclaimer: "환자 사례의 지표 기여 예상이며 공식 기관 점수·등급 또는 개별 진료비 삭감 판정이 아닙니다. 검사·처방을 자동 결정하지 않습니다.",
    };
  }

  const processBefore = HIRA_PNEUMONIA_2026_RULESET.arrivalWindows.preAdmissionHours;
  const oxygenEvidence = windowEvidence(oxygenAssessments(input), arrivalMs, processBefore, 24, ["performedAt", "recordedAt"]);
  const severityEvidence = windowEvidence(severityAssessments(input), arrivalMs, processBefore, 24, ["assessedAt", "recordedAt"]);
  const sputumEvidence = windowEvidence(sputumCultureOrders(input), arrivalMs, processBefore, 24, ["orderedAt"]);
  const oxygenIncluded = oxygenEvidence.some(({ withinWindow }) => withinWindow);
  const severityIncluded = severityEvidence.some(({ withinWindow }) => withinWindow);
  const sputumIncluded = sputumEvidence.some(({ withinWindow }) => withinWindow);
  const oxygenSpec = HIRA_PNEUMONIA_2026_RULESET.metrics[0];
  const severitySpec = HIRA_PNEUMONIA_2026_RULESET.metrics[1];
  const sputumSpec = HIRA_PNEUMONIA_2026_RULESET.metrics[2];
  const bloodSpec = HIRA_PNEUMONIA_2026_RULESET.metrics[3];
  const antibioticSpec = HIRA_PNEUMONIA_2026_RULESET.metrics[4];

  const dischargeMs = instantMillis(dischargeValue(input));
  const episodeEnd = dischargeMs !== null && dischargeMs >= arrivalMs ? dischargeMs : arrivalMs + 90 * DAY_MS;
  const episodeStart = arrivalMs - processBefore * HOUR_MS;
  const ivEvidence = administrations.map((event) => {
    const timestamp = eventTimestamp(event, ["administeredAt"]);
    const milliseconds = instantMillis(timestamp);
    return {
      event,
      timestamp: validInstant(timestamp),
      milliseconds,
      withinEpisode: milliseconds !== null && milliseconds >= episodeStart && milliseconds <= episodeEnd,
      appropriateForCap: antibioticAppropriateness(event),
    };
  });
  const firstIv = ivEvidence.filter(({ withinEpisode }) => withinEpisode).sort((left, right) => left.milliseconds - right.milliseconds)[0] ?? null;
  const hasIvWithoutTimestamp = administrations.length > 0 && !firstIv;

  const bloodEvents = bloodCultureCollections(input);
  const bloodEvidence = bloodEvents.map((event) => {
    const timestamp = eventTimestamp(event, ["collectedAt", "performedAt"]);
    const milliseconds = instantMillis(timestamp);
    return {
      event,
      timestamp: validInstant(timestamp),
      milliseconds,
      withinEpisode: milliseconds !== null && milliseconds >= episodeStart && milliseconds <= episodeEnd,
      beforeFirstIv: milliseconds !== null && firstIv ? milliseconds < firstIv.milliseconds : null,
    };
  });
  const performedBloodCultures = bloodEvidence.filter(({ withinEpisode }) => withinEpisode);
  const bloodKnownPerformed = bloodEvents.length > 0;
  let bloodMetric;
  if (!bloodKnownPerformed) {
    bloodMetric = metricResult(bloodSpec, "not-applicable", "혈액배양검사를 시행하지 않아 이 지표의 환자 분모에서 제외됩니다.", [], { denominatorIncluded: false, observed: 0 });
  } else if (!performedBloodCultures.length || !firstIv) {
    bloodMetric = metricResult(
      bloodSpec,
      "insufficient",
      !performedBloodCultures.length ? "혈액배양 채혈 시각을 확인해야 합니다." : "첫 정맥 항생제 실제 투여 시각을 확인해야 합니다.",
      bloodEvidence,
      { observed: performedBloodCultures.length },
    );
  } else {
    const before = performedBloodCultures.some(({ beforeFirstIv }) => beforeFirstIv);
    bloodMetric = metricResult(
      bloodSpec,
      before ? "included" : "not-included",
      before ? "첫 정맥 항생제 실제 투여 전에 혈액배양 검체를 채취했습니다." : "혈액배양은 시행했으나 첫 정맥 항생제 투여 전 채혈이 확인되지 않습니다.",
      bloodEvidence,
      { observed: performedBloodCultures.length },
    );
  }

  let antibioticMetric;
  if (!firstIv) {
    antibioticMetric = metricResult(
      antibioticSpec,
      "insufficient",
      hasIvWithoutTimestamp || target.ivAntibioticDays >= 3
        ? "첫 정맥 항생제 실제 투여 시각을 확인해야 합니다."
        : "정맥 항생제 투여 기록을 확인해야 합니다.",
      ivEvidence,
      { observed: 0 },
    );
  } else {
    const withinEightHours = firstIv.milliseconds >= episodeStart && firstIv.milliseconds <= arrivalMs + 8 * HOUR_MS;
    const appropriate = firstIv.appropriateForCap;
    const status = appropriate === null ? "insufficient" : withinEightHours && appropriate ? "included" : "not-included";
    const reason = appropriate === null
      ? "첫 정맥 항생제의 CAP 적합성 검토 결과를 확인해야 합니다."
      : !withinEightHours
        ? "첫 정맥 항생제가 병원도착 8시간 이내 또는 입원 전 48시간 범위에서 확인되지 않습니다."
        : appropriate
          ? "병원도착 8시간 이내 적합한 첫 정맥 항생제가 확인됩니다."
          : "병원도착 8시간 이내 첫 정맥 항생제의 적합성 기준이 충족되지 않았습니다.";
    antibioticMetric = metricResult(antibioticSpec, status, reason, [firstIv], { observed: 1 });
  }

  const processMetric = (spec, included, evidence, successReason, failureReason) => {
    const missingTimestamp = evidence.length > 0 && evidence.every(({ milliseconds }) => milliseconds === null);
    return metricResult(
      spec,
      included ? "included" : missingTimestamp ? "insufficient" : "not-included",
      included ? successReason : missingTimestamp ? "검사·평가의 실제 시행 시각을 확인해야 합니다." : failureReason,
      evidence,
      { observed: evidence.filter(({ withinWindow }) => withinWindow).length },
    );
  };
  const metrics = [
    processMetric(oxygenSpec, oxygenIncluded, oxygenEvidence, "병원도착 24시간 이내 또는 입원 전 48시간 이내 산소포화도검사가 확인됩니다.", "해당 시간 범위의 산소포화도검사를 찾지 못했습니다."),
    processMetric(severitySpec, severityIncluded, severityEvidence, "병원도착 24시간 이내 또는 입원 전 48시간 이내 CURB-65·PSI 기록이 확인됩니다.", "해당 시간 범위의 CURB-65·PSI 기록을 찾지 못했습니다."),
    processMetric(sputumSpec, sputumIncluded, sputumEvidence, "병원도착 24시간 이내 또는 입원 전 48시간 이내 객담배양검사 처방이 확인됩니다.", "해당 시간 범위의 객담배양검사 처방을 찾지 못했습니다."),
    bloodMetric,
    antibioticMetric,
  ];
  return {
    domain: "hira-pneumonia-patient-contribution-preview",
    status: "eligible",
    target,
    metrics,
    period,
    evaluatedAt: validInstant(options.evaluatedAt ?? input?.evaluatedAt),
    rule: HIRA_PNEUMONIA_2026_RULESET,
    disclaimer: "환자 사례의 지표 기여 예상이며 공식 기관 점수·등급 또는 개별 진료비 삭감 판정이 아닙니다. 검사·처방을 자동 결정하지 않습니다.",
  };
}

function chestImagingAssessment(input) {
  const imaging = asArray(valueAtPath(input, ["clinicalContext.chestImaging"]))
    .concat(asArray(input?.imagingStudies));
  if (!imaging.length) return { status: "insufficient", newInfiltrate: null, reason: "흉부 영상의 새로운 폐 침윤 기록을 확인해야 합니다.", evidence: [] };
  const supported = imaging.find((item) => item?.newInfiltrate === true
    || item?.pulmonaryInfiltrate === true
    || item?.supportsPneumonia === true);
  const explicitlyAbsent = imaging.every((item) => item?.newInfiltrate === false
    || item?.pulmonaryInfiltrate === false
    || item?.supportsPneumonia === false);
  return {
    status: supported ? "documented" : explicitlyAbsent ? "not-demonstrated" : "insufficient",
    newInfiltrate: supported ? true : explicitlyAbsent ? false : null,
    reason: supported ? "흉부 영상에서 새로운 폐 침윤이 기록되어 있습니다." : explicitlyAbsent ? "흉부 영상에 새로운 폐 침윤이 기록되지 않았습니다." : "영상 판독에서 새로운 폐 침윤 여부를 확인해야 합니다.",
    evidence: imaging,
  };
}

function infectionEvidenceAssessment(input) {
  const context = input?.clinicalContext ?? {};
  const symptoms = asArray(context.symptoms);
  const flags = [
    ["fever", context.fever],
    ["purulent-sputum", context.purulentSputum],
    ["leukocytosis", context.leukocytosis],
    ["oxygen-desaturation", context.oxygenDesaturation],
  ].filter(([, value]) => value === true).map(([type]) => ({ type, documented: true }));
  const recognized = symptoms.filter((symptom) => {
    if (typeof symptom === "string") return /발열|고열|화농성.*객담|백혈구.*증가|산소포화도.*감소|fever|purulent.*sputum|leukocytosis|desaturation/i.test(symptom);
    const text = [symptom?.type, symptom?.code, symptom?.label, symptom?.name].map(cleanText).join(" ");
    return symptom?.documented !== false && /발열|고열|화농성.*객담|백혈구.*증가|산소포화도.*감소|fever|purulent.*sputum|leukocytosis|desaturation/i.test(text);
  });
  const evidence = [...flags, ...recognized];
  const explicitlyAbsent = context.infectionEvidencePresent === false;
  return {
    status: evidence.length ? "documented" : explicitlyAbsent ? "not-demonstrated" : "insufficient",
    present: evidence.length ? true : explicitlyAbsent ? false : null,
    reason: evidence.length ? "폐 감염을 시사하는 임상 근거가 기록되어 있습니다." : explicitlyAbsent ? "발열·화농성 객담·백혈구 증가·산소포화도 감소 근거가 기록되지 않았습니다." : "폐 감염을 시사하는 임상 근거를 확인해야 합니다.",
    evidence,
  };
}

function clinicianDiagnosisAssessment(input) {
  const diagnosis = asArray(input?.diagnoses).find((item) => isCapDiagnosis(item)
    && item?.inferred !== true
    && normalizedToken(item?.sourceType ?? item?.source) !== "AI_INFERENCE");
  const documented = Boolean(diagnosis)
    && diagnosis?.clinicianConfirmed !== false
    && (!diagnosis?.status || FINAL_STATUSES.has(normalizedToken(diagnosis.status)));
  return {
    status: documented ? "documented" : "not-documented",
    documented,
    code: cleanText(diagnosis?.code),
    label: cleanText(diagnosis?.label ?? diagnosis?.name),
    autoChanged: false,
    reason: documented ? "의료진이 기록한 폐렴 진단이 있습니다." : "의료진의 최종 폐렴 진단 기록은 확인되지 않습니다.",
  };
}

export function evaluatePneumoniaConcordance(input = {}, options = {}) {
  const imaging = chestImagingAssessment(input);
  const infectionEvidence = infectionEvidenceAssessment(input);
  const communitySetting = communityAcquisition(input, asArray(input?.diagnoses).find(isCapDiagnosis));
  const clinicianDiagnosis = clinicianDiagnosisAssessment(input);
  const anyExplicitMismatch = imaging.newInfiltrate === false
    || infectionEvidence.present === false
    || communitySetting.communityAcquired === false;
  const anyMissing = imaging.newInfiltrate === null
    || infectionEvidence.present === null
    || communitySetting.communityAcquired === null;
  const criteriaMatch = anyExplicitMismatch ? false : anyMissing ? null : true;
  let status = "needs-review";
  if (communitySetting.status === "outside-scope") status = "outside-cap-scope";
  else if (criteriaMatch && clinicianDiagnosis.documented) status = "supported";
  else if (criteriaMatch) status = "clinician-review";
  return {
    domain: "pneumonia-clinical-concordance",
    status,
    criteriaMatch,
    imaging,
    infectionEvidence,
    communitySetting,
    clinicianDiagnosis,
    evaluatedAt: validInstant(options.evaluatedAt ?? input?.evaluatedAt),
    rule: KDCA_PNEUMONIA_2026_GUIDELINE,
    disclaimer: "영상·감염 근거·발생시점의 기록 정합성을 확인하는 보조 정보입니다. 폐렴을 자동 진단·삭제하거나 항생제·입원을 자동 결정하지 않습니다.",
  };
}

export const evaluatePneumoniaClinicalConcordance = evaluatePneumoniaConcordance;
