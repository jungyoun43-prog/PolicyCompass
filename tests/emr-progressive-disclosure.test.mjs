import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { componentMarkup } from "./helpers/markup.mjs";

function isInsideDetails(html, index) {
  const preceding = html.slice(0, index);
  return preceding.lastIndexOf("<details") > preceding.lastIndexOf("</details>");
}

test("EMR 안전 맥락과 최종 서명은 점진적 공개 밖에 남는다", async () => {
  const summary = await componentMarkup("components/emr/patient-summary.jsx");
  const header = await componentMarkup("components/emr/workspace-header.jsx");
  const encounter = await componentMarkup("components/emr/tabs/encounter-tab.jsx");
  const persistent = summary.indexOf("data-safety-persistent");

  assert.ok(persistent > -1);
  for (const marker of ['id="selectedPatientName"', 'id="safetyAlerts"']) {
    assert.ok(summary.indexOf(marker, persistent) > persistent, marker);
  }
  assert.match(header, /role="tablist"/);

  for (const marker of ['class="encounter-save-bar"', 'class="encounter-context-rail"']) {
    const index = encounter.indexOf(marker);
    assert.ok(index > -1, marker);
    assert.equal(isInsideDetails(encounter, index), false, marker);
  }
  assert.match(encounter, /class="encounter-save-bar" aria-labelledby="encounterSignoffTitle"/);
  assert.match(encounter, /id="encounterSignoffTitle">진료 최종 검토 및 서명/);
});

test("EMR 보조 입력은 이름 있는 네이티브 disclosure로 접힌다", async () => {
  const encounter = await componentMarkup("components/emr/tabs/encounter-tab.jsx");
  const chart = await componentMarkup("components/emr/tabs/chart-tab.jsx");
  const expected = ["visit-context", "soap", "measurements", "diagnoses", "prescriptions", "orders"];
  const names = [
    ...[...encounter.matchAll(/data-workflow-disclosure=\{?"?([a-z-]+)/g)].map((match) => match[1]),
    ...[...encounter.matchAll(/<WorkflowDisclosure name="([a-z-]+)"/g)].map((match) => match[1]),
  ].filter((name) => name !== "name");

  assert.deepEqual([...new Set(names)].sort(), [...expected].sort());
  // 사용자가 닫기 전에는 모든 단계가 열린 채 시작한다.
  assert.match(encounter, /openDisclosures\.get\(disclosureKey\(name\)\) \?\? true/);
  assert.match(encounter, /class="workflow-disclosure__summary"/);
  assert.match(chart, /data-workflow-disclosure="historical-entry"/);
  assert.match(encounter, /data-disclosure-summary=\{?"?visit-context|data-disclosure-summary="visit-context"/);
  assert.match(encounter, /data-disclosure-summary="soap"/);
});

test("처방 입력은 자동 검증하지 않는 임상 안전 범위를 팝업 안내에 유지한다", async () => {
  const dialog = await componentMarkup("components/emr/prescription-dialog.jsx");
  const notice = dialog.match(/notice="([^"]*)"/)?.[1] ?? "";

  assert.match(dialog, /noticeId="prescriptionNotice"/);
  assert.match(notice, /급여 인정이나 삭감을 확정하지 않습니다/);
  assert.match(notice, /최종 처방 결정은 의료진에게 있습니다/);
  assert.ok(dialog.indexOf('noticeId="prescriptionNotice"') < dialog.indexOf('id="prescriptionForm"'));
});

test("오늘 진료는 모든 단계를 펼친 채 열리고 사용자 선택은 메모리에만 유지된다", async () => {
  const encounter = await componentMarkup("components/emr/tabs/encounter-tab.jsx");

  assert.match(encounter, /useState\(\(\) => new Map\(\)\)/);
  assert.doesNotMatch(encounter, /localStorage|sessionStorage/);
  assert.match(encounter, /disclosureKey\(/);
  assert.match(encounter, /onToggle/);
  assert.match(encounter, /summaryText/);
});

test("EMR 첫 화면은 핵심 안전 상태만 짧게 유지하고 반복 영문 표제를 숨긴다", async () => {
  const [chrome, assessment, css] = await Promise.all([
    componentMarkup("components/emr/chrome.jsx"),
    componentMarkup("components/emr/claims/disease-assessment.jsx"),
    readFile("src/emr.css", "utf8"),
  ]);

  assert.match(chrome, /id="aiStatusLabel"/);
  assert.doesNotMatch(chrome, /실제 환자 아님 · 미저장|평가용 · 인증된 EMR/);
  assert.match(css, /\.emr-page \.rail-eyebrow:not\(#diseaseProgramEyebrow\):not\(#diseaseDiagnosticEyebrow\)\s*\{\s*display: none;/);
  assert.match(assessment, /class="rail-eyebrow" id="diseaseProgramEyebrow"/);
  assert.match(assessment, /class="rail-eyebrow" id="diseaseDiagnosticEyebrow"/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*?\.trust-strip\s*\{[^}]*display: grid[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test("진료 시작과 재개는 열린 SOAP 입력으로 초점을 옮긴다", async () => {
  const encounter = await componentMarkup("components/emr/tabs/encounter-tab.jsx");

  assert.match(encounter, /startEncounter\(current, patient\.id, encounter\.id\)[\s\S]*?getElementById\("soapSubjective"\)\?\.focus\(\)/);
  assert.match(encounter, /reopenEncounter\(current, patient\.id, encounter\.id\)[\s\S]*?getElementById\("soapSubjective"\)\?\.focus\(\)/);
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
    /\.clinical-header \.app-header__inner\s*\{[^}]*width:\s*calc\(100% - var\(--space-6\)\);[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s,
  );
  assert.match(
    css,
    /@media \(max-width: 620px\)\s*\{[\s\S]*?\.clinical-header \.app-header__inner\s*\{[^}]*width:\s*calc\(100% - var\(--space-4\)\);/s,
  );
});

test("EMR 워크스페이스 탭과 질환 평가 탭은 각각 독립된 키보드 모델을 사용한다", async () => {
  const [header, assessment, css] = await Promise.all([
    componentMarkup("components/emr/workspace-header.jsx"),
    componentMarkup("components/emr/claims/disease-assessment.jsx"),
    readFile("src/emr.css", "utf8"),
  ]);

  assert.equal((header.match(/role="tablist"/g) ?? []).length, 1);
  assert.equal((assessment.match(/role="tablist"/g) ?? []).length, 1);
  assert.doesNotMatch(header + assessment, /data-tab-target/);
  for (const source of [header, assessment]) {
    assert.match(source, /ArrowLeft/);
    assert.match(source, /ArrowRight/);
    assert.match(source, /"Home"/);
    assert.match(source, /"End"/);
  }
  assert.match(css, /\.workspace-tabs button:focus\s*\{[^}]*outline:\s*3px solid var\(--focus-ring\);/s);
});
