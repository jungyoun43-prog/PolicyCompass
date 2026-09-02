import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile } from "node:fs/promises";

import { stylesheet } from "./helpers/css.mjs";
import { renderPage } from "./helpers/render.mjs";

/** The HTML the server sends for a route's page (effects do not run). */
/** The opening tag of the rendered element whose attributes match `attribute`. */
function openingTag(html, attribute) {
  const match = html.match(new RegExp(`<[a-z][^>]*\\s${attribute.source ?? attribute}[^>]*>`));
  assert.ok(match, `렌더링된 요소가 있어야 합니다: ${attribute}`);
  return match[0];
}

/**
 * The personal page controllers (app.js, connections.js, insights.js,
 * journey.js) query the document and bind listeners the moment they are
 * imported, so they cannot be exercised by the Node test runner. The
 * assertions that read them below stay as source checks for that reason.
 */
const controllerSource = (name) => readFile(new URL(`../src/${name}`, import.meta.url), "utf8");

/** Modules with no document dependency: importing them proves they load and export. */
const PURE_MODULES = [
  "journey-model.js",
  "patient-transfer.js",
  "care-bridge.js",
  "sample-navigation.js",
  "patient-question-assistant.js",
];

/**
 * Evaluates src/sample-navigation.js's `preserveSampleNavigation` against a
 * minimal fake document so the link rewriting can be observed rather than
 * pattern-matched. Returns the hrefs the links end up with.
 */
async function rewrittenSampleLinks(hrefs, enabled) {
  const links = hrefs.map((href) => {
    const attributes = { href };
    return {
      getAttribute: (name) => attributes[name] ?? null,
      setAttribute: (name, value) => { attributes[name] = value; },
    };
  });
  const previous = { document: globalThis.document, window: globalThis.window };
  globalThis.document = { querySelectorAll: () => links };
  globalThis.window = { location: { origin: "https://personal.test" } };
  try {
    const { preserveSampleNavigation } = await import("../src/sample-navigation.js");
    preserveSampleNavigation(enabled);
  } finally {
    globalThis.document = previous.document;
    globalThis.window = previous.window;
  }
  return links.map((link) => link.getAttribute("href"));
}

test("Journey와 명시적 환자 전달 모듈이 번들 소스로 유지된다", async () => {
  for (const name of PURE_MODULES) {
    const module = await import(`../src/${name}`);
    assert.ok(Object.keys(module).length > 0, `번들에 포함되어야 하는 모듈이 export를 가져야 합니다: ${name}`);
  }
  // journey.js binds to the document on import; its presence in the bundle is what this guards.
  await access(new URL("../src/journey.js", import.meta.url));
  assert.ok(await stylesheet("src/journey.css"), "번들에 포함되어야 하는 자산: /journey.css");

  const html = await renderPage("/journey");
  assert.match(html, /나의 건강 지도 기록/);
  assert.match(html, /이 기기에만 저장/);
});

test("Health Map은 파일과 별도 코드의 3단계 가져오기만 제공한다", async () => {
  const html = await renderPage("/map");
  assert.match(openingTag(html, 'id="transferCode"'), /^<input/);
  assert.match(openingTag(html, 'id="fhirFile"'), /^<input/);
  assert.match(openingTag(html, 'id="selectRecordFile"'), /^<button/);
  assert.match(openingTag(html, 'id="importRecordButton"'), /\sdisabled=""/);
  assert.match(openingTag(html, 'id="recordFileStatus"'), /\srole="status"/);
  assert.match(openingTag(html, 'id="fhirResult"'), /\srole="status"/);
  assert.match(html, /파일과 다른 경로로 받은 확인 코드/);
  assert.match(html, /본인 기록 확인 후 교체/);
  assert.match(html, /기존 Journey는 바뀌지 않습니다/);
  assert.doesNotMatch(html, /careLinkStatus|refreshCareLink|downloadClinicalJson|자동 연결/);
});

test("Health Map 가져오기는 코드 검증·환자 확인 뒤 replace-only로 커밋한다", async () => {
  // source-check: app.js is a document-bound controller (see controllerSource); its import flow needs a browser.
  const app = await controllerSource("app.js");
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
  // source-check: session restore lives in the document-bound app.js controller and reads sessionStorage.
  const app = await controllerSource("app.js");
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
  // source-check: connections.js and insights.js are document-bound controllers; what they refuse to read is only visible in source.
  const [connections, insights] = await Promise.all([
    controllerSource("connections.js"),
    controllerSource("insights.js"),
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
  // source-check: the sample-mode guards sit inside document-bound controllers (app, connections, insights, journey).
  const [app, connections, insights, journey] = await Promise.all([
    controllerSource("app.js"),
    controllerSource("connections.js"),
    controllerSource("insights.js"),
    controllerSource("journey.js"),
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

  // The navigation helper itself is exercised: only the four personal pages gain sample=1.
  const hrefs = [
    "/map",
    "/connections#graph",
    "/insights?tab=questions",
    "/journey",
    "/patient",
    "/emr",
    "https://external.test/map",
  ];
  assert.deepEqual(await rewrittenSampleLinks(hrefs, true), [
    "/map?sample=1",
    "/connections?sample=1#graph",
    "/insights?tab=questions&sample=1",
    "/journey?sample=1",
    "/patient",
    "/emr",
    "https://external.test/map",
  ]);
  assert.deepEqual(await rewrittenSampleLinks(hrefs, false), hrefs);
});

test("텍스트 패턴은 Condition이 아니라 signal로 저장되고 imported provenance가 유지된다", async () => {
  // source-check: the state writes asserted here happen inside the document-bound app.js controller.
  const app = await controllerSource("app.js");
  assert.match(app, /state\.patientVisibleIds = state\.isDemo[\s\S]*?: \[\.\.\.state\.declaredIds\]/);
  assert.match(app, /state\.signals = state\.isDemo \? \[\] : extractInputSignals\(note\)/);
  assert.match(app, /const hasDetectedInput = state\.visibleIds\.length > 0 \|\| state\.signals\.length > 0/);
  assert.match(app, /선택·가져오기 질환 항목 \$\{conditions\.length\}개 · 입력 확인 신호 \$\{state\.signals\.length\}개/);
  assert.match(app, /hasJourneyData = conditions\.length > 0 \|\| state\.measurements\.length > 0 \|\| state\.signals\.length > 0/);
  assert.match(app, /clinician-confirmed-unsigned-import/);
  assert.match(app, /clinician-final-unsigned-import/);
  assert.match(app, /: "patient-entered"/);
});
