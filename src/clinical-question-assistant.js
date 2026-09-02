import { textCleaner } from "./text.js";

export const CLINICAL_PATIENT_BRIEF_SCHEMA = "policycompass-clinical-patient-brief";
export const CLINICAL_PATIENT_BRIEF_VERSION = 1;

const PATIENT_BRIEF_KINDS = new Set(["summary", "concern", "question"]);
const PATIENT_BRIEF_SOURCE_LABELS = {
  "rule-based": "환자 확인 · 규칙 기반 브리프",
  "local-model": "환자 확인 · 로컬 AI 브리프",
  "frontier-model": "환자 확인 · 프론티어 AI 브리프",
};
const ACE_INHIBITOR_PATTERN = /\bC09AA[A-Z0-9]*\b|captopril|enalapril|lisinopril|perindopril|ramipril|imidapril|benazepril|cilazapril|fosinopril|quinapril|trandolapril|캅토프릴|에날라프릴|리시노프릴|페린도프릴|라미프릴|이미다프릴|베나제프릴|실라자프릴|포시노프릴|퀴나프릴|트란돌라프릴/i;
const COUGH_PATTERN = /기침|마른기침|야간\s*해수|해수|cough/i;

const cleanText = textCleaner({ maxLength: 500, collapseWhitespace: true });

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value ? "" : value;
}

function directIdentifiers(patient = {}) {
  const emergency = patient?.emergencyContact && typeof patient.emergencyContact === "object"
    ? patient.emergencyContact
    : {};
  return [
    patient?.name,
    patient?.mrn,
    patient?.phone,
    patient?.birthDate,
    patient?.address,
    emergency.name,
    emergency.phone,
  ].map((value) => cleanText(value, 500)).filter((value) => value.length >= 2);
}

function redactPatientIdentifiers(value, patient) {
  let text = cleanText(value, 500);
  for (const identifier of directIdentifiers(patient)) {
    text = text.split(identifier).join("[식별정보 제거]");
  }
  return text;
}

function candidateText(value, kind) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  if (kind === "question") return value.question ?? value.text ?? value.summary;
  return value.text ?? value.summary ?? value.concern ?? value.question;
}

function candidateDate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return validDate(value.observedOn ?? value.date ?? value.reportedOn);
}

function addCandidate(target, seen, value, kind, patient) {
  if (target.length >= 10) return;
  const text = redactPatientIdentifiers(candidateText(value, kind), patient).slice(0, 280);
  if (!text) return;
  const dedupeKey = `${kind}:${text.toLocaleLowerCase("ko")}`;
  if (seen.has(dedupeKey)) return;
  seen.add(dedupeKey);
  target.push({
    id: `patient-brief-${target.length + 1}`,
    kind,
    text,
    observedOn: candidateDate(value),
  });
}

/**
 * Accepts a minimal bridge object and returns an identifier-free, bounded brief.
 * The returned IDs are local aliases; caller-provided IDs are intentionally ignored.
 */
export function normalizeClinicalPatientBrief(input = {}, patient = {}) {
  const value = input && typeof input === "object" && !Array.isArray(input)
    ? (input.brief && typeof input.brief === "object" && !Array.isArray(input.brief) ? input.brief : input)
    : {};
  const refinedContext = value.refinedContext && typeof value.refinedContext === "object" && !Array.isArray(value.refinedContext)
    ? value.refinedContext
    : {};
  const items = [];
  const seen = new Set();
  const source = Object.hasOwn(PATIENT_BRIEF_SOURCE_LABELS, value.source)
    ? value.source
    : "rule-based";

  const suppliedItems = Array.isArray(value.items) ? value.items : [];
  for (const item of suppliedItems) {
    const kind = PATIENT_BRIEF_KINDS.has(item?.kind) ? item.kind : "concern";
    addCandidate(items, seen, item, kind, patient);
  }
  if (typeof value.summary === "string") addCandidate(items, seen, value.summary, "summary", patient);
  if (typeof refinedContext.selfReportSummary === "string") {
    addCandidate(items, seen, refinedContext.selfReportSummary, "summary", patient);
  }
  for (const concern of Array.isArray(value.concerns) ? value.concerns : []) {
    addCandidate(items, seen, concern, "concern", patient);
  }
  for (const signal of Array.isArray(value.signals) ? value.signals : []) {
    addCandidate(items, seen, signal, "concern", patient);
  }
  const suppliedQuestions = [
    ...(Array.isArray(value.questions) ? value.questions : []),
    ...(Array.isArray(value.suggestedQuestions) ? value.suggestedQuestions : []),
  ];
  suppliedQuestions.sort((left, right) => {
    const selectedId = cleanText(value.selectedQuestionId, 160);
    return Number(cleanText(right?.id, 160) === selectedId) - Number(cleanText(left?.id, 160) === selectedId);
  });
  for (const question of suppliedQuestions) {
    addCandidate(items, seen, question, "question", patient);
  }

  return {
    schema: CLINICAL_PATIENT_BRIEF_SCHEMA,
    version: CLINICAL_PATIENT_BRIEF_VERSION,
    generatedAt: cleanText(value.generatedAt ?? value.updatedAt ?? value.preparedAt, 80),
    source,
    sourceLabel: PATIENT_BRIEF_SOURCE_LABELS[source],
    items,
  };
}

function finalChartEvents(patient = {}) {
  return (Array.isArray(patient?.events) ? patient.events : [])
    .filter((event) => event?.recordStatus === "final");
}

function eventText(event) {
  return [event?.system, event?.code, event?.label].map((value) => cleanText(value, 300)).filter(Boolean).join(" ");
}

function isAceInhibitor(event) {
  return event?.type === "medication" && ACE_INHIBITOR_PATTERN.test(eventText(event));
}

function questionItem(question, reason, evidenceEventIds = [], patientBriefIds = []) {
  return {
    question: cleanText(question, 500),
    reason: cleanText(reason, 500),
    evidenceEventIds: [...new Set(evidenceEventIds.filter(Boolean))],
    patientBriefIds: [...new Set(patientBriefIds.filter(Boolean))],
  };
}

function pushQuestion(target, seen, item, maximum = 5) {
  if (target.length >= maximum || !item.question || (!item.evidenceEventIds.length && !item.patientBriefIds.length)) return;
  const key = item.question.toLocaleLowerCase("ko");
  if (seen.has(key)) return;
  seen.add(key);
  target.push(item);
}

function questionMark(text) {
  const value = cleanText(text, 500);
  return !value || /[?？]$/.test(value) ? value : `${value}?`;
}

/**
 * Deterministic fallback for the clinician workspace. It never infers a diagnosis:
 * possible temporal relationships are phrased only as questions for confirmation.
 */
export function createClinicalQuestionSuggestions(patient = {}, patientBriefInput = {}) {
  const events = finalChartEvents(patient);
  const conditions = events.filter(({ type }) => type === "condition");
  const medications = events.filter(({ type }) => type === "medication");
  const observations = events.filter(({ type }) => type === "observation");
  const allergies = events.filter(({ type }) => type === "allergy");
  const patientBrief = normalizeClinicalPatientBrief(patientBriefInput, patient);
  const clinicianQuestions = [];
  const patientQuestions = [];
  const clinicianSeen = new Set();
  const patientSeen = new Set();

  const coughItem = patientBrief.items.find(({ kind, text }) => kind !== "question" && COUGH_PATTERN.test(text));
  const aceMedication = medications.find(isAceInhibitor);
  if (coughItem && aceMedication) {
    pushQuestion(clinicianQuestions, clinicianSeen, questionItem(
      `기침이 시작된 시점과 ${aceMedication.label} 복용 시작 또는 용량 변경 시점이 겹치는지 확인해 볼까요?`,
      "환자보고 증상과 약물 기록의 시간 관계를 확인하기 위한 질문이며, 약물이 원인이라고 단정하지 않습니다.",
      [aceMedication.id],
      [coughItem.id],
    ));
  }

  for (const item of patientBrief.items.filter(({ kind }) => kind !== "question").slice(0, 2)) {
    pushQuestion(clinicianQuestions, clinicianSeen, questionItem(
      `“${item.text.slice(0, 120)}”은 언제 시작됐고, 얼마나 자주 나타나며, 일상에 어떤 영향을 주나요?`,
      "환자가 정리한 내용을 진료 중 직접 확인하고 시간·빈도·기능 영향을 보완하기 위한 질문입니다.",
      [],
      [item.id],
    ));
  }

  for (const medication of medications.slice(0, 2)) {
    pushQuestion(clinicianQuestions, clinicianSeen, questionItem(
      `${medication.label}을 실제로 어떻게 복용하고 있으며, 빠뜨리거나 불편했던 점이 있나요?`,
      "확정 약물 기록과 실제 복용 경험이 일치하는지 확인하기 위한 질문입니다.",
      [medication.id],
    ));
  }
  for (const condition of conditions.slice(0, 2)) {
    pushQuestion(clinicianQuestions, clinicianSeen, questionItem(
      `최근 ${condition.label}와 관련해 증상, 자가 측정 또는 일상 기능에서 달라진 점이 있나요?`,
      "확정 문제 기록 이후의 변화를 환자에게 직접 확인하기 위한 질문입니다.",
      [condition.id],
    ));
  }
  for (const observation of observations.slice(0, 2)) {
    const measurement = observation.value === "" || observation.value === undefined
      ? observation.label
      : `${observation.label} ${observation.value}${observation.unit ? ` ${observation.unit}` : ""}`;
    pushQuestion(clinicianQuestions, clinicianSeen, questionItem(
      `${measurement} 측정 당시의 상태와 평소 기록은 어땠나요?`,
      "한 번의 확정 측정 기록을 측정 맥락과 반복 기록 없이 해석하지 않기 위한 질문입니다.",
      [observation.id],
    ));
  }
  for (const allergy of allergies.slice(0, 1)) {
    pushQuestion(clinicianQuestions, clinicianSeen, questionItem(
      `${allergy.label} 관련 반응 양상과 마지막 발생 시점을 기억하시나요?`,
      "확정 알레르기 기록의 반응과 시점을 다시 확인하기 위한 질문입니다.",
      [allergy.id],
    ));
  }

  for (const item of patientBrief.items.filter(({ kind }) => kind === "question").slice(0, 3)) {
    pushQuestion(patientQuestions, patientSeen, questionItem(
      questionMark(item.text),
      "환자용 PolicyCompass에서 정리되어 진료 중 답변을 준비할 수 있는 질문입니다.",
      [],
      [item.id],
    ));
  }
  for (const condition of conditions.slice(0, 2)) {
    pushQuestion(patientQuestions, patientSeen, questionItem(
      `${condition.label} 기록에서 현재 상태와 다음 확인 시점을 어떻게 이해하면 될까요?`,
      "환자가 확정 문제 기록의 의미와 추적 계획을 물을 수 있습니다.",
      [condition.id],
    ));
  }
  for (const medication of medications.slice(0, 2)) {
    pushQuestion(patientQuestions, patientSeen, questionItem(
      `${medication.label}은 왜 복용하고 있으며, 효과와 불편을 무엇으로 확인하나요?`,
      "환자가 확정 약물 기록의 목적과 모니터링 방법을 물을 수 있습니다.",
      [medication.id],
    ));
  }
  for (const observation of observations.slice(0, 2)) {
    pushQuestion(patientQuestions, patientSeen, questionItem(
      `최근 ${observation.label} 결과는 이전 기록과 비교해 무엇을 확인해야 하나요?`,
      "환자가 단일 수치의 진단적 해석이 아니라 비교 기준과 다음 확인 시점을 물을 수 있습니다.",
      [observation.id],
    ));
  }
  for (const allergy of allergies.slice(0, 1)) {
    pushQuestion(patientQuestions, patientSeen, questionItem(
      `${allergy.label} 알레르기가 처방이나 검사 계획에 어떤 영향을 주나요?`,
      "환자가 확정 알레르기 기록과 안전 계획의 관계를 물을 수 있습니다.",
      [allergy.id],
    ));
  }

  const usedPatientBriefIds = new Set([
    ...clinicianQuestions.flatMap(({ patientBriefIds }) => patientBriefIds),
    ...patientQuestions.flatMap(({ patientBriefIds }) => patientBriefIds),
  ]);
  return {
    clinicianQuestions,
    patientQuestions,
    patientBrief,
    patientBriefProvenance: patientBrief.items
      .filter(({ id }) => usedPatientBriefIds.has(id))
      .map((item) => ({
        id: item.id,
        kind: item.kind,
        label: item.kind === "question" ? `환자 질문 · ${item.text}` : `환자 보고 · ${item.text}`,
        observedOn: item.observedOn,
        sourceLabel: patientBrief.sourceLabel,
      })),
    disclaimer: "질문 준비용 초안입니다. 진단·처방·인과관계를 제시하지 않으며 의료진이 원 차트와 환자 진술을 직접 확인해야 합니다.",
  };
}
