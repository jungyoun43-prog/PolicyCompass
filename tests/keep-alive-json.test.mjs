import assert from "node:assert/strict";
import test from "node:test";
import { keepAliveJson } from "../lib/keep-alive-json.js";
import { ApiError, jsonResponse, withApiErrors } from "../lib/api.js";

test("long model work sends periodic bytes and still yields one valid JSON document", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let complete;
  const result = new Promise(resolve => { complete = resolve; });
  const response = keepAliveJson(() => result);
  assert.equal(response.headers.get("content-encoding"), "identity");
  assert.match(response.headers.get("cache-control"), /no-transform/);
  const reader = response.body.getReader(), chunks = [];
  chunks.push((await reader.read()).value);
  t.mock.timers.tick(70_000);
  for (let index = 0; index < 7; index += 1) chunks.push((await reader.read()).value);
  assert.ok(chunks.every(chunk => new TextDecoder().decode(chunk) === "\n"), "idle-timeout period has data flowing without inventing model output");
  complete(jsonResponse(200, { fields: { dataText: "Translated fixture" }, model: "haiku" }));
  chunks.push((await reader.read()).value);
  assert.equal((await reader.read()).done, true);
  assert.equal(JSON.parse(chunks.map(chunk => new TextDecoder().decode(chunk)).join("")).fields.dataText, "Translated fixture");
  t.mock.timers.tick(20_000);
  assert.equal((await reader.read()).done, true, "pulse stops after completion");
});

test("delayed model errors retain their API error code in the completed JSON body", async () => {
  const request = new Request("http://localhost/api/translate");
  const response = keepAliveJson(() => withApiErrors(() => { throw new ApiError(502, "COVERAGE_TRANSLATION_FAILED", "Synthetic model failure"); })(request));
  assert.equal(response.status, 200, "headers have already been sent to keep the connection alive");
  assert.deepEqual(await response.json(), { code: "COVERAGE_TRANSLATION_FAILED", message: "Synthetic model failure" });
});

test("disconnecting stops pulses and discards a late model response", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let complete;
  const response = keepAliveJson(() => new Promise(resolve => { complete = resolve; }));
  const reader = response.body.getReader();
  await reader.read();
  await reader.cancel();
  t.mock.timers.tick(70_000);
  complete(jsonResponse(200, { late: true }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await reader.read()).done, true);
});
