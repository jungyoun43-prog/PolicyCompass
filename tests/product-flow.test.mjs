import assert from "node:assert/strict";
import test from "node:test";

test("FHIR 가져오기와 Journey 화면 자산을 배포 Worker가 제공한다", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  const routes = ["/journey", "/journey.css", "/journey.js", "/journey-model.js", "/fhir-import.js"];

  for (const route of routes) {
    const response = await worker.fetch(new Request(`https://example.com${route}`));
    assert.equal(response.status, 200, route);
  }

  const html = await (await worker.fetch(new Request("https://example.com/journey"))).text();
  assert.match(html, /나의 건강 지도 기록/);
  assert.match(html, /이 기기에만 저장/);
});

test("Health Map은 FHIR 로컬 가져오기와 명시적 Journey 저장을 제공한다", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  const html = await (await worker.fetch(new Request("https://example.com/map"))).text();

  assert.match(html, /id="fhirFile"/);
  assert.match(html, /서버 전송 없음/);
  assert.match(html, /id="saveJourney"/);
});

test("Health Map은 실데이터와 예시 데이터를 명확히 분리한다", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  const html = await (await worker.fetch(new Request("https://example.com/map"))).text();
  const app = await (await worker.fetch(new Request("https://example.com/app.js"))).text();

  const textarea = html.match(/<textarea[^>]+id="healthNote"[^>]*>([\s\S]*?)<\/textarea>/);
  assert.ok(textarea, "health note textarea should exist");
  assert.equal(textarea[1].trim(), "", "the map must not preload a sample as user data");
  assert.match(html, /id="loadDemo"/);
  assert.match(html, /예시 데이터 보는 중 · 세션과 Journey에 저장되지 않음/);
  assert.match(html, /확인 필요 신호 · 진단 아님/);
  assert.match(app, /if \(state\.isDemo\) \{\s*sessionStorage\.removeItem\(sessionKey\)/);
  assert.match(app, /if \(state\.isDemo\) \{\s*elements\.formError\.hidden = false;\s*elements\.formError\.textContent = "예시 데이터는 Journey에 저장되지 않습니다\."/);
  assert.match(app, /renderAll\(\);\s*$/);
});
