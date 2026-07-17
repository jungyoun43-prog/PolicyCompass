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
