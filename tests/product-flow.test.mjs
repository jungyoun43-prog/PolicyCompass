import assert from "node:assert/strict";
import test from "node:test";

test("환자 전달 가져오기와 Journey 화면 자산을 배포 Worker가 제공한다", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  const routes = [
    "/journey",
    "/journey.css",
    "/journey.js",
    "/journey-model.js",
    "/patient-transfer.js",
  ];

  for (const route of routes) {
    const response = await worker.fetch(new Request(`https://example.com${route}`));
    assert.equal(response.status, 200, route);
  }

  const html = await (await worker.fetch(new Request("https://example.com/journey"))).text();
  assert.match(html, /나의 건강 지도 기록/);
  assert.match(html, /이 기기에만 저장/);
});

test("Health Map은 전용 환자 JSON 로컬 가져오기와 명시적 Journey 저장을 제공한다", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  const html = await (await worker.fetch(new Request("https://example.com/map"))).text();
  const landing = await (await worker.fetch(new Request("https://example.com/patient"))).text();

  assert.match(html, /id="fhirFile"/);
  assert.match(html, /서버 전송 없음/);
  assert.match(html, /id="saveJourney"/);
  assert.match(landing, /VitaGraph 환자 전달 v1만 읽고/);
  assert.doesNotMatch(landing, /FHIR R4는 보조/);
});

test("Health Map은 환자 전달 파일만 판별하고 전체 지원 투영을 세션에 보존한다", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  const app = await (await worker.fetch(new Request("https://example.com/app.js"))).text();

  assert.match(app, /payload\?\.schema !== "vitagraph-patient-transfer"/);
  assert.match(app, /parsePatientTransferPackage\(payload\)/);
  assert.doesNotMatch(app, /parseFhirBundle/);
  assert.match(app, /전달 확인 코드/);
  assert.match(app, /state\.declaredIds = \(imported\.conditionIds \?\? \[\]\)\.filter/);
  assert.match(app, /state\.measurements = imported\.measurements \?\? \[\]/);
  assert.match(app, /sessionStorage\.setItem\(sessionKey, JSON\.stringify\(\{[\s\S]*?declaredIds: state\.declaredIds,[\s\S]*?measurements: state\.measurements,[\s\S]*?isDemo: state\.isDemo/);
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
  assert.match(app, /elements\.resetButton\.addEventListener\("click",[\s\S]*?sessionStorage\.removeItem\(sessionKey\)/);
  assert.match(app, /if \(state\.isDemo\) \{\s*elements\.formError\.hidden = false;\s*elements\.formError\.textContent = "예시 데이터는 Journey에 저장되지 않습니다\."/);
  assert.match(app, /renderAll\(\);\s*$/);
});

test("화면 이동은 환자 세션 전체 shape와 데모 표시를 보존한다", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  const app = await (await worker.fetch(new Request("https://example.com/app.js"))).text();
  const connections = await (await worker.fetch(new Request("https://example.com/connections.js"))).text();
  const connectionsHtml = await (await worker.fetch(new Request("https://example.com/connections"))).text();
  const insightsHtml = await (await worker.fetch(new Request("https://example.com/insights"))).text();

  assert.match(app, /const restoredScene = readScene\(\)/);
  assert.match(app, /Object\.assign\(state, restoredScene\)/);
  assert.match(connections, /\.\.\.preserved,[\s\S]*?visibleIds: state\.visibleIds,[\s\S]*?activeId: state\.activeId/);
  assert.match(connections, /stored\?\.isDemo === true/);
  assert.match(connectionsHtml, /id="personalDemoMode"/);
  assert.match(insightsHtml, /id="personalDemoMode"/);
});
