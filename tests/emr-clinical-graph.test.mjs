import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, css, script] = await Promise.all([
  readFile(new URL("../src/emr.html", import.meta.url), "utf8"),
  readFile(new URL("../src/emr.css", import.meta.url), "utf8"),
  readFile(new URL("../src/emr.js", import.meta.url), "utf8"),
]);

test("임상 관계 지도는 중심 문제·확정 기록·추론 연결을 서로 다른 계약으로 설명한다", () => {
  for (const id of ["graphProblemCount", "graphRecordCount", "graphRelationCount", "graphDateRange", "graphProjectionNotice"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /전체 기록 범위/);
  assert.match(script, /projection\.omittedRecords/);
  assert.match(html, /점선은 코드·표시명으로 자동 분류한 탐색 보조/);
  assert.match(html, /의학적 인과나 차트에 명시된 관계가 아닙니다/);
  assert.match(html, /연결되지 않은 기록도 차트 사실/);
  assert.match(script, /독립된 확정 기록 · 자동 연결 기준 없음/);
  assert.match(script, /차트 사실·의학적 인과 아님/);
});

test("임상 관계 지도는 선택 상세·원문 확인·키보드 탐색을 제공한다", () => {
  assert.match(html, /data-graph-discovery="clinical"/);
  assert.match(html, /data-selection-state="ready"/);
  assert.match(html, /id="graphSelectionDetail"/);
  assert.match(html, /id="graphOpenChart"/);
  assert.match(script, /"data-graph-node": node\.id/);
  assert.match(script, /role: "button"/);
  assert.match(script, /"aria-pressed": "false"/);
  assert.match(script, /\["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"\]/);
  assert.match(script, /graphOpenChart\.dataset\.eventId = node\.id/);
  assert.match(script, /item\.dataset\.eventId = event\.id/);
  assert.match(script, /event-source-target-label/);
  assert.match(script, /switchTab\("chart"\)/);
});

test("좁은 임상 화면은 그래프를 잘라내지 않고 내부 가로 탐색으로 한정한다", () => {
  assert.match(css, /#clinicalGraph\s*\{[^}]*width:\s*max\(100%, 760px\)/s);
  assert.match(css, /\.clinical-graph-stage\s*\{[^}]*overflow:\s*auto/s);
  assert.match(css, /@media \(max-width: 1380px\)[\s\S]*?\.clinical-graph-layout\s*\{\s*grid-template-columns:\s*1fr/s);
  assert.match(css, /\.clinical-graph-pan-hint\s*\{[^}]*display:\s*none/s);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*?\.clinical-graph-pan-hint\s*\{\s*display:\s*block/s);
});
