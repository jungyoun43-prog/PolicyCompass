import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { emrMarkup, pageMarkup } from "./helpers/markup.mjs";

test("역할 게이트웨이는 두 앱의 명시적 진입점을 제공한다", async () => {
  const html = await pageMarkup("/");

  assert.match(html, /href="\/emr"[^>]*data-main-link/);
  assert.match(html, /href="\/patient"/);
});

test("개인 앱의 모든 주요 화면은 /patient 홈 링크를 제공한다", async () => {
  for (const route of ["/patient", "/map", "/connections", "/insights", "/journey"]) {
    const html = await pageMarkup(route);
    assert.match(html, /class="app-brand" href="\/patient"/, route);
  }
});

test("임상 앱은 /emr을 독립 워크스페이스 홈으로 제공한다", async () => {
  const html = await emrMarkup();

  assert.match(html, /class="app-brand" href="\/emr"/);
  assert.match(html, /id="clinicalBodyTitle"/);
  assert.match(html, /src="\/assets\/body-atlas-v5\.webp"/);
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
