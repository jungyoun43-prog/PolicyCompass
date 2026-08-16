import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routes = new Map([
  ["/", ["gateway.html", /데이터 입력 없음/]],
  ["/patient", ["landing.html", /개인용 · 이 브라우저에 저장 · 서버 자동 전송 없음 · 진단이나 처방 아님/]],
  ["/map", ["index.html", /진단 결과가 아닌 대화 준비용 지도/]],
  ["/connections", ["connections.html", /0개 질환/]],
  ["/insights", ["insights.html", /현재 브리프/]],
  ["/journey", ["journey.html", /현재 브라우저의 이 기기에만 저장/]],
  ["/emr", ["emr.html", /평가용 · 인증된 EMR·청구 소프트웨어 아님 · 삭감 방지 보장 없음/]],
]);

function assertExposedRouteContext(html, route, expected) {
  const matches = html.match(/<[^>]+data-route-context[^>]*>[\s\S]*?<\/[^>]+>/g) ?? [];
  assert.equal(matches.length, 1, `${route}: route context must be unique`);
  const openingTag = matches[0].match(/^<[^>]+>/)?.[0] ?? "";
  const contextOffset = html.indexOf(openingTag);
  const precedingMarkup = html.slice(0, contextOffset);
  const lastDetailsOpen = precedingMarkup.lastIndexOf("<details");
  const lastDetailsClose = precedingMarkup.lastIndexOf("</details>");

  assert.match(matches[0], expected, `${route}: route context must retain its safety or status copy`);
  assert.doesNotMatch(openingTag, /^<(?:details|summary)\b/i, `${route}: route context cannot be a disclosure`);
  assert.doesNotMatch(openingTag, /\bhidden\b|aria-hidden=["']true/i, `${route}: route context cannot start hidden`);
  assert.ok(lastDetailsOpen <= lastDetailsClose, `${route}: route context cannot be inside a closed disclosure`);
}

test("모든 경로는 공개된 안전 또는 상태 맥락을 하나씩 제공한다", async () => {
  for (const [route, [file, expected]] of routes) {
    const html = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
    assertExposedRouteContext(html, route, expected);
  }
});

test("닫힌 disclosure 안의 상태 맥락은 공개된 것으로 인정하지 않는다", () => {
  const nested = "<details><summary>상세</summary><p data-route-context>안전 상태</p></details>";
  assert.throws(
    () => assertExposedRouteContext(nested, "/edge", /안전 상태/),
    /cannot be inside a closed disclosure/,
  );
});

test("중복되거나 처음부터 숨겨진 상태 맥락은 거부한다", () => {
  assert.throws(
    () => assertExposedRouteContext("<p data-route-context>상태</p><p data-route-context>상태</p>", "/duplicate", /상태/),
    /must be unique/,
  );
  assert.throws(
    () => assertExposedRouteContext("<p data-route-context hidden>상태</p>", "/hidden", /상태/),
    /cannot start hidden/,
  );
});

test("경로 맥락 계약은 정확히 일곱 개의 독립 경로를 다룬다", () => {
  assert.deepEqual([...routes.keys()], ["/", "/patient", "/map", "/connections", "/insights", "/journey", "/emr"]);
});
