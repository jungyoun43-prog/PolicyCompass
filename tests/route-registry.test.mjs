import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeRegistry = [
  { path: "/", layout: "app/(gateway)/layout.jsx", presentation: "patient-presentation.css" },
  { path: "/patient", layout: "app/(landing)/layout.jsx", presentation: "patient-presentation.css" },
  { path: "/map", layout: "app/(map)/layout.jsx", presentation: "clinician-hierarchy.css" },
  { path: "/connections", layout: "app/(connections)/layout.jsx", presentation: "clinician-hierarchy.css" },
  { path: "/insights", layout: "app/(insights)/layout.jsx", presentation: "clinician-hierarchy.css" },
  { path: "/journey", layout: "app/(journey)/layout.jsx", presentation: "clinician-hierarchy.css" },
  { path: "/emr", layout: "app/(emr)/layout.jsx", presentation: "emr.css" },
];

function importedStylesheets(source) {
  return [...source.matchAll(/import "[^"]*\/([a-z0-9-]+\.css)"/g)].map(([, name]) => name);
}

test("정식 라우트 레지스트리는 중복 없이 일곱 화면을 모두 열거한다", () => {
  assert.deepEqual(
    routeRegistry.map(({ path }) => path),
    ["/", "/patient", "/map", "/connections", "/insights", "/journey", "/emr"],
  );
  assert.equal(new Set(routeRegistry.map(({ path }) => path)).size, 7);
});

test("등록된 모든 화면은 공통 테마·컨트롤과 대상별 프레젠테이션 모듈로 렌더링된다", async () => {
  for (const { path, layout, presentation } of routeRegistry) {
    const source = await readFile(layout, "utf8");
    const stylesheets = importedStylesheets(source);

    assert.ok(stylesheets.includes("foundation.css"), `${path}: shared theme`);
    assert.ok(stylesheets.includes("controls.css"), `${path}: reusable controls`);
    assert.ok(stylesheets.includes(presentation), `${path}: ${presentation}`);
  }
});

test("모든 화면은 main 랜드마크를 렌더한다", async () => {
  const pages = {
    "/": "app/(gateway)/page.jsx",
    "/patient": "app/(landing)/patient/page.jsx",
    "/map": "app/(map)/map/page.jsx",
    "/connections": "app/(connections)/connections/page.jsx",
    "/insights": "app/(insights)/insights/page.jsx",
    "/journey": "app/(journey)/journey/page.jsx",
    "/emr": "components/emr/emr-app.jsx",
  };
  for (const [path, file] of Object.entries(pages)) {
    assert.match(await readFile(file, "utf8"), /<main/, path);
  }
});
