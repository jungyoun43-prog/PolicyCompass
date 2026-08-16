import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { CONDITIONS, extractInputSignals, inferConditionIds } from "../src/data.js";

test("입력한 수치·증상은 질환이 아닌 미검증 패턴 신호로 분리한다", () => {
  // Given
  const note = "혈압 148/94, 공복혈당 132, 속쓰림이 자주 있음";

  // When
  const result = inferConditionIds(note, []);
  const signals = extractInputSignals(note);

  // Then
  assert.deepEqual(result, []);
  assert.deepEqual(signals.map(({ key }) => key), ["blood-pressure", "fasting-glucose", "heartburn"]);
  assert.ok(signals.every(({ provenanceKind }) => provenanceKind === "input-pattern"));
});

test("직접 선택한 항목만 질환 ID로 유지한다", () => {
  // Given
  const selected = ["migraine", "hypertension"];

  // When
  const result = inferConditionIds("편두통과 LDL 156", selected);

  // Then
  assert.deepEqual(result, ["migraine", "hypertension"]);
  assert.ok(extractInputSignals("편두통과 LDL 156").some(({ key }) => key === "ldl"));
});

test("부정된 증상은 패턴 신호에도 포함하지 않는다", () => {
  assert.deepEqual(extractInputSignals("호흡곤란 없음, 관절 통증은 호소하지 않음"), []);
  assert.deepEqual(inferConditionIds("당뇨 아님, 고혈압 없음", []), []);
});

test("COPD와 폐렴은 호흡기 모델에 등록하되 환자 입력이나 문구만으로 추론하지 않는다", async () => {
  assert.deepEqual(Object.keys(CONDITIONS), [
    "hypertension",
    "diabetes",
    "dyslipidemia",
    "migraine",
    "reflux",
    "asthma",
    "copd",
    "pneumonia",
    "mood",
    "arthritis",
  ]);
  assert.deepEqual(CONDITIONS.copd.departments, ["respiratory"]);
  assert.deepEqual(CONDITIONS.pneumonia.departments, ["respiratory"]);
  assert.deepEqual(inferConditionIds("COPD 같고 숨이 찹니다", []), []);
  assert.deepEqual(inferConditionIds("폐렴 같고 열이 납니다", []), []);

  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /data-condition="copd"/);
  assert.match(html, /확인 필요 신호 · 진단 아님/);
  assert.match(html, /입력값만으로 질환을 확정하지 않습니다/);
  assert.match(html, /반복 검사와 의료진 판단이 필요/);
});

test("빌드된 Worker가 역할 게이트웨이와 보안 헤더를 제공한다", async () => {
  // Given
  const { default: worker } = await import("../dist/server/index.js");

  // When
  const response = await worker.fetch(new Request("https://example.com/"));
  const html = await response.text();

  // Then
  assert.equal(response.status, 200);
  assert.match(html, /VitaGraph/);
  assert.match(html, /사용할 공간을 선택하세요/);
  assert.match(html, /href="\/emr"[^>]*>\s*의료진 EMR 열기/s);
  assert.match(html, /href="\/patient"[^>]*>\s*개인 VitaGraph 열기/s);
  assert.doesNotMatch(html, /id="fhirFile"/);
  assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  assert.equal(response.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
});

test("개인 VitaGraph 홈은 /patient에서 EMR 없이 제공된다", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  const response = await worker.fetch(new Request("https://example.com/patient"));
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /VitaGraph Personal/);
  assert.match(html, /내 건강 기록을.*내가 이어 보는/s);
  assert.doesNotMatch(html, /id="patientList"|id="encounterForm"|id="claimBoard"/);
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
