import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import { isAllowedFrontierModel } from "../../src/frontier-model-catalog.js";
import { medicationReviewPrompt } from "../../src/medication-review-prompt.js";

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
const MAX_RECORDS = 60;

function sanitizeRecord(input) {
  const type = cleanText(input?.type, 40);
  const label = cleanText(input?.label, 240);
  const date = cleanText(input?.date, 10);
  if (!RECORD_TYPES.has(type) || !label || !date) return null;
  const record = { type, code: cleanText(input?.code, 120), label, date, status: cleanText(input?.status, 80) };
  if (typeof input?.value === "number" && Number.isFinite(input.value)) record.value = input.value;
  else if (cleanText(input?.value, 200)) record.value = cleanText(input.value, 200);
  if (cleanText(input?.unit, 80)) record.unit = cleanText(input.unit, 80);
  if (input?.prescription && typeof input.prescription === "object") {
    record.prescription = {
      dose: cleanText(input.prescription.dose, 40),
      doseUnit: cleanText(input.prescription.doseUnit, 30),
      route: cleanText(input.prescription.route, 60),
      frequency: cleanText(input.prescription.frequency, 80),
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
  const label = cleanText(source.medication?.label, 160);
  if (!label) throw new TypeError("검토할 약품명이 필요합니다.");
  return {
    schema: COMPARISON_SCHEMA,
    version: 1,
    asOf: cleanText(source.asOf, 10),
    medication: {
      id: cleanText(source.medication?.id, 80),
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
    records: (Array.isArray(source.records) ? source.records : [])
      .slice(0, MAX_RECORDS)
      .map(sanitizeRecord)
      .filter(Boolean),
    ...(typeof source.dataset === "string" && source.dataset.trim()
      ? { dataset: markdownText(source.dataset, 100_000) }
      : {}),
    checks,
    verdict,
  };
}

/** Operator-edited 프롬프트/고시정보/진료데이터 from the pre-send preview. */
function sanitizeOverrides(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const overrides = {};
  const instructionsText = markdownText(input.instructions, 8_000);
  const noticeText = markdownText(input.notice, 8_000);
  const patientDataText = markdownText(input.patientData, 40_000);
  if (instructionsText) overrides.instructions = instructionsText;
  if (noticeText) overrides.notice = noticeText;
  if (patientDataText) overrides.patientData = patientDataText;
  const model = cleanText(input.model, 120);
  if (model && isAllowedFrontierModel(model)) overrides.model = model;
  return overrides;
}

const VERDICT_SYMBOLS = {
  "\u25cb": "circle", "\u25ef": "circle", "\u3007": "circle", "O": "circle",
  "\u25b3": "triangle", "\u25b5": "triangle",
  "\u2715": "cross", "\u2717": "cross", "\u00d7": "cross", "X": "cross", "x": "cross",
};

function markdownText(value, maximum = 8_000) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maximum);
}

function validateDraft(raw, comparison) {
  const markdown = markdownText(raw);
  if (!markdown) throw new Error("모델 응답이 비었습니다.");
  const heading = markdown.match(/##\s*\[\s*(.)\s*\]/u);
  const symbol = heading ? heading[1] : "";
  const verdict = VERDICT_SYMBOLS[symbol];
  if (!verdict) throw new Error("출력 형식의 판정 헤더(## [\u25cb/\u25b3/\u2715])가 없습니다.");
  safeGeneratedText(markdown.slice(0, 500), 500);
  return { verdict, markdown };
}

async function localDraft(comparison, options, feedback) {
  const messages = [
    { role: "user", content: medicationReviewPrompt(comparison, options.overrides ?? {}) },
  ];
  if (feedback) {
    messages.push({ role: "user", content: `이전 초안이 거부되었습니다: ${feedback} 지정된 출력 형식을 지켜 다시 작성하세요.` });
  }
  const response = await options.fetchImpl(`${ollamaEndpoint(options.endpoint)}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: options.model,
      messages,
      stream: false,
      think: false,
      options: { temperature: 0 },
    }),
    redirect: "error",
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  if (!response.ok) throw new Error(`약제 검토 로컬 모델 요청 실패 (${response.status})`);
  const body = await response.json();
  return {
    text: typeof body?.message?.content === "string" ? body.message.content : "",
    model: cleanText(body?.model, 160) || options.model,
    generatedBy: "local-model",
  };
}

async function frontierDraft(comparison, options, feedback) {
  const base = medicationReviewPrompt(comparison, options.overrides ?? {});
  const input = feedback ? `${base}\n\n[재시도 안내] ${feedback}` : base;
  const result = await callFrontierModel({
    apiKey: options.apiKey,
    model: options.model,
    instructions: "",
    input,
    maxOutputTokens: 2_600,
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
      if (!options.model) {
        return { draft: { generatedBy: "rule", note: "AI 모델이 설정되지 않아 규칙 판정을 그대로 사용했습니다." } };
      }
      let feedback = "";
      let rawSample = "";
      // 서버리스 함수 한도(60초) 안에서만 재시도한다 — 한도를 넘겨 죽으면
      // 실패 사유조차 내려보낼 수 없다.
      const startedAt = Date.now();
      const budgetMs = options.budgetMs ?? 110_000;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const remaining = budgetMs - (Date.now() - startedAt);
        if (remaining < 8_000) break;
        const attemptOptions = { ...options, timeoutMs: Math.min(options.timeoutMs ?? 30_000, remaining - 3_000) };
        let raw = null;
        try {
          raw = options.provider === "frontier"
            ? await frontierDraft(state.comparison, attemptOptions, feedback)
            : await localDraft(state.comparison, attemptOptions, feedback);
          return { draft: { ...validateDraft(raw.text, state.comparison), model: raw.model, generatedBy: raw.generatedBy } };
        } catch (error) {
          feedback = cleanText(error?.message, 300);
          // 검증에 걸린 시도의 모델 원문 앞부분을 보존해 실패 사유와 함께 보여 준다.
          if (raw?.text) rawSample = markdownText(raw.text, 200).replace(/\n+/g, " ");
        }
      }
      return {
        draft: {
          generatedBy: "rule",
          note: `모델 검토 실패로 규칙 판정을 사용했습니다: ${feedback}${rawSample ? ` — 모델 응답 원문(앞부분): "${rawSample}"` : ""}`,
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
  const overrides = sanitizeOverrides(payload?.overrides);
  const provider = payload?.provider === "frontier" ? "frontier" : "local";
  const status = medicationClaimReviewStatus(environment);
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
    configurable: { medicationReviewOptions: options },
  });
  return {
    schema: COMPARISON_SCHEMA,
    provider,
    draft: state.draft,
    disclaimer: "청구 전 사전점검 초안입니다. 급여 인정이나 삭감을 확정하지 않으며 처방 결정은 의료진이 합니다.",
  };
}
