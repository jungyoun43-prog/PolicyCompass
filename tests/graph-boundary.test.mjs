import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

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

test("랜딩 미리보기는 실제 진료 준비 결과물을 보여 준다", async () => {
  const html = await readFile("src/landing.html", "utf8");
  const preview = html.match(/<article class="brief-preview"[\s\S]*?<\/article>/)?.[0] ?? "";

  assert.match(preview, /예시 데이터/);
  assert.match(preview, /다음 진료에서 확인할 질문/);
  assert.match(preview, /가정 혈압/);
  assert.match(preview, /개인별 위험도나 질병 확률을 계산하지 않습니다/);
  assert.doesNotMatch(preview, /AI|LLM/);
});

test("메인 히어로는 생성 이미지와 의미 있는 대체 텍스트를 사용한다", async () => {
  const html = await readFile("src/landing.html", "utf8");
  const hero = html.match(/<figure class="landing-hero__visual"[\s\S]*?<\/figure>/)?.[0] ?? "";

  assert.match(hero, /src="\/assets\/visit-prep-hero\.png"/);
  assert.match(hero, /width="1586"/);
  assert.match(hero, /height="992"/);
  assert.match(hero, /alt="[^"]+"/);
});

test("Connections는 관리 메모를 그래프 밖 상세 패널에 둔다", async () => {
  const html = await readFile("src/connections.html", "utf8");

  assert.match(html, /id="explorerDetailChecks"/);
  assert.match(html, /id="explorerDetailNutrition"/);
  assert.match(html, /id="explorerDetailCare"/);
  assert.doesNotMatch(html, /관리 가지/);
});

test("Health Map은 12개 진료과 영역의 활성·비활성 상태를 구분한다", async () => {
  const html = await readFile("src/index.html", "utf8");

  assert.match(html, /class="human-figure__image"/);
  assert.match(html, /src="\/assets\/body-atlas-v4\.webp"/);
  assert.doesNotMatch(html, /class="human-figure__svg"/);
  assert.equal((html.match(/<button class="body-hotspot /g) ?? []).length, 12);
  assert.match(html, /신경과/);
  assert.match(html, /정신건강의학과/);
  assert.match(html, /순환기내과/);
  assert.match(html, /신장내과/);
  assert.match(html, /류마티스내과/);
  assert.match(html, /기록과 연결됨/);
  assert.match(html, /현재 기록에 없음/);
  assert.match(html, /data-body-context="patient"/);
  assert.match(html, /data-body-model="\/assets\/body-atlas-3d-v2\.glb"/);
});

test("Health Map 상세는 신체 지도와 겹치지 않는 다음 형제로 분리되고 반응형 폭을 넘지 않는다", async () => {
  const [html, bodyMapCss, controlsCss, responsiveCss] = await Promise.all([
    readFile("src/index.html", "utf8"),
    readFile("src/body-map.css", "utf8"),
    readFile("src/controls.css", "utf8"),
    readFile("src/responsive.css", "utf8"),
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

  assert.match(bodyMapCss, /\.body-stage\s*\{[^}]*display:\s*grid[^}]*min-width:\s*0[^}]*overflow:\s*hidden/s);
  assert.match(bodyMapCss, /\.human-figure\s*\{[^}]*position:\s*relative[^}]*width:\s*64%[^}]*height:\s*532px/s);
  assert.match(bodyMapCss, /\.body-panel > \.detail-panel\s*\{[^}]*max-width:\s*100%[^}]*min-width:\s*0[^}]*border:[^}]*box-shadow:\s*none[^}]*overflow:\s*hidden/s);
  assert.match(bodyMapCss, /\.body-panel > \.detail-panel :where\(h2, h3, p, li\)\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(bodyMapCss, /@media \(max-width: 780px\)[\s\S]*?\.human-figure\s*\{[^}]*width:\s*68%[^}]*height:\s*472px/s);
  assert.match(bodyMapCss, /@media \(max-width: 520px\)[\s\S]*?\.human-figure\s*\{[^}]*width:\s*74%[^}]*height:\s*468px/s);
  assert.match(controlsCss, /\.map-page \.body-stage\s*\{\s*flex:\s*0 0 auto;\s*min-height:\s*0;\s*\}/);
  assert.match(responsiveCss, /@media \(max-width: 780px\)[\s\S]*?\.detail-panel\s*\{[^}]*grid-template-columns:\s*1fr/s);
});
