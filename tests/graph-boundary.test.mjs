import assert from "node:assert/strict";
import test from "node:test";

import PatientPage from "../app/(landing)/patient/page.jsx";
import MapPage from "../app/(map)/map/page.jsx";
import ConnectionsPage from "../app/(connections)/connections/page.jsx";
import { declarationsFor, stylesheet } from "./helpers/css.mjs";
import { renderComponent } from "./helpers/render.mjs";

/** The HTML the server sends for a route's page (effects do not run). */
const pages = { "/patient": PatientPage, "/map": MapPage, "/connections": ConnectionsPage };
const renderPage = (route) => renderComponent(pages[route]);

function findElementEnd(source, start, tagName) {
  const tags = new RegExp(`<\\/?${tagName}\\b[^>]*>`, "g");
  tags.lastIndex = start;
  let depth = 0;
  let match;

  while ((match = tags.exec(source))) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return tags.lastIndex;
  }

  return -1;
}

/** The outer HTML of the first element carrying `className` (no same-tag nesting inside). */
function elementByClass(html, tagName, className) {
  const start = html.search(new RegExp(`<${tagName} class="${className}"`));
  if (start < 0) return "";
  return html.slice(start, findElementEnd(html, start, tagName));
}

test("랜딩 미리보기는 실제 진료 준비 결과물을 보여 준다", () => {
  const preview = elementByClass(renderPage("/patient"), "article", "brief-preview");

  assert.notEqual(preview, "", "brief-preview 미리보기가 렌더링되어야 한다.");
  assert.match(preview, /예시 데이터/);
  assert.match(preview, /다음 진료에서 확인할 질문/);
  assert.match(preview, /가정 혈압/);
  assert.match(preview, /개인별 위험도나 질병 확률을 계산하지 않습니다/);
  assert.doesNotMatch(preview, /AI|LLM/);
});

test("메인 히어로는 생성 이미지와 의미 있는 대체 텍스트를 사용한다", () => {
  const hero = elementByClass(renderPage("/patient"), "figure", "landing-hero__visual");

  assert.notEqual(hero, "", "히어로 figure가 렌더링되어야 한다.");
  assert.match(hero, /<img\b[^>]*\bsrc="\/assets\/visit-prep-hero\.png"/);
  assert.match(hero, /<img\b[^>]*\bwidth="1586"/);
  assert.match(hero, /<img\b[^>]*\bheight="992"/);
  assert.match(hero, /<img\b[^>]*\balt="[^"]+"/);
});

test("Connections는 관리 메모를 그래프 밖 상세 패널에 둔다", () => {
  const html = renderPage("/connections");

  assert.match(html, /id="explorerDetailChecks"/);
  assert.match(html, /id="explorerDetailNutrition"/);
  assert.match(html, /id="explorerDetailCare"/);
  assert.doesNotMatch(html, /관리 가지/);
});

test("Health Map은 12개 진료과 영역의 활성·비활성 상태를 구분한다", () => {
  const html = renderPage("/map");

  assert.match(html, /<img class="human-figure__image"/);
  assert.match(html, /<img class="human-figure__image"[^>]*\bsrc="\/assets\/body-atlas-v5\.webp"/);
  assert.doesNotMatch(html, /class="human-figure__svg"/);
  assert.equal((html.match(/<button class="body-hotspot /g) ?? []).length, 12);
  assert.match(html, /신경과/);
  assert.match(html, /정신건강의학과/);
  assert.match(html, /순환기내과/);
  assert.match(html, /신장내과/);
  assert.match(html, /류마티스내과/);
  assert.match(html, /기록과 연결됨/);
  assert.match(html, /현재 기록에 없음/);
  assert.match(html, /<div class="body-stage"[^>]*\bdata-body-context="patient"/);
  assert.match(html, /<div class="body-stage"[^>]*\bdata-body-model="\/assets\/body-atlas-3d-v4\.glb"/);
});

test("Health Map 상세는 신체 지도와 겹치지 않는 다음 형제로 분리되고 반응형 폭을 넘지 않는다", async () => {
  const html = renderPage("/map");
  const [bodyMapCss, controlsCss, responsiveCss] = await Promise.all([
    stylesheet("src/body-map.css"),
    stylesheet("src/controls.css"),
    stylesheet("src/responsive.css"),
  ]);
  const stageStart = html.indexOf('<div class="body-stage"');
  const stageEnd = findElementEnd(html, stageStart, "div");
  const figureStart = html.indexOf('<div class="human-figure"', stageStart);
  const figureEnd = findElementEnd(html, figureStart, "div");
  const detailStart = html.indexOf('<section class="panel detail-panel"', stageEnd);

  assert.ok(stageStart >= 0 && stageEnd > stageStart, "body-stage 경계를 찾을 수 있어야 한다.");
  assert.ok(figureStart > stageStart && figureEnd > figureStart, "human-figure가 body-stage 안에 있어야 한다.");
  assert.equal(html.slice(figureEnd, stageEnd).trim(), "</div>", "body-stage에는 human-figure만 있어야 한다.");
  assert.ok(detailStart >= stageEnd, "상세는 body-stage 다음에 있어야 한다.");
  assert.equal(html.slice(stageEnd, detailStart).trim(), "", "상세는 body-stage의 바로 다음 형제여야 한다.");
  assert.equal((html.slice(stageStart, stageEnd).match(/class="panel detail-panel"/g) ?? []).length, 0);
  assert.match(html.slice(detailStart, findElementEnd(html, detailStart, "section")), /aria-labelledby="detailTitle"/);
  for (const id of ["detailTone", "detailSystem", "detailTitle", "detailSummary", "detailRelation", "detailChecks", "detailCare"]) {
    assert.equal((html.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 1, `${id}는 한 번만 유지되어야 한다.`);
  }

  const stage = declarationsFor(bodyMapCss, ".body-stage");
  assert.equal(stage.display, "grid");
  assert.equal(stage["min-width"], "0");
  assert.equal(stage.overflow, "hidden");

  const figure = declarationsFor(bodyMapCss, ".human-figure");
  assert.equal(figure.position, "relative");
  assert.equal(figure.width, "min(78%, 360px)");
  assert.equal(figure.height, "auto");
  assert.equal(figure["aspect-ratio"], "2 / 3");

  const detail = declarationsFor(bodyMapCss, ".body-panel > .detail-panel");
  assert.equal(detail["max-width"], "100%");
  assert.equal(detail["min-width"], "0");
  assert.ok(detail.border, "상세 패널은 테두리로 경계를 드러내야 한다.");
  assert.equal(detail["box-shadow"], "none");
  assert.equal(detail.overflow, "hidden");
  assert.equal(
    declarationsFor(bodyMapCss, ".body-panel > .detail-panel :where(h2, h3, p, li)")["overflow-wrap"],
    "anywhere",
  );

  const tabletFigure = declarationsFor(bodyMapCss, ".human-figure", { container: "@media (max-width: 780px)" });
  assert.equal(tabletFigure.width, "min(84%, 340px)");
  assert.equal(tabletFigure.height, "auto");
  const phoneFigure = declarationsFor(bodyMapCss, ".human-figure", { container: "@media (max-width: 520px)" });
  assert.equal(phoneFigure.width, "min(92%, 308px)");
  assert.equal(phoneFigure.height, "auto");

  assert.deepEqual(declarationsFor(controlsCss, ".map-page .body-stage"), { flex: "0 0 auto", "min-height": "0" });
  assert.equal(
    declarationsFor(responsiveCss, ".detail-panel", { container: "@media (max-width: 780px)" })["grid-template-columns"],
    "1fr",
  );
});
