import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { pageMarkup } from "./helpers/markup.mjs";

const SOURCE_ROUTES = {
  "/journey": () => pageMarkup("/journey"),
  "/map": () => pageMarkup("/map"),
  "/journey.css": () => readFile("src/journey.css", "utf8"),
  "/journey.js": () => readFile("src/journey.js", "utf8"),
  "/journey-model.js": () => readFile("src/journey-model.js", "utf8"),
  "/patient-transfer.js": () => readFile("src/patient-transfer.js", "utf8"),
  "/care-bridge.js": () => readFile("src/care-bridge.js", "utf8"),
  "/sample-navigation.js": () => readFile("src/sample-navigation.js", "utf8"),
  "/patient-question-assistant.js": () => readFile("src/patient-question-assistant.js", "utf8"),
  "/app.js": () => readFile("src/app.js", "utf8"),
  "/connections.js": () => readFile("src/connections.js", "utf8"),
  "/insights.js": () => readFile("src/insights.js", "utf8"),
};

async function deployedText(route) {
  const loader = SOURCE_ROUTES[route];
  assert.ok(loader, `번들에 포함되어야 하는 자산: ${route}`);
  return loader();
}

test("Journey와 명시적 환자 전달 모듈이 번들 소스로 유지된다", async () => {
  for (const route of [
    "/journey",
    "/journey.css",
    "/journey.js",
    "/journey-model.js",
    "/patient-transfer.js",
    "/care-bridge.js",
    "/sample-navigation.js",
    "/patient-question-assistant.js",
  ]) {
    await deployedText(route);
  }
  const html = await deployedText("/journey");
  assert.match(html, /나의 건강 지도 기록/);
  assert.match(html, /이 기기에만 저장/);
});

test("Health Map은 파일과 별도 코드의 3단계 가져오기만 제공한다", async () => {
  const html = await deployedText("/map");
  assert.match(html, /id="transferCode"/);
  assert.match(html, /id="fhirFile"/);
  assert.match(html, /id="selectRecordFile"/);
  assert.match(html, /id="importRecordButton"[^>]*disabled/);
  assert.match(html, /id="recordFileStatus"[^>]*role="status"/);
  assert.match(html, /id="fhirResult"[^>]*role="status"/);
  assert.match(html, /파일과 다른 경로로 받은 확인 코드/);
  assert.match(html, /본인 기록 확인 후 교체/);
  assert.match(html, /기존 Journey는 바뀌지 않습니다/);
  assert.doesNotMatch(html, /careLinkStatus|refreshCareLink|downloadClinicalJson|자동 연결/);
});

test("Health Map 가져오기는 코드 검증·환자 확인 뒤 replace-only로 커밋한다", async () => {
  const app = await deployedText("/app.js");
  assert.match(app, /parsePatientTransferPackage/);
  assert.match(app, /verifyPatientTransferCode/);
  assert.match(app, /PatientTransferCodeError/);
  assert.match(app, /if \(!pendingTransferFile\)/);
  assert.match(app, /if \(!window\.confirm\([\s\S]*?내 기록이 맞는지 확인/);
  assert.match(app, /기존 저장 전 지도와 자동 병합하지 않습니다/);
  assert.match(app, /Journey 저장소를 확인할 수 없어 가져오기를 중단했습니다/);
  assert.doesNotMatch(app, /catch\s*\{\s*journeyCount = 0;/);
  assert.match(app, /function replaceMapWithImportedTransfer\(imported\)/);
  assert.match(app, /state\.declaredIds = \[\];[\s\S]*?state\.clinicalConditionIds = clinicalConditions\.map/);
  assert.match(app, /state\.signals = \[\];[\s\S]*?elements\.note\.value = ""/);
  assert.match(app, /Journey는 자동 변경되지 않습니다/);
  assert.doesNotMatch(app, /readCareBridge|subscribeCareBridge|publishClinicalSnapshot|createPatientOwnedJson/);
});

test("세션 복원은 explicit transfer marker와 v1 canonical 규칙을 다시 검증한다", async () => {
  const app = await deployedText("/app.js");
  assert.match(app, /function restoredImportedTransfer\(stored\)/);
  assert.match(app, /hasExactKeys\(value, \["schema", "version", "exportedAt", "trust"\]\)/);
  assert.match(app, /parsePatientTransferPackage\(\{/);
  assert.match(app, /provenanceKind !== "clinician-confirmed-unsigned-import"/);
  assert.match(app, /provenanceKind !== "clinician-final-unsigned-import"/);
  assert.match(app, /const patientVisibleIds = \[\.\.\.declaredIds\]/);
  assert.doesNotMatch(app, /conditionIds\(stored\.patientVisibleIds\)|inferConditionIds/);
  assert.match(app, /signals: extractInputSignals\(note\)/);
});

test("Connections와 Insights는 전역 bridge를 읽지 않고 검증된 explicit import만 소비한다", async () => {
  const [connections, insights] = await Promise.all([
    deployedText("/connections.js"),
    deployedText("/insights.js"),
  ]);
  for (const source of [connections, insights]) {
    assert.match(source, /parsePatientTransferPackage/);
    assert.match(source, /clinician-confirmed-unsigned-import/);
    assert.match(source, /clinician-final-unsigned-import/);
    assert.match(source, /const patientVisibleIds = \[\.\.\.declaredIds\]/);
    assert.doesNotMatch(source, /readCareBridge|subscribeCareBridge|publishPatientBrief|publishClinicalSnapshot|BroadcastChannel/);
    assert.doesNotMatch(source, /stored\??\.patientVisibleIds\s*\?/);
  }
  assert.match(connections, /파일에 의료진 확정으로 표시 · 발행기관·변조 미검증/);
  assert.match(insights, /source: "unsigned-local-export"/);
  assert.doesNotMatch(insights, /clinicalSnapshot:[\s\S]{0,500}medications/);
});

test("sample=1은 저장·가져오기·Journey·모델·내보내기에서 실제 세션과 격리된다", async () => {
  const [app, connections, insights, journey, sampleNavigation] = await Promise.all([
    deployedText("/app.js"),
    deployedText("/connections.js"),
    deployedText("/insights.js"),
    deployedText("/journey.js"),
    deployedText("/sample-navigation.js"),
  ]);
  assert.match(app, /if \(forcedSampleMode\) return null/);
  assert.match(app, /if \(state\.isDemo \|\| forcedSampleMode\) return/);
  assert.match(app, /state\.isDemo \|\| forcedSampleMode[\s\S]*?실제 환자 전달 파일을 가져올 수 없습니다/);
  assert.match(app, /state\.isDemo \|\| forcedSampleMode[\s\S]*?Journey에 저장되지 않습니다/);
  assert.match(connections, /if \(forcedSampleMode\)[\s\S]*?demoConditionIds/);
  assert.match(connections, /if \(state\.isDemo \|\| forcedSampleMode\) return/);
  assert.match(insights, /if \(forcedSampleMode\)[\s\S]*?demoConditionIds/);
  assert.match(insights, /if \(session\.isDemo\)[\s\S]*?데이터를 전송하지 않습니다/);
  assert.match(insights, /exportSnapshot\.disabled = true/);
  assert.match(connections, /preserveSampleNavigation\(forcedSampleMode\)/);
  assert.match(insights, /preserveSampleNavigation\(forcedSampleMode\)/);
  assert.match(journey, /preserveSampleNavigation\(sampleMode\)/);
  assert.match(sampleNavigation, /PERSONAL_SAMPLE_PATHS = new Set\(\["\/map", "\/connections", "\/insights", "\/journey"\]\)/);
  assert.match(sampleNavigation, /url\.searchParams\.set\("sample", "1"\)/);
});

test("텍스트 패턴은 Condition이 아니라 signal로 저장되고 imported provenance가 유지된다", async () => {
  const app = await deployedText("/app.js");
  assert.match(app, /state\.patientVisibleIds = state\.isDemo[\s\S]*?: \[\.\.\.state\.declaredIds\]/);
  assert.match(app, /state\.signals = state\.isDemo \? \[\] : extractInputSignals\(note\)/);
  assert.match(app, /const hasDetectedInput = state\.visibleIds\.length > 0 \|\| state\.signals\.length > 0/);
  assert.match(app, /선택·가져오기 질환 항목 \$\{conditions\.length\}개 · 입력 확인 신호 \$\{state\.signals\.length\}개/);
  assert.match(app, /hasJourneyData = conditions\.length > 0 \|\| state\.measurements\.length > 0 \|\| state\.signals\.length > 0/);
  assert.match(app, /clinician-confirmed-unsigned-import/);
  assert.match(app, /clinician-final-unsigned-import/);
  assert.match(app, /: "patient-entered"/);
});
