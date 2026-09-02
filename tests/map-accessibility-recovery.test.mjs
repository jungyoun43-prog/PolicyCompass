import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { renderComponent } from "./helpers/render.mjs";

const { default: MapPage } = await import("../app/(map)/map/page.jsx");
const html = renderComponent(MapPage);
const script = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const design = await readFile(new URL("../DESIGN.md", import.meta.url), "utf8");

/** The rendered opening tag of the element with `id`, or "" when absent. */
function tagWithId(id) {
  return html.match(new RegExp(`<[a-z]+ [^>]*\\bid="${id}"[^>]*>`))?.[0] ?? "";
}

test("/map exposes an invalid state and returns focus for empty-submit recovery", () => {
  const note = tagWithId("healthNote");
  assert.match(note, /^<textarea /);
  assert.match(note, /aria-invalid="false"/);
  assert.match(note, /aria-describedby="inputHint formError"/);
  const error = tagWithId("formError");
  assert.match(error, /role="alert"/);
  assert.match(error, /\bhidden=""/, "the alert is empty-silent until a failed submit");
  assert.match(html, /id="formError"[^>]*>증상이나 수치를 입력하거나 질환을 하나 이상 선택해 주세요\./);
  // source-check: the invalid state, focus return and clearing happen in the map controller's submit handler, which needs a document.
  assert.match(script, /function showFormError\(message, \{ focusNote = false \} = \{\}\)/);
  assert.match(script, /elements\.note\.setAttribute\("aria-invalid", "true"\)/);
  assert.match(script, /if \(focusNote\) elements\.note\.focus\(\{ preventScroll: true \}\)/);
  assert.match(script, /showFormError\("증상이나 수치를 입력하거나 질환을 하나 이상 선택해 주세요\.", \{ focusNote: true \}\)/);
  assert.match(script, /function clearFormError\(\)[\s\S]*?aria-invalid", "false"[\s\S]*?formError\.hidden = true/);
});

test("/map은 파일·별도 코드·본인 확인의 복구 가능한 가져오기 흐름을 노출한다", () => {
  const transferCode = tagWithId("transferCode");
  assert.match(transferCode, /^<input /);
  assert.match(transferCode, /aria-invalid="false"/);
  assert.match(transferCode, /aria-errormessage="fhirResult"/);
  const file = tagWithId("fhirFile");
  assert.match(file, /type="file"/);
  assert.match(file, /aria-describedby="recordImportHelp recordFileStatus recordImportWarning"/);
  assert.match(tagWithId("selectRecordFile"), /aria-controls="fhirFile"/);
  assert.match(tagWithId("importRecordButton"), /\bdisabled=""/);
  assert.match(tagWithId("recordFileStatus"), /role="status" aria-live="polite"/);
  const result = tagWithId("fhirResult");
  assert.match(result, /role="status" aria-live="polite"/);
  assert.match(result, /\bhidden=""/);
  assert.match(html, /현재 지도에서 아직 Journey에 저장하지 않은 기록은 가져온 내용으로 교체/);

  // source-check: the transfer-code error state, focus return and package parsing run in the map controller's import handlers, which need a document and a File.
  assert.match(script, /function showTransferCodeError\(message\)/);
  assert.match(script, /transferCode\.setAttribute\("aria-invalid", "true"\)/);
  assert.match(script, /elements\.transferCode\.focus\(\{ preventScroll: true \}\)/);
  assert.match(script, /PatientTransferCodeError/);
  assert.match(script, /pendingTransferFile/);
  assert.match(script, /parsePatientTransferPackage/);
  assert.doesNotMatch(script, /readCareBridge|subscribeCareBridge|createPatientOwnedJson/);
});

test("the normative audit records deterministic evidence and its human-testing limit", () => {
  // source-check: DESIGN.md is the written audit record itself, not an implementation.
  assert.match(design, /Accessibility and responsive audit evidence \(2026-07-23\)/);
  assert.match(design, /`\/map` empty-submit path marks the health-note control `aria-invalid`/);
  assert.match(design, /three personal users and three clinical or health-information users/);
  assert.match(design, /No automated result is treated as a substitute/);
});
