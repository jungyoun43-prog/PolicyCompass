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

test("/map은 자동 연결 상태를 알리고 환자 소유 내보내기만 명시적으로 활성화한다", () => {
  const connectedRecord = html.match(/<section class="import-box care-link-box"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.match(connectedRecord, /id="connected-record"/);
  assert.match(connectedRecord, /id="careLinkStatus" role="status" aria-live="polite"/);
  assert.match(connectedRecord, /id="careLinkSummary" hidden/);
  assert.match(connectedRecord, /id="refreshCareLink"/);
  assert.match(connectedRecord, /id="downloadClinicalJson"[^>]*disabled/);
  assert.match(connectedRecord, /파일과 확인 코드는 필요하지 않습니다/);
  assert.match(connectedRecord, /원본 EMR·이름·등록번호·연락처·원문 메모는 연결하거나 내보내지 않습니다/);
  assert.doesNotMatch(html, /id="(?:transferCode|fhirFile|importRecordButton|selectRecordFile)"/);

  assert.match(script, /readCareBridge/);
  assert.match(script, /subscribeCareBridge\(\(bridge\) => applyCareBridge\(bridge\)\)/);
  assert.match(script, /elements\.downloadClinicalJson\.disabled = !snapshot/);
  assert.match(script, /createPatientOwnedJson\(state\.clinicalSnapshot, exportedAt\)/);
  assert.match(script, /patientOwnedJsonFilename\(exportedAt\)/);
  assert.match(script, /elements\.careLinkStatus\.textContent = "정제 기록 JSON을 내보냈습니다\.[^"]*환자 본인이 선택해 보관하는 사본입니다\."/);
  assert.doesNotMatch(script, /pendingTransferFile|PatientTransferCodeError|parsePatientTransferPackage/);
});

test("the normative audit records deterministic evidence and its human-testing limit", () => {
  assert.match(design, /Accessibility and responsive audit evidence \(2026-07-23\)/);
  assert.match(design, /`\/map` empty-submit path marks the health-note control `aria-invalid`/);
  assert.match(design, /three personal users and three clinical or health-information users/);
  assert.match(design, /No automated result is treated as a substitute/);
});
