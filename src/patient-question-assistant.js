import {
  CLINICAL_OBSERVATION_SPECS,
  normalizeClinicalObservationValue,
} from "./clinical-observations.js";
import { CONDITIONS } from "./data.js";

export const PATIENT_QUESTION_REQUEST_SCHEMA = "vitagraph-patient-question-request";
export const PATIENT_QUESTION_REQUEST_VERSION = 1;
export const PATIENT_QUESTION_HANDOFF_SCHEMA = "vitagraph-patient-brief";
export const PATIENT_QUESTION_HANDOFF_VERSION = 1;
export const PATIENT_SNAPSHOT_EXPORT_SCHEMA = "vitagraph-personal-clinical-snapshot";
export const PATIENT_SNAPSHOT_EXPORT_VERSION = 1;

const MAX_SELF_REPORT_LENGTH = 1_000;
const MAX_QUESTIONS = 5;
const MAX_MEDICATIONS = 40;
const providerNames = new Set(["local", "frontier"]);
const measurementByKey = new Map(CLINICAL_OBSERVATION_SPECS.map((spec) => [spec.key, spec]));
const measurementByCode = new Map(CLINICAL_OBSERVATION_SPECS.map((spec) => [spec.code, spec]));
const PATIENT_CONDITION_QUESTION_RULES = {
  diabetes: [
    {
      question: "혈당 관리를 위해 평소에 무엇을 먹어도 되고, 무엇을 줄이면 좋을까요?",
      reason: "집에서 실천할 식사 방법을 구체적으로 물어보기 위해서입니다.",
    },
    {
      question: "저에게 맞는 운동은 무엇이고, 일주일에 몇 번·한 번에 몇 분 하면 좋을까요?",
      reason: "무리하지 않고 꾸준히 할 수 있는 운동량을 물어보기 위해서입니다.",
    },
  ],
  hypertension: [
    {
      question: "혈압 관리를 위해 어떤 음식을 덜 먹고, 대신 무엇을 먹으면 좋을까요?",
      reason: "장보기와 식사 때 바로 적용할 방법을 물어보기 위해서입니다.",
    },
    {
      question: "혈압에 무리가 가지 않는 운동은 무엇이고, 일주일에 몇 번·몇 분 하면 좋을까요?",
      reason: "내 상태에 맞는 운동 종류와 시간을 물어보기 위해서입니다.",
    },
  ],
  dyslipidemia: [
    {
      question: "콜레스테롤 관리를 위해 자주 먹어도 되는 음식과 줄일 음식은 무엇인가요?",
      reason: "매일 먹는 음식을 고를 때 쓸 수 있는 기준을 물어보기 위해서입니다.",
    },
    {
      question: "콜레스테롤 관리에 도움이 되는 운동은 일주일에 몇 번·몇 분 하면 좋을까요?",
      reason: "일상에서 이어 갈 수 있는 운동 계획을 물어보기 위해서입니다.",
    },
  ],
  asthma: [
    {
      question: "흡입기는 하루 중 언제, 어떤 순서로 쓰면 되는지 다시 보여 주실 수 있나요?",
      reason: "집에서 약을 올바르게 사용하는 방법을 확인하기 위해서입니다.",
    },
    {
      question: "운동할 때 숨이 차면 언제 쉬고, 어떤 경우에 병원에 연락해야 할까요?",
      reason: "활동 중 불편한 증상이 생겼을 때 어떻게 물어볼지 준비하기 위해서입니다.",
    },
  ],
  migraine: [
    {
      question: "두통이 있을 때 집에서 해도 되는 일과 피하면 좋은 일은 무엇인가요?",
      reason: "두통이 있는 날의 생활 방법을 물어보기 위해서입니다.",
    },
    {
      question: "두통약은 언제 먹고, 너무 자주 먹는 기준은 무엇인가요?",
      reason: "약 먹는 시간과 사용 횟수를 의료진에게 확인하기 위해서입니다.",
    },
  ],
  reflux: [
    {
      question: "속이 쓰릴 때 무엇을 먹어도 되고, 어떤 음식은 줄이면 좋을까요?",
      reason: "증상이 있을 때 식사를 고르는 방법을 물어보기 위해서입니다.",
    },
    {
      question: "저녁 식사와 잠자는 시간은 얼마나 띄우면 좋을까요?",
      reason: "집에서 바꿔 볼 수 있는 식사와 수면 습관을 물어보기 위해서입니다.",
    },
  ],
  mood: [
    {
      question: "잠을 잘 자려면 집에서 바꿔 볼 수 있는 생활 습관은 무엇인가요?",
      reason: "매일 해 볼 수 있는 작은 변화를 물어보기 위해서입니다.",
    },
    {
      question: "마음이 많이 힘들 때 누구에게, 어떤 방법으로 도움을 요청하면 좋을까요?",
      reason: "혼자 견디기 어려울 때 도움받는 방법을 미리 알아두기 위해서입니다.",
    },
  ],
  arthritis: [
    {
      question: "관절에 무리가 덜 가는 운동은 무엇이고, 일주일에 몇 번·몇 분 하면 좋을까요?",
      reason: "통증을 살피며 이어 갈 수 있는 운동량을 물어보기 위해서입니다.",
    },
    {
      question: "통증이 있을 때 해도 되는 활동과 쉬어야 하는 때를 알려 주실 수 있나요?",
      reason: "일상생활에서 움직임과 휴식을 나누는 기준을 물어보기 위해서입니다.",
    },
  ],
};

const directIdentifierPatterns = [
  /\b\d{6}\s*[- ]?\s*[1-8]\d{6}\b/g,
  /\b01[016789]\s*[-. ]?\s*\d{3,4}\s*[-. ]?\s*\d{4}\b/g,
  /\b(?:\+?82\s*[-. ]?)?0?1[016789]\s*[-. ]?\s*\d{3,4}\s*[-. ]?\s*\d{4}\b/g,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\bhttps?:\/\/\S+/gi,
  /\b(?:MRN|차트|등록번호|환자번호)\s*[:#-]?\s*[A-Z0-9-]{3,}\b/gi,
  /(?:이름|성명)\s*[:：]?\s*[가-힣A-Z]{2,20}/gi,
  /저는\s+[가-힣]{2,5}(?=\s*(?:이고|이며|입니다|라고))/g,
  /(?:서울특별시|서울시|부산광역시|부산시|대구광역시|대구시|인천광역시|인천시|광주광역시|광주시|대전광역시|대전시|울산광역시|울산시|세종특별자치시|세종시|경기도|강원특별자치도|강원도|충청북도|충청남도|전북특별자치도|전라북도|전라남도|경상북도|경상남도|제주특별자치도|제주도)\s+[가-힣0-9-]+(?:시|군|구)(?:\s+[가-힣0-9-]+(?:로|길|동|읍|면)?)?(?:\s+\d+(?:-\d+)?)?/g,
];

const unsafeGeneratedClaim = new RegExp([
  "(?:진단|확진)(?:입니다|이다|됐습니다|되었습니다|으로\\s*보입니다)",
  "(?:고혈압|당뇨병|이상지질혈증|편두통|위식도역류|천식|우울|불안|관절염)(?:입니다|이다|으로\\s*보입니다|일\\s*가능성이\\s*높습니다)",
  "(?:약|약물|복용량|처방)을?\\s*(?:중단|증량|감량|변경)하세요",
  "(?:약|약물|복용량|처방)을?\\s*(?:중단|증량|감량|변경)해야\\s*합니다",
  "(?:반드시|즉시)\\s*(?:복용|중단)하세요",
  "(?:중단(?:하)?|끊(?:어|으)?|증량(?:하)?|감량(?:하)?|변경(?:하)?|바꾸).{0,16}(?:세요|야|필요|권장|겠습니까|하나요|할까요|습니까)",
  "(?:즉시|바로|반드시).{0,24}(?:중단|끊|증량|감량|용량\\s*변경|바꾸)",
  "복용.{0,12}(?:하지\\s*마세요|하세요|해야\\s*합니다)",
  "응급실에?\\s*가지\\s*마세요",
].join("|"), "i");

function cleanText(value, maximum = 1_000) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\u2060\uFEFF]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function safeDate(value) {
  const text = cleanText(value, 32);
  const candidate = /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : "";
  if (!candidate) return "";
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === candidate
    ? candidate
    : "";
}

function safeTimestamp(value, fallback = new Date().toISOString()) {
  if (typeof value !== "string") return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? fallback : parsed.toISOString();
}

function unique(values) {
  return [...new Set(values)];
}

function valueCandidates(...values) {
  return values.flatMap((value) => (Array.isArray(value) ? value : []));
}

export function sanitizePatientSelfReport(value) {
  let text = cleanText(value, MAX_SELF_REPORT_LENGTH * 2);
  for (const pattern of directIdentifierPatterns) {
    text = text.replace(pattern, "[개인정보 제거]");
  }
  return cleanText(text, MAX_SELF_REPORT_LENGTH);
}

function conditionIdsFrom(session) {
  const structuredConditions = valueCandidates(
    session?.clinicalSnapshot?.healthMap?.conditions,
    session?.clinicalSnapshot?.conditions,
    session?.refinedContext?.conditions,
  ).map((item) => (typeof item === "string" ? item : item?.id ?? item?.conditionId));
  return unique(valueCandidates(
    session?.clinicalSnapshot?.healthMap?.conditionIds,
    session?.clinicalSnapshot?.conditionIds,
    session?.refinedContext?.conditionIds,
    session?.visibleIds,
    structuredConditions,
  ).filter((id) => typeof id === "string" && CONDITIONS[id]))
    .slice(0, Object.keys(CONDITIONS).length);
}

function signedConditionIdsFrom(session) {
  return unique(valueCandidates(session?.clinicalSnapshot?.healthMap?.conditions)
    .map((item) => (typeof item === "string" ? item : item?.id ?? item?.conditionId))
    .filter((id) => typeof id === "string" && CONDITIONS[id]));
}

function normalizeMeasurement(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const spec = measurementByKey.get(cleanText(item.key, 80))
    ?? measurementByCode.get(cleanText(item.code, 80));
  if (!spec) return null;
  let value;
  try {
    value = normalizeClinicalObservationValue(item.value, spec);
  } catch {
    return null;
  }
  const observedOn = safeDate(item.observedOn ?? item.observedAt ?? item.date);
  return {
    id: `measurement:${spec.key}`,
    key: spec.key,
    label: spec.label,
    value,
    unit: spec.unit,
    observedOn,
  };
}

function measurementsFrom(session) {
  const candidates = valueCandidates(
    session?.clinicalSnapshot?.healthMap?.measurements,
    session?.clinicalSnapshot?.measurements,
    session?.refinedContext?.measurements,
    session?.measurements,
  );
  const byId = new Map();
  for (const candidate of candidates) {
    const measurement = normalizeMeasurement(candidate);
    if (!measurement) continue;
    const current = byId.get(measurement.id);
    if (!current || measurement.observedOn >= current.observedOn) {
      byId.set(measurement.id, measurement);
    }
  }
  return [...byId.values()].sort((left, right) => (
    CLINICAL_OBSERVATION_SPECS.findIndex(({ key }) => key === left.key)
    - CLINICAL_OBSERVATION_SPECS.findIndex(({ key }) => key === right.key)
  ));
}

function medicationsFrom(session) {
  const candidates = valueCandidates(
    session?.clinicalSnapshot?.medications,
    session?.refinedContext?.medications,
  );
  const medications = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const system = cleanText(candidate.system, 160);
    const code = cleanText(candidate.code, 120);
    const label = sanitizePatientSelfReport(candidate.label).slice(0, 160);
    const prescribedOn = safeDate(candidate.prescribedOn);
    const doseUnit = sanitizePatientSelfReport(candidate.doseUnit).slice(0, 40);
    const route = sanitizePatientSelfReport(candidate.route).slice(0, 80);
    const frequency = sanitizePatientSelfReport(candidate.frequency).slice(0, 120);
    const durationDays = Number(candidate.durationDays);
    const dose = Number(candidate.dose);
    const quantity = Number(candidate.quantity);
    const key = `${system}|${code}`;
    if (!system || !code || !/^[A-Za-z0-9._:-]+$/.test(code)
      || !label || !prescribedOn || !doseUnit || !route || !frequency
      || !Number.isFinite(dose) || dose <= 0 || dose > 100_000
      || !Number.isSafeInteger(durationDays) || durationDays < 1 || durationDays > 3_650
      || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000
      || seen.has(key)) {
      continue;
    }
    seen.add(key);
    medications.push({
      id: `medication:${medications.length + 1}`,
      system,
      code,
      label,
      prescribedOn,
      dose,
      doseUnit,
      route,
      frequency,
      durationDays,
      quantity,
    });
    if (medications.length >= MAX_MEDICATIONS) break;
  }
  return medications;
}

function evidenceForContext(context) {
  return [
    ...context.conditionIds.map((id) => ({
      id: `condition:${id}`,
      kind: "condition",
      label: CONDITIONS[id].label,
      basis: context.signedConditionIds.includes(id)
        ? "EMR 서명·확정 기록에서 환자용으로 정제된 건강 항목"
        : "환자가 건강 지도에서 표시한 확인 필요 신호 · 진단 아님",
    })),
    ...context.measurements.map((measurement) => ({
      id: measurement.id,
      kind: "measurement",
      label: measurement.label,
      value: measurement.value,
      unit: measurement.unit,
      date: measurement.observedOn,
      basis: "환자용으로 정제된 최종 측정값",
    })),
    ...context.medications.map((medication) => ({
      id: medication.id,
      kind: "medication",
      label: medication.label,
      date: medication.prescribedOn,
      dose: medication.dose,
      doseUnit: medication.doseUnit,
      route: medication.route,
      frequency: medication.frequency,
      durationDays: medication.durationDays,
      quantity: medication.quantity,
      basis: "서명 완료 처방에서 환자용으로 정제된 복약 정보",
    })),
    ...(context.selfReportSummary ? [{
      id: "self-report:1",
      kind: "patient-report",
      label: "환자가 정리한 최근 변화",
      summary: context.selfReportSummary,
      basis: "환자가 진료 준비 화면에서 직접 입력한 미확인 요약",
    }] : []),
  ];
}

export function createPatientQuestionContext(session = {}, selfReportInput = "") {
  const context = {
    conditionIds: conditionIdsFrom(session),
    signedConditionIds: signedConditionIdsFrom(session),
    measurements: measurementsFrom(session),
    medications: medicationsFrom(session),
    selfReportSummary: sanitizePatientSelfReport(selfReportInput),
  };
  return { ...context, evidence: evidenceForContext(context) };
}

function evidenceBasis(evidenceIds, evidenceById) {
  return evidenceIds.map((id) => {
    const evidence = evidenceById.get(id);
    if (!evidence) return "";
    if (evidence.kind === "measurement") {
      const date = evidence.date ? ` · ${evidence.date}` : "";
      return `${evidence.label} ${String(evidence.value)} ${evidence.unit}${date}`;
    }
    if (evidence.kind === "medication") {
      return `${evidence.label} · ${String(evidence.dose)} ${evidence.doseUnit} · ${evidence.frequency}`;
    }
    return evidence.label;
  }).filter(Boolean).join(" · ");
}

function contextSignals(context) {
  return context.evidence.map((item) => ({
    id: item.id,
    label: item.label,
    basis: item.kind === "measurement"
      ? `${item.label} ${String(item.value)} ${item.unit}${item.date ? ` · ${item.date}` : ""}`
      : item.kind === "medication"
        ? `${item.label} · ${String(item.dose)} ${item.doseUnit} · ${item.frequency}`
      : item.basis,
  }));
}

function patientConditionQuestions(conditionIds) {
  const questions = [];
  const seen = new Set();
  const rounds = Math.max(
    0,
    ...conditionIds.map((id) => PATIENT_CONDITION_QUESTION_RULES[id]?.length ?? 0),
  );
  for (let index = 0; index < rounds && questions.length < MAX_QUESTIONS; index += 1) {
    for (const id of conditionIds) {
      const rule = PATIENT_CONDITION_QUESTION_RULES[id]?.[index];
      if (!rule || seen.has(rule.question)) continue;
      seen.add(rule.question);
      questions.push({
        id: `${id}-${index + 1}`,
        question: rule.question,
        reason: rule.reason,
        basis: `건강 지도에서 ‘${CONDITIONS[id].label}’ 관련 입력 신호가 표시됨`,
        sourceId: id,
        sourceLabel: CONDITIONS[id].label,
        origin: "rule",
        evidenceIds: [id],
      });
      if (questions.length === MAX_QUESTIONS) break;
    }
  }
  return questions;
}

function supplementalRuleQuestions(context) {
  return [
    ...(context.selfReportSummary ? [{
      id: "self-report-1",
      question: "이 불편함이 계속되거나 심해지면 언제 병원에 연락해야 할까요?",
      reason: "집에서 지켜볼 때와 다시 진료받을 때를 물어보기 위해서입니다.",
      basis: "환자가 진료 준비 화면에서 정리한 최근 변화",
      sourceId: "self-report",
      sourceLabel: "최근 변화",
      origin: "rule",
      evidenceIds: ["self-report:1"],
    }] : []),
    ...context.measurements.map((measurement) => ({
      id: `measurement-${measurement.key}-1`,
      question: `다음 ${measurement.label} 측정이나 검사 전에는 무엇을 준비해야 할까요?`,
      reason: "금식 여부, 약 먹는 시간, 방문 시간처럼 미리 알아둘 일을 물어보기 위해서입니다.",
      basis: `${measurement.label} ${String(measurement.value)} ${measurement.unit}${measurement.observedOn ? ` · ${measurement.observedOn}` : ""}`,
      sourceId: measurement.id,
      sourceLabel: measurement.label,
      origin: "rule",
      evidenceIds: [measurement.id],
    })),
    ...context.medications.map((medication) => ({
      id: `${medication.id.replace(":", "-")}-1`,
      question: `${medication.label}은 하루 중 언제 먹고, 불편한 증상이 생기면 어떻게 문의하면 될까요?`,
      reason: "약 먹는 시간과 불편할 때 연락하는 방법을 물어보기 위해서입니다.",
      basis: `${medication.label} · ${String(medication.dose)} ${medication.doseUnit} · ${medication.frequency}`,
      sourceId: medication.id,
      sourceLabel: medication.label,
      origin: "rule",
      evidenceIds: [medication.id],
    })),
  ];
}

function prioritizedFallbackQuestions(context, conditionQuestions) {
  const supplemental = supplementalRuleQuestions(context);
  const selfReportQuestions = supplemental.filter(({ id }) => id.startsWith("self-report-"));
  const measurementQuestions = supplemental.filter(({ id }) => id.startsWith("measurement-"));
  const medicationQuestions = supplemental.filter(({ id }) => id.startsWith("medication-"));
  return [
    ...selfReportQuestions,
    ...conditionQuestions.slice(0, 2),
    ...measurementQuestions.slice(0, 1),
    ...medicationQuestions.slice(0, 1),
    ...conditionQuestions.slice(2),
    ...measurementQuestions.slice(1),
    ...medicationQuestions.slice(1),
  ];
}

export function createPatientFallbackBrief(session = {}, selfReportInput = "") {
  const context = createPatientQuestionContext(session, selfReportInput);
  const questions = [];
  const seen = new Set();
  const conditionQuestions = patientConditionQuestions(context.conditionIds).map((item) => ({
    ...item,
    sourceId: `condition:${item.sourceId}`,
    evidenceIds: item.evidenceIds.map((id) => `condition:${id}`),
  }));
  for (const item of prioritizedFallbackQuestions(context, conditionQuestions)) {
    if (questions.length >= MAX_QUESTIONS || seen.has(item.question)) continue;
    seen.add(item.question);
    questions.push(item);
  }
  const evidenceCount = context.conditionIds.length
    + context.measurements.length
    + context.medications.length
    + (context.selfReportSummary ? 1 : 0);
  return {
    ids: context.conditionIds,
    kind: "rule-based",
    provider: "rule",
    label: "규칙 기반 질문",
    questions,
    signals: contextSignals(context),
    coverage: evidenceCount
      ? `${evidenceCount}개 정제 항목에서 진료 질문을 정리했습니다.`
      : "아직 질문을 만들 정제 항목이 없습니다.",
    countLabel: `${questions.length}개 질문`,
    selfReportSummary: context.selfReportSummary,
    refinedContext: {
      conditionIds: context.conditionIds,
      measurements: context.measurements,
      medications: context.medications,
      selfReportSummary: context.selfReportSummary,
    },
    disclaimer: "질문 제안은 진료 준비용이며 진단·처방·응급 판단을 제공하지 않습니다.",
  };
}

export function createPatientQuestionRequest(
  session = {},
  selfReportInput = "",
  { provider = "local", frontierConsent = false, asOf = new Date().toISOString().slice(0, 10) } = {},
) {
  if (!providerNames.has(provider)) throw new TypeError("지원되는 질문 생성 방식을 선택하세요.");
  if (provider === "frontier" && frontierConsent !== true) {
    throw new TypeError("외부 모델 전송 범위를 확인하고 동의해야 합니다.");
  }
  const context = createPatientQuestionContext(session, selfReportInput);
  const sourceSnapshot = session?.clinicalSnapshot;
  const conditionById = new Map(valueCandidates(sourceSnapshot?.healthMap?.conditions)
    .map((item) => [item?.id, item]));
  const conditions = context.conditionIds.map((id) => {
    const source = conditionById.get(id);
    const recordedOn = safeDate(source?.recordedOn ?? source?.recordedAt);
    return recordedOn ? {
      id,
      label: CONDITIONS[id].label,
      recordedOn,
      basis: "confirmed-condition",
    } : null;
  }).filter(Boolean);
  const measurements = context.measurements
    .filter(({ observedOn }) => Boolean(observedOn))
    .map(({ id: _id, ...measurement }) => ({
      ...measurement,
      code: measurementByKey.get(measurement.key)?.code ?? "",
      basis: "final-observation",
    }));
  const medications = context.medications.map(({ id: _id, ...medication }) => ({
    ...medication,
    basis: "signed-prescription",
  }));
  const factCount = conditions.length + measurements.length + medications.length;
  if (!factCount && !context.selfReportSummary) {
    throw new TypeError("질문을 만들 정제된 건강 항목이나 최근 변화가 없습니다.");
  }
  const clinicalSnapshot = factCount ? {
    schema: "vitagraph-clinical-snapshot",
    version: 1,
    preparedAt: safeTimestamp(sourceSnapshot?.preparedAt),
    source: sourceSnapshot ? "finalized-clinical-record" : "patient-refined-record",
    healthMap: { conditions, measurements },
    medications,
    summary: {
      includedConditions: conditions.length,
      includedMeasurements: measurements.length,
      includedMedications: medications.length,
    },
  } : null;
  return {
    schema: PATIENT_QUESTION_REQUEST_SCHEMA,
    version: PATIENT_QUESTION_REQUEST_VERSION,
    provider,
    consent: provider === "frontier" && frontierConsent === true,
    asOf: safeDate(asOf) || new Date().toISOString().slice(0, 10),
    clinicalSnapshot,
    selfReport: context.selfReportSummary ? { summary: context.selfReportSummary } : null,
  };
}

export function patientQuestionContextFingerprint(context) {
  return JSON.stringify({
    conditionIds: unique(Array.isArray(context?.conditionIds) ? context.conditionIds : []).sort(),
    signedConditionIds: unique(Array.isArray(context?.signedConditionIds) ? context.signedConditionIds : []).sort(),
    measurements: (Array.isArray(context?.measurements) ? context.measurements : [])
      .map(({ id, key, value, unit, observedOn }) => ({ id, key, value, unit, observedOn }))
      .sort((left, right) => String(left.id).localeCompare(String(right.id))),
    medications: (Array.isArray(context?.medications) ? context.medications : [])
      .map(({ id, system, code, label, prescribedOn, dose, doseUnit, route, frequency, durationDays, quantity }) => ({
        id,
        system,
        code,
        label,
        prescribedOn,
        dose,
        doseUnit,
        route,
        frequency,
        durationDays,
        quantity,
      }))
      .sort((left, right) => String(left.id).localeCompare(String(right.id))),
    selfReportSummary: sanitizePatientSelfReport(context?.selfReportSummary),
  });
}

function questionHash(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function generatedQuestion(item, index, allowedEvidenceIds, evidenceById) {
  const question = sanitizePatientSelfReport(item?.question);
  const reason = sanitizePatientSelfReport(item?.reason);
  if (!question || !reason || !/[?？]$/.test(question)) {
    throw new TypeError("로컬 모델 질문 형식이 올바르지 않습니다.");
  }
  if (unsafeGeneratedClaim.test(question) || unsafeGeneratedClaim.test(reason)) {
    throw new TypeError("로컬 모델 질문에 진단 또는 처방 표현이 포함되어 있습니다.");
  }
  const suppliedEvidence = Array.isArray(item?.evidenceIds)
    ? item.evidenceIds
    : Array.isArray(item?.evidenceEventIds) ? item.evidenceEventIds : [];
  const evidenceIds = unique(suppliedEvidence.map((id) => cleanText(id, 120)).filter(Boolean));
  if (!evidenceIds.length || evidenceIds.some((id) => !allowedEvidenceIds.has(id))) {
    throw new TypeError("로컬 모델 질문의 근거가 정제 입력과 연결되지 않았습니다.");
  }
  return {
    id: `model-${index + 1}-${questionHash(question)}`,
    question,
    reason,
    basis: evidenceBasis(evidenceIds, evidenceById),
    sourceId: evidenceIds[0],
    sourceLabel: evidenceById.get(evidenceIds[0])?.label ?? "정제된 건강 항목",
    origin: "model",
    evidenceIds,
  };
}

export function createModelPatientBrief(
  response,
  session = {},
  selfReportInput = "",
  provider = "local",
) {
  if (!response || typeof response !== "object" || Array.isArray(response)
    || (response.kind !== undefined && response.kind !== "model")) {
    throw new TypeError("질문 모델 응답 형식이 올바르지 않습니다.");
  }
  if (!providerNames.has(provider)) throw new TypeError("질문 모델 제공자 표시가 올바르지 않습니다.");
  if (response.provider !== undefined && response.provider !== provider) {
    throw new TypeError("질문 모델 응답의 제공자 표시가 요청과 일치하지 않습니다.");
  }
  const context = createPatientQuestionContext(session, selfReportInput);
  const evidenceById = new Map(context.evidence.map((item) => [item.id, item]));
  const allowedEvidenceIds = new Set(evidenceById.keys());
  const questions = (Array.isArray(response.questions) ? response.questions : [])
    .slice(0, MAX_QUESTIONS)
    .map((item, index) => generatedQuestion(item, index, allowedEvidenceIds, evidenceById));
  if (!questions.length) throw new TypeError("근거가 연결된 질문이 없습니다.");
  if (new Set(questions.map(({ question }) => question)).size !== questions.length) {
    throw new TypeError("로컬 모델이 중복 질문을 반환했습니다.");
  }
  const summary = sanitizePatientSelfReport(response.summary);
  if (summary && unsafeGeneratedClaim.test(summary)) {
    throw new TypeError("질문 모델 요약에 진단 또는 처방 표현이 포함되어 있습니다.");
  }
  const sharedSignals = (Array.isArray(response.sharedSignals) ? response.sharedSignals : [])
    .slice(0, 8)
    .map((item) => {
      const text = sanitizePatientSelfReport(item?.text);
      const evidenceIds = unique((Array.isArray(item?.evidenceIds) ? item.evidenceIds : [])
        .map((id) => cleanText(id, 120))
        .filter(Boolean));
      if (!text || unsafeGeneratedClaim.test(text)
        || !evidenceIds.length
        || evidenceIds.some((id) => !allowedEvidenceIds.has(id))) {
        throw new TypeError("질문 모델 공유 요약의 근거 또는 안전 표현이 올바르지 않습니다.");
      }
      return { text, evidenceIds };
    });
  return {
    kind: "model",
    provider,
    label: provider === "frontier" ? "프론티어 AI 질문 초안" : "로컬 AI 질문 초안",
    model: cleanText(response.model, 160),
    generatedAt: safeTimestamp(response.generatedAt),
    confirmed: false,
    questions,
    summary,
    sharedSignals,
    signals: contextSignals(context),
    coverage: `${context.evidence.length}개 정제 항목에서 ${questions.length}개 질문을 제안했습니다.`,
    countLabel: `${questions.length}개 질문`,
    selfReportSummary: context.selfReportSummary,
    refinedContext: {
      conditionIds: context.conditionIds,
      measurements: context.measurements,
      medications: context.medications,
      selfReportSummary: context.selfReportSummary,
    },
    disclaimer: "AI가 만든 진료 준비 초안입니다. 진단·처방이 아니며, 환자와 의료진의 확인이 필요합니다.",
  };
}

function handoffQuestion(item, allowedEvidenceIds) {
  const id = cleanText(item?.id, 160);
  const question = sanitizePatientSelfReport(item?.question);
  const reason = sanitizePatientSelfReport(item?.reason);
  const origin = item?.origin === "model" ? "model" : "rule";
  const evidenceIds = unique((Array.isArray(item?.evidenceIds) ? item.evidenceIds : [])
    .map((value) => cleanText(value, 120))
    .filter((value) => allowedEvidenceIds.has(value)));
  if (!id || !question || !reason || !evidenceIds.length) return null;
  return { id, question, reason, origin, evidenceIds };
}

export function createPatientQuestionHandoff(session = {}, brief = {}, selection = "") {
  const context = createPatientQuestionContext(
    session,
    brief?.selfReportSummary ?? brief?.refinedContext?.selfReportSummary ?? "",
  );
  const allowedEvidenceIds = new Set([
    ...context.conditionIds.map((id) => `condition:${id}`),
    ...context.measurements.map(({ id }) => id),
    ...context.medications.map(({ id }) => id),
    ...(context.selfReportSummary ? ["self-report:1"] : []),
  ]);
  const questions = (Array.isArray(brief?.questions) ? brief.questions : [])
    .slice(0, MAX_QUESTIONS)
    .map((item) => handoffQuestion(item, allowedEvidenceIds))
    .filter(Boolean);
  if (!questions.length) throw new TypeError("의료진에게 공유할 근거 연결 질문이 없습니다.");
  const requestedSelection = typeof selection === "string"
    ? selection
    : cleanText(selection?.selectedQuestionId, 160);
  const selectedQuestionId = questions.some(({ id }) => id === requestedSelection)
    ? requestedSelection
    : "";
  const modelGenerated = questions.some(({ origin }) => origin === "model");
  return {
    schema: PATIENT_QUESTION_HANDOFF_SCHEMA,
    version: PATIENT_QUESTION_HANDOFF_VERSION,
    updatedAt: safeTimestamp(brief?.generatedAt),
    source: "personal",
    refinedContext: {
      conditionIds: context.conditionIds,
      measurements: context.measurements,
      medications: context.medications,
      selfReportSummary: context.selfReportSummary,
    },
    questions,
    selectedQuestionId,
    safety: {
      modelGenerated,
      reviewRequired: true,
      disclaimer: "환자가 진료 준비를 위해 공유한 미확인 요약과 질문입니다. 진단·처방 또는 확정 차트 사실이 아닙니다.",
    },
  };
}

export function publishPatientQuestionHandoff(
  publish,
  { session = {}, brief = {}, selection = "" } = {},
) {
  if (typeof publish !== "function") throw new TypeError("환자 브리프 공유 기능을 사용할 수 없습니다.");
  return publish(createCareBridgePatientBriefInput(session, brief, selection));
}

export function createCareBridgePatientBriefInput(session = {}, brief = {}, selection = "") {
  const handoff = createPatientQuestionHandoff(session, brief, selection);
  const selected = handoff.questions.find(({ id }) => id === handoff.selectedQuestionId);
  const orderedQuestions = selected
    ? [selected, ...handoff.questions.filter(({ id }) => id !== selected.id)]
    : handoff.questions;
  const basisById = new Map((Array.isArray(brief?.questions) ? brief.questions : [])
    .map((item) => [item.id, cleanText(item.basis, 500)]));
  const signals = (Array.isArray(brief?.signals) ? brief.signals : [])
    .map((item) => {
      const label = cleanText(item?.label, 160);
      const basis = cleanText(item?.basis, 300);
      return label ? `${label}${basis ? ` · ${basis}` : ""}` : "";
    })
    .filter(Boolean)
    .slice(0, 8);
  return {
    source: brief?.provider === "frontier"
      ? "frontier-model"
      : brief?.kind === "model" ? "local-model" : "rule-based",
    summary: cleanText([
      handoff.refinedContext.selfReportSummary
        ? `환자 입력: ${handoff.refinedContext.selfReportSummary}`
        : "",
      brief?.summary ? `AI 정리 초안: ${sanitizePatientSelfReport(brief.summary)}` : "",
    ].filter(Boolean).join(" · "), 1_000)
      || `환자가 정제 기록을 바탕으로 ${orderedQuestions.length}개 진료 질문을 준비했습니다.`,
    signals: [
      ...signals,
      ...(Array.isArray(brief?.sharedSignals) ? brief.sharedSignals : [])
        .map((item) => sanitizePatientSelfReport(item?.text))
        .filter(Boolean),
    ].slice(0, 8),
    questions: orderedQuestions.map((item) => ({
      question: item.question,
      basis: [
        item.id === handoff.selectedQuestionId ? "환자가 우선 질문으로 선택" : "",
        item.reason,
        basisById.get(item.id) ? `근거: ${basisById.get(item.id)}` : "",
      ].filter(Boolean).join(" · "),
    })),
  };
}

export function createPatientClinicalSnapshotExport(session = {}, exportedAt = new Date().toISOString()) {
  const context = createPatientQuestionContext(session, "");
  return {
    schema: PATIENT_SNAPSHOT_EXPORT_SCHEMA,
    version: PATIENT_SNAPSHOT_EXPORT_VERSION,
    exportedAt: safeTimestamp(exportedAt),
    source: "personal-refined-snapshot",
    refinedContext: {
      conditionIds: context.conditionIds,
      measurements: context.measurements,
      medications: context.medications,
    },
    safety: {
      directIdentifiersIncluded: false,
      rawClinicalNoteIncluded: false,
      disclaimer: "환자용으로 정제된 사본이며 원본 EMR 또는 의료진의 판단을 대체하지 않습니다.",
    },
  };
}

export function patientClinicalSnapshotFilename(exportedAt = new Date().toISOString()) {
  return `vitagraph-personal-snapshot-${safeTimestamp(exportedAt).slice(0, 10)}.json`;
}
