import { randomUUID } from "node:crypto";

import {
  Annotation,
  Command,
  END,
  MemorySaver,
  START,
  StateGraph,
  interrupt,
} from "@langchain/langgraph";

import {
  cleanText,
  ollamaEndpoint,
  safeGeneratedText,
} from "../patient-question-assistant.mjs";

const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    explanation: { type: "string" },
    nextSteps: { type: "array", maxItems: 6, items: { type: "string" } },
    evidenceEventIds: { type: "array", maxItems: 12, items: { type: "string" } },
  },
  required: ["explanation", "nextSteps", "evidenceEventIds"],
};

const CLAIM_DECISION_CLAIM = /(급여|청구)[를을]?\s*(확정|승인|거절)(합니다|했습니다)/;
const REVIEW_ACTIONS = new Set(["approve", "revise", "discard"]);
const THREAD_TTL_MS = 2 * 60 * 60 * 1_000;
const MAX_THREADS = 200;

export function sanitizeClaimReviewInput(payload = {}) {
  const source = payload?.evaluation && typeof payload.evaluation === "object" && !Array.isArray(payload.evaluation)
    ? payload.evaluation
    : null;
  if (!source) throw new TypeError("검토할 청구 적합성 평가가 필요합니다.");
  const evaluation = {
    id: cleanText(source.id, 160),
    title: cleanText(source.title, 240),
    status: cleanText(source.status, 80),
    explanation: cleanText(source.explanation, 600),
    missingEvidence: (Array.isArray(source.missingEvidence) ? source.missingEvidence : [])
      .map((item) => cleanText(item, 200)).filter(Boolean).slice(0, 8),
    nextEligibleDate: cleanText(source.nextEligibleDate, 10),
    evidenceEventIds: (Array.isArray(source.evidenceEventIds) ? source.evidenceEventIds : [])
      .map((item) => cleanText(item, 160)).filter(Boolean).slice(0, 12),
  };
  if (!evaluation.id || !evaluation.title || !evaluation.status) {
    throw new TypeError("평가에는 id, title, status가 필요합니다.");
  }
  const events = (Array.isArray(payload?.events) ? payload.events : []).slice(0, 80).map((event) => ({
    id: cleanText(event?.id, 160),
    label: cleanText(event?.label, 240),
    date: cleanText(event?.date, 10),
  })).filter(({ id, label }) => id && label);
  return { evaluation, events };
}

function ruleDraft(evaluation, revisionNote = "") {
  const nextSteps = evaluation.missingEvidence
    .map((item) => `${item} 준비 여부를 확인하고 기록에 첨부 근거를 연결하세요.`);
  if (evaluation.nextEligibleDate) {
    nextSteps.push(`다음 가능일(${evaluation.nextEligibleDate}) 이후에 이 항목을 재평가하세요.`);
  }
  if (!nextSteps.length) nextSteps.push("규칙 결과와 연결된 근거를 의료진이 직접 대조 확인하세요.");
  return {
    explanation: [
      `'${evaluation.title}' 항목은 규칙 엔진 기준 현재 '${evaluation.status}' 상태입니다.`,
      evaluation.explanation,
      revisionNote ? `검토 의견 반영: ${revisionNote}` : "",
    ].filter(Boolean).join(" "),
    nextSteps: nextSteps.slice(0, 6),
    evidenceEventIds: evaluation.evidenceEventIds,
    draftedBy: "rule",
  };
}

function draftInstructions() {
  return [
    "당신은 청구 전 적합성 점검을 보조하는 한국어 문서화 도구입니다.",
    "규칙 엔진이 계산한 상태를 바꾸거나 급여 여부를 확정하지 않습니다.",
    "explanation에는 왜 이 상태인지와 무엇이 부족한지를 의료진이 읽기 쉽게 설명합니다.",
    "nextSteps에는 의료진이 확인할 보완 행동만 적고, 처방 변경이나 진단 판단은 넣지 않습니다.",
    "evidenceEventIds에는 입력에 있던 근거 ID만 사용합니다.",
    "응답은 지정된 JSON 스키마만 따릅니다.",
  ].join(" ");
}

async function modelDraft(evaluation, events, options, revisionNote) {
  const allowed = new Set([...evaluation.evidenceEventIds, ...events.map(({ id }) => id)]);
  let feedback = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const messages = [
        { role: "system", content: draftInstructions() },
        { role: "user", content: JSON.stringify({ evaluation, events, revisionNote }) },
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
          format: DRAFT_SCHEMA,
          options: { temperature: 0 },
        }),
        redirect: "error",
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      if (!response.ok) throw new Error(`청구 검토 모델 요청 실패 (${response.status})`);
      const body = await response.json();
      const parsed = JSON.parse(cleanText(body?.message?.content, 10_000));
      const explanation = safeGeneratedText(parsed?.explanation, 800);
      if (!explanation || CLAIM_DECISION_CLAIM.test(explanation)) {
        throw new Error("설명이 비었거나 급여 여부를 확정합니다.");
      }
      const nextSteps = (Array.isArray(parsed?.nextSteps) ? parsed.nextSteps : [])
        .map((item) => safeGeneratedText(item, 300)).filter(Boolean).slice(0, 6);
      const evidenceEventIds = (Array.isArray(parsed?.evidenceEventIds) ? parsed.evidenceEventIds : [])
        .map((item) => cleanText(item, 160)).filter(Boolean);
      if (evidenceEventIds.some((id) => !allowed.has(id))) {
        throw new Error("입력에 없는 근거 ID를 인용했습니다.");
      }
      return { explanation, nextSteps, evidenceEventIds, draftedBy: "local-model" };
    } catch (error) {
      feedback = cleanText(error.message, 300);
    }
  }
  const fallback = ruleDraft(evaluation, revisionNote);
  return { ...fallback, note: `모델 초안 실패로 규칙 초안을 사용했습니다: ${feedback}` };
}

const ClaimReviewState = Annotation.Root({
  evaluation: Annotation(),
  events: Annotation(),
  draft: Annotation(),
  decision: Annotation(),
  revisions: Annotation({ reducer: (a, b) => [...(a ?? []), ...(b ?? [])], default: () => [] }),
  result: Annotation(),
});

let compiledClaimReviewGraph = null;

function claimReviewGraph() {
  compiledClaimReviewGraph ??= new StateGraph(ClaimReviewState)
    .addNode("drafting", async (state, config) => {
      const options = config?.configurable?.claimReviewOptions ?? {};
      const revisionNote = state.decision?.action === "revise" ? state.decision.note : "";
      const draft = options.model
        ? await modelDraft(state.evaluation, state.events, options, revisionNote)
        : ruleDraft(state.evaluation, revisionNote);
      return {
        draft,
        ...(revisionNote ? { revisions: [{ note: revisionNote, at: new Date().toISOString() }] } : {}),
      };
    })
    .addNode("review", (state) => {
      const decision = interrupt({
        type: "claim-review",
        evaluationId: state.evaluation.id,
        title: state.evaluation.title,
        status: state.evaluation.status,
        draft: state.draft,
      });
      return { decision };
    })
    .addNode("finalize", (state) => ({
      result: {
        evaluationId: state.evaluation.id,
        action: state.decision.action,
        status: state.decision.action === "approve" ? "clinician-confirmed" : "discarded",
        confirmed: state.decision.action === "approve",
        note: state.decision.note ?? "",
        draft: state.draft,
        revisions: state.revisions,
        decidedAt: new Date().toISOString(),
        disclaimer: "의료진이 직접 확정한 검토 결과이며, 급여 여부의 최종 판단은 청구 절차에서 이루어집니다.",
      },
    }))
    .addEdge(START, "drafting")
    .addEdge("drafting", "review")
    .addConditionalEdges("review", (state) => (
      state.decision?.action === "revise" ? "drafting" : "finalize"
    ), ["drafting", "finalize"])
    .addEdge("finalize", END)
    .compile({ checkpointer: new MemorySaver() });
  return compiledClaimReviewGraph;
}

const reviewThreads = new Map();

function sweepThreads(now = Date.now()) {
  for (const [threadId, entry] of reviewThreads) {
    if (now - entry.createdAt > THREAD_TTL_MS) reviewThreads.delete(threadId);
  }
  while (reviewThreads.size > MAX_THREADS) {
    const oldest = reviewThreads.keys().next().value;
    reviewThreads.delete(oldest);
  }
}

function reviewOptions(environment, fetchImpl, timeoutMs) {
  return {
    model: cleanText(environment.POLICYCOMPASS_OLLAMA_MODEL ?? "", 160),
    endpoint: environment.POLICYCOMPASS_OLLAMA_URL ?? "http://127.0.0.1:11434",
    fetchImpl,
    timeoutMs,
  };
}

function interruptedResponse(threadId, state) {
  const pending = state.__interrupt__?.[0]?.value;
  if (!pending) return null;
  return { threadId, status: "awaiting-review", review: pending };
}

export async function startClaimReview(payload = {}, {
  environment = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = 30_000,
} = {}) {
  const { evaluation, events } = sanitizeClaimReviewInput(payload);
  sweepThreads();
  const threadId = randomUUID();
  const options = reviewOptions(environment, fetchImpl, timeoutMs);
  reviewThreads.set(threadId, { createdAt: Date.now(), options });
  const state = await claimReviewGraph().invoke({ evaluation, events }, {
    configurable: { thread_id: threadId, claimReviewOptions: options },
  });
  const pending = interruptedResponse(threadId, state);
  if (!pending) throw new Error("검토 그래프가 의료진 확인 단계에 도달하지 못했습니다.");
  return pending;
}

export async function resumeClaimReview(threadId, decision = {}, {
  fetchImpl,
  timeoutMs,
} = {}) {
  const entry = reviewThreads.get(cleanText(threadId, 80));
  if (!entry) throw new TypeError("알 수 없거나 만료된 검토 스레드입니다.");
  const action = cleanText(decision.action, 20);
  if (!REVIEW_ACTIONS.has(action)) {
    throw new TypeError("검토 결정은 approve, revise, discard 중 하나여야 합니다.");
  }
  const note = cleanText(decision.note, 500);
  if (action === "revise" && !note) {
    throw new TypeError("revise 결정에는 수정 의견(note)이 필요합니다.");
  }
  const options = {
    ...entry.options,
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
  };
  const state = await claimReviewGraph().invoke(new Command({ resume: { action, note } }), {
    configurable: { thread_id: threadId, claimReviewOptions: options },
  });
  const pending = interruptedResponse(threadId, state);
  if (pending) return pending;
  reviewThreads.delete(threadId);
  return { threadId, status: "completed", result: state.result };
}
