import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const pages = [
  ["src/landing.html", "/"],
  ["src/index.html", "/map"],
  ["src/connections.html", "/connections"],
  ["src/insights.html", "/insights"],
  ["src/journey.html", "/journey"],
];

const navigation = [
  ["/", "시작"],
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
    assert.match(header, /class="app-brand"/, file);
    assert.match(header, /class="app-nav"/, file);
    assert.match(header, /class="app-header__action" href="\/map">/, file);

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

test("페이지 타이틀은 강제 줄바꿈 없이 반응형으로 흐른다", async () => {
  for (const [file] of pages) {
    const html = await readFile(file, "utf8");
    assert.doesNotMatch(html, /<br\s*\/?\s*>/i, file);
  }
});
