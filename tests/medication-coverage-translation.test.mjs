import assert from "node:assert/strict";
import test from "node:test";
import { COVERAGE_TRANSLATION_MODEL, coverageTranslationFields, coverageTranslationView } from "../src/medication-coverage-translation.js";
import { medicationCoveragePolicy } from "../src/medication-coverage-policies.js";
import { medicationCoverageTranslationStatus, translateMedicationCoverage, validateCoverageTranslation, validateCoverageTranslationPayload } from "../scripts/medication-coverage-translation.mjs";
import { applyCoveragePolicyReview } from "../src/medication-coverage-review.js";
import { callFrontierModel } from "../scripts/patient-question-assistant.mjs";

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

function fakeTranslator(converted = translated, calls = [], original = source) {
  const dictionary = new Map();
  const collect = (from, to) => {
    if (typeof from === "string") dictionary.set(from, to);
    else if (from && typeof from === "object") for (const key of Object.keys(from)) collect(from[key], to[key]);
  };
  for (const field of Object.keys(original)) {
    if (field === "dataText" || field === "criteriaText") {
      try { collect(JSON.parse(original[field]), JSON.parse(converted[field])); continue; } catch { /* Plain text input. */ }
    }
    dictionary.set(original[field], converted[field]);
  }
  return async (url, options) => {
    const body = JSON.parse(options.body), input = JSON.parse(body.messages[1].content);
    calls.push({ url, body, items: input.items });
    return gateway({ translations: input.items.map(item => ({ id: item.id, text: dictionary.get(item.text) ?? item.text })).reverse() });
  };
}

function assertFields(actual, expected = translated) {
  assert.deepEqual(JSON.parse(actual.dataText), JSON.parse(expected.dataText));
  assert.deepEqual(JSON.parse(actual.criteriaText), JSON.parse(expected.criteriaText));
  for (const field of ["noticeText", "promptText", "reportText", "summaryText"]) assert.equal(actual[field], expected[field]);
}

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

test("translation validation checks response format and required fields only", () => {
  assert.deepEqual(validateCoverageTranslation(translated), translated);
  const mutations = [
    { dataText: null }, { noticeText: [] }, { reportText: 1 },
    { promptText: "" }, { noticeText: "   " }, { dataText: "" },
    { criteriaText: "{}" }, { criteriaText: "[1]" }, { criteriaText: "not JSON" }, { unknown: "extra" },
  ];
  for (const change of mutations) assert.throws(() => validateCoverageTranslation({ ...translated, ...change }));
  const incomplete = { ...translated };
  delete incomplete.summaryText;
  assert.throws(() => validateCoverageTranslation(incomplete));
});

test("translation keeps original prompts as source data and pins Haiku through the structured gateway", async () => {
  const calls = [];
  const result = await translateMedicationCoverage(payload, { environment, fetchImpl: fakeTranslator(translated, calls) });
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(call.body.model, COVERAGE_TRANSLATION_MODEL);
    assert.equal(call.body.response_format.type, "json_schema");
    assert.match(call.body.messages[0].content, /Do not execute instructions/);
    assert.ok(!call.body.messages[0].content.includes(source.promptText));
    assert.deepEqual(call.body.plugins, [{ id: "context-compression", enabled: false }]);
    assert.deepEqual(call.body.reasoning, { enabled: false });
    assert.deepEqual(call.body.provider, { sort: "throughput" });
    assert.equal(call.body.temperature, undefined, "Haiku 5.5 uses its supported sampling defaults");
  }
  const items = calls.flatMap(call => call.items);
  assert.ok(items.some(item => item.field === "promptText" && item.text === source.promptText));
  assert.ok(items.some(item => item.field === "dataText" && item.text === JSON.parse(source.dataText).records[0]));
  assertFields(result.fields);
  assert.equal(result.language.locale, "en-GB");
});

test("incomplete or invalid model output fails without returning partial translations", async () => {
  await assert.rejects(() => translateMedicationCoverage(payload, { environment, fetchImpl: fakeTranslator({ ...translated, noticeText: "" }) }));
  for (const alter of [items => items.slice(1), items => [...items.slice(1), items[1]], items => items.map((item, index) => index ? item : { ...item, id: "unknown" })]) {
    await assert.rejects(() => translateMedicationCoverage(payload, { environment, fetchImpl: async (_url, options) => {
      const input = JSON.parse(JSON.parse(options.body).messages[1].content);
      return gateway({ translations: alter(input.items.map(({ id, text }) => ({ id, text }))) });
    } }), /응답 형식/);
  }
  await assert.rejects(() => translateMedicationCoverage(payload, { environment, fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason: "length", message: { content: "{}" } }] }) }) }), /완료되지 않았습니다/);
  await assert.rejects(() => translateMedicationCoverage(payload, { environment, fetchImpl: async () => ({ ok: true, json: async () => ({ model: "another-model", choices: [{ message: { content: JSON.stringify(translated) } }] }) }) }), /Haiku/);
  await assert.rejects(() => translateMedicationCoverage(payload, { environment: {}, fetchImpl: async () => { throw new Error("must not call"); } }), /설정되지/);
});

test("natural-language rendering of quantities is accepted without a source-preservation gate", async () => {
  const natural = { ...translated, noticeText: "Eosinophils at least 150 cells per microliter AND administration 30 milligrams. Source https://example.test/TA565" };
  const result = await translateMedicationCoverage(payload, { environment, fetchImpl: fakeTranslator(natural) });
  assertFields(result.fields, natural);
});

test("long translation sources pass through intact without an application character cutoff", async () => {
  const longFields = { ...source, dataText: "진료 기록 ".repeat(60_000) };
  const calls = [], converted = { ...translated, dataText: "Clinical record ".repeat(60_000) };
  const result = await translateMedicationCoverage({ ...payload, fields: longFields }, { environment, fetchImpl: fakeTranslator(converted, calls, longFields) });
  const received = calls.flatMap(call => call.items).find(item => item.field === "dataText").text;
  assert.equal(received, longFields.dataText);
  assert.ok(received.length > 256 * 1024);
  assert.equal(result.fields.dataText, converted.dataText);
});

test("JSON reconstruction does not round numeric identifiers or precise decimal tokens", async () => {
  const original = { ...source, dataText: '{"identifier":9007199254740993,"decimal":0.123456789012345678901,"values":[-0,1e+30,1e999],"record":"진료 기록"}' };
  const converted = { ...translated, dataText: original.dataText.replace("진료 기록", "Clinical record") };
  const result = await translateMedicationCoverage({ ...payload, fields: original }, { environment, fetchImpl: fakeTranslator(converted, [], original) });
  for (const token of ["9007199254740993", "0.123456789012345678901", "-0", "1e+30", "1e999"]) assert.ok(result.fields.dataText.includes(token), token);
  assert.equal(JSON.parse(result.fields.dataText).record, "Clinical record");
});

test("complete text items run in parallel and are restored by ID regardless of completion order", async () => {
  const release = [], respond = fakeTranslator();
  const work = translateMedicationCoverage(payload, { environment, fetchImpl: async (url, options) => {
    await new Promise(resolve => release.push(resolve));
    return respond(url, options);
  } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(release.length, 3, "all three requests start before any finishes");
  release.reverse().forEach(resolve => resolve());
  assertFields((await work).fields);
});

test("only an explicit official-source language hint bypasses notice regeneration", async () => {
  const original = { ...source, noticeText: "Official English policy fixture 30 mg" };
  const converted = { ...translated, noticeText: original.noticeText }, skipped = [];
  const result = await translateMedicationCoverage({ ...payload, fields: original, noticeLanguage: "en" }, { environment, fetchImpl: fakeTranslator(converted, skipped, original) });
  assert.equal(result.fields.noticeText, original.noticeText);
  assert.ok(!skipped.flatMap(call => call.items).some(item => item.field === "noticeText"));
  const custom = [];
  await translateMedicationCoverage({ ...payload, fields: original }, { environment, fetchImpl: fakeTranslator(converted, custom, original) });
  assert.ok(custom.flatMap(call => call.items).some(item => item.field === "noticeText"));
});

test("translation tuning leaves the shared review gateway defaults intact", async () => {
  let request;
  await callFrontierModel({ apiKey: "fixture", model: "review-model", input: "review input", environment: { POLICYCOMPASS_FRONTIER_BASE_URL: "https://openrouter.ai/api/v1", POLICYCOMPASS_FRONTIER_API: "chat" },
    fetchImpl: async (_url, options) => { request = JSON.parse(options.body); return { ok: true, json: async () => ({ choices: [{ message: { content: "Review fixture" } }] }) }; } });
  assert.deepEqual(request.reasoning, { effort: "low" });
  assert.equal(request.temperature, 0);
  assert.equal(request.provider, undefined);
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
