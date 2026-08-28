import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Vercel 배포가 빌드된 워커와 같은 출처 API를 그대로 제공한다", async () => {
  // Given
  const [handlerSource, functionSource, vercelConfig, packageConfig] = await Promise.all([
    readFile("scripts/app-server.mjs", "utf8"),
    readFile("api/index.js", "utf8"),
    readFile("vercel.json", "utf8"),
    readFile("package.json", "utf8"),
  ]);
  const config = JSON.parse(vercelConfig);

  // When
  const sharesOneHandler = handlerSource.includes("export function handleNodeRequest")
    && functionSource.includes('from "../scripts/app-server.mjs"');

  // Then
  assert.equal(sharesOneHandler, true);
  assert.equal(config.buildCommand, "npm run build");
  assert.equal(config.outputDirectory, "public");
  assert.deepEqual(config.rewrites, [{ source: "/(.*)", destination: "/api" }]);
  assert.equal(config.functions["api/index.js"].maxDuration, 60);
  assert.match(packageConfig, /"start": "node scripts\/server\.mjs"/);
});

test("로컬 Node 서버는 여전히 외부 요청을 받을 수 있게 구성된다", async () => {
  // Given
  const serverSource = await readFile("scripts/server.mjs", "utf8");

  // When
  const hasPublicBinding = serverSource.includes('server.listen(port, "0.0.0.0"');

  // Then
  assert.equal(hasPublicBinding, true);
  assert.match(serverSource, /from "\.\/app-server\.mjs"/);
});

test("Render 배포 설정은 저장소에 남기지 않는다", async () => {
  // Given / When
  const missing = await readFile("render.yaml", "utf8").then(() => false, () => true);

  // Then
  assert.equal(missing, true);
});
