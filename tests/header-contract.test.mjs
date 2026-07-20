import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const pages = [
  ["src/landing.html", "/patient"],
  ["src/index.html", "/map"],
  ["src/connections.html", "/connections"],
  ["src/insights.html", "/insights"],
  ["src/journey.html", "/journey"],
];

const navigation = [
  ["/patient", "시작"],
  ["/map", "건강 지도"],
  ["/connections", "연결 보기"],
  ["/insights", "진료 준비"],
  ["/journey", "기록"],
];

test("모든 화면은 같은 VitaGraph 앱 헤더 계약을 사용한다", async () => {
  for (const [file, activeRoute] of pages) {
    const html = await readFile(file, "utf8");
    const header = html.match(/<header class="app-header">([\s\S]*?)<\/header>/)?.[0] ?? "";

    assert.match(header, /class="app-header__inner"/, file);
    assert.match(header, /class="app-brand" href="\/patient"/, file);
    assert.match(header, /class="app-nav"/, file);
    assert.match(header, /class="app-header__action" href="\/map#import-record">/, file);

    for (const [route, label] of navigation) {
      assert.match(header, new RegExp('<a href="' + route + '"[^>]*>' + label + '<\\/a>'), file);
    }

    assert.match(
      header,
      new RegExp('<a href="' + activeRoute + '"[^>]*aria-current="page"[^>]*>'),
      file,
    );
  }
});

test("게이트웨이는 의료진 EMR과 개인 VitaGraph 진입점을 분리한다", async () => {
  const html = await readFile("src/gateway.html", "utf8");

  assert.match(html, /class="app-brand" href="\/"/);
  assert.match(html, /href="\/emr"[^>]*>\s*의료진 EMR 열기/s);
  assert.match(html, /href="\/patient"[^>]*>\s*개인 VitaGraph 열기/s);
  assert.match(html, /두 앱은 환자용 파일로만 연결됩니다/);
});

test("EMR 헤더는 임상 워크스페이스 안에서만 이동한다", async () => {
  const html = await readFile("src/emr.html", "utf8");
  const header = html.match(/<header class="app-header clinical-header">([\s\S]*?)<\/header>/)?.[0] ?? "";
  const hrefs = [...header.matchAll(/\bhref="([^"]+)"/g)].map(([, href]) => href);

  assert.match(header, /class="app-brand" href="\/emr"/);
  assert.ok(hrefs.filter((href) => href.startsWith("#")).length >= 1);
  for (const route of ["/patient", "/map", "/connections", "/insights", "/journey"]) {
    assert.equal(hrefs.includes(route), false, route);
  }
});

test("페이지 타이틀은 강제 줄바꿈 없이 반응형으로 흐른다", async () => {
  for (const [file] of pages) {
    const html = await readFile(file, "utf8");
    assert.doesNotMatch(html, /<br\s*\/?\s*>/i, file);
  }
});
