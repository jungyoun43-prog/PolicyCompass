import { Annotation, END, Send, START, StateGraph } from "@langchain/langgraph";

import {
  buildPatientQuestionContext,
  cleanText,
  ollamaEndpoint,
  patientLocalModel,
  safeGeneratedText,
} from "../patient-question-assistant.mjs";

const VERIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    related: { type: "boolean" },
    explanation: { type: "string" },
    checkQuestion: { type: "string" },
  },
  required: ["related", "explanation", "checkQuestion"],
};

const CAUSAL_CLAIM = /(때문입니다|원인입니다|원인이다|유발했습니다|인해\s*발생)/;

function parseDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cleanText(value, 10));
  if (!match) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(time) ? time : null;
}

function gapDays(a, b) {
  const left = parseDay(a);
  const right = parseDay(b);
  if (left === null || right === null) return null;
  return Math.round(Math.abs(left - right) / 86_400_000);
}

function candidate(kind, a, b) {
  return {
    id: `${a.evidenceId}~${b.evidenceId}`,
    kind,
    aLabel: a.label,
    aDate: a.date,
    aEvidenceId: a.evidenceId,
    bLabel: b.label,
    bDate: b.date,
    bEvidenceId: b.evidenceId,
    gapDays: gapDays(a.date, b.date),
  };
}

export function buildConnectionCandidates(context, maxCandidates = 12) {
  const conditions = context.clinical.conditions.map((item) => ({ ...item, date: item.recordedOn }));
  const measurements = context.clinical.measurements.map((item) => ({ ...item, date: item.observedOn }));
  const medications = context.clinical.medications.map((item) => ({ ...item, date: item.prescribedOn }));
  const selfReport = context.selfReport
    ? { evidenceId: context.selfReport.evidenceId, label: "직접 적은 최근 변화", date: "" }
    : null;
  const candidates = [];
  for (const medication of medications) {
    for (const condition of conditions) candidates.push(candidate("medication-condition", medication, condition));
    if (selfReport) candidates.push(candidate("medication-self-report", medication, selfReport));
  }
  for (const measurement of measurements) {
    for (const condition of conditions) candidates.push(candidate("measurement-condition", measurement, condition));
    if (selfReport) candidates.push(candidate("measurement-self-report", measurement, selfReport));
  }
  return candidates
    .sort((a, b) => (a.gapDays ?? Number.MAX_SAFE_INTEGER) - (b.gapDays ?? Number.MAX_SAFE_INTEGER))
    .slice(0, maxCandidates);
}

function ruleInsight(item, note = "") {
  const timing = typeof item.gapDays === "number"
    ? `${item.gapDays}일 간격으로 함께 기록되어 있습니다.`
    : "같은 기록 안에 함께 있습니다.";
  return {
    id: item.id,
    kind: item.kind,
    basis: typeof item.gapDays === "number" ? "temporal" : "co-occurrence",
    text: `${item.aLabel} 기록과 ${item.bLabel} 기록이 ${timing}`,
    checkQuestion: `${item.aLabel} 기록과 ${item.bLabel} 기록이 서로 관련이 있는지 진료 때 확인해 볼까요?`,
    evidenceIds: [item.aEvidenceId, item.bEvidenceId],
    gapDays: item.gapDays,
    verifiedBy: "rule",
    ...(note ? { note } : {}),
  };
}

function verifyInstructions() {
  return [
    "당신은 환자 건강 지도에서 두 기록의 관련 가능성을 설명하는 한국어 보조 도구입니다.",
    "진단, 처방 변경, 인과관계 단정을 하지 않습니다.",
    "explanation에는 두 기록이 함께 있다는 사실과 시간 관계만 짧고 쉬운 존댓말로 씁니다.",
    "checkQuestion은 환자가 진료실에서 그대로 읽을 수 있는 확인 질문 한 문장으로 쓰고 물음표로 끝냅니다.",
    "두 기록이 일상적으로 함께 볼 이유가 없으면 related를 false로 표시합니다.",
    "응답은 지정된 JSON 스키마만 따릅니다.",
  ].join(" ");
}

async function callVerifyModel(item, options, feedback) {
  const messages = [
    { role: "system", content: verifyInstructions() },
    {
      role: "user",
      content: JSON.stringify({
        a: { label: item.aLabel, date: item.aDate },
        b: { label: item.bLabel, date: item.bDate },
        gapDays: item.gapDays,
      }),
    },
  ];
  if (feedback) {
    messages.push({ role: "user", content: `이전 응답이 거부되었습니다: ${feedback} 같은 JSON 스키마와 안전 규칙을 지켜 다시 작성하세요.` });
  }
  const response = await options.fetchImpl(`${ollamaEndpoint(options.endpoint)}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: options.model,
      messages,
      stream: false,
      think: false,
      format: VERIFY_SCHEMA,
      options: { temperature: 0 },
    }),
    redirect: "error",
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  if (!response.ok) throw new Error(`관계 검증 모델 요청 실패 (${response.status})`);
  const body = await response.json();
  const parsed = JSON.parse(cleanText(body?.message?.content, 10_000));
  if (typeof parsed?.related !== "boolean") throw new Error("related 값이 없습니다.");
  const explanation = safeGeneratedText(parsed.explanation, 400);
  const checkQuestion = safeGeneratedText(parsed.checkQuestion, 300);
  if (!explanation || CAUSAL_CLAIM.test(explanation)) throw new Error("설명이 비었거나 인과관계를 단정합니다.");
  if (!checkQuestion || !/[?？]$/.test(checkQuestion)) throw new Error("확인 질문이 물음표로 끝나지 않습니다.");
  return { related: parsed.related, explanation, checkQuestion };
}

async function verifyCandidate(item, options) {
  if (!options.model) return [ruleInsight(item)];
  let feedback = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const verdict = await callVerifyModel(item, options, feedback);
      if (!verdict.related) return [];
      return [{
        ...ruleInsight(item),
        text: verdict.explanation,
        checkQuestion: verdict.checkQuestion,
        verifiedBy: "local-model",
      }];
    } catch (error) {
      feedback = cleanText(error.message, 300);
    }
  }
  return [ruleInsight(item, `모델 검증 실패로 규칙 설명을 사용했습니다: ${feedback}`)];
}

const ConnectionState = Annotation.Root({
  context: Annotation(),
  options: Annotation(),
  candidates: Annotation(),
  candidate: Annotation(),
  insights: Annotation({ reducer: (a, b) => [...(a ?? []), ...(b ?? [])], default: () => [] }),
  output: Annotation(),
});

let compiledConnectionGraph = null;

function connectionGraph() {
  compiledConnectionGraph ??= new StateGraph(ConnectionState)
    .addNode("plan", (state) => ({ candidates: buildConnectionCandidates(state.context, state.options.maxCandidates) }))
    .addNode("verify", async (state) => ({ insights: await verifyCandidate(state.candidate, state.options) }))
    .addNode("gather", (state) => ({
      output: {
        mode: state.options.model ? "local-model" : "rule-based",
        generatedAt: new Date().toISOString(),
        insights: [...state.insights]
          .sort((a, b) => (a.gapDays ?? Number.MAX_SAFE_INTEGER) - (b.gapDays ?? Number.MAX_SAFE_INTEGER))
          .slice(0, state.options.maxInsights),
        disclaimer: "두 기록이 함께 있다는 사실 확인일 뿐 진단이나 인과관계 판단이 아닙니다. 진료에서 직접 확인하세요.",
      },
    }))
    .addConditionalEdges("plan", (state) => (
      state.candidates.length
        ? state.candidates.map((item) => new Send("verify", { candidate: item, options: state.options }))
        : ["gather"]
    ), ["verify", "gather"])
    .addEdge(START, "plan")
    .addEdge("verify", "gather")
    .addEdge("gather", END)
    .compile();
  return compiledConnectionGraph;
}

export async function runConnectionInsights(payload = {}, {
  environment = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = 30_000,
  maxCandidates = 12,
  maxInsights = 8,
} = {}) {
  const context = buildPatientQuestionContext(payload);
  const local = patientLocalModel(environment);
  const state = await connectionGraph().invoke({
    context,
    options: {
      model: cleanText(local.model, 160),
      endpoint: local.endpoint,
      fetchImpl,
      timeoutMs,
      maxCandidates,
      maxInsights,
    },
  });
  return state.output;
}
