import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

import { createJourneyNarrative, createJourneySnapshot } from "../src/journey-model.js";

const execFileAsync = promisify(execFile);

test("Journey 이야기는 관찰된 차이와 원인 판단을 분리한다", () => {
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
    measurements: [{ key: "ldl", label: "LDL", value: 140, unit: "mg/dL" }],
  });

  const story = createJourneyNarrative(before, after);

  assert.equal(story.state, "comparison");
  assert.deepEqual(
    story.observations.slice(0, 3).map(({ kind }) => kind),
    ["added", "removed", "measurement"],
  );
  assert.match(story.observations[1].detail, /소실이나 회복을 뜻하지 않습니다/);
  assert.match(story.observations[2].detail, /호전·악화를 판단하지 않습니다/);
  assert.match(story.comparisonSummary, /2026-06-01 기록과 2026-07-01 기록 비교/);
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

test("Journey는 스토리 단계를 유지하고 진료 준비는 질문 브리프에 집중한다", async () => {
  const [insights, journey] = await Promise.all([
    readFile(new URL("../src/insights.html", import.meta.url), "utf8"),
    readFile(new URL("../src/journey.html", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(insights, /visit-story|data-story-section/);
  assert.match(insights, /class="question-panel"/);
  assert.match(insights, /data-first-use/);
  assert.match(insights, /href="\/map#import-record"/);
  assert.match(insights, /href="\/map\?sample=1"/);
  assert.match(insights, /Journey 저장 안 됨/);

  assert.match(journey, /data-story-section="changed"/);
  assert.match(journey, /data-story-section="context"/);
  assert.match(journey, /data-story-section="next"/);
  assert.match(journey, /data-story-section="comparison"/);
  assert.match(journey, /인과관계[^<]*(?:아님|원인)/);
});

test("두 화면의 브라우저 모듈은 정적 구문 검사를 통과한다", async () => {
  for (const file of ["insights.js", "journey.js"]) {
    const path = new URL(`../src/${file}`, import.meta.url);
    await assert.doesNotReject(execFileAsync(process.execPath, ["--check", path.pathname]));
  }
});
