import assert from "node:assert/strict";
import test from "node:test";

import { inferConditionIds } from "../src/data.js";

test("입력한 건강 신호에서 관련 상태를 찾는다", () => {
  // Given
  const note = "혈압 148/94, 공복혈당 132, 속쓰림이 자주 있음";

  // When
  const result = inferConditionIds(note, []);

  // Then
  assert.deepEqual(result, ["hypertension", "diabetes", "reflux"]);
});

test("직접 선택한 상태와 텍스트 신호를 중복 없이 합친다", () => {
  // Given
  const selected = ["migraine", "hypertension"];

  // When
  const result = inferConditionIds("편두통과 LDL 156", selected);

  // Then
  assert.deepEqual(result, ["migraine", "hypertension", "dyslipidemia"]);
});

test("빌드된 Worker가 앱과 보안 헤더를 제공한다", async () => {
  // Given
  const { default: worker } = await import("../dist/server/index.js");

  // When
  const response = await worker.fetch(new Request("https://example.com/"));
  const html = await response.text();

  // Then
  assert.equal(response.status, 200);
  assert.match(html, /VitaGraph/);
  assert.match(html, /내 몸의 신호를.*연결해서 보기/s);
  assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'self'/);
});

test("연결 탐색 전용 페이지를 제공한다", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  const response = await worker.fetch(new Request("https://example.com/connections"));
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /질환 관계를 자유롭게 탐색/);
  assert.match(html, /networkScene/);
});

test("존재하지 않는 경로는 404를 반환한다", async () => {
  // Given
  const { default: worker } = await import("../dist/server/index.js");

  // When
  const response = await worker.fetch(new Request("https://example.com/missing"));

  // Then
  assert.equal(response.status, 404);
});
