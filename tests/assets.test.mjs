import assert from "node:assert/strict";
import test from "node:test";

test("화면 모듈과 분리된 스타일 자산을 모두 제공한다", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  const routes = [
    "/foundation.css",
    "/shell.css",
    "/controls.css",
    "/body-map.css",
    "/portal.css",
    "/detail.css",
    "/responsive.css",
    "/explorer.css",
    "/view-model.js",
    "/explorer-model.js",
    "/connections.js",
  ];

  for (const route of routes) {
    const response = await worker.fetch(new Request(`https://example.com${route}`));
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get("content-type") ?? "", /text\/(css|javascript)/);
  }
});
