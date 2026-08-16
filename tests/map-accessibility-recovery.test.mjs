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

test("/map은 파일·별도 코드·본인 확인의 복구 가능한 가져오기 흐름을 노출한다", () => {
  assert.match(html, /id="transferCode"[^>]*aria-invalid="false"/);
  assert.match(html, /aria-errormessage="fhirResult"/);
  assert.match(html, /id="fhirFile"[^>]*aria-describedby="recordImportHelp recordFileStatus recordImportWarning"/);
  assert.match(html, /id="selectRecordFile"[^>]*aria-controls="fhirFile"/);
  assert.match(html, /id="importRecordButton"[^>]*disabled/);
  assert.match(html, /id="recordFileStatus" role="status" aria-live="polite"/);
  assert.match(html, /id="fhirResult" role="status" aria-live="polite" hidden/);
  assert.match(html, /현재 지도에서 아직 Journey에 저장하지 않은 기록은 가져온 내용으로 교체/);

  assert.match(script, /function showTransferCodeError\(message\)/);
  assert.match(script, /transferCode\.setAttribute\("aria-invalid", "true"\)/);
  assert.match(script, /elements\.transferCode\.focus\(\{ preventScroll: true \}\)/);
  assert.match(script, /PatientTransferCodeError/);
  assert.match(script, /pendingTransferFile/);
  assert.match(script, /parsePatientTransferPackage/);
  assert.doesNotMatch(script, /readCareBridge|subscribeCareBridge|createPatientOwnedJson/);
});

test("the normative audit records deterministic evidence and its human-testing limit", () => {
  assert.match(design, /Accessibility and responsive audit evidence \(2026-07-23\)/);
  assert.match(design, /`\/map` empty-submit path marks the health-note control `aria-invalid`/);
  assert.match(design, /three personal users and three clinical or health-information users/);
  assert.match(design, /No automated result is treated as a substitute/);
});
