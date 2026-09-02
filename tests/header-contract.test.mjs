import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { Tabs as TabsPrimitive } from "radix-ui";

import GatewayPage from "../app/(gateway)/page.jsx";
import PatientPage from "../app/(landing)/patient/page.jsx";
import MapPage from "../app/(map)/map/page.jsx";
import ConnectionsPage from "../app/(connections)/connections/page.jsx";
import InsightsPage from "../app/(insights)/insights/page.jsx";
import JourneyPage from "../app/(journey)/journey/page.jsx";
import { ClinicalHeader } from "../components/emr/chrome.jsx";
import { WorkspaceHeader } from "../components/emr/workspace-header.jsx";
import { renderComponent } from "./helpers/render.mjs";

/**
 * The personal pages are plain server components, so they render the way the
 * server does; the LegacyScript controller they mount is an effect and adds
 * nothing to the markup.
 */
const PAGES = {
  "/": GatewayPage,
  "/patient": PatientPage,
  "/map": MapPage,
  "/connections": ConnectionsPage,
  "/insights": InsightsPage,
  "/journey": JourneyPage,
};
const renderPage = (route) => renderComponent(PAGES[route]);

const pages = ["/patient", "/map", "/connections", "/insights", "/journey"];

const navigation = [
  ["/patient", "시작"],
  ["/map", "건강 지도"],
  ["/connections", "연결 보기"],
  ["/insights", "진료 준비"],
  ["/journey", "기록"],
];

const renderWorkspaceHeader = () => renderComponent(() => createElement(TabsPrimitive.Root, { value: "encounter" }, createElement(WorkspaceHeader, { onSelectTab: () => {} })));

test("모든 화면은 같은 PolicyCompass 앱 헤더 계약을 사용한다", () => {
  for (const activeRoute of pages) {
    const html = renderPage(activeRoute);
    const file = activeRoute;
    const headers = html.match(/<header class="app-header">[\s\S]*?<\/header>/g) ?? [];
    assert.equal(headers.length, 1, file);
    const header = headers[0];

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
    assert.equal((header.match(/aria-current="page"/g) ?? []).length, 1, file);
  }
});

test("게이트웨이는 의료진 EMR과 개인 PolicyCompass 진입점을 분리한다", () => {
  const html = renderPage("/");

  assert.match(html, /class="app-brand" href="\/"/);
  assert.match(html, /href="\/emr"[^>]*>\s*의료진 EMR 열기/s);
  assert.match(html, /href="\/patient"[^>]*>\s*개인 PolicyCompass 열기/s);
  assert.match(html, /의료진과 개인 사이의 기록 전달 방식/);
  assert.match(html, /의료진이 환자용 파일과 일회성 코드를 따로 전달/);
  assert.match(html, /파일과 별도 확인 코드 대조/);
  assert.match(html, /선택한 질문을 직접 전달/);
  assert.doesNotMatch(html, /자동 연결/);
});

test("EMR 헤더는 환자 화면 탭과 환자 추가 전역 작업을 중복하지 않는다", () => {
  // A patient is selected: the header carries the workspace tabs and the local-data utilities.
  const html = renderComponent(ClinicalHeader, {
    demo: true,
    onExitDemo: () => {},
    ai: { mode: "none", configured: false, detail: "미연결" },
    nav: createElement(TabsPrimitive.Root, { value: "encounter" }, createElement(WorkspaceHeader, { onSelectTab: () => {} })),
    utilities: createElement("span", { className: "test-utilities" }, "utilities"),
  });
  const header = html.match(/<header class="app-header clinical-header">([\s\S]*?)<\/header>/)?.[0] ?? "";
  const hrefs = [...header.matchAll(/\bhref="([^"]+)"/g)].map(([, href]) => href);

  assert.match(header, /class="app-brand" href="\/emr"/);
  assert.match(header, /role="tablist"[^>]*class="workspace-tabs"/);
  assert.match(header, /class="test-utilities"/);
  assert.doesNotMatch(header, /class="app-header__action"|href="#patientComposer"|>환자 추가<\/a>/);
  assert.doesNotMatch(header, /class="app-nav clinical-nav"/);
  assert.doesNotMatch(header, /data-tab-target/);
  assert.deepEqual(hrefs, ["/emr"]);
  for (const route of ["/patient", "/map", "/connections", "/insights", "/journey"]) {
    assert.equal(hrefs.includes(route), false, route);
  }
});

test("EMR 환자 화면은 한 개의 탭 목록과 일관된 명칭을 사용한다", () => {
  const html = renderWorkspaceHeader();
  const tablists = html.match(/role="tablist"/g) ?? [];

  assert.equal(tablists.length, 1);
  const tabLabels = [...html.matchAll(/<button[^>]*role="tab"[^>]*>([^<]+)<\/button>/g)].map(([, label]) => label);
  assert.deepEqual(tabLabels, ["오늘 진료", "환자 요약", "과거 기록", "신체 지도", "급여 보드", "Journey", "감사·데이터"]);
  assert.doesNotMatch(html, /차트|급여 칸반/);
});

test("페이지 타이틀은 강제 줄바꿈 없이 반응형으로 흐른다", () => {
  for (const route of pages) {
    assert.doesNotMatch(renderPage(route), /<br\s*\/?\s*>/i, route);
  }
});
