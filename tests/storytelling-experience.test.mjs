import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

import InsightsPage from "../app/(insights)/insights/page.jsx";
import JourneyPage from "../app/(journey)/journey/page.jsx";
import { renderComponent } from "./helpers/render.mjs";

import { createJourneyNarrative, createJourneySnapshot } from "../src/journey-model.js";

const execFileAsync = promisify(execFile);

test("Journey 이야기는 관찰된 차이와 원인 판단을 분리한다", () => {
  const inputSignal = {
    id: "input-symptom-heartburn-0",
    kind: "symptom-input",
    key: "heartburn",
    label: "속쓰림·신물 증상 입력",
    value: "속쓰림",
    unit: "",
    evidenceText: "속쓰림",
    provenanceKind: "input-pattern",
  };
  const before = createJourneySnapshot({
    id: "before",
    observedAt: "2026-06-01",
    conditionIds: ["hypertension", "reflux"],
    measurements: [{ key: "ldl", label: "LDL", value: 156, unit: "mg/dL" }],
  });
  const after = createJourneySnapshot({
    id: "after",
    observedAt: "2026-07-01",
    conditionIds: ["hypertension", "diabetes"],
    signals: [inputSignal],
    measurements: [{ key: "ldl", label: "LDL", value: 140, unit: "mg/dL" }],
  });

  const story = createJourneyNarrative(before, after);

  assert.equal(story.state, "comparison");
  assert.deepEqual(
    story.observations.slice(0, 4).map(({ kind }) => kind),
    ["added", "removed", "added-pattern", "measurement"],
  );
  assert.match(story.observations[1].detail, /소실이나 회복을 뜻하지 않습니다/);
  assert.match(story.observations[0].title, /질환 항목/);
  assert.match(story.observations.find(({ kind }) => kind === "measurement").detail, /호전·악화를 판단하지 않습니다/);
  assert.match(story.comparisonSummary, /질환 항목 2개 → 2개 · 입력 확인 신호 0개 → 1개/);
  assert.equal(story.comparison.currentConditionCount, 2);
  assert.equal(story.comparison.currentInputSignalCount, 1);
  assert.equal(story.comparison.currentSignalCount, 3);
  assert.equal(story.comparison.changedMeasurementCount, 1);
});

test("가능한 맥락은 근거 링크와 비인과 가드레일을 항상 함께 제공한다", () => {
  const current = createJourneySnapshot({
    id: "current",
    observedAt: "2026-07-01",
    conditionIds: ["hypertension", "diabetes", "dyslipidemia"],
  });

  const story = createJourneyNarrative(null, current);

  assert.equal(story.state, "baseline");
  assert.ok(story.contexts.length > 0);
  for (const context of story.contexts) {
    assert.match(context.sourceUrl, /^https:\/\//);
    assert.ok(context.sourceTitle.length > 0);
    assert.match(context.guardrail, /원인이나 인과관계를 뜻하지 않습니다/);
  }
  assert.ok(story.nextReviews.length > 0);
  assert.ok(story.nextReviews.length <= 3);
});

test("Journey는 스토리 단계를 유지하고 진료 준비는 질문 브리프에 집중한다", () => {
  // The HTML the server sends for each page (effects do not run).
  const insights = renderComponent(InsightsPage);
  const journey = renderComponent(JourneyPage);

  assert.doesNotMatch(insights, /visit-story|data-story-section/);
  assert.match(insights, /<section class="question-panel"/);
  assert.match(insights, /<div\b[^>]*\bid="briefEmpty"[^>]*\bdata-first-use\b/);
  assert.match(insights, /<a\b[^>]*\bid="refreshClinicalSnapshotEmpty"[^>]*\bhref="\/map#import-record"/);
  assert.match(insights, /파일과 별도 확인 코드를 대조해 가져오세요/);
  assert.match(insights, /<a\b[^>]*\bhref="\/map\?sample=1"/);
  assert.match(insights, /Journey 저장 안 됨/);
  assert.match(insights, /원본 전달 파일이 개인 보관 사본/);
  assert.match(insights, /<button\b[^>]*\bid="sharePatientBrief"/);
  assert.doesNotMatch(insights, /id="fhirFile"/);

  for (const section of ["changed", "context", "next", "comparison"]) {
    assert.match(journey, new RegExp(`<article\\b[^>]*\\bdata-story-section="${section}"`), `${section} 단계 카드가 있어야 한다.`);
  }
  assert.match(journey, /인과관계[^<]*(?:아님|원인)/);
});

test("두 화면의 브라우저 모듈은 정적 구문 검사를 통과한다", async () => {
  // source-check: these controllers touch document/window on import, so a
  // browser-free static syntax check is the strongest load-time contract here.
  for (const file of ["insights.js", "journey.js"]) {
    const path = new URL(`../src/${file}`, import.meta.url);
    await assert.doesNotReject(execFileAsync(process.execPath, ["--check", path.pathname]));
  }
});
