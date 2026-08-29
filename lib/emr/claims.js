/**
 * Pure claim-board logic lifted verbatim from the pre-React controller:
 * profile-linked evaluations, attention grouping, adjudication rows, the
 * unified search index and the wording every judgement is shown with.
 */
import {
  buildClaimBoard,
  CLAIM_LANE_LABELS,
  CLAIM_LANE_ORDER,
} from "../../src/claim-rules.js";
import {
  latestFinalAdjudication,
  resolveClaimAdjudicationPresentation,
  resolveClaimPreflightPresentation,
} from "../../src/claim-presentation.js";
import { createClaimSearchEntry } from "../../src/claim-search.js";
import {
  evaluateDiseaseAssessment,
  getCombinedDiseaseClaimProfile,
  getDiseaseAssessmentOptions,
  getDiseaseAssessmentProfiles,
} from "../../src/disease-assessment.js";
import { today } from "./format.js";

export const CLAIM_REVIEW_STAGE_ORDER = ["new", "evidence", "reviewing", "reviewed"];
export const CLAIM_REVIEW_STAGE_LABELS = {
  new: "검토 대기",
  evidence: "자료 확인",
  reviewing: "담당자 검토",
  reviewed: "최종 판정",
};
export const CLAIM_ATTENTION_ORDER = Object.freeze({ "high-risk": 0, "needs-review": 1, insufficient: 2, verified: 3 });
export const CLAIM_ATTENTION_ICON = Object.freeze({ "high-risk": "!", "needs-review": "!", insufficient: "…", verified: "✓" });
export const CLAIM_WORKFLOW_LABELS = Object.freeze({
  DRAFT: "청구 전",
  PERFORMED: "시행됨",
  CLAIMED: "제출됨",
  SUBMITTED: "제출됨",
  ADJUDICATED: "심사 완료",
  "EMR 자동 집계": "EMR 자동 집계",
});
export const DEMO_CLAIM_REASON_LABELS = Object.freeze({
  DEMO_REQUIRED_EVIDENCE_VERIFIED: "필요 근거 확인",
  DEMO_TIME_COUNT_PASS: "기간·횟수 사전점검 통과",
  DEMO_RULE_NOT_APPLICABLE: "이 항목에 적용할 규칙 없음",
  DEMO_DIAGNOSTIC_EVIDENCE_MISSING: "COPD 진단 근거 확인 필요",
  DEMO_RECORD_CONTEXT_MISSING: "증상·노출력 기록 확인 필요",
  DEMO_REQUIRED_DATA_MISSING: "필수 자료 부족",
  DEMO_EXTERNAL_PROVENANCE_UNVERIFIED: "타기관 자료 출처·환자 일치 미검증",
  DEMO_CAP_CONTEXT_VERIFIED: "폐렴 진료 맥락 확인",
  DEMO_IV_COURSE_VERIFIED: "정맥 항생제 투여 기간 확인",
  DEMO_IMAGE_REPORT_VERIFIED: "흉부 영상 판독 확인",
  DEMO_REPEAT_IMAGE_INDICATION_NOTE_MISSING: "추적 영상 적응증 기록 확인 필요",
  DEMO_SPECIMEN_TIMING_VERIFIED: "검체 채취 시점 확인",
});
export const QUALITY_METRIC_STATUS = Object.freeze({
  included: { label: "충족 예상", icon: "✓" },
  "not-included": { label: "미충족 예상", icon: "!" },
  insufficient: { label: "자료 확인 필요", icon: "…" },
  "not-applicable": { label: "평가대상 제외 가능", icon: "—" },
});

export function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

export function claimRuleDisplayReference(rule) {
  if (!rule || typeof rule !== "object") return "규칙 식별자 미연결";
  if (rule.sample === true) return rule.sourceDocumentNumber || "기관 내부 규칙";
  return [rule.ruleSetId, rule.version ? `v${rule.version}` : ""].filter(Boolean).join(" · ") || "규칙 식별자 미연결";
}

export function profileEvidenceSnapshots(profile, item) {
  const context = profile?.clinicalContext && typeof profile.clinicalContext === "object" ? profile.clinicalContext : {};
  const candidates = [
    profile?.admission,
    ...(profile?.diagnoses ?? []),
    ...(profile?.visits ?? []),
    ...(profile?.pftSessions ?? []),
    ...(profile?.medications ?? []),
    ...(context.symptoms ?? []),
    ...(context.chestImaging ?? []),
    ...(profile?.observations ?? []),
    ...(profile?.severityAssessments ?? []),
    ...(profile?.microbiologyOrders ?? []),
    ...(profile?.specimenCollections ?? []),
    ...(profile?.medicationAdministrations ?? []),
  ].filter((record) => record && typeof record === "object" && !Array.isArray(record));
  const candidateById = new Map(candidates.map((record) => [record.id, record]).filter(([id]) => typeof id === "string" && id));
  return (item?.preflight?.evidenceIds ?? []).map((id) => {
    const record = candidateById.get(id);
    if (!record) return null;
    const provenance = record.provenance || record.source || {};
    const rawDate = record.date || record.serviceDate || record.recordedAt || record.prescribedAt || record.arrivedAt
      || record.performedAt || record.administeredAt || record.orderedAt || record.collectedAt || record.assessedAt || "";
    const label = record.label || record.purpose || record.tool || (record.procedureCode ? `검사 ${record.procedureCode}` : "연결 임상 기록");
    return {
      id,
      label,
      date: typeof rawDate === "string" ? rawDate.slice(0, 10) : "",
      sourceId: provenance.sourceId || "",
      sourceLabel: provenance.sourceLabel || provenance.label || "",
      verificationStatus: provenance.verificationStatus || "",
      patientMatch: provenance.patientMatch || "",
      reviewerId: provenance.reviewerId || "",
      verifiedAt: provenance.verifiedAt || "",
      synthetic: provenance.synthetic === true,
    };
  }).filter(Boolean);
}

export function profileClaimSourceId(item) {
  const assessmentId = String(item?.assessmentId || "linked-claim").trim().toLowerCase();
  const claimItemId = String(item?.id || "claim-line").trim();
  return `${assessmentId}.${claimItemId}`;
}

function profileClaimRule(item) {
  const assessmentId = String(item?.assessmentId || "linked-claim").trim().toLowerCase();
  const sourceId = String(item?.id || "claim-line").trim();
  const serviceCode = String(item?.code || "UNLINKED").trim();
  return {
    id: `profile-${assessmentId}-${sourceId}`,
    ruleSetId: `PC-PROFILE-${assessmentId.toUpperCase()}`,
    version: "2026.1",
    title: `${item?.label || "청구 항목"} 사전점검`,
    serviceCode,
    serviceSystem: serviceCode.startsWith("DEMO-") ? "urn:policycompass:linked-claim" : "urn:hira:fee-code",
    serviceEventType: "procedure",
    windowDays: 365,
    maxCount: 1,
    dueSoonDays: 30,
    applicabilityCodes: [],
    applicabilitySystem: "",
    requiredEvidence: [],
    requiredEvidenceCodes: [],
    evidenceLabels: {},
    effectiveFrom: "2026-01-01",
    effectiveTo: "",
    sourceLabel: "연결된 청구 line 사전점검 프로필",
    sourceDocumentNumber: `기관 프로필 ${assessmentId.toUpperCase()}`,
    note: "실제 보험자 심사결과가 아닌 연결 자료 기반 사전점검",
    sample: true,
  };
}

export function profileClaimEvaluation(patient, item, diseaseProfile = null) {
  const status = item?.preflight?.status;
  const evaluationStatus = status === "GREEN"
    ? "ready"
    : status === "YELLOW" ? "missing-evidence" : "unknown";
  const reasonLabels = (item?.preflight?.reasonCodes ?? [])
    .map((code) => DEMO_CLAIM_REASON_LABELS[code] ?? code);
  const rule = profileClaimRule(item);
  const serviceDate = item?.serviceDate || today();
  const evidenceRecords = profileEvidenceSnapshots(diseaseProfile, item);
  const sourceId = profileClaimSourceId(item);
  return {
    id: `${patient.id}:profile:${sourceId}`,
    sourceKind: "profile",
    sourceId,
    patientId: patient.id,
    patientName: patient.name,
    patientMrn: patient.mrn,
    ruleId: rule.id,
    title: item.label,
    serviceCode: item.code,
    status: evaluationStatus,
    asOf: serviceDate,
    calculationAvailable: status !== "GRAY",
    windowStart: serviceDate,
    windowEnd: serviceDate,
    usedCount: status === "GREEN" ? 1 : 0,
    remainingCount: status === "GREEN" ? 0 : 1,
    serviceEventIds: [],
    lastServiceDate: serviceDate,
    daysSinceLastService: 0,
    nextEligibleDate: "",
    missingEvidence: status === "YELLOW" || status === "RED" ? reasonLabels : [],
    evidenceEventIds: [],
    explanation: item.preflight?.disclaimer ?? "연결 사전점검 자료",
    rule,
    claimContext: {
      assessmentId: item.assessmentId || "",
      claimItemId: item.id,
      serviceDate,
      workflowStatus: item.workflowStatus || "",
      claimUnit: item.claimUnit || null,
      preflightStatus: status || "GRAY",
      riskConfirmed: item?.preflight?.riskConfirmed === true,
      reasonCodes: Array.isArray(item?.preflight?.reasonCodes) ? item.preflight.reasonCodes : [],
      reasonLabels,
      evidenceIds: Array.isArray(item?.preflight?.evidenceIds) ? item.preflight.evidenceIds : [],
      evidenceCount: item?.preflight?.evidenceIds?.length ?? 0,
      evidenceRecords,
      disclaimer: item?.preflight?.disclaimer || "",
      provenance: item?.provenance || null,
      provenanceLabel: item?.provenance?.sourceLabel || item?.provenance?.sourceId || "연결 출처 확인 필요",
    },
  };
}

export function claimReviewEvaluationsForPatient(state, patient) {
  const profile = state.demo ? getCombinedDiseaseClaimProfile(patient) : null;
  const profileItems = Array.isArray(profile?.claimItems) ? profile.claimItems : [];
  const diseaseProfileById = new Map((state.demo ? getDiseaseAssessmentProfiles(patient) : [])
    .map((diseaseProfile) => [diseaseProfile.assessmentId, diseaseProfile]));
  const profileEvaluations = profileItems.map((item) => profileClaimEvaluation(patient, item, diseaseProfileById.get(item.assessmentId)));
  const board = buildClaimBoard([patient], state.rules, today());
  const ruleEvaluations = CLAIM_LANE_ORDER
    .flatMap((status) => board.lanes[status])
    .filter((evaluation) => evaluation.status !== "not-applicable");
  return [...profileEvaluations, ...ruleEvaluations];
}

export function claimReviewEvaluationsForPatients(state, patients) {
  return patients.flatMap((patient) => claimReviewEvaluationsForPatient(state, patient))
    .sort((left, right) => left.patientName.localeCompare(right.patientName, "ko")
      || left.title.localeCompare(right.title, "ko")
      || String(left.asOf).localeCompare(String(right.asOf)));
}

export function demoClaimInput(item) {
  const reason = (item?.preflight?.reasonCodes ?? [])
    .map((code) => DEMO_CLAIM_REASON_LABELS[code] ?? code)
    .join(" · ");
  return {
    claimItemId: item.id,
    riskConfirmed: item?.preflight?.status === "RED" && item?.preflight?.riskConfirmed === true,
    riskEvaluable: item?.preflight?.status !== "GRAY",
    riskReason: reason,
    insufficientReason: item?.preflight?.status === "GRAY" ? reason || item.preflight.disclaimer : "",
    requiredEvidenceVerified: item?.preflight?.status === "GREEN",
    verifiedReason: reason,
    missingData: item?.preflight?.status === "YELLOW" ? (item.preflight.reasonCodes ?? []).map((code) => DEMO_CLAIM_REASON_LABELS[code] ?? code) : [],
  };
}

export function claimAttentionEntries(patient, evaluations, profile) {
  const profileItems = Array.isArray(profile?.claimItems) ? profile.claimItems : [];
  const profileEvaluationBySourceId = new Map(evaluations
    .filter(({ sourceKind }) => sourceKind === "profile")
    .map((evaluation) => [evaluation.sourceId, evaluation]));
  const entries = profileItems.map((item) => {
    const evaluation = profileEvaluationBySourceId.get(profileClaimSourceId(item)) || profileClaimEvaluation(patient, item);
    return {
      id: profileClaimSourceId(item),
      workItemId: evaluation.id,
      evaluation,
      title: item.label,
      code: item.code,
      displayCode: String(item.code || "").startsWith("DEMO-") ? "" : item.code,
      date: item.serviceDate,
      dateLabel: "진료일",
      workflowStatus: item.workflowStatus,
      claimUnit: item.claimUnit || null,
      rule: null,
      evidenceCount: item?.preflight?.evidenceIds?.length ?? 0,
      synthetic: true,
      presentation: resolveClaimPreflightPresentation({ evaluation, claimItem: demoClaimInput(item) }),
    };
  });
  for (const evaluation of evaluations) {
    if (evaluation.sourceKind === "profile") continue;
    if (evaluation.status === "not-applicable") continue;
    entries.push({
      id: evaluation.id,
      workItemId: evaluation.id,
      evaluation,
      title: evaluation.title,
      code: evaluation.serviceCode,
      displayCode: evaluation.rule?.sample === true ? "" : evaluation.serviceCode,
      date: evaluation.asOf,
      dateLabel: "판정 기준일",
      workflowStatus: "EMR 자동 집계",
      claimUnit: null,
      rule: evaluation.rule,
      evidenceCount: evaluation.evidenceEventIds?.length ?? 0,
      synthetic: evaluation.rule?.sample === true,
      presentation: resolveClaimPreflightPresentation({ evaluation }),
    });
  }
  return entries.sort((left, right) => CLAIM_ATTENTION_ORDER[left.presentation.state] - CLAIM_ATTENTION_ORDER[right.presentation.state]
    || left.title.localeCompare(right.title, "ko"));
}

export function priorityClaimAttentionEntries(entries) {
  const actionable = entries.filter(({ presentation }) => ["high-risk", "needs-review"].includes(presentation.state));
  return (actionable.length ? actionable : entries).slice(0, 3);
}

export function profileClaimUnitLabel(claimUnit) {
  if (!claimUnit || typeof claimUnit !== "object") return "단위 정보 미연결";
  return [
    claimUnit.lineNumber ? `line ${claimUnit.lineNumber}` : "",
    claimUnit.quantity !== undefined && claimUnit.quantity !== null && claimUnit.quantity !== ""
      ? `${claimUnit.quantity}${claimUnit.unit || ""}`
      : claimUnit.unit || "",
  ].filter(Boolean).join(" · ") || "단위 정보 미연결";
}

export function claimRequiredActions(evaluation) {
  const actions = [];
  const add = (id, label, completionCriterion) => {
    if (!label || actions.some((item) => item.id === id || item.label === label)) return;
    actions.push({ id, label, completionCriterion });
  };
  if (evaluation.sourceKind === "profile") {
    for (const [index, reason] of (evaluation.claimContext?.reasonLabels ?? []).entries()) {
      add(`profile-reason-${index + 1}`, reason, `${reason} 항목의 원본·기록 위치와 환자 일치 여부가 확인됨`);
    }
    if (evaluation.claimContext?.preflightStatus === "GRAY") {
      add("profile-data-scope", "판정 가능한 자료 범위 확인", "원내·외부 자료의 연결 여부와 판정 제외 사유가 기록됨");
    }
    add("claim-line-context", "진료일·청구 line·상병 연결 대조", "진료일, 청구 단위, 적용 상병이 같은 진료 맥락으로 확인됨");
  } else {
    for (const [index, evidence] of (evaluation.missingEvidence ?? []).entries()) {
      add(`evidence-${index + 1}`, `${evidence} 확인·연결`, `${evidence}의 확정 결과·기록일·출처가 EMR에 연결됨`);
    }
    if (["waiting", "due-soon"].includes(evaluation.status)) {
      add("prior-service", "원내·외부 최근 시행일 확인", "동일 행위의 최근 시행일과 집계 구간 포함 여부가 확인됨");
      add("eligibility-date", "다음 기준일 확인", "다음 적용 가능일과 예외 조건을 담당자가 검토함");
    }
    if (evaluation.status === "ready") {
      add("claim-context", "적용 상병·진료일·청구 line 대조", "현재 규칙과 청구 단위가 같은 진료 맥락으로 확인됨");
    }
    if (evaluation.status === "unknown") {
      add("rule-scope", "규칙 적용기간·필수값 확인", "규칙 버전, 적용일, 환자 조건의 누락 여부가 확인됨");
    }
  }
  add("human-decision", "담당자 의견과 내부 결론 기록", "자동 판정과 별도로 검토자·담당·사유·결론이 이력에 저장됨");
  return actions.slice(0, 5);
}

export function claimAdjudicationEntries(profile) {
  const items = Array.isArray(profile?.claimItems) ? profile.claimItems : [];
  const adjudications = Array.isArray(profile?.adjudications) ? profile.adjudications : [];
  const scopeKey = (assessmentId, claimItemId) => `${assessmentId || "unscoped"}:${claimItemId}`;
  const itemById = new Map(items.map((item) => [scopeKey(item.assessmentId, item.id), item]));
  const claimItemKeys = [...new Set(adjudications
    .map(({ assessmentId, claimItemId }) => claimItemId ? scopeKey(assessmentId, claimItemId) : "")
    .filter(Boolean))];
  return claimItemKeys.map((claimItemKey) => {
    const [assessmentId, ...claimItemIdParts] = claimItemKey.split(":");
    const claimItemId = claimItemIdParts.join(":");
    const scopedAdjudications = adjudications.filter((item) => scopeKey(item.assessmentId, item.claimItemId) === claimItemKey);
    const adjudication = latestFinalAdjudication(scopedAdjudications, claimItemId);
    if (!adjudication) return null;
    const item = itemById.get(claimItemKey);
    return {
      id: `${assessmentId}:${adjudication.id || claimItemId}`,
      title: item?.label || "연결된 청구 항목",
      code: String(item?.code || "").startsWith("DEMO-") ? "" : item?.code || "",
      serviceDate: item?.serviceDate || "",
      presentation: resolveClaimAdjudicationPresentation(adjudication),
      adjudication,
    };
  }).filter(Boolean).sort((left, right) => String(right.adjudication.decidedAt).localeCompare(String(left.adjudication.decidedAt)));
}

export function formatClaimAmount(value, currency = "KRW") {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "금액 미연결";
  return new Intl.NumberFormat("ko-KR", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

export function buildClaimSearchIndex(state, patient, evaluations, profile) {
  const entries = [];
  for (const evaluation of evaluations) {
    entries.push(createClaimSearchEntry({
      id: `workflow:${evaluation.id}`,
      kind: "workflow",
      domain: "claim",
      title: evaluation.title,
      subtitle: `${evaluation.patientName} · ${evaluation.asOf || "판정일 미연결"} · ${CLAIM_LANE_LABELS[evaluation.status] || "기준 확인"}`,
      searchText: [
        evaluation.patientName,
        evaluation.patientMrn,
        evaluation.serviceCode,
        evaluation.rule?.title,
        evaluation.rule?.ruleSetId,
        evaluation.rule?.sourceLabel,
        evaluation.rule?.sourceDocumentNumber,
        evaluation.explanation,
        evaluation.sourceKind === "profile" ? profileClaimUnitLabel(evaluation.claimContext?.claimUnit) : "",
        ...(evaluation.missingEvidence ?? []),
        ...(evaluation.claimContext?.evidenceRecords ?? []).flatMap(({ id, label, sourceId, sourceLabel }) => [id, label, sourceId, sourceLabel]),
        ...claimRequiredActions(evaluation).flatMap(({ label, completionCriterion }) => [label, completionCriterion]),
      ].filter(Boolean).join(" "),
      target: { targetType: "workflow", evaluationId: evaluation.id },
    }));
  }
  for (const entry of claimAdjudicationEntries(profile)) {
    entries.push(createClaimSearchEntry({
      id: `adjudication:${entry.id}`,
      kind: "adjudication",
      domain: "adjudication",
      title: entry.title,
      subtitle: `${entry.presentation.label} · ${entry.serviceDate || "진료일 미연결"}`,
      searchText: [entry.code, entry.adjudication.reasonCode, entry.adjudication.sourceId, entry.adjudication.provenance?.sourceLabel, entry.presentation.reason].filter(Boolean).join(" "),
      target: { targetType: "adjudication", adjudicationId: entry.id },
    }));
  }
  for (const option of state.demo ? getDiseaseAssessmentOptions(patient) : []) {
    const assessment = evaluateDiseaseAssessment(patient, option.id);
    if (!assessment) continue;
    for (const metric of assessment.quality?.metrics ?? []) {
      entries.push(createClaimSearchEntry({
        id: `quality:${patient.id}:${option.id}:${metric.id}`,
        kind: "quality",
        domain: "quality",
        title: `${option.label} · ${metric.label || metric.title || metric.id}`,
        subtitle: `${QUALITY_METRIC_STATUS[metric.status]?.label || "자료 확인"} · 기관 질 평가 예상`,
        searchText: [patient.name, patient.mrn, option.shortLabel, option.description, metric.observedLabel, metric.displayValue, metric.reason, ...(metric.evidence ?? [])].filter(Boolean).join(" "),
        target: { targetType: "quality", diseaseId: option.id, metricId: metric.id },
      }));
    }
  }
  for (const rule of state.rules) {
    entries.push(createClaimSearchEntry({
      id: `rule:${rule.id}`,
      kind: "rule",
      domain: "rule",
      title: rule.title,
      subtitle: [rule.sourceDocumentNumber || "고시·문서번호 미연결", rule.sample ? "기관 내부 규칙" : `v${rule.version}`, `적용 ${rule.effectiveFrom}–${rule.effectiveTo || "현재"}`].join(" · "),
      searchText: [rule.ruleSetId, rule.serviceCode, rule.serviceSystem, rule.sourceLabel, rule.sourceDocumentNumber, rule.note].filter(Boolean).join(" "),
      target: { targetType: "rule", ruleId: rule.id },
    }));
  }
  return entries.filter(Boolean);
}
