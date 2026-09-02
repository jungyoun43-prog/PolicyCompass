import { chartMedicationClass, MEDICATION_CLAIM_SOURCES } from "./medication-catalog.js";
import { textCleaner } from "./text.js";

export const MEDICATION_REVIEW_BOUNDARY = "등록 기준과 이 환자의 확정 기록을 대조한 청구 전 사전점검입니다. 급여 인정·삭감을 확정하지 않고 처방 여부를 대신 결정하지 않으며, 최종 판단은 의료진과 심사 절차에 있습니다.";

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

const cleanText = textCleaner({ maxLength: 240, collapseWhitespace: true });

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

const RECORD_TYPE_LABELS = {
  condition: "상병",
  observation: "검사·측정",
  medication: "약물",
  allergy: "알레르기",
  procedure: "처치·검사 시행",
  encounter: "내원",
  "service-request": "오더",
  symptom: "증상",
};

/**
 * The stored chart row, field by field, so the criterion can be checked against
 * the record itself rather than a rendered summary. Free-text notes stay out:
 * this structure is what leaves the browser when a model reviews the comparison.
 */
function recordRows(event, _encounterId) {
  const value = event.value === undefined || event.value === null || event.value === ""
    ? ""
    : `${event.value}${cleanText(event.unit, 24) ? ` ${cleanText(event.unit, 24)}` : ""}`;
  return [
    ["기록 유형", RECORD_TYPE_LABELS[cleanText(event.type, 40)] ?? cleanText(event.type, 40)],
    ["표시명", cleanText(event.label, 160)],
    ["코드", cleanText(event.code, 80)],
    ["코드 시스템", cleanText(event.system, 120)],
    ["측정값", value],
    ["기록일", validDate(event.date)],
    ["임상 상태", cleanText(event.status, 40)],
    ["확인 상태", cleanText(event.verificationStatus, 40)],
    ["진단 확실성", cleanText(event.certainty, 40)],
    ["기록 단계", cleanText(event.recordStatus, 40) === "final" ? "final · 확정" : cleanText(event.recordStatus, 40)],
    ["연결 진료 ID", cleanText(event.encounterId, 160)],
    ["기록 출처", cleanText(event.source?.kind, 40)],
    ["기록 ID", cleanText(event.id, 160)],
  ].filter(([, item]) => item);
}

function finding(event, encounterId, extra = "", highlights = []) {
  return {
    eventId: cleanText(event.id, 160),
    label: cleanText(event.label, 160) || cleanText(event.code, 80) || "기록",
    code: [cleanText(event.system, 120), cleanText(event.code, 80)].filter(Boolean).join(" | "),
    date: validDate(event.date),
    provenance: eventProvenance(event, encounterId),
    detail: cleanText([extra, event.value === undefined || event.value === null || event.value === ""
      ? ""
      : `${event.value}${cleanText(event.unit, 24) ? ` ${cleanText(event.unit, 24)}` : ""}`].filter(Boolean).join(" · "), 240),
    record: recordRows(event, encounterId),
    highlights: highlights.map((item) => cleanText(item, 120)).filter(Boolean).slice(0, 6),
  };
}

function codeMatches(eventCode, criterionCode) {
  const left = cleanText(eventCode, 80).toUpperCase();
  const right = cleanText(criterionCode, 80).toUpperCase();
  if (!left || !right) return false;
  return left === right || left.startsWith(`${right}.`) || left.startsWith(right);
}

function check({ id, kind, title, verdict, matched, requirement, criterionDetail, chartDetail, findings = [], source, article = "", excerpt = "", highlights = [], pairs = [] }) {
  return {
    id,
    kind,
    title,
    verdict,
    matched,
    criterion: { requirement, detail: criterionDetail },
    chart: { status: matched ? "기록 확인" : "기록 미확인", detail: chartDetail, findings },
    source: {
      ...source,
      article: cleanText(article, 160),
      excerpt: cleanText(excerpt, 600),
      highlights: highlights.map((value) => cleanText(value, 120)).filter(Boolean).slice(0, 6),
      // Which phrase of the criterion each chart value actually answers. The two
      // sides rarely share wording, so the match cannot be recovered from text.
      pairs: pairs
        .map(({ rule, chart }) => ({ rule: cleanText(rule, 120), chart: cleanText(chart, 120) }))
        .filter(({ rule, chart }) => rule && chart)
        .slice(0, 6),
    },
  };
}

/**
 * Each check carries the criterion wording it was matched against, so a clinician
 * can re-read the rule text beside the chart record rather than trusting a summary.
 */
function indicationOrigin(medication) {
  const codes = medication.coverage.indications.map(({ code, label }) => `${code} ${label}`);
  return {
    article: "제3장 제1절 · 급여 인정 상병",
    excerpt: codes.length
      ? `「${medication.label}」은(는) 다음 상병이 확인된 경우에 한하여 요양급여를 인정한다: ${codes.join(", ")}. 인정 상병이 진료기록에서 확인되지 않은 청구분은 조정 대상이 된다.`
      : `「${medication.label}」에 대한 급여 인정 상병이 등록되어 있지 않아 자동 대조를 수행하지 않는다.`,
    highlights: codes.length
      ? [...medication.coverage.indications.map(({ code }) => code), "인정 상병이 진료기록에서 확인되지 않은 청구분은 조정 대상"]
      : ["자동 대조를 수행하지 않는다"],
  };
}

function durationOrigin(medication, maximum) {
  return {
    article: "제3장 제3절 · 1회 처방 인정 일수",
    excerpt: `「${medication.label}」은(는) 1회 처방 시 ${maximum}일분까지 인정한다. 이를 초과하여 처방한 분량은 조정 대상이 된다.`,
    highlights: [`${maximum}일분까지 인정`, "초과하여 처방한 분량은 조정 대상"],
  };
}

function ageOrigin(medication, requirement) {
  return {
    article: "제3장 제4절 · 연령 인정 범위",
    excerpt: `「${medication.label}」은(는) ${requirement.replace("연령 인정 범위: ", "")} 환자에게 투여하는 경우 인정한다. 범위를 벗어난 투여는 그 사유를 진료기록부에 기재한다.`,
    highlights: [requirement.replace("연령 인정 범위: ", ""), "사유를 진료기록부에 기재"],
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
      ...indicationOrigin(medication),
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
  const findings = matches.map((event) => finding(
    event,
    encounterId,
    cleanText(event.certainty, 40) === "provisional" ? "의증·잠정" : "확정 진단",
    [cleanText(event.code, 80), cleanText(event.status, 40), cleanText(event.certainty, 40) || "confirmed"],
  ));
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
      ...indicationOrigin(medication),
      pairs: confirmed.slice(0, 4).flatMap((event) => {
        const matched = medication.coverage.indications.find(({ code }) => codeMatches(event.code, code));
        return matched ? [{ rule: matched.code, chart: cleanText(event.code, 80) }] : [];
      }),
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
      ...indicationOrigin(medication),
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
    findings: conditions.slice(0, 4).map((event) => finding(event, encounterId, "인정 상병과 불일치", [cleanText(event.code, 80)])),
    source,
    ...indicationOrigin(medication),
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
        return finding(
          event,
          encounterId,
          elapsed === null ? "" : `처방일 기준 ${elapsed}일 전`,
          [cleanText(event.code, 80), validDate(event.date)],
        );
      }),
      source,
      pairs: matches.slice(0, 2).flatMap((event) => [
        { rule: criterion.label, chart: cleanText(event.code, 80) },
        ...(cutoffDays ? [{ rule: `최근 ${cutoffDays}일 이내`, chart: validDate(event.date) }] : []),
      ]),
      article: "제2장 제4절 · 선행 검사·기록 요건",
      excerpt: `「${medication.label}」의 투여는 ${criterion.label}이(가) ${cutoffDays ? `처방일 기준 최근 ${cutoffDays}일 이내에 ` : ""}진료기록에서 확인되는 경우에 인정한다. 선행 근거가 확인되지 않은 청구분은 조정 대상이 된다.`,
      highlights: [criterion.label, cutoffDays ? `최근 ${cutoffDays}일 이내` : "", "선행 근거가 확인되지 않은 청구분은 조정 대상"].filter(Boolean),
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
      article: "제4장 제1절 · 동일 효능군 중복 투여",
      excerpt: "동일 효능군 중복 투여 기준이 등록되지 않은 약제는 자동 대조 대상에서 제외한다.",
      highlights: ["자동 대조 대상에서 제외"],
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
    findings: duplicates.slice(0, 4).map((event) => finding(
      event,
      encounterId,
      `${chartMedicationClass(event).classLabel} · 활성 처방`,
      [cleanText(event.code, 80), cleanText(event.status, 40) || "active"],
    )),
    source,
    pairs: duplicates.slice(0, 3).map((event) => ({
      rule: medication.coverage.duplicateClassLabel || medication.classLabel,
      chart: cleanText(event.code, 80),
    })),
    article: "제4장 제1절 · 동일 효능군 중복 투여",
    excerpt: `동일 효능군(${medication.coverage.duplicateClassLabel || medication.classLabel})에 속하는 약제를 같은 기간에 함께 투여한 경우, 중복 투여분은 인정하지 아니한다. 병용이 임상적으로 필요한 경우 그 사유를 진료기록부에 기재한다.`,
    highlights: [medication.coverage.duplicateClassLabel || medication.classLabel, "중복 투여분은 인정하지 아니한다"],
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
      findings: allergies.slice(0, 4).map((event) => finding(event, encounterId, "자동 대조 대상 아님", [cleanText(event.label, 160)])),
      source,
      article: "제5장 제2절 · 투여 전 알레르기 확인",
      excerpt: "성분명 자동 대조 대상으로 등록되지 않은 약제는 의료진이 환자의 약물 알레르기 기록을 직접 대조한다.",
      highlights: ["의료진이 환자의 약물 알레르기 기록을 직접 대조한다"],
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
    findings: (matches.length ? matches : allergies).slice(0, 4).map((event) => finding(
      event,
      encounterId,
      matches.length ? "성분명 일치" : "성분명 불일치",
      [cleanText(event.label, 160), cleanText(event.code, 80)],
    )),
    source,
    pairs: matches.slice(0, 3).flatMap((event) => {
      const haystack = [cleanText(event.label, 160), cleanText(event.code, 80), cleanText(event.note, 240)].join(" ").toLowerCase();
      const ingredient = ingredients.find((item) => haystack.includes(item.toLowerCase()));
      return ingredient ? [{ rule: ingredient, chart: cleanText(event.label, 160) }] : [];
    }),
    article: "제5장 제2절 · 투여 전 알레르기 확인",
    excerpt: `투여 전 환자의 약물 알레르기 기록을 확인한다. 기록된 알레르기와 투여 약제의 성분명(${ingredients.slice(0, 3).join(", ")})이 일치하는 경우, 임상적 관련성과 대체 약제 검토 결과를 진료기록부에 기재한다.`,
    highlights: [...ingredients.slice(0, 3), "임상적 관련성과 대체 약제 검토 결과를 진료기록부에 기재"],
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
    findings: matches.slice(0, 4).map((event) => finding(event, encounterId, "금기 상병 일치", [cleanText(event.code, 80)])),
    source,
    pairs: matches.slice(0, 3).flatMap((event) => {
      const matchedCode = codes.find(({ code }) => codeMatches(event.code, code));
      return matchedCode ? [{ rule: matchedCode.code, chart: cleanText(event.code, 80) }] : [];
    }),
    article: "제5장 제1절 · 금기·신중투여",
    excerpt: `다음 상병이 확인된 환자에게 「${medication.label}」을(를) 투여하는 경우는 금기 또는 신중투여에 해당한다: ${codes.map(({ code, label }) => `${code} ${label}`).join(", ")}. 투여가 필요한 경우 그 사유를 진료기록부에 기재하며, 사유가 확인되지 않은 청구분은 조정 대상이 된다.`,
    highlights: [...codes.map(({ code }) => code), "사유가 확인되지 않은 청구분은 조정 대상"],
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
      ...durationOrigin(medication, maximum),
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
    pairs: [{ rule: `${maximum}일분까지 인정`, chart: `${requested}일` }],
    findings: [{
      eventId: "",
      label: "이번 처방 입력",
      code: "",
      date: "",
      provenance: "이번 진료 초안",
      detail: `${requested}일`,
      record: [["처방 일수", `${requested}일`], ["인정 일수", `${maximum}일`], ["입력 단계", "이번 진료 초안"]],
      highlights: [`${requested}일`],
    }],
    source,
    ...durationOrigin(medication, maximum),
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
      ...ageOrigin(medication, requirement),
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
    pairs: [{ rule: requirement.replace("연령 인정 범위: ", ""), chart: `만 ${patientAge}세` }],
    findings: [{
      eventId: "",
      label: "환자 나이",
      code: "",
      date: "",
      provenance: "환자 기본정보",
      detail: `만 ${patientAge}세`,
      record: [["환자 나이", `만 ${patientAge}세`], ["판정 기준일", "처방일"], ["인정 범위", requirement.replace("연령 인정 범위: ", "")]],
      highlights: [`만 ${patientAge}세`],
    }],
    source,
    ...ageOrigin(medication, requirement),
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
  return `${medication.label}은(는) 등록 기준 ${checks.length}개 항목 모두에서 이 환자 기록과 일치했습니다.`;
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
const STRUCTURED_RECORD_TYPES = new Set(["condition", "observation", "medication", "allergy", "procedure", "symptom"]);
const STRUCTURED_RECORD_LOOKBACK_DAYS = 730;
const MAX_STRUCTURED_RECORDS = 60;

/**
 * A de-identified extract of the patient's structured events — codes, dates,
 * values and prescriptions, never names or free-text memos. This is the
 * 환자 의료데이터 a notice-based review judges against, so anything the 고시
 * asks about (검사 수치, 처방 이력, 시술) must be recorded as a structured
 * event to count.
 */
function structuredRecords(events, asOf) {
  return events
    .filter((event) => usableEvent(event)
      && STRUCTURED_RECORD_TYPES.has(cleanText(event.type, 40))
      && validDate(event.date)
      && daysBetween(asOf, event.date) !== null
      && daysBetween(asOf, event.date) <= STRUCTURED_RECORD_LOOKBACK_DAYS)
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, MAX_STRUCTURED_RECORDS)
    .map((event) => {
      const record = {
        type: cleanText(event.type, 40),
        code: cleanText(event.code, 120),
        label: cleanText(event.label, 240),
        date: validDate(event.date),
        status: cleanText(event.status, 80),
      };
      if (typeof event.value === "number" || cleanText(event.value, 200)) record.value = event.value;
      if (cleanText(event.unit, 80)) record.unit = cleanText(event.unit, 80);
      if (event.prescription && typeof event.prescription === "object") {
        record.prescription = {
          dose: cleanText(String(event.prescription.dose ?? ""), 40),
          doseUnit: cleanText(event.prescription.doseUnit, 30),
          route: cleanText(event.prescription.route, 60),
          frequency: cleanText(event.prescription.frequency, 80),
          durationDays: positiveInteger(event.prescription.durationDays),
        };
      }
      return record;
    });
}

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
    records: structuredRecords(events, reviewDate),
    ...(typeof patient?.sourceDataset === "string" && patient.sourceDataset.trim()
      ? { dataset: patient.sourceDataset.slice(0, 100_000) }
      : {}),
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
  const markdown = typeof draft.markdown === "string" ? draft.markdown.slice(0, 8_000) : "";
  // 고시 프롬프트 기반 검토(markdown)는 프롬프트 판정을 그대로 따른다.
  const verdict = markdown && MEDICATION_REVIEW_VERDICTS[proposed]
    ? proposed
    : isVerdictAtLeastAsCautious(proposed, comparison.verdict) ? proposed : comparison.verdict;
  const state = MEDICATION_REVIEW_VERDICTS[verdict];
  const softened = !markdown && Boolean(proposed) && proposed !== verdict;
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
    markdown,
    ruleVerdict: comparison.verdict,
    note: softened
      ? `모델이 제시한 '${MEDICATION_REVIEW_VERDICTS[proposed]?.label ?? proposed}'보다 규칙 판정을 우선했습니다.`
      : cleanText(draft.note, 600),
  };
}
