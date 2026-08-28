import { chartMedicationClass, MEDICATION_CLAIM_SOURCES } from "./medication-catalog.js";

export const MEDICATION_REVIEW_BOUNDARY = "등록된 내부 예시 기준과 이 환자의 확정 기록을 대조한 청구 전 사전점검입니다. 급여 인정·삭감을 확정하지 않고 처방 여부를 대신 결정하지 않으며, 최종 판단은 의료진과 심사 절차에 있습니다.";

export const MEDICATION_REVIEW_VERDICTS = Object.freeze({
  circle: Object.freeze({ symbol: "○", label: "삭감 위험 낮음", tone: "green", rank: 0, sentence: "등록 기준과 이 환자 기록이 일치합니다." }),
  triangle: Object.freeze({ symbol: "△", label: "추가 근거 확인 필요", tone: "amber", rank: 1, sentence: "기준과 기록이 부분적으로만 맞아 보완 확인이 필요합니다." }),
  cross: Object.freeze({ symbol: "✕", label: "삭감 위험 높음", tone: "red", rank: 2, sentence: "등록 기준에서 요구하는 근거가 이 환자 기록에서 확인되지 않습니다." }),
});

const VERDICT_BY_RANK = ["circle", "triangle", "cross"];
const DAY_MS = 86_400_000;
const CONFIRMED_CONDITION_STATUSES = new Set(["active", "recurrence", "relapse"]);
const ACTIVE_MEDICATION_STATUSES = new Set(["active", "on-hold"]);
const UNVERIFIED_SOURCE_KINDS = new Set(["fhir", "import"]);

function cleanText(value, maximum = 240) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maximum) : "";
}

function validDate(value) {
  const normalized = cleanText(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return "";
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== normalized ? "" : normalized;
}

function daysBetween(later, earlier) {
  const right = validDate(later);
  const left = validDate(earlier);
  if (!right || !left) return null;
  return Math.round((Date.parse(`${right}T00:00:00.000Z`) - Date.parse(`${left}T00:00:00.000Z`)) / DAY_MS);
}

function positiveInteger(value) {
  const parsed = typeof value === "number" ? value : Number.parseInt(cleanText(String(value ?? ""), 12), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

export function worstVerdict(verdicts = []) {
  const rank = verdicts.reduce((highest, verdict) => Math.max(highest, MEDICATION_REVIEW_VERDICTS[verdict]?.rank ?? 0), 0);
  return VERDICT_BY_RANK[rank];
}

export function isVerdictAtLeastAsCautious(candidate, floor) {
  const candidateRank = MEDICATION_REVIEW_VERDICTS[candidate]?.rank;
  const floorRank = MEDICATION_REVIEW_VERDICTS[floor]?.rank ?? 0;
  return Number.isInteger(candidateRank) && candidateRank >= floorRank;
}

function usableEvent(event) {
  return Boolean(event)
    && typeof event === "object"
    && !UNVERIFIED_SOURCE_KINDS.has(cleanText(event.source?.kind, 40))
    && cleanText(event.recordStatus, 40) !== "entered-in-error";
}

function eventProvenance(event, encounterId) {
  if (cleanText(event.recordStatus, 40) === "final") return "확정 기록";
  return encounterId && cleanText(event.encounterId, 160) === encounterId ? "이번 진료 초안" : "미확정 초안";
}

function finding(event, encounterId, extra = "") {
  return {
    eventId: cleanText(event.id, 160),
    label: cleanText(event.label, 160) || cleanText(event.code, 80) || "기록",
    code: [cleanText(event.system, 120), cleanText(event.code, 80)].filter(Boolean).join(" | "),
    date: validDate(event.date),
    provenance: eventProvenance(event, encounterId),
    detail: cleanText([extra, event.value === undefined || event.value === null || event.value === ""
      ? ""
      : `${event.value}${cleanText(event.unit, 24) ? ` ${cleanText(event.unit, 24)}` : ""}`].filter(Boolean).join(" · "), 240),
  };
}

function codeMatches(eventCode, criterionCode) {
  const left = cleanText(eventCode, 80).toUpperCase();
  const right = cleanText(criterionCode, 80).toUpperCase();
  if (!left || !right) return false;
  return left === right || left.startsWith(`${right}.`) || left.startsWith(right);
}

function check({ id, kind, title, verdict, matched, requirement, criterionDetail, chartDetail, findings = [], source }) {
  return {
    id,
    kind,
    title,
    verdict,
    matched,
    criterion: { requirement, detail: criterionDetail },
    chart: { status: matched ? "기록 확인" : "기록 미확인", detail: chartDetail, findings },
    source,
  };
}

function conditionEvents(events, encounterId) {
  return events.filter((event) => usableEvent(event)
    && cleanText(event.type, 40) === "condition"
    && CONFIRMED_CONDITION_STATUSES.has(cleanText(event.status, 40) || "active")
    && (cleanText(event.verificationStatus, 40) || "confirmed") === "confirmed"
    && (cleanText(event.recordStatus, 40) === "final" || cleanText(event.encounterId, 160) === encounterId));
}

function indicationCheck(medication, conditions, encounterId) {
  const source = medication.coverage.source;
  const requirement = `급여 인정 상병: ${medication.coverage.indications.map(({ code, label }) => `${code} ${label}`).join(", ")}`;
  if (!medication.coverage.indications.length) {
    return check({
      id: "indication",
      kind: "indication",
      title: "급여 인정 상병",
      verdict: "triangle",
      matched: false,
      requirement: "등록된 인정 상병 기준이 없습니다.",
      criterionDetail: "이 약품에는 대조할 인정 상병 기준이 등록되어 있지 않아 자동 대조를 하지 못했습니다.",
      chartDetail: "기준이 없어 환자 기록과 대조하지 않았습니다.",
      source,
    });
  }
  const matches = conditions.filter((event) => medication.coverage.indications.some(({ code }) => codeMatches(event.code, code)));
  const confirmed = matches.filter((event) => cleanText(event.certainty, 40) !== "provisional");
  const findings = matches.map((event) => finding(event, encounterId, cleanText(event.certainty, 40) === "provisional" ? "의증·잠정" : "확정 진단"));
  if (confirmed.length) {
    return check({
      id: "indication",
      kind: "indication",
      title: "급여 인정 상병",
      verdict: "circle",
      matched: true,
      requirement,
      criterionDetail: "인정 상병이 확인된 환자에게만 급여로 인정합니다.",
      chartDetail: `이 환자 기록에서 인정 상병 ${confirmed.length}건을 확인했습니다.`,
      findings,
      source,
    });
  }
  if (matches.length) {
    return check({
      id: "indication",
      kind: "indication",
      title: "급여 인정 상병",
      verdict: "triangle",
      matched: true,
      requirement,
      criterionDetail: "인정 상병이 확인된 환자에게만 급여로 인정합니다.",
      chartDetail: "인정 상병 범위의 기록이 있으나 의증·잠정 단계로만 남아 있어 확정 근거로 보기 어렵습니다.",
      findings,
      source,
    });
  }
  return check({
    id: "indication",
    kind: "indication",
    title: "급여 인정 상병",
    verdict: "cross",
    matched: false,
    requirement,
    criterionDetail: "인정 상병이 확인된 환자에게만 급여로 인정합니다.",
    chartDetail: conditions.length
      ? `이 환자의 확인 상병 ${conditions.length}건 중 인정 상병과 일치하는 기록이 없습니다.`
      : "이 환자에게 대조할 확인 상병 기록이 없습니다.",
    findings: conditions.slice(0, 4).map((event) => finding(event, encounterId, "인정 상병과 불일치")),
    source,
  });
}

function evidenceChecks(medication, events, encounterId, asOf) {
  const source = medication.coverage.source;
  return medication.coverage.requiredEvidence.map((criterion, index) => {
    const cutoffDays = positiveInteger(criterion.lookbackDays);
    const matches = events.filter((event) => usableEvent(event)
      && codeMatches(event.code, criterion.code)
      && (!criterion.system || cleanText(event.system, 120) === criterion.system)
      && (!criterion.eventTypes?.length || criterion.eventTypes.includes(cleanText(event.type, 40)))
      && validDate(event.date)
      && validDate(event.date) <= asOf
      && (!cutoffDays || (daysBetween(asOf, event.date) ?? Number.POSITIVE_INFINITY) <= cutoffDays));
    const requirement = `필수 선행 근거: ${criterion.label}`;
    const missingVerdict = criterion.severity === "recommended" ? "triangle" : "cross";
    return check({
      id: `evidence-${index + 1}`,
      kind: "evidence",
      title: "필수 선행 근거",
      verdict: matches.length ? "circle" : missingVerdict,
      matched: matches.length > 0,
      requirement,
      criterionDetail: cutoffDays
        ? `처방일 기준 최근 ${cutoffDays}일 이내의 ${criterion.label}이(가) 기록에 있어야 합니다.`
        : `${criterion.label}이(가) 기록에 있어야 합니다.`,
      chartDetail: matches.length
        ? `요구 기간 안에서 ${matches.length}건을 확인했습니다.`
        : "요구 기간 안에서 해당 기록을 찾지 못해 근거 없이 청구될 위험이 있습니다.",
      findings: matches.slice(0, 4).map((event) => {
        const elapsed = daysBetween(asOf, event.date);
        return finding(event, encounterId, elapsed === null ? "" : `처방일 기준 ${elapsed}일 전`);
      }),
      source,
    });
  });
}

function duplicateCheck(medication, events, encounterId, asOf) {
  const targetClass = medication.coverage.duplicateClass;
  const source = MEDICATION_CLAIM_SOURCES.duplicate;
  const requirement = `동일 효능군 중복 처방 제한: ${medication.coverage.duplicateClassLabel || medication.classLabel}`;
  if (!targetClass) {
    return check({
      id: "duplicate",
      kind: "duplicate",
      title: "동일 효능군 중복",
      verdict: "circle",
      matched: false,
      requirement: "등록된 중복 제한 효능군이 없습니다.",
      criterionDetail: "이 약품에는 대조할 중복 효능군 기준이 등록되어 있지 않습니다.",
      chartDetail: "중복 대조를 수행하지 않았습니다.",
      source,
    });
  }
  const active = events.filter((event) => usableEvent(event)
    && cleanText(event.type, 40) === "medication"
    && ACTIVE_MEDICATION_STATUSES.has(cleanText(event.status, 40) || "active")
    && (cleanText(event.recordStatus, 40) === "final" || cleanText(event.encounterId, 160) === encounterId)
    && validDate(event.date)
    && validDate(event.date) <= asOf);
  const duplicates = active.filter((event) => chartMedicationClass(event).class === targetClass);
  return check({
    id: "duplicate",
    kind: "duplicate",
    title: "동일 효능군 중복",
    verdict: duplicates.length ? "cross" : "circle",
    matched: duplicates.length > 0,
    requirement,
    criterionDetail: "같은 효능군 약제를 동시에 처방하면 중복분이 조정될 수 있습니다.",
    chartDetail: duplicates.length
      ? `이 환자에게 같은 효능군의 활성 처방 ${duplicates.length}건이 이미 있습니다.`
      : `이 환자에게 같은 효능군의 활성 처방이 없습니다. (활성 약물 ${active.length}건 대조)`,
    findings: duplicates.slice(0, 4).map((event) => finding(event, encounterId, `${chartMedicationClass(event).classLabel} · 활성 처방`)),
    source,
  });
}

function allergyCheck(medication, events, encounterId) {
  const source = MEDICATION_CLAIM_SOURCES.safety;
  const ingredients = medication.coverage.allergyIngredients;
  const allergies = events.filter((event) => usableEvent(event)
    && cleanText(event.type, 40) === "allergy"
    && (cleanText(event.status, 40) || "active") === "active"
    && (cleanText(event.verificationStatus, 40) || "confirmed") === "confirmed");
  const requirement = ingredients.length
    ? `알레르기 확인 성분: ${ingredients.join(", ")}`
    : "등록된 알레르기 확인 성분이 없습니다.";
  if (!ingredients.length) {
    return check({
      id: "allergy",
      kind: "allergy",
      title: "알레르기 대조",
      verdict: "circle",
      matched: false,
      requirement,
      criterionDetail: "이 약품에는 자동 대조할 알레르기 성분이 등록되어 있지 않아 의료진이 직접 대조해야 합니다.",
      chartDetail: allergies.length
        ? `이 환자에게 등록된 알레르기 ${allergies.length}건은 의료진이 직접 대조해야 합니다.`
        : "이 환자에게 등록된 활성 알레르기 기록이 없습니다.",
      findings: allergies.slice(0, 4).map((event) => finding(event, encounterId, "자동 대조 대상 아님")),
      source,
    });
  }
  const matches = allergies.filter((event) => {
    const haystack = [cleanText(event.label, 160), cleanText(event.code, 80), cleanText(event.note, 240)].join(" ").toLowerCase();
    return ingredients.some((ingredient) => haystack.includes(ingredient.toLowerCase()));
  });
  return check({
    id: "allergy",
    kind: "allergy",
    title: "알레르기 대조",
    verdict: matches.length ? "cross" : "circle",
    matched: matches.length > 0,
    requirement,
    criterionDetail: "기록된 알레르기 성분과 이름이 일치하면 임상적 관련성을 먼저 확인해야 합니다.",
    chartDetail: matches.length
      ? "이 환자의 알레르기 기록과 이름이 일치합니다."
      : `이 환자의 활성 알레르기 ${allergies.length}건과 이름이 일치하지 않습니다.`,
    findings: (matches.length ? matches : allergies).slice(0, 4).map((event) => finding(event, encounterId, matches.length ? "성분명 일치" : "성분명 불일치")),
    source,
  });
}

function contraindicationCheck(medication, conditions, encounterId) {
  const source = MEDICATION_CLAIM_SOURCES.safety;
  const codes = medication.coverage.contraindications;
  if (!codes.length) return null;
  const matches = conditions.filter((event) => codes.some(({ code }) => codeMatches(event.code, code)));
  return check({
    id: "contraindication",
    kind: "contraindication",
    title: "금기 상병",
    verdict: matches.length ? "cross" : "circle",
    matched: matches.length > 0,
    requirement: `금기·신중투여 상병: ${codes.map(({ code, label }) => `${code} ${label}`).join(", ")}`,
    criterionDetail: "금기 상병이 확인되면 처방 근거를 별도로 남겨야 하며 급여에서 조정될 수 있습니다.",
    chartDetail: matches.length
      ? "이 환자 기록에서 금기 상병이 확인됩니다."
      : "이 환자 기록에서 금기 상병이 확인되지 않습니다.",
    findings: matches.slice(0, 4).map((event) => finding(event, encounterId, "금기 상병 일치")),
    source,
  });
}

function durationCheck(medication, prescription) {
  const source = medication.coverage.source;
  const maximum = positiveInteger(medication.coverage.maxDurationDays);
  const requested = positiveInteger(prescription.durationDays);
  if (!maximum) return null;
  const requirement = `1회 처방 인정 일수: 최대 ${maximum}일`;
  if (!requested) {
    return check({
      id: "duration",
      kind: "duration",
      title: "처방 일수",
      verdict: "triangle",
      matched: false,
      requirement,
      criterionDetail: "인정 일수를 넘는 처방분은 조정될 수 있습니다.",
      chartDetail: "처방 일수를 입력하지 않아 인정 일수와 대조하지 못했습니다.",
      source,
    });
  }
  return check({
    id: "duration",
    kind: "duration",
    title: "처방 일수",
    verdict: requested > maximum ? "triangle" : "circle",
    matched: requested <= maximum,
    requirement,
    criterionDetail: "인정 일수를 넘는 처방분은 조정될 수 있습니다.",
    chartDetail: requested > maximum
      ? `이번 처방 ${requested}일은 인정 일수를 ${requested - maximum}일 초과합니다.`
      : `이번 처방 ${requested}일은 인정 일수 안에 있습니다.`,
    findings: [{ eventId: "", label: "이번 처방 입력", code: "", date: "", provenance: "이번 진료 초안", detail: `${requested}일` }],
    source,
  });
}

function ageCheck(medication, patientAge) {
  const source = medication.coverage.source;
  const minimum = positiveInteger(medication.coverage.ageMinimum);
  const maximum = positiveInteger(medication.coverage.ageMaximum);
  if (!minimum && !maximum) return null;
  const requirement = `연령 인정 범위: ${minimum ? `만 ${minimum}세 이상` : ""}${minimum && maximum ? " · " : ""}${maximum ? `만 ${maximum}세 이하` : ""}`;
  if (!Number.isInteger(patientAge)) {
    return check({
      id: "age",
      kind: "age",
      title: "연령 기준",
      verdict: "triangle",
      matched: false,
      requirement,
      criterionDetail: "연령 범위를 벗어난 처방은 별도 사유 없이는 조정될 수 있습니다.",
      chartDetail: "환자 생년월일이나 나이가 없어 연령 기준과 대조하지 못했습니다.",
      source,
    });
  }
  const withinRange = (!minimum || patientAge >= minimum) && (!maximum || patientAge <= maximum);
  return check({
    id: "age",
    kind: "age",
    title: "연령 기준",
    verdict: withinRange ? "circle" : "triangle",
    matched: withinRange,
    requirement,
    criterionDetail: "연령 범위를 벗어난 처방은 별도 사유 없이는 조정될 수 있습니다.",
    chartDetail: `이 환자는 만 ${patientAge}세로 ${withinRange ? "연령 기준 안에 있습니다." : "연령 기준을 벗어납니다."}`,
    findings: [{ eventId: "", label: "환자 나이", code: "", date: "", provenance: "환자 기본정보", detail: `만 ${patientAge}세` }],
    source,
  });
}

function ageOf(patient, asOf) {
  const birthDate = validDate(patient?.birthDate);
  if (birthDate) {
    const [birthYear, birthMonth, birthDay] = birthDate.split("-").map(Number);
    const [year, month, day] = asOf.split("-").map(Number);
    const age = year - birthYear - (month < birthMonth || (month === birthMonth && day < birthDay) ? 1 : 0);
    return age >= 0 ? age : null;
  }
  return Number.isInteger(patient?.ageYears) && patient.ageYears >= 0 ? patient.ageYears : null;
}

function summarize(verdict, checks, medication) {
  const blocking = checks.filter((item) => item.verdict === "cross");
  const cautions = checks.filter((item) => item.verdict === "triangle");
  if (verdict === "cross") {
    return `${medication.label}은(는) ${blocking.map(({ title }) => title).join(" · ")} 기준에서 이 환자 기록과 맞지 않아 삭감 위험이 높습니다.`;
  }
  if (verdict === "triangle") {
    return `${medication.label}은(는) ${cautions.map(({ title }) => title).join(" · ")} 항목에서 추가 확인이 필요합니다.`;
  }
  return `${medication.label}은(는) 등록된 예시 기준 ${checks.length}개 항목 모두에서 이 환자 기록과 일치했습니다.`;
}

function rationaleFor(checks) {
  return checks.map((item) => {
    const state = MEDICATION_REVIEW_VERDICTS[item.verdict];
    return `${state.symbol} ${item.title} · ${item.criterion.requirement} → ${item.chart.detail}`;
  });
}

/**
 * Compares one candidate prescription against the patient's own record, one
 * registered criterion at a time. Each returned check carries the criterion and
 * the chart evidence side by side so the UI can show what was compared with what.
 */
export function buildMedicationClaimComparison({
  patient,
  medication,
  prescription = {},
  encounterId = "",
  asOf = new Date().toISOString().slice(0, 10),
} = {}) {
  if (!medication || typeof medication !== "object" || !medication.coverage) {
    throw new TypeError("검토할 약품 정보가 필요합니다.");
  }
  const reviewDate = validDate(asOf) || new Date().toISOString().slice(0, 10);
  const events = Array.isArray(patient?.events) ? patient.events : [];
  const currentEncounterId = cleanText(encounterId, 160);
  const conditions = conditionEvents(events, currentEncounterId);
  const patientAge = ageOf(patient, reviewDate);
  const checks = [
    indicationCheck(medication, conditions, currentEncounterId),
    ...evidenceChecks(medication, events, currentEncounterId, reviewDate),
    duplicateCheck(medication, events, currentEncounterId, reviewDate),
    allergyCheck(medication, events, currentEncounterId),
    contraindicationCheck(medication, conditions, currentEncounterId),
    durationCheck(medication, prescription),
    ageCheck(medication, patientAge),
  ].filter(Boolean);
  const verdict = worstVerdict(checks.map(({ verdict: value }) => value));
  const state = MEDICATION_REVIEW_VERDICTS[verdict];
  return {
    schema: "policycompass-medication-claim-review",
    version: 1,
    asOf: reviewDate,
    medication: {
      id: cleanText(medication.id, 80),
      code: cleanText(medication.code, 80),
      system: cleanText(medication.system, 120),
      label: cleanText(medication.label, 160),
      ingredient: cleanText(medication.ingredient, 160),
      classLabel: cleanText(medication.classLabel, 120),
    },
    prescription: {
      dose: cleanText(prescription.dose, 40),
      doseUnit: cleanText(prescription.doseUnit, 30),
      route: cleanText(prescription.route, 60),
      frequency: cleanText(prescription.frequency, 80),
      durationDays: positiveInteger(prescription.durationDays),
      quantity: cleanText(String(prescription.quantity ?? ""), 20),
    },
    patient: {
      ageYears: patientAge,
      sex: cleanText(patient?.sex, 20),
      insuranceType: cleanText(patient?.insuranceType, 40),
      conditionCount: conditions.length,
      eventCount: events.length,
    },
    checks,
    verdict,
    verdictSymbol: state.symbol,
    verdictLabel: state.label,
    verdictTone: state.tone,
    summary: summarize(verdict, checks, medication),
    rationale: rationaleFor(checks),
    boundary: MEDICATION_REVIEW_BOUNDARY,
    generatedBy: "rule",
  };
}

/**
 * Applies a model draft on top of the rule comparison. The model may sharpen the
 * wording and escalate the verdict, but never soften it below what the registered
 * criteria already showed, and it may only cite checks that exist in the comparison.
 */
export function applyMedicationReviewDraft(comparison, draft = {}) {
  if (!comparison || typeof comparison !== "object") throw new TypeError("규칙 비교 결과가 필요합니다.");
  const checkIds = new Set(comparison.checks.map(({ id }) => id));
  const citedCheckIds = (Array.isArray(draft.citedCheckIds) ? draft.citedCheckIds : [])
    .map((value) => cleanText(value, 80))
    .filter((value) => checkIds.has(value));
  const summary = cleanText(draft.summary, 400);
  const rationale = (Array.isArray(draft.rationale) ? draft.rationale : [])
    .map((value) => cleanText(value, 300))
    .filter(Boolean)
    .slice(0, 8);
  const proposed = cleanText(draft.verdict, 20);
  const verdict = isVerdictAtLeastAsCautious(proposed, comparison.verdict) ? proposed : comparison.verdict;
  const state = MEDICATION_REVIEW_VERDICTS[verdict];
  const softened = Boolean(proposed) && proposed !== verdict;
  return {
    ...comparison,
    verdict,
    verdictSymbol: state.symbol,
    verdictLabel: state.label,
    verdictTone: state.tone,
    summary: summary || comparison.summary,
    rationale: rationale.length ? rationale : comparison.rationale,
    citedCheckIds: citedCheckIds.length ? citedCheckIds : comparison.checks.map(({ id }) => id),
    generatedBy: cleanText(draft.generatedBy, 40) || "model",
    model: cleanText(draft.model, 120),
    ruleVerdict: comparison.verdict,
    note: softened
      ? `모델이 제시한 '${MEDICATION_REVIEW_VERDICTS[proposed]?.label ?? proposed}'보다 규칙 판정을 우선했습니다.`
      : cleanText(draft.note, 240),
  };
}
