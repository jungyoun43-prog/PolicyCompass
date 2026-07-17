import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("모든 주요 화면은 명시적 Main 링크를 제공한다", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  for (const route of ["/", "/map", "/connections", "/insights", "/journey"]) {
    const response = await worker.fetch(new Request(`https://example.com${route}`));
    const html = await response.text();
    assert.equal(response.status, 200, route);
    assert.match(html, /data-main-link/, route);
  }
});

test("Health Map은 빈 세 번째 컬럼 없이 두 영역을 균형 있게 배치한다", async () => {
  const css = await readFile("src/controls.css", "utf8");
  assert.match(css, /grid-template-columns: minmax\(320px, 0\.78fr\) minmax\(520px, 1\.22fr\)/);
});

test("공통 앱 셸은 모든 페이지 배경과 헤더 폭을 공유한다", async () => {
  const css = await readFile("src/foundation.css", "utf8");
  assert.match(css, /--page-width: 1480px/);
  assert.match(css, /body\.map-page/);
  assert.match(css, /\.site-header/);
});
