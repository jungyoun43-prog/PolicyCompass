import assert from "node:assert/strict";
import test from "node:test";

const routeRegistry = [
  { path: "/", presentation: "/patient-presentation.css" },
  { path: "/patient", presentation: "/patient-presentation.css" },
  { path: "/map", presentation: "/clinician-hierarchy.css" },
  { path: "/connections", presentation: "/clinician-hierarchy.css" },
  { path: "/insights", presentation: "/clinician-hierarchy.css" },
  { path: "/journey", presentation: "/clinician-hierarchy.css" },
  { path: "/emr", presentation: "/emr.css" },
];

function stylesheetHrefs(html) {
  return [...html.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["'][^>]*>/gi)]
    .map(([, href]) => href);
}

test("정식 라우트 레지스트리는 중복 없이 일곱 화면을 모두 열거한다", () => {
  assert.deepEqual(
    routeRegistry.map(({ path }) => path),
    ["/", "/patient", "/map", "/connections", "/insights", "/journey", "/emr"],
  );
  assert.equal(new Set(routeRegistry.map(({ path }) => path)).size, 7);
});

test("등록된 모든 화면은 공통 테마·컨트롤과 대상별 프레젠테이션 모듈로 렌더링된다", async () => {
  const { default: worker } = await import("../dist/server/index.js");

  for (const { path, presentation } of routeRegistry) {
    const response = await worker.fetch(new Request(`https://example.com${path}`));
    const html = await response.text();
    const stylesheets = stylesheetHrefs(html);

    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/, path);
    assert.ok(html.includes("<main"), `${path}: main landmark`);
    assert.ok(stylesheets.includes("/foundation.css"), `${path}: shared theme`);
    assert.ok(stylesheets.includes("/controls.css"), `${path}: reusable controls`);
    assert.ok(stylesheets.includes(presentation), `${path}: ${presentation}`);
  }
});
