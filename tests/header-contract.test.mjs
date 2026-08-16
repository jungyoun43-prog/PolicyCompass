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
    assert.match(header, /class="app-header__action" href="\/map#import-record">환자용 기록 가져오기<\/a>/, file);

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
  assert.match(html, /의료진과 개인 사이의 기록 전달 방식/);
  assert.match(html, /의료진이 환자용 파일과 일회성 코드를 따로 전달/);
  assert.match(html, /파일과 별도 확인 코드 대조/);
  assert.match(html, /선택한 질문을 직접 전달/);
  assert.doesNotMatch(html, /자동 연결/);
});

test("EMR 헤더는 환자 화면 탭과 환자 추가 전역 작업을 중복하지 않는다", async () => {
  const html = await readFile("src/emr.html", "utf8");
  const header = html.match(/<header class="app-header clinical-header">([\s\S]*?)<\/header>/)?.[0] ?? "";
  const hrefs = [...header.matchAll(/\bhref="([^"]+)"/g)].map(([, href]) => href);

  assert.match(header, /class="app-brand" href="\/emr"/);
  assert.doesNotMatch(header, /class="app-header__action"|href="#patientComposer"|>환자 추가<\/a>/);
  assert.doesNotMatch(header, /class="app-nav clinical-nav"/);
  assert.doesNotMatch(header, /data-tab-target/);
  assert.deepEqual(hrefs, ["/emr"]);
  for (const route of ["/patient", "/map", "/connections", "/insights", "/journey"]) {
    assert.equal(hrefs.includes(route), false, route);
  }
});

test("EMR 환자 화면은 한 개의 탭 목록과 일관된 명칭을 사용한다", async () => {
  const html = await readFile("src/emr.html", "utf8");
  const tablists = [...html.matchAll(/<div class="workspace-tabs" role="tablist"[\s\S]*?<\/div>/g)];

  assert.equal(tablists.length, 1);
  const tablist = tablists[0][0];
  assert.equal((tablist.match(/role="tab"/g) ?? []).length, 7);
  for (const label of ["오늘 진료", "환자 요약", "과거 기록", "신체 지도", "급여 보드", "Journey", "감사·데이터"]) {
    assert.match(tablist, new RegExp(`>${label}<\\/button>`));
  }
  assert.doesNotMatch(tablist, />차트<\/button>|>급여 칸반<\/button>/);
});

test("페이지 타이틀은 강제 줄바꿈 없이 반응형으로 흐른다", async () => {
  for (const [file] of pages) {
    const html = await readFile(file, "utf8");
    assert.doesNotMatch(html, /<br\s*\/?\s*>/i, file);
  }
});
