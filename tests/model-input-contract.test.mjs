import assert from "node:assert/strict";
import test from "node:test";
import { readJson, modelResponse, withApiErrors } from "../lib/api.js";
import { assertModelContextAccepted, ModelContextError } from "../lib/model-errors.js";

test("약제 검토의 명시적 크기 제한 해제는 원문을 보존하고 다른 경로의 기본 제한은 유지한다", async () => {
  const payload = { patientData: `${"기록\n".repeat(100_000)}끝` };
  const request = () => new Request("https://example.test/api/review", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  });
  assert.deepEqual(await readJson(request(), { maxLength: null }), payload);
  await assert.rejects(readJson(request()), { status: 413, code: "PAYLOAD_TOO_LARGE" });
});

test("모델 입력 초과는 환자 자료를 노출하지 않는 명시적 422 응답이다", async () => {
  const handler = withApiErrors(() => modelResponse(async () => {
    assertModelContextAccepted(400, { error: { code: "context_length_exceeded", message: "sensitive patient text" } });
  }, { invalidCode: "INVALID", failureCode: "FAILED", failureMessage: "failed" }));
  const response = await handler(new Request("https://example.test/api/review"));
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.code, "MODEL_CONTEXT_TOO_LARGE");
  assert.match(body.message, /자동으로 자르지 않았습니다/);
  assert.doesNotMatch(body.message, /sensitive patient text/);
});

test("일반 인증·요청 오류를 입력 한도 오류로 바꾸지 않는다", () => {
  assert.doesNotThrow(() => assertModelContextAccepted(401, { error: { message: "invalid key" } }));
  assert.doesNotThrow(() => assertModelContextAccepted(429, { error: { message: "rate limited" } }));
  for (const error of [
    { message: "This endpoint's maximum context length is 131072 tokens" },
    "input is too long",
    { code: "context_window_exceeded" },
  ]) assert.throws(() => assertModelContextAccepted(400, { error }), ModelContextError);
  for (const payload of [
    { error: { message: "masked", metadata: { error_type: "context_length_exceeded" } } },
    { status: "failed", error_type: "context_length_exceeded", error: { code: "invalid_prompt", message: "masked" } },
    { error: { metadata: { raw: '{"error":{"code":"context_length_exceeded"}}' } } },
    { error: { metadata: { raw: { error: { code: "context_length_exceeded" } } } } },
    { choices: [{ error: { metadata: { error_type: "context_length_exceeded" } } }] },
  ]) assert.throws(() => assertModelContextAccepted(400, payload), ModelContextError);
});
