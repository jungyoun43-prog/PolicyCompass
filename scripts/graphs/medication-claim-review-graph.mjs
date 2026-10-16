import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import { isAllowedFrontierModel } from "../../src/frontier-model-catalog.js";
import { medicationReviewInstructions, medicationReviewRequest } from "../../src/medication-review-prompt.js";
import { medicationCoveragePolicy } from "../../src/medication-coverage-policies.js";
import { medicationCriteriaProfile } from "../../src/medication-policy-criteria.js";
import { assertCriteriaSource, structuredMedicationRequest, validateMedicationCriteria } from "../medication-criteria-review.mjs";
import { assertModelContextAccepted, ModelContextError } from "../../lib/model-errors.js";
import { isJevReviewModel } from "../../src/medication-review-decision.js";
import { jevMedicationDraft } from "../medication-jev-review.mjs";

import {
  callFrontierModel,
  cleanText,
  clinicalLocalModel,
  frontierCredentials,
  frontierStatus,
  ollamaEndpoint,
  safeGeneratedText,
} from "../patient-question-assistant.mjs";

const COMPARISON_SCHEMA = "policycompass-medication-claim-review";
const VERDICT_RANK = { circle: 0, triangle: 1, cross: 2 };
const MAX_CHECKS = 12;
const MAX_FINDINGS = 6;

function boundedInteger(value, maximum) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= maximum ? parsed : 0;
}

function sanitizeFinding(input) {
  return {
    eventId: cleanText(input?.eventId, 160),
    label: cleanText(input?.label, 160),
    code: cleanText(input?.code, 200),
    date: cleanText(input?.date, 10),
    provenance: cleanText(input?.provenance, 40),
    detail: cleanText(input?.detail, 240),
  };
}

function sanitizeCheck(input) {
  const id = cleanText(input?.id, 80);
  const verdict = cleanText(input?.verdict, 20);
  if (!id || !Object.hasOwn(VERDICT_RANK, verdict)) return null;
  return {
    id,
    kind: cleanText(input?.kind, 40),
    title: cleanText(input?.title, 80),
    verdict,
    matched: input?.matched === true,
    criterion: {
      requirement: cleanText(input?.criterion?.requirement, 400),
      detail: cleanText(input?.criterion?.detail, 400),
    },
    chart: {
      status: cleanText(input?.chart?.status, 40),
      detail: cleanText(input?.chart?.detail, 400),
      findings: (Array.isArray(input?.chart?.findings) ? input.chart.findings : [])
        .slice(0, MAX_FINDINGS)
        .map(sanitizeFinding),
    },
    source: {
      label: cleanText(input?.source?.label, 200),
      documentNumber: cleanText(input?.source?.documentNumber, 200),
      version: cleanText(input?.source?.version, 40),
      effectiveFrom: cleanText(input?.source?.effectiveFrom, 10),
      url: cleanText(input?.source?.url, 300),
    },
  };
}

const RECORD_TYPES = new Set(["condition", "observation", "medication", "allergy", "procedure", "symptom"]);

function sourceText(value) {
  return typeof value === "string" ? value : "";
}

function sanitizeRecord(input) {
  const type = cleanText(input?.type, 40);
  const label = sourceText(input?.label);
  const date = cleanText(input?.date, 10);
  if (!RECORD_TYPES.has(type) || !label || !date) return null;
  const record = { type, code: sourceText(input?.code), label, date, status: sourceText(input?.status) };
  if (typeof input?.value === "number" && Number.isFinite(input.value)) record.value = input.value;
  else if (sourceText(input?.value)) record.value = input.value;
  if (sourceText(input?.unit)) record.unit = input.unit;
  if (input?.prescription && typeof input.prescription === "object") {
    record.prescription = {
      dose: sourceText(input.prescription.dose),
      doseUnit: sourceText(input.prescription.doseUnit),
      route: sourceText(input.prescription.route),
      frequency: sourceText(input.prescription.frequency),
      durationDays: boundedInteger(input.prescription.durationDays, 365),
    };
  }
  return record;
}

/**
 * Accepts only the de-identified rule comparison the browser produced. Names, MRNs
 * and free-text memos never appear in that structure, and anything else is dropped here.
 */
export function sanitizeMedicationClaimComparison(payload = {}) {
  const source = payload?.comparison && typeof payload.comparison === "object" && !Array.isArray(payload.comparison)
    ? payload.comparison
    : null;
  if (!source || source.schema !== COMPARISON_SCHEMA) {
    throw new TypeError("검토할 약제 급여 사전점검 비교 결과가 필요합니다.");
  }
  const checks = (Array.isArray(source.checks) ? source.checks : [])
    .slice(0, MAX_CHECKS)
    .map(sanitizeCheck)
    .filter(Boolean);
  if (!checks.length) throw new TypeError("대조된 기준 항목이 없습니다.");
  const verdict = cleanText(source.verdict, 20);
  if (!Object.hasOwn(VERDICT_RANK, verdict)) throw new TypeError("규칙 판정이 올바르지 않습니다.");
  const label = sourceText(source.medication?.label);
  if (!label) throw new TypeError("검토할 약품명이 필요합니다.");
  return {
    schema: COMPARISON_SCHEMA,
    version: 1,
    asOf: cleanText(source.asOf, 10),
    medication: {
      id: cleanText(source.medication?.id, 80),
      code: cleanText(source.medication?.code, 80),
      system: cleanText(source.medication?.system, 120),
      label,
      ingredient: sourceText(source.medication?.ingredient),
      classLabel: sourceText(source.medication?.classLabel),
    },
    prescription: {
      dose: sourceText(source.prescription?.dose),
      doseUnit: sourceText(source.prescription?.doseUnit),
      route: sourceText(source.prescription?.route),
      frequency: sourceText(source.prescription?.frequency),
      durationDays: boundedInteger(source.prescription?.durationDays, 365),
      quantity: sourceText(source.prescription?.quantity),
    },
    patient: {
      ageYears: Number.isInteger(source.patient?.ageYears) ? source.patient.ageYears : null,
      sex: cleanText(source.patient?.sex, 20),
      insuranceType: cleanText(source.patient?.insuranceType, 40),
      conditionCount: boundedInteger(source.patient?.conditionCount, 10_000),
      eventCount: boundedInteger(source.patient?.eventCount, Number.MAX_SAFE_INTEGER),
    },
    records: (Array.isArray(source.records) ? source.records : [])
      .map(sanitizeRecord)
      .filter(Boolean),
    ...(typeof source.dataset === "string" && source.dataset.trim()
      ? { dataset: source.dataset }
      : {}),
    checks,
    verdict,
  };
}

/** Operator-edited 프롬프트/고시정보/진료데이터 from the pre-send preview. */
function sanitizeOverrides(input, comparison) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const overrides = {};
  for (const key of ["instructions", "notice", "patientData", "criteriaSourceNotice"]) {
    if (!Object.hasOwn(input, key)) continue;
    if (typeof input[key] !== "string" || !input[key].trim()) {
      throw new TypeError("검토 지시문, 고시정보, 진료데이터는 비어 있지 않은 문자열이어야 합니다.");
    }
    overrides[key] = input[key];
  }
  const model = cleanText(input.model, 120);
  if (model && isAllowedFrontierModel(model)) overrides.model = model;
  overrides.treatmentPhase = input.treatmentPhase ?? "initial";
  if (!["initial", "continuation"].includes(overrides.treatmentPhase)) throw new TypeError("초기 또는 지속 투여 경로를 선택해 주세요.");
  if (input.policyId !== undefined) {
    overrides.policyId = input.policyId;
    const policy = medicationCoveragePolicy(comparison.medication.id, overrides.policyId);
    if (!policy) throw new TypeError("이 약제에 등록되지 않은 보험 기준입니다.");
    overrides.policyContext = { countryCode: policy.countryCode, country: policy.country, payer: policy.payer, program: policy.program, indication: policy.indication };
  }
  return overrides;
}

const VERDICT_SYMBOLS = {
  "\u25cb": "circle", "\u25ef": "circle", "\u3007": "circle", "O": "circle",
  "\u25b3": "triangle", "\u25b5": "triangle",
  "\u2715": "cross", "\u2717": "cross", "\u00d7": "cross", "X": "cross", "x": "cross",
};

function markdownText(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function validateDraft(raw, _comparison) {
  const markdown = markdownText(raw);
  if (!markdown) throw new Error("모델 응답이 비었습니다.");
  const heading = markdown.match(/^##[ \t]+(?:\[[ \t]*([^\]\s])[ \t]*\]|([^\s[]))(?=[ \t]|$)/mu);
  const symbol = heading ? (heading[1] || heading[2]) : "";
  const verdict = VERDICT_SYMBOLS[symbol];
  if (!verdict) throw new Error("출력 형식의 판정 헤더(## [\u25cb/\u25b3/\u2715])가 없습니다.");
  safeGeneratedText(markdown, markdown.length);
  return { verdict, markdown };
}

function reviewRequest(comparison, options, feedback) {
  const overrides = { ...options.overrides };
  if (options.criteriaProfile && !overrides.instructions) overrides.instructions = medicationReviewInstructions(options.model, { structured: true });
  const request = medicationReviewRequest(comparison, overrides, Boolean(feedback) && !options.criteriaProfile);
  return options.criteriaProfile
    ? structuredMedicationRequest(request, comparison, { ...options.overrides, retryFeedback: feedback }, options.criteriaProfile)
    : request;
}

async function localDraft(comparison, options, feedback) {
  const { instructions, input } = reviewRequest(comparison, options, feedback);
  const messages = [
    { role: "system", content: instructions },
    { role: "user", content: input },
  ];
  const response = await options.fetchImpl(`${ollamaEndpoint(options.endpoint)}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: options.model,
      messages,
      stream: false,
      think: false,
      truncate: false,
      shift: false,
      options: { temperature: 0 },
    }),
    redirect: "error",
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    assertModelContextAccepted(response.status, error);
    throw new Error(`약제 검토 로컬 모델 요청 실패 (${response.status})`);
  }
  const body = await response.json();
  if (body?.error) {
    assertModelContextAccepted(response.status, body);
    throw new Error("로컬 모델이 검토 응답을 완료하지 못했습니다.");
  }
  if (body?.done_reason === "length") throw new Error("모델 응답이 출력 한도에 도달해 완료되지 않았습니다.");
  return {
    text: typeof body?.message?.content === "string" ? body.message.content : "",
    model: cleanText(body?.model, 160) || options.model,
    generatedBy: "local-model",
  };
}

async function frontierDraft(comparison, options, feedback) {
  const { instructions, input } = reviewRequest(comparison, options, feedback);
  const result = await callFrontierModel({
    apiKey: options.apiKey,
    model: options.model,
    instructions,
    input,
    preserveInput: true,
    requireCompleteOutput: true,
    maxOutputTokens: options.criteriaProfile ? 6_000 : 2_600,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    environment: options.environment ?? process.env,
  });
  return {
    text: result.text,
    model: result.model,
    generatedBy: "frontier-model",
  };
}

const MedicationClaimReviewState = Annotation.Root({
  comparison: Annotation(),
  draft: Annotation(),
  attempts: Annotation({ reducer: (left, right) => [...(left ?? []), ...(right ?? [])], default: () => [] }),
});

let compiledGraph = null;

function medicationClaimReviewGraph() {
  compiledGraph ??= new StateGraph(MedicationClaimReviewState)
    .addNode("compare", async (state, config) => {
      const options = config?.configurable?.medicationReviewOptions ?? {};
      if (options.sourceError) return { draft: { status: "incomplete", verdict: null, generatedBy: "none", note: options.sourceError } };
      if (!options.model) {
        return { draft: { status: "failed", verdict: null, generatedBy: "none", note: "AI 모델이 설정되지 않아 검토를 완료하지 못했습니다." } };
      }
      if (options.criteriaProfile && isJevReviewModel(options.model)) {
        return { draft: { status: "incomplete", verdict: null, generatedBy: "none", note: "이 조건표 검토에는 조건별 근거를 반환하는 모델이 필요합니다. 다른 검토 모델을 선택해 주세요." } };
      }
      let feedback = "";
      let rawSample = "";
      let rejectedResponse = "";
      const validationIssues = [];
      // Leave time for a structured error response within the route's 120s budget.
      const startedAt = Date.now();
      const budgetMs = options.budgetMs ?? 110_000;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const remaining = budgetMs - (Date.now() - startedAt);
        if (remaining < 8_000) break;
        const attemptOptions = { ...options, timeoutMs: Math.min(options.timeoutMs ?? 30_000, remaining - 3_000) };
        let raw = null;
        try {
          if (options.provider === "frontier" && isJevReviewModel(options.model)) {
            return { draft: { ...await jevMedicationDraft(state.comparison, attemptOptions), status: "completed" } };
          }
          raw = options.provider === "frontier"
            ? await frontierDraft(state.comparison, attemptOptions, feedback)
            : await localDraft(state.comparison, attemptOptions, feedback);
          const draft = options.criteriaProfile
            ? validateMedicationCriteria(raw.text, options.criteriaProfile, reviewRequest(state.comparison, options, feedback), state.comparison)
            : { ...validateDraft(raw.text, state.comparison), status: "completed", assessmentMethod: "model-report" };
          if (draft.criteria) safeGeneratedText(draft.criteria.map(row => row.reason).join("\n"), Infinity);
          return { draft: { ...draft, model: raw.model, generatedBy: draft.status === "completed" ? raw.generatedBy : "none" } };
        } catch (error) {
          if (error instanceof ModelContextError) throw error;
          feedback = cleanText(error?.message, 300);
          validationIssues.push({ attempt, message: feedback });
          // 검증에 걸린 시도의 모델 원문 앞부분을 보존해 실패 사유와 함께 보여 준다.
          if (raw?.text) {
            rejectedResponse = raw.text;
            rawSample = markdownText(raw.text).slice(0, 200).replace(/\n+/g, " ");
          }
        }
      }
      return {
        draft: {
          status: "failed", verdict: null, generatedBy: "none",
          validationIssues, rejectedResponse,
          note: `모델 검토를 완료하지 못했습니다: ${feedback}${rawSample ? ` — 모델 응답 원문(앞부분): "${rawSample}"` : ""}`,
        },
        attempts: [feedback],
      };
    })
    .addEdge(START, "compare")
    .addEdge("compare", END)
    .compile();
  return compiledGraph;
}

export function medicationClaimReviewStatus(environment = process.env) {
  const local = clinicalLocalModel(environment);
  return {
    local: { configured: Boolean(local.model), model: local.model },
    frontier: frontierStatus(environment),
  };
}

export async function runMedicationClaimReview(payload = {}, {
  environment = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = 30_000,
} = {}) {
  const comparison = sanitizeMedicationClaimComparison(payload);
  const overrides = sanitizeOverrides(payload?.overrides, comparison);
  const provider = payload?.provider === "frontier" ? "frontier" : "local";
  const status = medicationClaimReviewStatus(environment);
  const criteriaProfile = medicationCriteriaProfile(comparison.medication.id, overrides.policyId, overrides.treatmentPhase);
  let sourceError = "";
  if (criteriaProfile) {
    try {
      const request = medicationReviewRequest(comparison, overrides);
      assertCriteriaSource(criteriaProfile, overrides.criteriaSourceNotice ?? JSON.parse(request.input).noticeText);
    } catch (error) { sourceError = error.message; }
  }
  const options = provider === "frontier"
    ? {
      provider,
      overrides,
      model: status.frontier.configured ? (overrides.model || status.frontier.model) : "",
      apiKey: frontierCredentials(environment).apiKey,
      environment,
      fetchImpl,
      timeoutMs,
    }
    : {
      provider,
      overrides,
      model: status.local.configured ? status.local.model : "",
      endpoint: clinicalLocalModel(environment).endpoint,
      fetchImpl,
      timeoutMs,
    };
  const state = await medicationClaimReviewGraph().invoke({ comparison }, {
    configurable: { medicationReviewOptions: { ...options, criteriaProfile, sourceError } },
  });
  return {
    schema: COMPARISON_SCHEMA,
    provider,
    status: state.draft.status,
    draft: state.draft,
    disclaimer: "청구 전 사전점검 초안입니다. 급여 인정이나 삭감을 확정하지 않으며 처방 결정은 의료진이 합니다.",
  };
}
