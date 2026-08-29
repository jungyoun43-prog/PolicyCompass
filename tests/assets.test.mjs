import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

// The old Cloudflare-style worker served every asset route by hand. Next.js
// serves public/ statically, so these tests pin the files themselves and the
// bundle imports that replaced the hand-written route table.

test("스타일 자산은 모두 레이아웃이나 컨트롤러 번들에 연결된다", async () => {
  const cssFiles = (await readdir("src")).filter((name) => name.endsWith(".css"));
  const layoutSources = await Promise.all([
    "app/(gateway)/layout.jsx",
    "app/(landing)/layout.jsx",
    "app/(map)/layout.jsx",
    "app/(connections)/layout.jsx",
    "app/(insights)/layout.jsx",
    "app/(journey)/layout.jsx",
    "app/(emr)/layout.jsx",
  ].map((file) => readFile(file, "utf8")));
  const combined = layoutSources.join("\n");

  assert.ok(cssFiles.length >= 15);
  for (const name of cssFiles) {
    assert.ok(combined.includes(`/${name}"`), `${name}는 최소 한 레이아웃에서 import되어야 한다`);
  }
});

test("3D 신체 아틀라스 GLB는 public 자산으로 유지된다", async () => {
  const buffer = await readFile("public/assets/body-atlas-3d-v4.glb");
  assert.equal(buffer.subarray(0, 4).toString("ascii"), "glTF");
});

test("Health Map 신체 아틀라스 이미지를 WebP 자산으로 제공한다", async () => {
  const buffer = await readFile("public/assets/body-atlas-v5.webp");
  assert.equal(buffer.subarray(0, 4).toString("ascii"), "RIFF");
});

test("랜딩 히어로 이미지를 PNG 자산으로 제공한다", async () => {
  const buffer = await readFile("public/assets/visit-prep-hero.png");
  assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
});

test("임상 워크스페이스 빈 상태 이미지를 투명 PNG 자산으로 제공한다", async () => {
  const buffer = await readFile("public/assets/clinical-workspace-empty.png");
  assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
});

test("Journey의 진료 준비 일러스트를 WebP 자산으로 제공한다", async () => {
  const buffer = await readFile("public/assets/patient-journey-bridge.webp");
  assert.equal(buffer.subarray(0, 4).toString("ascii"), "RIFF");
});

test("구 vendor 런타임 참조가 남아 있지 않다", async () => {
  const loaders = await readFile("components/legacy-script.jsx", "utf8");
  assert.match(loaders, /import\("@google\/model-viewer"\)/);
  const pages = await Promise.all([
    "app/(map)/map/page.jsx",
    "components/emr/tabs/body-tab.jsx",
  ].map((file) => readFile(file, "utf8")));
  for (const source of pages) {
    assert.doesNotMatch(source, /\/vendor\/model-viewer/);
  }
});
