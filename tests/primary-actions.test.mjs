import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { emrMarkup, pageMarkup } from "./helpers/markup.mjs";

const script = await readFile(new URL("../scripts/primary-action-smoke.mjs", import.meta.url), "utf8");

test("primary-action browser contract activates every originating route", () => {
  for (const route of ["/", "/patient", "/map", "/connections", "/insights", "/journey", "/emr"]) {
    assert.ok(script.includes(`from: ${JSON.stringify(route)}`) || script.includes(`navigate(${JSON.stringify(route)})`));
  }
  assert.match(script, /querySelector\(\$\{selector\}\)\.click\(\)/);
  assert.match(script, /location\.pathname/);
  assert.match(script, /location\.hash/);
  assert.match(script, /formError/);
  assert.match(script, /patientList/);
  assert.match(script, /checkInPatient/);
  assert.match(script, /__printInvoked/);
  assert.match(script, /question-select/);
  assert.match(script, /visit question selection was not preserved/);
  assert.match(script, /__journeyScrollBehavior === 'auto'/);
  assert.match(script, /cancelled delete changed saved records/);
  assert.match(script, /activatedEmrAction/);
  assert.match(script, /expectedStatus/);
  assert.match(script, /Network\.setBlockedURLs/);
  assert.match(script, /Emulation\.setTimezoneOverride/);
  assert.match(script, /Emulation\.setLocaleOverride/);
  assert.match(script, /prefers-reduced-motion/);
  assert.match(script, /Date\.now=\(\)=>1735689600000;Math\.random=\(\)=>0\.5/);
});

test("Insights 질문은 하나의 명시적 선택 동작과 복원 가능한 상태를 제공한다", async () => {
  const [html, client, css] = await Promise.all([
    pageMarkup("/insights"),
    readFile(new URL("../src/insights.js", import.meta.url), "utf8"),
    readFile(new URL("../src/insights.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /id="questionSelectionStatus" role="status" aria-live="polite" hidden/);
  assert.match(html, /id="questions"[\s\S]*?role="radiogroup"/);
  assert.match(client, /const selectedQuestionKey = "policycompass-selected-visit-question"/);
  assert.match(client, /function sceneFingerprint\(session\)/);
  assert.match(client, /sessionStorage\.setItem\(selectedQuestionKey, JSON\.stringify/);
  assert.match(client, /renderQuestions\(brief\.questions, readSelectedQuestionId\(fingerprint\), fingerprint\)/);
  assert.match(client, /radio\.type = "radio"/);
  assert.match(client, /radio\.name = "visit-question"/);
  assert.match(css, /\.question-select\s*\{[\s\S]*?min-height: 44px/);
  assert.match(css, /question-selected-badge/);
  assert.match(css, /@media print[\s\S]*?question-list > li\.is-selected/);
});

test("건강 지도 입력은 선택 가능한 질환 뒤에 제출 동작을 제공한다", async () => {
  const [html, css] = await Promise.all([
    pageMarkup("/map"),
    readFile(new URL("../src/controls.css", import.meta.url), "utf8"),
  ]);
  assert.ok(
    html.indexOf('id="loadDemo"') < html.indexOf('id="healthForm"'),
    "예시 기록 버튼은 입력 폼보다 위의 패널 헤더에 있어야 한다",
  );
  assert.match(html, /class="input-panel__heading-actions"[\s\S]*?id="loadDemo"[\s\S]*?class="session-badge"/);
  assert.match(css, /\.input-panel__heading-actions\s*\{[\s\S]*?justify-items:\s*end/);
  assert.ok(html.indexOf('class="signal-fieldset"') < html.indexOf('id="analyzeButton"'));
  assert.ok(html.indexOf('id="analyzeButton"') < html.indexOf('id="import-record"'));
  assert.match(html, /id="transferCode"/);
  assert.match(html, /id="fhirFile"[^>]*type="file"/);
  assert.match(html, /id="selectRecordFile"[^>]*aria-controls="fhirFile"/);
  assert.match(html, /id="importRecordButton"[^>]*disabled/);
});

test("빈 EMR은 하나의 명시적 예시 환자 동작만 제공한다", async () => {
  const html = await emrMarkup();
  assert.equal((html.match(/id="loadDemo"/g) ?? []).length, 1);
  assert.equal((html.match(/예시 환자 불러오기/g) ?? []).length, 1);
});
