import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createDemoEmrState } from "../src/emr-demo-state.js";
import { findMedicationInCatalog } from "../src/medication-catalog.js";
import { applyMedicationReviewDraft, buildMedicationClaimComparison } from "../src/medication-claim-review.js";
import { JEV_REVIEW_MODEL } from "../src/medication-review-decision.js";
import { medicationReviewInstructions } from "../src/medication-review-prompt.js";
import { runMedicationClaimReview } from "../scripts/graphs/medication-claim-review-graph.mjs";
import { MedicationDecisionResult } from "../components/emr/medication-decision-result.jsx";

const asOf = "2026-07-20";
const patient = createDemoEmrState(asOf).patients.find(({ name }) => name === "김비타");
const medication = findMedicationInCatalog("benralizumab-30");
const comparison = buildMedicationClaimComparison({ patient, medication, prescription: medication.dosing, asOf });
const environment = { OPENROUTER_API_KEY: "sk-or-test", POLICYCOMPASS_FRONTIER_MODEL: "openai/gpt-5.6-sol" };
const payload = { comparison, provider: "frontier", overrides: { model: JEV_REVIEW_MODEL } };
const answer = { type: "choice", choice: "circle", probabilities: { cross: 0.03, circle: 0.85, triangle: 0.12 } };
const stub = (value = answer) => async () => ({ ok: true, json: async () => ({ answers: { verdict: value } }) });

test("Jev uses Decisions API and OpenRouter key with edited inputs and three defined choices", async () => {
  const calls = [];
  const overrides = { ...payload.overrides, instructions: "사용자 판정 원칙\n{NOTICE}\n{PATIENT_DATA}", notice: "수정 고시", patientData: "수정 환자자료" };
  const result = await runMedicationClaimReview({ ...payload, overrides }, {
    environment,
    fetchImpl: async (url, options) => {
      calls.push({ url, ...options, body: JSON.parse(options.body) });
      return stub()();
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://openrouter.ai/api/alpha/decisions");
  assert.equal(calls[0].headers.authorization, "Bearer sk-or-test");
  assert.equal(calls[0].body.state, "사용자 판정 원칙\n수정 고시\n수정 환자자료");
  assert.deepEqual(Object.keys(calls[0].body.questions.verdict.criteria), ["circle", "triangle", "cross"]);
  assert.equal(calls[0].body.questions.verdict.type, "choice");
  assert.equal(calls[0].body.model, JEV_REVIEW_MODEL);
  assert.equal(calls[0].redirect, "error");
  assert.equal(result.draft.outputKind, "decision");
  assert.equal(result.draft.markdown, undefined);
  assert.deepEqual(result.draft.probabilities, { circle: 0.85, triangle: 0.12, cross: 0.03 });
});

test("Jev default prompt requests no report and does not disclose patient name or rule verdict", async () => {
  let state;
  await runMedicationClaimReview(payload, { environment, fetchImpl: async (_url, options) => {
    state = JSON.parse(options.body).state;
    return stub()();
  } });
  assert.match(state, /고시 제2026-92호/);
  assert.match(state, /설명문은 작성하지 않습니다/);
  assert.doesNotMatch(state, /김비타|### 출력 형식|ruleVerdict/);
  assert.match(medicationReviewInstructions(), /### 출력 형식/);
});

test("all three Jev choices survive rule merging and render matching probabilities without explanation", async () => {
  for (const choice of ["circle", "triangle", "cross"]) {
    const probabilities = Object.fromEntries(["circle", "triangle", "cross"].map((key) => [key, key === choice ? 0.8 : 0.1]));
    const result = await runMedicationClaimReview(payload, { environment, fetchImpl: stub({ type: "choice", choice, probabilities }) });
    const merged = applyMedicationReviewDraft(comparison, result.draft);
    assert.equal(merged.verdict, choice, "the rule verdict must not contradict the displayed Jev distribution");
    assert.equal(merged.ruleVerdict, comparison.verdict);
    assert.equal(merged.outputKind, "decision");
    assert.equal(merged.markdown, "");
    assert.deepEqual(merged.rationale, []);
    const html = renderToStaticMarkup(createElement(MedicationDecisionResult, { review: merged }));
    assert.match(html, /80\.0%/);
    assert.equal((html.match(/10\.0%/g) || []).length, 2);
    assert.equal((html.match(/<meter /g) || []).length, 3);
    assert.equal((html.match(/선택됨/g) || []).length, 1);
    assert.match(html, /실제 삭감률을 의미하지 않습니다/);
    assert.doesNotMatch(html, /<table|최종 판단|사유:/);
  }
});

test("malformed Jev answers retry then fall back without invented probabilities", async () => {
  for (const invalid of [
    null,
    { ...answer, type: "score" },
    { ...answer, choice: "unknown" },
    { ...answer, probabilities: { circle: 1 } },
    { ...answer, probabilities: { circle: "0.85", triangle: 0.12, cross: 0.03 } },
    { ...answer, probabilities: { circle: 0.9, triangle: 0.9, cross: 0.9 } },
    { ...answer, probabilities: { circle: -0.1, triangle: 0.2, cross: 0.9 } },
    { ...answer, probabilities: { circle: NaN, triangle: 0, cross: 0 } },
    { ...answer, probabilities: { circle: 0, triangle: 0, cross: 1 } },
  ]) {
    let count = 0;
    const result = await runMedicationClaimReview(payload, { environment, fetchImpl: async () => { count++; return stub(invalid)(); } });
    assert.equal(count, 2);
    assert.equal(result.draft.generatedBy, "rule");
    const merged = applyMedicationReviewDraft(comparison, result.draft);
    assert.equal(merged.verdict, comparison.verdict);
    assert.equal(merged.probabilities, null);
    assert.equal(merged.outputKind, "report");
  }
});

test("Jev HTTP failure and timeout use existing rule fallback", async () => {
  for (const fetchImpl of [
    async () => ({ ok: false, status: 429 }),
    async () => { throw new Error("timeout"); },
  ]) {
    const result = await runMedicationClaimReview(payload, { environment, fetchImpl });
    assert.equal(result.draft.generatedBy, "rule");
    assert.match(result.draft.note, /Jev 판정|timeout/);
  }
});

test("Jev never sends an OpenAI key to OpenRouter", async () => {
  let called = false;
  const result = await runMedicationClaimReview(payload, {
    environment: { OPENAI_API_KEY: "openai-test", POLICYCOMPASS_FRONTIER_ENABLED: "true", POLICYCOMPASS_FRONTIER_MODEL: "gpt-test" },
    fetchImpl: async () => { called = true; return stub()(); },
  });
  assert.equal(called, false);
  assert.equal(result.draft.generatedBy, "rule");
  assert.match(result.draft.note, /OPENROUTER_API_KEY/);
});
