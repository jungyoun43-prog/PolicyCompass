import assert from "node:assert/strict";
import test from "node:test";

test("화면 모듈과 분리된 스타일 자산을 모두 제공한다", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  const routes = [
    "/foundation.css",
    "/shell.css",
    "/controls.css",
    "/body-map.css",
    "/body-index.css",
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

test("Health Map 신체 아틀라스 이미지를 WebP 자산으로 제공한다", async () => {
  const { default: worker } = await import("../dist/server/index.js");

  const response = await worker.fetch(
    new Request("https://example.com/assets/body-atlas-v4.webp"),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.equal(response.headers.get("content-length"), null);
  const signature = Buffer.from(await response.arrayBuffer()).subarray(0, 4).toString("ascii");
  assert.equal(signature, "RIFF");
});

test("랜딩 히어로 이미지를 PNG 자산으로 제공한다", async () => {
  const { default: worker } = await import("../dist/server/index.js");

  const response = await worker.fetch(
    new Request("https://example.com/assets/visit-prep-hero.png"),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  const signature = Buffer.from(await response.arrayBuffer()).subarray(0, 8).toString("hex");
  assert.equal(signature, "89504e470d0a1a0a");
});

test("임상 워크스페이스 빈 상태 이미지를 투명 PNG 자산으로 제공한다", async () => {
  const { default: worker } = await import("../dist/server/index.js");

  const response = await worker.fetch(
    new Request("https://example.com/assets/clinical-workspace-empty.png"),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  const signature = Buffer.from(await response.arrayBuffer()).subarray(0, 8).toString("hex");
  assert.equal(signature, "89504e470d0a1a0a");
});
