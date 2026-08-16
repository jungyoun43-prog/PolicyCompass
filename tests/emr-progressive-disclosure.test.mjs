import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

function isInsideDetails(html, index) {
  const preceding = html.slice(0, index);
  return preceding.lastIndexOf("<details") > preceding.lastIndexOf("</details>");
}

test("EMR 안전 맥락과 최종 서명은 점진적 공개 밖에 남는다", async () => {
  const html = await readFile("src/emr.html", "utf8");
  const persistent = html.indexOf("data-safety-persistent");
  const encounterPanel = html.indexOf('id="panel-encounter"');

  assert.ok(persistent > -1);
  for (const marker of ['id="selectedPatientName"', 'id="safetyAlerts"', 'role="tablist"']) {
    const index = html.indexOf(marker, persistent);
    assert.ok(index > persistent && index < encounterPanel, marker);
  }

  for (const marker of ['class="encounter-save-bar"', 'class="encounter-context-rail"']) {
    const index = html.indexOf(marker);
    assert.ok(index > -1, marker);
    assert.equal(isInsideDetails(html, index), false, marker);
  }
  assert.match(html, /class="encounter-save-bar" aria-labelledby="encounterSignoffTitle"/);
  assert.match(html, /id="encounterSignoffTitle">진료 최종 검토 및 서명/);
});

test("EMR 보조 입력은 이름 있는 네이티브 disclosure로 접힌다", async () => {
  const html = await readFile("src/emr.html", "utf8");
  const expected = [
    "visit-context",
    "soap",
    "measurements",
    "diagnoses",
    "prescriptions",
    "orders",
    "historical-entry",
  ];
  const disclosures = [...html.matchAll(/<details\b[^>]*data-workflow-disclosure="([^"]+)"[^>]*>/g)];

  assert.deepEqual(disclosures.map((match) => match[1]), expected);
  for (const disclosure of disclosures) {
    const following = html.slice(disclosure.index + disclosure[0].length);
    assert.match(following, /^\s*<summary class="workflow-disclosure__summary">/, disclosure[1]);
    assert.doesNotMatch(disclosure[0], /\sopen(?:\s|>|=)/, disclosure[1]);
  }
  assert.match(html, /data-disclosure-summary="visit-context"/);
  assert.match(html, /data-disclosure-summary="soap"/);
});

test("처방 입력은 자동 검증하지 않는 임상 안전 범위를 가까이 알린다", async () => {
  const html = await readFile("src/emr.html", "utf8");
  const prescription = html.match(/data-workflow-disclosure="prescriptions"[\s\S]*?<\/details>/)?.[0] ?? "";

  assert.match(prescription, /의약품 추천이나 전자처방전 전송 기능이 아니며/);
  assert.match(prescription, /용량·알레르기·상호작용·임신·신장\/간 기능을 자동 검증하지 않습니다/);
  assert.ok(prescription.indexOf("자동 검증하지 않습니다") < prescription.indexOf('id="prescriptionForm"'));
});

test("disclosure 기본값은 진료 단계에 맞고 사용자 선택은 메모리에만 유지된다", async () => {
  const script = await readFile("src/emr.js", "utf8");

  assert.match(script, /none:\s*\["visit-context"\]/);
  assert.match(script, /waiting:\s*\["visit-context"\]/);
  assert.match(script, /"in-progress":\s*\["visit-context", "soap"\]/);
  assert.match(script, /completed:\s*\[\]/);
  assert.match(script, /const workflowDisclosureSessionState = new Map\(\)/);
  assert.match(script, /querySelectorAll\("details\[data-workflow-disclosure\]"\)[\s\S]*?disclosure\.addEventListener\("toggle"/);
  assert.match(script, /workflowDisclosureSessionState\.set\(/);
  assert.match(script, /renderWorkflowDisclosureSummaries\(encounter, status, records\)/);
});

test("EMR 헤더는 모든 뷰포트에서 60px 이하이다", async () => {
  const css = await readFile("src/emr.css", "utf8");
  const heights = [...css.matchAll(/--header-height:\s*(\d+)px/g)].map((match) => Number(match[1]));

  assert.ok(heights.length >= 1);
  assert.ok(heights.every((height) => height <= 60), heights);
  assert.match(css, /\.clinical-header\s*\{[^}]*height:\s*var\(--header-height\);[^}]*min-height:\s*var\(--header-height\);/s);
});

test("EMR 헤더는 워크스페이스 여백에 맞춰 단일 로고 열을 정렬한다", async () => {
  const css = await readFile("src/emr.css", "utf8");

  assert.match(
    css,
    /\.clinical-header \.app-header__inner\s*\{[^}]*width:\s*min\(calc\(100% - var\(--space-8\)\), 1600px\);[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s,
  );
  assert.match(
    css,
    /@media \(max-width: 620px\)\s*\{[\s\S]*?\.clinical-header \.app-header__inner\s*\{[^}]*width:\s*min\(calc\(100% - var\(--space-4\)\), 1600px\);/s,
  );
});

test("EMR 워크스페이스 탭과 질환 평가 탭은 각각 독립된 키보드 모델을 사용한다", async () => {
  const [html, script, css] = await Promise.all([
    readFile("src/emr.html", "utf8"),
    readFile("src/emr.js", "utf8"),
    readFile("src/emr.css", "utf8"),
  ]);

  assert.equal((html.match(/role="tablist"/g) ?? []).length, 2);
  assert.equal((html.match(/role="tab"/g) ?? []).length, 7);
  assert.doesNotMatch(html + script, /data-tab-target/);
  assert.match(script, /"ArrowLeft", "ArrowRight", "Home", "End"/);
  assert.match(script, /switchTab\(next\.dataset\.tab, true\)/);
  assert.match(script, /selectDiseaseAssessment\(next\.dataset\.diseaseAssessmentId, \{ focus: true \}\)/);
  assert.match(css, /\.workspace-tabs button:focus\s*\{[^}]*outline:\s*3px solid var\(--focus-ring\);/s);
});
