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

test("처방 입력은 자동 검증하지 않는 임상 안전 범위를 팝업 안내에 유지한다", async () => {
  const html = await readFile("src/emr.html", "utf8");
  const prescription = html.match(/data-workflow-disclosure="prescriptions"[\s\S]*?<\/details>/)?.[0] ?? "";
  const notice = prescription.match(/id="prescriptionNoticePanel"[^>]*>([^<]*)</)?.[1] ?? "";

  assert.match(prescription, /<button class="rx-notice__summary"[^>]*id="prescriptionNotice"/);
  assert.match(notice, /급여 인정이나 삭감을 확정하지 않습니다/);
  assert.match(notice, /최종 처방 결정은 의료진에게 있습니다/);
  assert.ok(prescription.indexOf('id="prescriptionNotice"') < prescription.indexOf('id="prescriptionForm"'));
});

test("오늘 진료는 모든 단계를 펼친 채 열리고 사용자 선택은 메모리에만 유지된다", async () => {
  const script = await readFile("src/emr.js", "utf8");
  const steps = script.match(/const ENCOUNTER_WORKFLOW_DISCLOSURES = Object\.freeze\(\[([\s\S]*?)\]\)/)?.[1] ?? "";
  const defaults = script.match(/const WORKFLOW_DISCLOSURE_DEFAULTS = Object\.freeze\(\{([\s\S]*?)\}\)/)?.[1] ?? "";

  for (const step of ["visit-context", "soap", "measurements", "diagnoses", "prescriptions", "orders"]) {
    assert.match(steps, new RegExp(`"${step}"`), step);
  }
  for (const status of ["none", "waiting", '"in-progress"', "completed", "signed", "legacy", "external"]) {
    assert.match(defaults, new RegExp(`${status}:\\s*ENCOUNTER_WORKFLOW_DISCLOSURES`), status);
  }
  assert.match(script, /const workflowDisclosureSessionState = new Map\(\)/);
  assert.match(script, /querySelectorAll\("details\[data-workflow-disclosure\]"\)[\s\S]*?disclosure\.addEventListener\("toggle"/);
  assert.match(script, /workflowDisclosureSessionState\.set\(/);
  assert.match(script, /renderWorkflowDisclosureSummaries\(encounter, status, records\)/);
});

test("EMR 첫 화면은 핵심 안전 상태만 짧게 유지하고 반복 영문 표제를 숨긴다", async () => {
  const [html, css] = await Promise.all([
    readFile("src/emr.html", "utf8"),
    readFile("src/emr.css", "utf8"),
  ]);

  assert.match(html, /<b>로컬 저장<\/b>\s*<span>이 브라우저만<\/span>/);
  assert.match(html, /실제 환자 아님 · 미저장/);
  assert.match(html, /평가용 · 인증된 EMR·청구 소프트웨어 아님 · 삭감 방지 보장 없음/);
  assert.match(css, /\.emr-page \.rail-eyebrow:not\(#diseaseProgramEyebrow\):not\(#diseaseDiagnosticEyebrow\)\s*\{\s*display: none;/);
  assert.match(html, /class="rail-eyebrow" id="diseaseProgramEyebrow"/);
  assert.match(html, /class="rail-eyebrow" id="diseaseDiagnosticEyebrow"/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*?\.trust-strip\s*\{[^}]*display: grid[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test("진료 시작과 재개는 열린 SOAP 입력으로 초점을 옮긴다", async () => {
  const script = await readFile("src/emr.js", "utf8");

  assert.match(script, /startEncounter\(current, patient\.id, encounter\.id\)[\s\S]*?refs\.soapSubjective\.focus\(\)/);
  assert.match(script, /reopenEncounter\(current, patient\.id, encounter\.id\)[\s\S]*?restoreWorkflowFocus\(refs\.soapSubjective, refs\.saveEncounterDraft\)/);
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
