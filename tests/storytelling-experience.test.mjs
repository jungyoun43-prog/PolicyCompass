import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

import { createVisitStory } from "../src/insight-model.js";
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

test("진료 준비 이야기는 현재 지도와 가장 최근 기준점을 결정적으로 비교한다", () => {
  const previousSnapshot = createJourneySnapshot({
    id: "prior",
    observedAt: "2026-06-15",
    conditionIds: ["hypertension"],
    measurements: [{ key: "ldl", label: "LDL", value: 156, unit: "mg/dL" }],
  });

  const story = createVisitStory({
    ids: ["hypertension", "diabetes"],
    measurements: [{ key: "ldl", label: "LDL", value: 140, unit: "mg/dL" }],
    observedAt: "2026-07-20T09:00:00.000Z",
    previousSnapshot,
  });

  assert.equal(story.state, "comparison");
  assert.equal(story.hasCurrentData, true);
  assert.match(story.observations[0].title, /당뇨병 신호가 새로 표시됨/);
  assert.match(story.comparisonSummary, /2026-06-15 기록과 2026-07-20 기록 비교/);
  assert.ok(story.nextReviews.every(({ title }) => title.endsWith("?")));
});

test("현재 데이터가 없을 때는 저장된 과거 기록이 있어도 변화나 다음 항목을 꾸며내지 않는다", () => {
  const previousSnapshot = createJourneySnapshot({
    id: "saved-only",
    observedAt: "2026-06-01",
    conditionIds: ["hypertension"],
  });
  const story = createVisitStory({ ids: [], measurements: [], previousSnapshot });

  assert.equal(story.state, "empty");
  assert.deepEqual(story.observations, []);
  assert.deepEqual(story.contexts, []);
  assert.deepEqual(story.nextReviews, []);
  assert.equal(story.comparison, null);
  assert.match(story.comparisonSummary, /입력 신호가 없어 이전 기록과 비교하지 않았습니다/);
});

test("예시 데이터는 사용자의 저장된 Journey 기록과 섞어 비교하지 않는다", () => {
  const previousSnapshot = createJourneySnapshot({
    id: "real-record",
    observedAt: "2026-06-01",
    conditionIds: ["hypertension"],
  });
  const story = createVisitStory({
    ids: ["diabetes"],
    isDemo: true,
    previousSnapshot,
  });

  assert.equal(story.state, "demo");
  assert.equal(story.comparison, null);
  assert.match(story.comparisonSummary, /예시 데이터는 저장된 Journey 기록과 비교하지 않습니다/);
  assert.doesNotMatch(story.comparisonSummary, /2026-06-01/);
});

test("두 개인 화면은 스토리 단계와 안전한 첫 사용 동선을 정적으로 노출한다", async () => {
  for (const file of ["insights.html", "journey.html"]) {
    const html = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
    assert.match(html, /data-story-section="changed"/);
    assert.match(html, /data-story-section="context"/);
    assert.match(html, /data-story-section="next"/);
    assert.match(html, /data-story-section="comparison"/);
    assert.match(html, /data-first-use/);
    assert.match(html, /href="\/map#import-record"/);
    assert.match(html, /href="\/map\?sample=1"/);
    assert.match(html, /인과관계[^<]*(?:아님|원인)/);
    assert.match(html, /Journey 저장 안 됨/);
  }
});

test("두 화면의 브라우저 모듈은 정적 구문 검사를 통과한다", async () => {
  for (const file of ["insights.js", "journey.js"]) {
    const path = new URL(`../src/${file}`, import.meta.url);
    await assert.doesNotReject(execFileAsync(process.execPath, ["--check", path.pathname]));
  }
});
