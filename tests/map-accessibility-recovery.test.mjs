import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
const script = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const design = await readFile(new URL("../DESIGN.md", import.meta.url), "utf8");

test("/map exposes an invalid state and returns focus for empty-submit recovery", () => {
  assert.match(html, /id="healthNote"[\s\S]*?aria-invalid="false"[\s\S]*?aria-describedby="inputHint formError"/);
  assert.match(html, /id="formError" role="alert"/);
  assert.match(script, /function showFormError\(message, \{ focusNote = false \} = \{\}\)/);
  assert.match(script, /elements\.note\.setAttribute\("aria-invalid", "true"\)/);
  assert.match(script, /if \(focusNote\) elements\.note\.focus\(\{ preventScroll: true \}\)/);
  assert.match(script, /showFormError\("증상이나 수치를 입력하거나 질환을 하나 이상 선택해 주세요\.", \{ focusNote: true \}\)/);
  assert.match(script, /function clearFormError\(\)[\s\S]*?aria-invalid", "false"[\s\S]*?formError\.hidden = true/);
});

test("/map transfer import preserves the pending file and returns code errors to the code field", () => {
  assert.ok(html.indexOf('id="transferCode"') < html.indexOf('id="fhirFile"'));
  assert.ok(html.indexOf('id="fhirFile"') < html.indexOf('id="importRecordButton"'));
  assert.match(html, /id="transferCode"[\s\S]*?aria-invalid="false"[\s\S]*?aria-errormessage="fhirResult"/);
  assert.match(script, /let pendingTransferFile = null/);
  assert.match(script, /pendingTransferFile = file/);
  assert.match(script, /elements\.transferCode\.setAttribute\("aria-invalid", "true"\)/);
  assert.match(script, /elements\.transferCode\.focus\(\{ preventScroll: true \}\)/);
  assert.match(script, /if \(error instanceof PatientTransferCodeError\)[\s\S]*?showTransferCodeError\(error\.message\)/);
  assert.doesNotMatch(
    script.match(/elements\.importRecordButton\.addEventListener\("click",[\s\S]*?\n\}\);/)?.[0] ?? "",
    /finally[\s\S]*?fhirFile\.value = ""/,
  );
});

test("the normative audit records deterministic evidence and its human-testing limit", () => {
  assert.match(design, /Accessibility and responsive audit evidence \(2026-07-23\)/);
  assert.match(design, /`\/map` empty-submit path marks the health-note control `aria-invalid`/);
  assert.match(design, /three personal users and three clinical or health-information users/);
  assert.match(design, /No automated result is treated as a substitute/);
});
