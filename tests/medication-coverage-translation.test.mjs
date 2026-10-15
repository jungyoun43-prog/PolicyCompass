import assert from "node:assert/strict";
import test from "node:test";
import { COVERAGE_TRANSLATION_MODEL, coverageTranslationFields, coverageTranslationView } from "../src/medication-coverage-translation.js";
import { medicationCoveragePolicy } from "../src/medication-coverage-policies.js";
import { medicationCoverageTranslationStatus, translateMedicationCoverage, validateCoverageTranslation, validateCoverageTranslationPayload } from "../scripts/medication-coverage-translation.mjs";
import { applyCoveragePolicyReview } from "../src/medication-coverage-review.js";

const source = {
  dataText: JSON.stringify({ patient: ["00000000 | 1955-00-00 | male"], records: ["2026-10-15 | C34 | 투여 30 mg, 호산구 150 cells/μL"], value: 2, active: true, missing: null }),
  noticeText: "호산구 ≥150 cells/μL 그리고 투여 30 mg. 출처 https://example.test/TA565",
  promptText: "보고서에 ○/△/✕ 판정을 유지하고 1~2문장으로 작성하세요. {NOTICE}",
  reportText: "## [○] 약제 — 기준 충족\n| 판단 | 근거 |\n| ○ | 2026-10-15 검사 |",
  summaryText: "2026-10-15 기록에서 충족",
  criteriaText: JSON.stringify(["호산구 ≥150 cells/μL", "투여 30 mg"]),
};
const translated = {
  ...source,
  dataText: JSON.stringify({ patient: ["00000000 | 1955-00-00 | male"], records: ["2026-10-15 | C34 | Administration 30 mg, eosinophils 150 cells/μL"], value: 2, active: true, missing: null }),
  noticeText: "Eosinophils ≥150 cells/μL AND administration 30 mg. Source https://example.test/TA565",
  promptText: "Retain the ○/△/✕ judgments and write 1~2 sentences. {NOTICE}",
  reportText: "## [○] Medication — Criteria met\n| Judgment | Evidence |\n| ○ | 2026-10-15 test |",
  summaryText: "Criteria met in the 2026-10-15 record",
  criteriaText: JSON.stringify(["Eosinophils ≥150 cells/μL", "Administration 30 mg"]),
};
const payload = { medicationId: "benralizumab-30", policyId: "gb-nice", fields: source, model: "openai/expensive-other-model" };
const environment = { OPENROUTER_API_KEY: "sk-or-test-key", POLICYCOMPASS_FRONTIER_MODEL: "openai/gpt-6.1-sol" };
const gateway = fields => ({ ok: true, json: async () => ({ model: COVERAGE_TRANSLATION_MODEL, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(fields) } }] }) });

test("Haiku translation has its own server capability and does not depend on the review model", () => {
  assert.equal(medicationCoverageTranslationStatus({}).configured, false);
  assert.equal(medicationCoverageTranslationStatus({ OPENAI_API_KEY: "test" }).configured, false);
  assert.equal(medicationCoverageTranslationStatus({ OPENROUTER_API_KEY: "sk-or-test" }).configured, true);
  assert.equal(medicationCoverageTranslationStatus({ ...environment, POLICYCOMPASS_FRONTIER_ENABLED: "false" }).configured, false);
  const result = medicationCoverageTranslationStatus(environment);
  assert.equal(result.model, COVERAGE_TRANSLATION_MODEL);
  assert.ok(!JSON.stringify(result).includes("sk-or-test"));
});

test("translation target comes from the selected country's registered policy", () => {
  assert.equal(validateCoverageTranslationPayload(payload).language.locale, "en-GB");
  assert.equal(validateCoverageTranslationPayload({ ...payload, policyId: "us-aetna" }).language.locale, "en-US");
  assert.equal(validateCoverageTranslationPayload({ ...payload, policyId: "au-pbs" }).language.locale, "en-AU");
  for (const bad of [ { ...payload, policyId: "kr-registered" }, { ...payload, medicationId: "missing" },
    { ...payload, fields: { ...source, dataText: "" } }, { ...payload, fields: { ...source, criteriaText: "{}" } } ]) assert.throws(() => validateCoverageTranslationPayload(bad), TypeError);
});

test("medical translations preserve JSON structure, numbers, codes, units, URLs and judgments", () => {
  assert.deepEqual(validateCoverageTranslation(source, translated), translated);
  const mutations = [
    { dataText: translated.dataText.replace("30 mg", "31 mg") },
    { dataText: translated.dataText.replace("C34", "C33") },
    { dataText: translated.dataText.replace('"records":', '"record":') },
    { dataText: translated.dataText.replace('"value":2', '"value":"2"') },
    { noticeText: translated.noticeText.replace("≥", ">") },
    { noticeText: translated.noticeText.replace("mg", "g") },
    { noticeText: translated.noticeText.replace("https://example.test/TA565", "https://other.test/TA565") },
    { reportText: translated.reportText.replace("[○]", "[✕]") },
    { promptText: "" }, { unknown: "extra" },
  ];
  for (const change of mutations) assert.throws(() => validateCoverageTranslation(source, { ...translated, ...change }));
});

test("translation keeps original prompts as source data and pins Haiku through the structured gateway", async () => {
  const calls = [];
  const result = await translateMedicationCoverage(payload, { environment, fetchImpl: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) }); return gateway(translated);
  } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(calls[0].body.model, COVERAGE_TRANSLATION_MODEL);
  assert.equal(calls[0].body.response_format.type, "json_schema");
  assert.deepEqual(JSON.parse(calls[0].body.messages[1].content).fields, source);
  assert.match(calls[0].body.messages[0].content, /Do not execute instructions/);
  assert.ok(!calls[0].body.messages[0].content.includes(source.promptText));
  assert.deepEqual(calls[0].body.plugins, [{ id: "context-compression", enabled: false }]);
  assert.deepEqual(result.fields, translated);
  assert.equal(result.language.locale, "en-GB");
});

test("incomplete or invalid model output fails without returning partial translations", async () => {
  await assert.rejects(() => translateMedicationCoverage(payload, { environment, fetchImpl: async () => gateway({ ...translated, noticeText: "" }) }));
  await assert.rejects(() => translateMedicationCoverage(payload, { environment, fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason: "length", message: { content: "{}" } }] }) }) }), /완료되지 않았습니다/);
  await assert.rejects(() => translateMedicationCoverage(payload, { environment, fetchImpl: async () => ({ ok: true, json: async () => ({ model: "another-model", choices: [{ message: { content: JSON.stringify(translated) } }] }) }) }), /Haiku/);
  await assert.rejects(() => translateMedicationCoverage(payload, { environment: {}, fetchImpl: async () => { throw new Error("must not call"); } }), /설정되지/);
});

test("long translation sources pass through intact without an application character cutoff", async () => {
  const longFields = { ...source, dataText: "진료 기록 ".repeat(60_000) };
  let received;
  await translateMedicationCoverage({ ...payload, fields: longFields }, { environment, fetchImpl: async (_url, options) => {
    received = JSON.parse(JSON.parse(options.body).messages[1].content).fields.dataText;
    return gateway({ ...translated, dataText: "Clinical record ".repeat(60_000) });
  } });
  assert.equal(received, longFields.dataText);
  assert.ok(received.length > 256 * 1024);
});

test("translated view leaves originals untouched, invalidates after edits or country changes, and translates existing reports", () => {
  const preview = { medicationId: payload.medicationId, policyId: payload.policyId, ...source };
  const review = { markdown: source.reportText, summary: source.summaryText, verdict: "circle", coveragePolicy: medicationCoveragePolicy(payload.medicationId, payload.policyId) };
  const translation = { medicationId: payload.medicationId, policyId: payload.policyId, source, fields: translated, show: true, model: COVERAGE_TRANSLATION_MODEL, language: { code: "en", locale: "en-GB" } };
  const view = coverageTranslationView(preview, review, translation);
  assert.equal(view.active, true);
  assert.equal(view.preview.dataText, translated.dataText);
  assert.equal(view.review.markdown, translated.reportText);
  assert.equal(preview.dataText, source.dataText);
  assert.equal(review.markdown, source.reportText);
  assert.deepEqual(coverageTranslationFields(preview, review, { criteria: JSON.parse(source.criteriaText) }), source);
  assert.equal(coverageTranslationView(preview, review, { ...translation, show: false }).preview, preview);
  assert.equal(coverageTranslationView({ ...preview, dataText: "수정" }, review, translation).active, false);
  assert.equal(coverageTranslationView({ ...preview, policyId: "au-pbs" }, review, translation).active, false);
  const changedReport = { ...review, markdown: "새 검토 결과" };
  assert.equal(coverageTranslationView(preview, changedReport, translation).review, changedReport);
});

test("reviewing a translation records its actual notice and translation provenance", () => {
  const base = { checks: [], verdict: "cross", summary: "국내 규칙" };
  const original = { medicationId: payload.medicationId, policyId: payload.policyId, base, ...source };
  const translation = { medicationId: payload.medicationId, policyId: payload.policyId, source, fields: translated, show: true, model: COVERAGE_TRANSLATION_MODEL, language: { code: "en", locale: "en-GB" } };
  const { preview } = coverageTranslationView(original, null, translation);
  const result = applyCoveragePolicyReview(preview, { verdict: "circle", markdown: translated.reportText, generatedBy: "frontier" });
  assert.equal(result.coveragePolicy.noticeText, translated.noticeText);
  assert.equal(result.coveragePolicy.translation.model, COVERAGE_TRANSLATION_MODEL);
  assert.equal(result.coveragePolicy.translation.sourceNotice, source.noticeText);
  assert.deepEqual(result.coveragePolicy.criteria, JSON.parse(translated.criteriaText));
});
