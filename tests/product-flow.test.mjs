import assert from "node:assert/strict";
import test from "node:test";

test("자동 진료 연결과 Journey 화면 자산을 배포 Worker가 제공한다", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  const routes = [
    "/journey",
    "/journey.css",
    "/journey.js",
    "/journey-model.js",
    "/care-bridge.js",
    "/patient-question-assistant.js",
  ];

  for (const route of routes) {
    const response = await worker.fetch(new Request(`https://example.com${route}`));
    assert.equal(response.status, 200, route);
  }

  const html = await (await worker.fetch(new Request("https://example.com/journey"))).text();
  assert.match(html, /나의 건강 지도 기록/);
  assert.match(html, /이 기기에만 저장/);
});

test("Health Map은 서명 EMR 정제 기록을 자동 연결하고 JSON은 환자 소유 내보내기로만 제공한다", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  const html = await (await worker.fetch(new Request("https://example.com/map"))).text();
  const landing = await (await worker.fetch(new Request("https://example.com/patient"))).text();

  assert.match(html, /id="connected-record"/);
  assert.match(html, /SIGNED · VERIFIED EMR RECORD/);
  assert.match(html, /진료를 서명하면 최종·확정 사실과 처방이 식별정보 없이[\s\S]*?자동 연결/);
  assert.match(html, /파일과 확인 코드는 필요하지 않습니다/);
  assert.match(html, /id="refreshCareLink"/);
  assert.match(html, /id="downloadClinicalJson"[^>]*disabled/);
  assert.match(html, /내 정제 JSON 내보내기/);
  assert.ok(html.indexOf('id="analyzeButton"') < html.indexOf('id="connected-record"'));
  assert.match(html, /id="saveJourney"/);
  assert.match(landing, /의료진이 서명한 기록은 환자에게 필요한 항목만 정제되어 자동으로 이어집니다/);
  assert.match(landing, /정제 JSON은 환자가 직접 선택해 보관하는 사본/);
  assert.match(landing, /병원 연결을 위한 업로드 파일이 아니며/);
  assert.doesNotMatch(html, /id="(?:fhirFile|transferCode|selectRecordFile|importRecordButton)"/);
  assert.doesNotMatch(landing, /href="\/map#import-record"|VitaGraph 환자 전달 v1/);
});

test("자동 연결 완료 상태에서 환자는 정제 항목 수와 건강 지도를 함께 확인한다", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  const html = await (await worker.fetch(new Request("https://example.com/map"))).text();
  const app = await (await worker.fetch(new Request("https://example.com/app.js"))).text();

  assert.match(html, /id="health-map"[^>]*aria-labelledby="bodyTitle"[^>]*tabindex="-1"/);
  assert.match(html, /id="careLinkStatus" role="status" aria-live="polite"/);
  assert.match(html, /id="careLinkSummary" hidden/);
  assert.match(html, /id="careLinkDetails"[^>]*hidden/);
  assert.match(html, /id="careConditionList"/);
  assert.match(html, /id="careMeasurementList"/);
  assert.match(html, /id="careMedicationList"/);
  assert.match(app, /function renderCareLink\(\)/);
  assert.match(app, /EMR에서 \$\{count\}개 정제 항목을 연결했습니다/);
  assert.match(app, /\["확정 질환", snapshot\.healthMap\.conditions\.length\]/);
  assert.match(app, /\["최종 측정", snapshot\.healthMap\.measurements\.length\]/);
  assert.match(app, /\["서명 처방", snapshot\.medications\.length\]/);
  assert.match(app, /replaceLinkedItems\(\s*elements\.careConditionList/);
  assert.match(app, /replaceLinkedItems\(\s*elements\.careMeasurementList/);
  assert.match(app, /replaceLinkedItems\(\s*elements\.careMedicationList/);
  assert.match(app, /\(\{ label, dose, doseUnit, frequency, prescribedOn \}\)/);
  assert.match(app, /`\$\{dose\}\$\{doseUnit\} · \$\{frequency\} · \$\{prescribedOn\}`/);
  assert.match(app, /state\.patientVisibleIds = inferConditionIds\([\s\S]*?state\.declaredIds/);
  assert.match(app, /state\.visibleIds = \[\.\.\.new Set\(\[\.\.\.state\.patientVisibleIds, \.\.\.state\.clinicalConditionIds\]\)\]/);
});

test("Health Map은 진료 연결을 구독하고 정제 데이터와 환자 입력의 저장 경계를 분리한다", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  const app = await (await worker.fetch(new Request("https://example.com/app.js"))).text();

  assert.match(app, /readCareBridge/);
  assert.match(app, /subscribeCareBridge\(\(bridge\) => applyCareBridge\(bridge\)\)/);
  assert.match(app, /const snapshot = connectedClinicalSnapshot\(bridge\?\.clinical\?\.snapshot\)/);
  assert.match(app, /state\.clinicalConditionIds = \(snapshot\?\.healthMap\?\.conditions \?\? \[\]\)/);
  assert.match(app, /state\.clinicalMeasurements = snapshot\?\.healthMap\?\.measurements \?\? \[\]/);
  assert.match(app, /state\.clinicalMedications = snapshot\?\.medications \?\? \[\]/);
  assert.match(app, /patientVisibleIds: state\.patientVisibleIds,[\s\S]*?clinicalConditionIds: state\.clinicalConditionIds,[\s\S]*?visibleIds: state\.visibleIds/);
  assert.match(app, /const clinicalConditionIds = Array\.isArray\(stored\.clinicalConditionIds\)/);
  assert.match(app, /const patientVisibleIds = Array\.isArray\(stored\.patientVisibleIds\)/);
  assert.match(app, /const visibleIds = \[\.\.\.new Set\(\[\.\.\.patientVisibleIds, \.\.\.clinicalConditionIds\]\)\]/);
  assert.match(app, /state\.visibleIds = \[\.\.\.new Set\(\[\.\.\.state\.patientVisibleIds, \.\.\.state\.clinicalConditionIds\]\)\]/);
  assert.match(app, /source: state\.source,[\s\S]*?isDemo: state\.isDemo,[\s\S]*?note: elements\.note\.value/);
  assert.match(app, /measurements: state\.isDemo \? state\.measurements : \[\]/);
  assert.doesNotMatch(app, /pendingTransferFile|parsePatientTransferPackage|verifyPatientTransferCode|PatientTransferCodeError/);
});

test("Connections와 Insights는 끊긴 임상 ID를 버리고 환자 선택·입력 추론은 보존한다", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  const [connections, insights] = await Promise.all([
    worker.fetch(new Request("https://example.com/connections.js")).then((response) => response.text()),
    worker.fetch(new Request("https://example.com/insights.js")).then((response) => response.text()),
  ]);

  assert.match(connections, /import \{ readCareBridge, subscribeCareBridge \} from "\/care-bridge\.js"/);
  assert.match(connections, /const storedClinicalIds = conditionIds\(stored\?\.clinicalConditionIds\)/);
  assert.match(connections, /const patientVisibleIds = Array\.isArray\(stored\?\.patientVisibleIds\)/);
  assert.match(connections, /: storedVisibleIds\.filter\(\(id\) => !storedClinicalIds\.includes\(id\) \|\| declaredIds\.includes\(id\)\)/);
  assert.match(connections, /const clinicalConditionIds = isDemo \? \[\] : clinicalIdsFromBridge\(bridge\)/);
  assert.match(connections, /visibleIds = isDemo[\s\S]*?\[\.\.\.new Set\(\[\.\.\.patientVisibleIds, \.\.\.clinicalConditionIds\]\)\]/);
  assert.match(connections, /subscribeCareBridge\(\(bridge\) => refreshFromBridge\(bridge\)\)/);

  assert.match(insights, /const patientVisibleIds = Array\.isArray\(stored\?\.patientVisibleIds\)/);
  assert.match(insights, /clinicalConditionIds: Array\.isArray\(stored\?\.clinicalConditionIds\)/);
  assert.match(insights, /const clinicalConditionIds = clinicalSnapshot[\s\S]*?: \[\]/);
  assert.match(insights, /const visibleIds = session\.isDemo[\s\S]*?\[\.\.\.new Set\(\[\.\.\.session\.patientVisibleIds, \.\.\.clinicalConditionIds\]\)\]/);
  assert.doesNotMatch(insights, /clinicalSnapshot\s*\?[\s\S]{0,240}:\s*session\.visibleIds/);
});

test("Health Map은 실데이터와 예시 데이터를 명확히 분리한다", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  const html = await (await worker.fetch(new Request("https://example.com/map"))).text();
  const app = await (await worker.fetch(new Request("https://example.com/app.js"))).text();

  const textarea = html.match(/<textarea[^>]+id="healthNote"[^>]*>([\s\S]*?)<\/textarea>/);
  assert.ok(textarea, "health note textarea should exist");
  assert.equal(textarea[1].trim(), "", "the map must not preload a sample as user data");
  assert.match(html, /id="loadDemo"/);
  assert.match(html, /예시 데이터 보는 중 · 현재 탭에서만 유지 · Journey에는 저장되지 않음/);
  assert.match(html, /확인 필요 신호 · 진단 아님/);
  assert.match(app, /sessionStorage\.setItem\(sessionKey, JSON\.stringify\(\{[\s\S]*?isDemo: state\.isDemo/);
  assert.match(app, /elements\.resetButton\.addEventListener\("click",[\s\S]*?state\.visibleIds = \[\.\.\.state\.clinicalConditionIds\]/);
  assert.match(app, /elements\.resetButton\.addEventListener\("click",[\s\S]*?state\.measurements = state\.clinicalMeasurements/);
  assert.match(app, /elements\.resetButton\.addEventListener\("click",[\s\S]*?persistScene\(\)/);
  assert.match(app, /if \(state\.isDemo\) \{\s*elements\.formError\.hidden = false;\s*elements\.formError\.textContent = "예시 데이터는 Journey에 저장되지 않습니다\."/);
  assert.match(app, /elements\.loadDemo\.addEventListener\("click",[\s\S]*?state\.isDemo = true[\s\S]*?analyze\(\)/);
  assert.match(app, /applyCareBridge\(\);[\s\S]*?subscribeCareBridge/);
});

test("화면 이동은 환자 세션 전체 shape와 데모 표시를 보존한다", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  const app = await (await worker.fetch(new Request("https://example.com/app.js"))).text();
  const connections = await (await worker.fetch(new Request("https://example.com/connections.js"))).text();
  const connectionsHtml = await (await worker.fetch(new Request("https://example.com/connections"))).text();
  const insightsHtml = await (await worker.fetch(new Request("https://example.com/insights"))).text();

  assert.match(app, /const restoredScene = readScene\(\)/);
  assert.match(app, /Object\.assign\(state, restoredScene\)/);
  assert.match(connections, /\.\.\.preserved,[\s\S]*?patientVisibleIds: state\.patientVisibleIds,[\s\S]*?clinicalConditionIds: state\.clinicalConditionIds,[\s\S]*?visibleIds: state\.visibleIds,[\s\S]*?activeId: state\.activeId/);
  assert.match(connections, /stored\?\.isDemo === true/);
  assert.match(connectionsHtml, /id="personalDemoMode"/);
  assert.match(insightsHtml, /id="personalDemoMode"/);
});
