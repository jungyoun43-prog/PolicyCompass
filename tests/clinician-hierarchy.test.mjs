import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const composedRoutes = [
  ["/map", "src/index.html"],
  ["/connections", "src/connections.html"],
  ["/insights", "src/insights.html"],
  ["/journey", "src/journey.html"],
];

test("등록된 정보 중심 화면은 공유 밀도 계층 모듈을 조합한다", async () => {
  for (const [route, file] of composedRoutes) {
    const html = await readFile(file, "utf8");

    assert.match(html, /href="\/clinician-hierarchy\.css"/, route);
    assert.match(html, /<body class="[^"]*clinician-hierarchy(?:\s|\")/, route);
    assert.match(html, /<main class="[^"]*clinician-hierarchy__workspace(?:\s|\")/, route);
    assert.match(html, /clinician-hierarchy__summary/, route);
    assert.match(html, /clinician-hierarchy__groups/, route);
  }
});

test("계층 모듈은 기존 토큰만 소비하고 컨트롤 계약을 만들지 않는다", async () => {
  const css = await readFile("src/clinician-hierarchy.css", "utf8");

  assert.doesNotMatch(css, /:root|--[\w-]+\s*:/);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b/i);
  assert.doesNotMatch(css, /\b(button|input|textarea|select)\b/);
  for (const token of ["border-subtle", "space-3", "space-4", "space-5", "space-6", "muted", "font-mono"]) {
    assert.match(css, new RegExp(`var\\(--${token}\\)`), token);
  }
});

test("좁은 화면 계층은 콘텐츠 폭과 긴 문자열을 안전하게 제한한다", async () => {
  const css = await readFile("src/clinician-hierarchy.css", "utf8");

  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /max-width: 100%/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /min-width: 0/);
});

test("게이트웨이와 앱 홈 및 EMR 경계에는 밀도 모듈을 주입하지 않는다", async () => {
  for (const file of ["src/gateway.html", "src/landing.html", "src/emr.html"]) {
    const html = await readFile(file, "utf8");
    assert.doesNotMatch(html, /clinician-hierarchy/, file);
  }
});
