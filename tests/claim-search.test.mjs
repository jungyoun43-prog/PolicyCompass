import assert from "node:assert/strict";
import test from "node:test";

import {
  createClaimSearchEntry,
  normalizeClaimSearchText,
  searchClaimIndex,
} from "../src/claim-search.js";

const index = [
  {
    id: "rule-pft",
    kind: "rule",
    domain: "rule",
    title: "폐기능검사 급여 규칙",
    subtitle: "고시·근거번호 VG-2026-01",
    searchText: "F6002 COPD",
    target: { view: "rules", ruleId: "rule-pft" },
  },
  {
    id: "quality-copd",
    kind: "quality",
    domain: "quality",
    title: "COPD 적정성 평가",
    subtitle: "폐기능검사 시행률",
    searchText: "J44.9 F6002 박영정 VG-2026-0001",
    target: { view: "quality", diseaseId: "copd" },
  },
  {
    id: "adjudication-pft",
    kind: "adjudication",
    domain: "adjudication",
    title: "폐기능검사 심사 결과",
    subtitle: "일부 조정",
    searchText: "F6002 박영정 VG-2026-0001",
    target: { view: "adjudication", resultId: "adj-1" },
  },
  {
    id: "workflow-pft",
    kind: "workflow",
    domain: "workflow",
    title: "폐기능검사 자료 확인",
    subtitle: "박영정 · VG-2026-0001",
    searchText: "J44.9 F6002 COPD",
    target: { view: "workflow", evaluationId: "p1:rule-pft" },
  },
  {
    id: "claim-pft",
    kind: "claim",
    domain: "claim",
    title: "폐기능검사 청구 점검",
    subtitle: "박영정 · VG-2026-0001",
    searchText: "J44.9 F6002 COPD",
    target: { view: "claim", evaluationId: "p1:rule-pft" },
  },
];

test("검색 텍스트는 NFKC·소문자·공백 기준으로 정규화한다", () => {
  assert.equal(normalizeClaimSearchText("  ＶＧ－２０２６\t COPD  "), "vg-2026 copd");
  assert.equal(normalizeClaimSearchText(null), "");
});

test("한글·MRN·진단 및 행위 코드를 구두점 차이와 무관하게 찾는다", () => {
  assert.deepEqual(searchClaimIndex(index, "폐기능검사").map(({ id }) => id), [
    "workflow-pft",
    "claim-pft",
    "adjudication-pft",
    "quality-copd",
    "rule-pft",
  ]);
  assert.equal(searchClaimIndex(index, "vg20260001").length, 4);
  assert.equal(searchClaimIndex(index, "J44 9").length, 3);
  assert.equal(searchClaimIndex(index, "f6002").length, 5);
});

test("결과는 입력 순서와 무관하게 업무→심사→평가→규칙, 제목 순으로 정렬한다", () => {
  const reversed = [...index].reverse();
  assert.deepEqual(
    searchClaimIndex(reversed, "F6002").map(({ domain, title }) => [domain, title]),
    searchClaimIndex(index, "F6002").map(({ domain, title }) => [domain, title]),
  );
  assert.deepEqual(searchClaimIndex(index, "F6002", 2).map(({ id }) => id), [
    "workflow-pft",
    "claim-pft",
  ]);
  assert.deepEqual(searchClaimIndex(index, "F6002", 0), []);
  assert.deepEqual(searchClaimIndex(index, "   "), []);
});

test("잘못된 입력과 위험한 target 속성은 검색 인덱스에서 제거한다", () => {
  const unsafeTarget = JSON.parse('{"view":"workflow","__proto__":{"polluted":true},"nested":{"ruleId":"ok","constructor":"drop"}}');
  const entry = createClaimSearchEntry({
    id: "safe-id",
    kind: "workflow",
    domain: "workflow",
    title: "검토 항목",
    target: unsafeTarget,
  });

  assert.deepEqual(entry.target, {
    view: "workflow",
    nested: { ruleId: "ok" },
  });
  assert.equal({}.polluted, undefined);
  assert.equal(createClaimSearchEntry({ id: "missing-title", kind: "rule", domain: "rule" }), null);
  assert.deepEqual(createClaimSearchEntry({
    id: "primitive-target",
    kind: "claim",
    domain: "claim",
    title: "원시값 target",
    target: "javascript:alert(1)",
  }).target, {});
  assert.deepEqual(searchClaimIndex([null, "bad", entry], "검토").map(({ id }) => id), ["safe-id"]);
});

test("중복 id는 도메인 우선순위가 높은 안전한 항목 하나만 반환한다", () => {
  const duplicate = {
    ...index[0],
    domain: "claim",
    kind: "claim",
    title: "폐기능검사 청구",
  };
  const results = searchClaimIndex([index[0], duplicate], "폐기능검사");
  assert.equal(results.length, 1);
  assert.equal(results[0].domain, "claim");
});

test("합법적인 긴 환자·규칙 ID도 잘리지 않고 서로 다른 Workflow로 라우팅한다", () => {
  const commonPrefix = "patient-" + "p".repeat(155) + ":rule-" + "r".repeat(155);
  const firstId = `${commonPrefix}-first`;
  const secondId = `${commonPrefix}-second`;
  const longEntries = [firstId, secondId].map((evaluationId, index) => createClaimSearchEntry({
    id: `workflow:${evaluationId}`,
    kind: "workflow",
    domain: "workflow",
    title: `긴 식별자 청구 ${index + 1}`,
    searchText: "긴 식별자",
    target: { targetType: "workflow", evaluationId },
  }));
  const results = searchClaimIndex(longEntries, "긴 식별자");
  assert.equal(results.length, 2);
  assert.deepEqual(results.map(({ target }) => target.evaluationId), [firstId, secondId]);
  assert.ok(results.every(({ id }) => id.length > 320));
});
