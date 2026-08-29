import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import {
  callFrontierModel,
  cleanText,
  frontierApiStyle,
  frontierCredentials,
  frontierEndpoint,
  frontierKeyMismatch,
  frontierVariablesPresent,
  ollamaEndpoint,
  safeGeneratedText,
} from "../patient-question-assistant.mjs";

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["circle", "triangle", "cross"] },
    summary: { type: "string" },
    rationale: { type: "array", maxItems: 8, items: { type: "string" } },
    citedCheckIds: { type: "array", maxItems: 12, items: { type: "string" } },
  },
  required: ["verdict", "summary", "rationale", "citedCheckIds"],
};

const COVERAGE_DECISION_CLAIM = /(급여|청구|삭감)[를을]?\s*(확정|승인|거절|확신)(합니다|했습니다|됩니다)/;
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
  const label = cleanText(source.medication?.label, 160);
  if (!label) throw new TypeError("검토할 약품명이 필요합니다.");
  return {
    schema: COMPARISON_SCHEMA,
    version: 1,
    asOf: cleanText(source.asOf, 10),
    medication: {
      code: cleanText(source.medication?.code, 80),
      label,
      ingredient: cleanText(source.medication?.ingredient, 160),
      classLabel: cleanText(source.medication?.classLabel, 120),
    },
    prescription: {
      dose: cleanText(source.prescription?.dose, 40),
      doseUnit: cleanText(source.prescription?.doseUnit, 30),
      route: cleanText(source.prescription?.route, 60),
      frequency: cleanText(source.prescription?.frequency, 80),
      durationDays: boundedInteger(source.prescription?.durationDays, 365),
    },
    patient: {
      ageYears: Number.isInteger(source.patient?.ageYears) ? source.patient.ageYears : null,
      sex: cleanText(source.patient?.sex, 20),
      insuranceType: cleanText(source.patient?.insuranceType, 40),
      conditionCount: boundedInteger(source.patient?.conditionCount, 10_000),
    },
    checks,
    verdict,
  };
}

function instructions() {
  return [
    "당신은 한국 요양급여 청구 전 사전점검을 돕는 한국어 문서화 도구입니다.",
    "입력에는 등록된 예시 급여기준(criterion)과 같은 환자의 기록(chart)이 항목별로 짝지어져 있습니다.",
    "두 값을 항목별로 대조해 이번 처방이 삭감될 위험을 verdict로 제시합니다.",
    "verdict는 circle(기준과 기록이 일치, 삭감 위험 낮음), triangle(추가 근거 확인 필요), cross(요구 근거가 기록에 없어 삭감 위험 높음) 중 하나입니다.",
    "규칙 엔진이 이미 계산한 ruleVerdict보다 관대한 판정을 내리지 않습니다.",
    "summary에는 어떤 기준과 어떤 환자 기록이 어긋났는지 또는 일치했는지를 한 문장으로 씁니다.",
    "rationale의 각 문장은 기준 내용과 그에 대응하는 환자 기록을 함께 언급합니다.",
    "citedCheckIds에는 입력 checks에 있는 id만 사용합니다.",
    "급여 인정이나 삭감을 확정하지 않고, 처방 변경·중단·증량을 지시하지 않으며, 진단을 내리지 않습니다.",
    "응답은 지정된 JSON 스키마만 따릅니다.",
  ].join(" ");
}

function modelInput(comparison) {
  return JSON.stringify({
    ruleVerdict: comparison.verdict,
    medication: comparison.medication,
    prescription: comparison.prescription,
    patient: comparison.patient,
    checks: comparison.checks.map(({ id, title, verdict, criterion, chart }) => ({
      id,
      title,
      ruleVerdict: verdict,
      criterion,
      chart,
    })),
  });
}

function validateDraft(parsed, comparison) {
  const verdict = cleanText(parsed?.verdict, 20);
  if (!Object.hasOwn(VERDICT_RANK, verdict)) throw new Error("verdict가 circle·triangle·cross가 아닙니다.");
  if (VERDICT_RANK[verdict] < VERDICT_RANK[comparison.verdict]) {
    throw new Error("규칙 판정보다 관대한 판정을 제시했습니다.");
  }
  const summary = safeGeneratedText(parsed?.summary, 400);
  if (!summary || COVERAGE_DECISION_CLAIM.test(summary)) {
    throw new Error("요약이 비었거나 급여·삭감을 확정합니다.");
  }
  const rationale = (Array.isArray(parsed?.rationale) ? parsed.rationale : [])
    .map((item) => safeGeneratedText(item, 300))
    .filter(Boolean)
    .slice(0, 8);
  if (!rationale.length) throw new Error("근거 문장이 없습니다.");
  if (rationale.some((item) => COVERAGE_DECISION_CLAIM.test(item))) {
    throw new Error("근거 문장이 급여·삭감을 확정합니다.");
  }
  const allowed = new Set(comparison.checks.map(({ id }) => id));
  const citedCheckIds = (Array.isArray(parsed?.citedCheckIds) ? parsed.citedCheckIds : [])
    .map((item) => cleanText(item, 80))
    .filter(Boolean);
  if (citedCheckIds.some((id) => !allowed.has(id))) throw new Error("입력에 없는 기준 항목을 인용했습니다.");
  return { verdict, summary, rationale, citedCheckIds };
}

async function localDraft(comparison, options, feedback) {
  const messages = [
    { role: "system", content: instructions() },
    { role: "user", content: modelInput(comparison) },
  ];
  if (feedback) {
    messages.push({ role: "user", content: `이전 초안이 거부되었습니다: ${feedback} 같은 JSON 스키마와 안전 규칙을 지켜 다시 작성하세요.` });
  }
  const response = await options.fetchImpl(`${ollamaEndpoint(options.endpoint)}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: options.model,
      messages,
      stream: false,
      think: false,
      format: REVIEW_SCHEMA,
      options: { temperature: 0 },
    }),
    redirect: "error",
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  if (!response.ok) throw new Error(`약제 검토 로컬 모델 요청 실패 (${response.status})`);
  const body = await response.json();
  return {
    parsed: JSON.parse(cleanText(body?.message?.content, 10_000)),
    model: cleanText(body?.model, 160) || options.model,
    generatedBy: "local-model",
  };
}

async function frontierDraft(comparison, options, feedback) {
  const input = feedback
    ? `${modelInput(comparison)}\n\n[재시도 안내] ${feedback}`
    : modelInput(comparison);
  const result = await callFrontierModel({
    apiKey: options.apiKey,
    model: options.model,
    instructions: instructions(),
    input,
    schemaName: "policycompass_medication_claim_review",
    schema: REVIEW_SCHEMA,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    environment: options.environment ?? process.env,
  });
  return {
    parsed: JSON.parse(result.text),
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
      if (!options.model) {
        return { draft: { generatedBy: "rule", note: "AI 모델이 설정되지 않아 규칙 판정을 그대로 사용했습니다." } };
      }
      let feedback = "";
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const raw = options.provider === "frontier"
            ? await frontierDraft(state.comparison, options, feedback)
            : await localDraft(state.comparison, options, feedback);
          return { draft: { ...validateDraft(raw.parsed, state.comparison), model: raw.model, generatedBy: raw.generatedBy } };
        } catch (error) {
          feedback = cleanText(error?.message, 300);
        }
      }
      return {
        draft: { generatedBy: "rule", note: `모델 검토 실패로 규칙 판정을 사용했습니다: ${feedback}` },
        attempts: [feedback],
      };
    })
    .addEdge(START, "compare")
    .addEdge("compare", END)
    .compile();
  return compiledGraph;
}

export function medicationClaimReviewStatus(environment = process.env) {
  return {
    local: {
      configured: Boolean(environment.POLICYCOMPASS_OLLAMA_MODEL),
      model: environment.POLICYCOMPASS_OLLAMA_MODEL ?? "",
    },
    frontier: (({ configured, model, reason }) => ({
      configured,
      model,
      api: frontierApiStyle(environment),
      endpoint: frontierEndpoint(environment),
      ...(frontierKeyMismatch(environment) ? { warning: frontierKeyMismatch(environment) } : {}),
      ...(reason ? { reason, detected: frontierVariablesPresent(environment) } : {}),
    }))(frontierCredentials(environment)),
  };
}

export async function runMedicationClaimReview(payload = {}, {
  environment = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = 30_000,
} = {}) {
  const comparison = sanitizeMedicationClaimComparison(payload);
  const provider = payload?.provider === "frontier" ? "frontier" : "local";
  const status = medicationClaimReviewStatus(environment);
  const options = provider === "frontier"
    ? {
      provider,
      model: status.frontier.configured ? status.frontier.model : "",
      apiKey: frontierCredentials(environment).apiKey,
      environment,
      fetchImpl,
      timeoutMs,
    }
    : {
      provider,
      model: status.local.configured ? status.local.model : "",
      endpoint: environment.POLICYCOMPASS_OLLAMA_URL ?? "http://127.0.0.1:11434",
      fetchImpl,
      timeoutMs,
    };
  const state = await medicationClaimReviewGraph().invoke({ comparison }, {
    configurable: { medicationReviewOptions: options },
  });
  return {
    schema: COMPARISON_SCHEMA,
    provider,
    draft: state.draft,
    disclaimer: "청구 전 사전점검 초안입니다. 급여 인정이나 삭감을 확정하지 않으며 처방 결정은 의료진이 합니다.",
  };
}
