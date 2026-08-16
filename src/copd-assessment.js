const HIRA_SOURCE_URL = "https://www.hira.or.kr/bbs/157/2025/10/BZ202510302440715.pdf";
const GOLD_SOURCE_URL = "https://goldcopd.org/wp-content/uploads/2026/01/GOLD-REPORT-2026-v1.3-8Dec2025_WMV2.pdf";

export const GOLD_COPD_2026_RULESET = Object.freeze({
  id: "gold-copd-diagnostic-concordance",
  version: "2026-v1.3",
  sourceLabel: "GOLD 2026 Report v1.3",
  sourceUrl: GOLD_SOURCE_URL,
  criterion: Object.freeze({ phase: "post-bronchodilator", operator: "<", threshold: 0.70 }),
  repeatConfirmationRange: Object.freeze({ minimum: 0.60, maximum: 0.80, inclusive: true }),
});

export const HIRA_COPD_2026_RULESET = Object.freeze({
  id: "hira-copd-quality-12th",
  version: "2026-12th-plan",
  sourceLabel: "심평원 2026년(12차) COPD 적정성 평가 세부계획",
  sourceUrl: HIRA_SOURCE_URL,
  effectivePeriod: Object.freeze({ start: "2026-01-01", end: "2026-12-31" }),
  diagnosisRange: Object.freeze({ included: Object.freeze(["J43", "J44"]), excluded: Object.freeze(["J43.0"]) }),
  pftCodes: Object.freeze(["F6001", "F6002", "F6013"]),
  inhalerClasses: Object.freeze(["LABA", "SABA", "LAMA", "LABA/ICS", "LABA/LAMA", "LABA/LAMA/ICS"]),
  metrics: Object.freeze([
    Object.freeze({ id: "pft", label: "폐기능검사 시행", weight: 40, minimum: 1 }),
    Object.freeze({ id: "continuing-visits", label: "동일 기관 COPD 외래 지속방문", weight: 20, minimum: 3 }),
    Object.freeze({ id: "inhaled-bronchodilator", label: "흡입기관지확장제 처방", weight: 40, minimum: 1 }),
  ]),
});

const ACCEPTABLE_QUALITY = new Set(["acceptable", "accepted", "verified", "valid", "a"]);
const VERIFIED = new Set(["verified", "confirmed", "final"]);

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validDate(value) {
  const normalized = cleanText(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return "";
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== normalized ? "" : normalized;
}

function validInstant(value) {
  if (!cleanText(value)) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? "" : parsed.toISOString();
}

function inPeriod(date, period) {
  const normalized = validDate(date);
  return Boolean(normalized) && normalized >= period.start && normalized <= period.end;
}

function ageOnDate(birthDate, onDate) {
  const birth = validDate(birthDate);
  const date = validDate(onDate);
  if (!birth || !date || birth > date) return null;
  const [birthYear, birthMonth, birthDay] = birth.split("-").map(Number);
  const [year, month, day] = date.split("-").map(Number);
  return year - birthYear - (month < birthMonth || (month === birthMonth && day < birthDay) ? 1 : 0);
}

export function normalizeSpirometryRatio(value, unit = "ratio") {
  let rawValue = value;
  let rawUnit = cleanText(unit).toLowerCase();
  if (typeof rawValue === "string" && rawValue.trim().endsWith("%")) {
    rawUnit = "%";
    rawValue = rawValue.trim().slice(0, -1);
  }
  if (!["", "ratio", "decimal", "1", "%", "percent", "percentage"].includes(rawUnit)) return null;
  const numeric = typeof rawValue === "number" ? rawValue : Number(cleanText(String(rawValue)));
  if (!Number.isFinite(numeric)) return null;
  const normalized = ["%", "percent", "percentage"].includes(rawUnit) ? numeric / 100 : numeric;
  return normalized >= 0 && normalized <= 1 ? normalized : null;
}

function verifiedProvenance(provenance, { allowLocalFinal = false } = {}) {
  if (!provenance || typeof provenance !== "object") return false;
  const kind = cleanText(provenance.kind).toLowerCase();
  if (allowLocalFinal && ["manual", "encounter", "demo", "synthetic-local-emr"].includes(kind)) {
    return provenance.verificationStatus === undefined
      || VERIFIED.has(cleanText(provenance.verificationStatus).toLowerCase());
  }
  return VERIFIED.has(cleanText(provenance.verificationStatus).toLowerCase())
    && VERIFIED.has(cleanText(provenance.patientMatch).toLowerCase())
    && Boolean(cleanText(provenance.sourceId))
    && Boolean(cleanText(provenance.reviewerId))
    && Boolean(validInstant(provenance.verifiedAt));
}

function acceptableSessionQuality(session) {
  const quality = session?.quality;
  if (quality === undefined || quality === null) return false;
  if (typeof quality === "string") return ACCEPTABLE_QUALITY.has(cleanText(quality).toLowerCase());
  return ACCEPTABLE_QUALITY.has(cleanText(quality.status).toLowerCase());
}

function measurementValue(measurement, keys) {
  for (const key of keys) {
    const value = measurement?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function ratioFromPostBronchodilator(session) {
  const post = session?.postBronchodilator ?? session?.post;
  if (!post || typeof post !== "object") return { ratio: null, basis: "", reason: "post-BD 측정값 없음" };
  const declaredRatio = measurementValue(post, ["fev1Fvc", "fev1FvcRatio", "ratio"]);
  if (declaredRatio !== null) {
    const ratio = normalizeSpirometryRatio(declaredRatio, post.unit ?? post.ratioUnit ?? "ratio");
    return ratio === null
      ? { ratio: null, basis: "", reason: "post-BD FEV₁/FVC 값 또는 단위가 유효하지 않음" }
      : { ratio, basis: "reported-ratio", reason: "" };
  }
  const fev1 = Number(measurementValue(post, ["fev1", "FEV1"]));
  const fvc = Number(measurementValue(post, ["fvc", "FVC"]));
  const fev1Unit = cleanText(post.fev1Unit ?? post.unit).toLowerCase();
  const fvcUnit = cleanText(post.fvcUnit ?? post.unit).toLowerCase();
  const acceptedVolumeUnits = new Set(["l", "liter", "litre"]);
  if (!Number.isFinite(fev1) || !Number.isFinite(fvc) || fev1 <= 0 || fvc <= 0) {
    return { ratio: null, basis: "", reason: "같은 post-BD 세션의 FEV₁·FVC가 완전하지 않음" };
  }
  if (!acceptedVolumeUnits.has(fev1Unit) || fev1Unit !== fvcUnit) {
    return { ratio: null, basis: "", reason: "FEV₁·FVC 단위가 같고 유효한 용적 단위인지 확인 필요" };
  }
  return { ratio: fev1 / fvc, basis: "calculated-fev1-fvc", reason: "" };
}

function normalizeSpirometrySession(session, index) {
  const date = validDate(session?.serviceDate ?? session?.date);
  const id = cleanText(session?.id);
  const encounterId = cleanText(session?.encounterId);
  const provenance = session?.provenance ?? session?.source;
  const external = cleanText(provenance?.kind).toLowerCase().includes("external");
  const provenanceVerified = verifiedProvenance(provenance, { allowLocalFinal: !external });
  const qualityAcceptable = acceptableSessionQuality(session);
  const ratioResult = ratioFromPostBronchodilator(session);
  const reasons = [];
  if (!id) reasons.push("검사 세션 ID 없음");
  if (!date) reasons.push("검사일 없음");
  if (!encounterId) reasons.push("진료 연결 ID 없음");
  if (!provenanceVerified) reasons.push(external ? "타기관 자료 출처·환자 일치 미검증" : "검사 출처 검증 정보 부족");
  if (!qualityAcceptable) reasons.push("검사 품질 확인 필요");
  if (ratioResult.reason) reasons.push(ratioResult.reason);
  return {
    id: id || `unidentified-${index}`,
    date,
    encounterId,
    ratio: ratioResult.ratio,
    basis: ratioResult.basis,
    valid: reasons.length === 0,
    external,
    reasons,
    provenance,
  };
}

function contextAssessment(input) {
  const context = input?.clinicalContext ?? {};
  const symptoms = Array.isArray(context.symptoms) ? context.symptoms : [];
  const verifiedSymptoms = symptoms.filter((symptom) => !symptom?.status || VERIFIED.has(cleanText(symptom.status).toLowerCase()));
  const exposure = context.exposure;
  const exposureVerified = Boolean(exposure)
    && (!exposure.status || VERIFIED.has(cleanText(exposure.status).toLowerCase()));
  const explicitlyVerified = VERIFIED.has(cleanText(context.evidenceStatus).toLowerCase());
  const sufficient = explicitlyVerified || (verifiedSymptoms.length > 0 && exposureVerified);
  return {
    status: sufficient ? "documented" : "insufficient",
    symptoms: verifiedSymptoms.map(({ label, code }) => cleanText(label || code)).filter(Boolean),
    exposure: exposureVerified ? exposure : null,
    alternativeCauseReview: context.alternativeCauseReview ?? null,
    reason: sufficient ? "호흡기 증상과 노출력 맥락이 기록되어 있습니다." : "호흡기 증상과 흡연·유해물질 노출력 기록을 함께 확인해야 합니다.",
  };
}

function clinicianDiagnosisAssessment(input) {
  const candidates = Array.isArray(input?.diagnoses)
    ? input.diagnoses
    : input?.diagnosis ? [input.diagnosis] : [];
  const diagnosis = candidates.find(({ code }) => isEligibleCopdCode(code)) ?? null;
  return {
    status: diagnosis ? "documented" : "not-documented",
    code: cleanText(diagnosis?.code),
    label: cleanText(diagnosis?.label),
    recordedAt: cleanText(diagnosis?.recordedAt),
    autoChanged: false,
    reason: diagnosis ? "의료진이 기록한 COPD 진단이 있습니다." : "의료진의 최종 COPD 진단 기록은 확인되지 않습니다.",
  };
}

function separateOccasions(left, right) {
  return left.id !== right.id && left.date !== right.date && left.encounterId !== right.encounterId;
}

export function evaluateGoldCopdConcordance(input = {}, options = {}) {
  const sessionsInput = Array.isArray(input.spirometrySessions)
    ? input.spirometrySessions
    : Array.isArray(input.pftSessions) ? input.pftSessions : [];
  const sessions = sessionsInput.map(normalizeSpirometrySession);
  const validSessions = sessions.filter(({ valid }) => valid).sort((left, right) => left.date.localeCompare(right.date));
  const context = contextAssessment(input);
  const clinicianDiagnosis = clinicianDiagnosisAssessment(input);
  const latest = validSessions.at(-1) ?? null;
  const previous = [...validSessions].reverse().find((session) => latest && separateOccasions(session, latest)) ?? null;
  const latestMatch = latest ? latest.ratio < GOLD_COPD_2026_RULESET.criterion.threshold : null;
  const inRepeatRange = latest
    ? latest.ratio >= GOLD_COPD_2026_RULESET.repeatConfirmationRange.minimum
      && latest.ratio <= GOLD_COPD_2026_RULESET.repeatConfirmationRange.maximum
    : false;
  const previousMatch = previous ? previous.ratio < GOLD_COPD_2026_RULESET.criterion.threshold : null;
  const discordant = Boolean(previous && previousMatch !== latestMatch);
  const repeatedMatch = Boolean(previous && previousMatch === true && latestMatch === true);

  let criterionStatus = "insufficient";
  if (latest) criterionStatus = latestMatch ? "matched" : "not-matched";
  let repeatStatus = "insufficient";
  let repeatConfirmationRecommended = false;
  let clinicianReviewRequired = false;
  if (latest) {
    if (discordant) {
      repeatStatus = "clinician-review";
      clinicianReviewRequired = true;
    } else if (previous) {
      repeatStatus = repeatedMatch ? "confirmed" : "criterion-not-demonstrated";
    } else if (inRepeatRange) {
      repeatStatus = "pending";
      repeatConfirmationRecommended = true;
    } else {
      repeatStatus = "not-required-by-range";
    }
  }

  let status = "insufficient";
  if (latest && context.status === "documented") {
    status = discordant
      ? "clinician-review"
      : repeatedMatch
        ? "matched-repeat-confirmed"
        : latestMatch
          ? repeatConfirmationRecommended ? "matched-repeat-pending" : "matched"
          : previous ? "criterion-not-demonstrated" : repeatConfirmationRecommended ? "not-matched-repeat-pending" : "criterion-not-demonstrated";
  }
  const invalidReasons = sessions.flatMap(({ reasons }) => reasons);
  return {
    domain: "copd-diagnostic-concordance",
    status,
    criteriaMatch: latestMatch,
    repeatConfirmationRecommended,
    clinicianReviewRequired,
    criterion: {
      status: criterionStatus,
      operator: "<",
      threshold: 0.70,
      latestRatio: latest?.ratio ?? null,
      displayRatio: latest ? latest.ratio.toFixed(3) : "",
      sessionId: latest?.id ?? "",
      sessionDate: latest?.date ?? "",
      basis: latest?.basis ?? "",
      reason: latest
        ? `post-BD FEV₁/FVC ${latest.ratio.toFixed(3)} ${latestMatch ? "<" : "≥"} 0.70`
        : invalidReasons[0] || "검증된 post-BD 검사 세션이 없습니다.",
    },
    repeatConfirmation: {
      status: repeatStatus,
      recommended: repeatConfirmationRecommended,
      clinicianReviewRequired,
      previousSessionId: previous?.id ?? "",
      previousRatio: previous?.ratio ?? null,
      reason: discordant
        ? "별도 시점 결과가 0.70 경계를 사이에 두고 달라 의료진 검토가 필요합니다."
        : repeatedMatch
          ? "서로 다른 날짜·진료의 두 검증 세션에서 기준 일치가 반복 확인되었습니다."
          : repeatConfirmationRecommended
            ? "단일 결과가 0.60~0.80 범위에 있어 별도 시점 재확인을 권고합니다."
            : latest ? "단일 결과가 반복확인 권고 범위 밖입니다." : "반복확인 상태를 평가할 자료가 없습니다.",
    },
    clinicalContext: context,
    clinicianDiagnosis,
    sessions,
    evaluatedAt: validInstant(options.evaluatedAt ?? input.evaluatedAt) || new Date().toISOString(),
    rule: GOLD_COPD_2026_RULESET,
    disclaimer: "수치와 임상 맥락의 정합성 보조 정보이며 COPD를 자동 진단·삭제하거나 처방을 결정하지 않습니다.",
  };
}

function isEligibleCopdCode(value) {
  const code = cleanText(value).toUpperCase();
  if (!code || code === "J43.0" || code.startsWith("J43.0")) return false;
  return code === "J43" || code.startsWith("J43.") || code === "J44" || code.startsWith("J44.");
}

function isEligibleQualityDiagnosis(diagnosis) {
  if (!isEligibleCopdCode(diagnosis?.code)) return false;
  const position = cleanText(diagnosis?.claimPosition ?? diagnosis?.diagnosisRole).toUpperCase().replaceAll("-", "_");
  return !position || ["PRIMARY", "FIRST_SECONDARY", "FIRSTSECONDARY"].includes(position);
}

function normalizedHiraInput(input, period) {
  const events = Array.isArray(input?.events) ? input.events : [];
  const diagnoses = Array.isArray(input?.diagnoses)
    ? input.diagnoses
    : events.filter(({ type }) => type === "condition");
  const visits = Array.isArray(input?.visits)
    ? input.visits
    : events.filter(({ type }) => type === "encounter").map((event) => ({
        id: event.id,
        date: event.date,
        setting: event.setting ?? "OUTPATIENT",
        institutionId: event.institutionId ?? "local-institution",
        diagnosisCodes: diagnoses.filter(({ encounterId }) => encounterId === event.id).map(({ code }) => code),
      }));
  const medications = Array.isArray(input?.medications)
    ? input.medications
    : events.filter(({ type }) => type === "medication").map((event) => ({
        ...event,
        prescribedAt: event.date,
        visitId: event.encounterId,
        class: event.medicationClass,
        route: event.prescription?.route,
      }));
  const pftSessions = Array.isArray(input?.pftSessions)
    ? input.pftSessions
    : events.filter(({ type, code }) => type === "procedure" && HIRA_COPD_2026_RULESET.pftCodes.includes(cleanText(code).toUpperCase())).map((event) => ({
        id: event.id,
        serviceDate: event.date,
        encounterId: event.encounterId || event.id,
        procedureCode: event.code,
        eligibleQualityProcedure: true,
        quality: { status: event.recordStatus === "final" ? "verified" : "" },
        provenance: event.source,
      }));
  const ageYears = Number.isInteger(input?.ageYears)
    ? input.ageYears
    : Number.isInteger(input?.patient?.ageAtEvaluation)
      ? input.patient.ageAtEvaluation
      : Number.isInteger(input?.ageAtEvaluation)
        ? input.ageAtEvaluation
        : ageOnDate(input?.birthDate ?? input?.patient?.birthDate, period.end);
  return { diagnoses, visits, medications, pftSessions, ageYears };
}

function qualityPftVerification(session) {
  const code = cleanText(session?.procedureCode ?? session?.code).toUpperCase();
  const date = validDate(session?.serviceDate ?? session?.date);
  const provenance = session?.provenance ?? session?.source;
  const external = cleanText(provenance?.kind).toLowerCase().includes("external");
  const verified = verifiedProvenance(provenance, { allowLocalFinal: !external });
  return {
    id: cleanText(session?.id),
    code,
    date,
    external,
    verified,
    eligibleCode: HIRA_COPD_2026_RULESET.pftCodes.includes(code),
    explicitlyEligible: session?.eligibleQualityProcedure !== false,
  };
}

function metricResult(spec, status, observed, reason, evidence = []) {
  return {
    id: spec.id,
    label: spec.label,
    weight: spec.weight,
    minimum: spec.minimum,
    status,
    included: status === "included",
    observed,
    reason,
    evidence,
  };
}

export function evaluateHiraCopd2026Contribution(input = {}, options = {}) {
  const period = {
    start: validDate(options.assessmentStart ?? input?.evaluationPeriod?.start) || HIRA_COPD_2026_RULESET.effectivePeriod.start,
    end: validDate(options.assessmentEnd ?? input?.evaluationPeriod?.end) || HIRA_COPD_2026_RULESET.effectivePeriod.end,
  };
  const normalized = normalizedHiraInput(input, period);
  const eligibleDiagnosis = normalized.diagnoses.find(isEligibleQualityDiagnosis);
  const excludedDiagnosis = normalized.diagnoses.find(({ code }) => cleanText(code).toUpperCase().startsWith("J43.0"));
  const eligibleVisits = normalized.visits.filter((visit) => inPeriod(visit.date, period)
    && cleanText(visit.setting || "OUTPATIENT").toUpperCase() === "OUTPATIENT"
    && (Array.isArray(visit.diagnosisCodes) ? visit.diagnosisCodes.some(isEligibleCopdCode) : Boolean(eligibleDiagnosis)));
  const visitById = new Map(eligibleVisits.map((visit) => [cleanText(visit.id), visit]));
  const targetMedicationDates = new Set(normalized.medications.filter((medication) => {
    const date = validDate(medication.prescribedAt ?? medication.date);
    const linkedVisit = visitById.get(cleanText(medication.visitId ?? medication.encounterId));
    const matchingVisit = linkedVisit || eligibleVisits.find((visit) => visit.date === date);
    const qualifies = medication.qualifiesTargetMedication === true
      || medication.eligibleQualityMedication === true
      || HIRA_COPD_2026_RULESET.inhalerClasses.includes(cleanText(medication.class).toUpperCase());
    return inPeriod(date, period) && Boolean(matchingVisit) && qualifies;
  }).map((medication) => validDate(medication.prescribedAt ?? medication.date)));
  const inpatientSteroid = normalized.visits.some((visit) => inPeriod(visit.date, period)
    && cleanText(visit.setting).toUpperCase() === "INPATIENT"
    && visit.systemicSteroidUsed === true);
  const ageEligible = Number.isInteger(normalized.ageYears) ? normalized.ageYears >= 40 : null;
  const medicationVisitPath = targetMedicationDates.size >= 2;
  const inpatientPath = inpatientSteroid && targetMedicationDates.size >= 1;
  const qualityScope = input?.qualityScope && typeof input.qualityScope === "object" && !Array.isArray(input.qualityScope)
    ? input.qualityScope
    : {};
  const denominatorVerified = qualityScope.officialDenominatorVerified === true;
  const exclusionsReviewed = qualityScope.officialExclusionsReviewed === true
    && typeof qualityScope.officialExclusionApplies === "boolean";
  const exclusionApplies = qualityScope.officialExclusionApplies === true;
  const targetCriteriaMatch = ageEligible === true && Boolean(eligibleDiagnosis) && (medicationVisitPath || inpatientPath);
  let targetStatus = targetCriteriaMatch ? "eligible" : "not-eligible";
  const targetReasons = [];
  if (ageEligible === null) {
    targetStatus = "insufficient";
    targetReasons.push("평가기간 기준 만 나이 자료 없음");
  } else if (!ageEligible) targetReasons.push("만 40세 미만");
  if (!eligibleDiagnosis) targetReasons.push(excludedDiagnosis ? "J43.0 제외 상병만 확인됨" : "J43~J44 대상 상병 확인 안 됨");
  if (!medicationVisitPath && !inpatientPath) targetReasons.push("COPD 약제 외래 사용 2회 또는 입원 스테로이드+외래 약제 경로 미충족");
  if (exclusionApplies) {
    targetStatus = "not-eligible";
    targetReasons.push("공식 제외조건 해당이 검토됨");
  } else if (targetCriteriaMatch && (!denominatorVerified || !exclusionsReviewed)) {
    targetStatus = "insufficient";
    if (!denominatorVerified) targetReasons.push("공식 분모 포함 여부 확인 필요");
    if (!exclusionsReviewed) targetReasons.push("공식 제외조건 검토 여부 확인 필요");
  }
  if (targetStatus === "eligible") targetReasons.push(medicationVisitPath ? "COPD 약제 사용 외래 2회 이상" : "전신 스테로이드 입원과 COPD 약제 외래 확인");

  const pftEvidence = normalized.pftSessions.map(qualityPftVerification)
    .filter(({ date, eligibleCode }) => inPeriod(date, period) && eligibleCode);
  const verifiedPft = pftEvidence.filter(({ verified, explicitlyEligible }) => verified && explicitlyEligible);
  const hasUnverifiedExternalPft = pftEvidence.some(({ external, verified, explicitlyEligible }) => external && (!verified || !explicitlyEligible));
  const sameInstitutionVisits = new Map();
  for (const visit of eligibleVisits) {
    const institution = cleanText(visit.institutionId) || "unknown";
    sameInstitutionVisits.set(institution, new Set([...(sameInstitutionVisits.get(institution) ?? []), visit.date]));
  }
  const maximumVisitCount = Math.max(0, ...[...sameInstitutionVisits.values()].map((dates) => dates.size));
  const inhalers = normalized.medications.filter((medication) => {
    const date = validDate(medication.prescribedAt ?? medication.date);
    const linkedVisit = visitById.get(cleanText(medication.visitId ?? medication.encounterId));
    const matchingVisit = linkedVisit || eligibleVisits.find((visit) => visit.date === date);
    return inPeriod(date, period)
      && Boolean(matchingVisit)
      && (medication.eligibleQualityMedication === true
        || HIRA_COPD_2026_RULESET.inhalerClasses.includes(cleanText(medication.class).toUpperCase()));
  });
  const [pftSpec, visitSpec, inhalerSpec] = HIRA_COPD_2026_RULESET.metrics;
  const metrics = targetStatus !== "eligible"
    ? HIRA_COPD_2026_RULESET.metrics.map((spec) => metricResult(
        spec,
        targetStatus === "insufficient" ? "insufficient" : "not-applicable",
        0,
        "평가대상 여부가 충족된 뒤 환자별 지표 기여를 확인합니다.",
      ))
    : [
        metricResult(
          pftSpec,
          verifiedPft.length ? "included" : hasUnverifiedExternalPft ? "insufficient" : "not-included",
          verifiedPft.length,
          verifiedPft.length
            ? "평가기간 내 검증된 대상 폐기능검사 코드가 있습니다. 진단 수치 기준과는 별도입니다."
            : hasUnverifiedExternalPft ? "타기관 PFT의 출처·환자 일치·검토자·검증 시각을 확인해야 합니다." : "평가기간 내 검증된 대상 폐기능검사 기록을 찾지 못했습니다.",
          pftEvidence,
        ),
        metricResult(
          visitSpec,
          qualityScope.previousPeriodSameInstitutionVisitVerified !== true
            ? "insufficient"
            : maximumVisitCount >= visitSpec.minimum ? "included" : "not-included",
          maximumVisitCount,
          qualityScope.previousPeriodSameInstitutionVisitVerified !== true
            ? "이전 평가기간 마지막 방문과 동일 기관 연결을 확인해야 합니다."
            : maximumVisitCount >= visitSpec.minimum ? "동일 기관 COPD 외래가 3회 이상 확인됩니다." : `동일 기관 COPD 외래 ${maximumVisitCount}회가 확인됩니다.`,
          eligibleVisits,
        ),
        metricResult(
          inhalerSpec,
          inhalers.length ? "included" : "not-included",
          inhalers.length,
          inhalers.length ? "평가기간 내 흡입기관지확장제 처방이 확인됩니다." : "평가기간 내 흡입기관지확장제 처방을 찾지 못했습니다.",
          inhalers,
        ),
      ];
  return {
    domain: "hira-copd-patient-contribution-preview",
    status: targetStatus,
    target: {
      status: targetStatus,
      eligible: targetStatus === "eligible",
      ageYears: normalized.ageYears,
      diagnosisCode: cleanText(eligibleDiagnosis?.code),
      outpatientMedicationDates: [...targetMedicationDates].sort(),
      qualityScope: {
        officialDenominatorVerified: denominatorVerified,
        officialExclusionsReviewed: exclusionsReviewed,
        officialExclusionApplies: exclusionsReviewed ? exclusionApplies : null,
      },
      reason: targetReasons.join(" · "),
    },
    metrics,
    evaluatedAt: validInstant(options.evaluatedAt ?? input.evaluatedAt) || new Date().toISOString(),
    period,
    rule: HIRA_COPD_2026_RULESET,
    disclaimer: "현재 연결 데이터에서 확인된 항목입니다. 공식 분모·제외조건이 확인되지 않으면 평가대상을 확정하지 않으며, 기관 점수·등급·가산금액이 아닙니다.",
  };
}
