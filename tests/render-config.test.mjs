import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Render Web Service가 외부 요청을 받을 수 있게 구성된다", async () => {
  // Given
  const [serverSource, renderConfig, packageConfig] = await Promise.all([
    readFile("scripts/render-server.mjs", "utf8"),
    readFile("render.yaml", "utf8"),
    readFile("package.json", "utf8"),
  ]);

  // When
  const hasPublicBinding = serverSource.includes('server.listen(port, "0.0.0.0"');

  // Then
  assert.equal(hasPublicBinding, true);
  assert.match(renderConfig, /type: web/);
  assert.match(renderConfig, /runtime: node/);
  assert.match(renderConfig, /buildCommand: npm run build/);
  assert.match(renderConfig, /startCommand: node scripts\/render-server\.mjs/);
  assert.match(packageConfig, /"start": "node scripts\/render-server\.mjs"/);
});
