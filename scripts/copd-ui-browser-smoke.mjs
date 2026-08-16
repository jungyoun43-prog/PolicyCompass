import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { assert, runBrowserSmoke } from "./browser-smoke-harness.mjs";

const appUrl = process.env.EMR_URL ?? "http://127.0.0.1:4173";
const debugPort = Number.parseInt(process.env.QUALITY_UI_DEBUG_PORT ?? process.env.COPD_UI_DEBUG_PORT ?? "9242", 10);
const pneumoniaPath = process.env.QUALITY_UI_PNEUMONIA_SCREENSHOT ?? "/tmp/vitagraph-quality-screens/pneumonia-quality-1440.png";
const mixedPath = process.env.QUALITY_UI_MIXED_SCREENSHOT ?? "/tmp/vitagraph-quality-screens/disease-toggle-1440.png";
const reductionPath = process.env.QUALITY_UI_REDUCTION_SCREENSHOT ?? "/tmp/vitagraph-quality-screens/claim-reduction-1440.png";
const mobilePath = process.env.QUALITY_UI_MOBILE_SCREENSHOT ?? "/tmp/vitagraph-quality-screens/disease-quality-390.png";
const detailPath = process.env.QUALITY_UI_DETAIL_SCREENSHOT ?? "/tmp/vitagraph-quality-screens/pneumonia-detail-1440.png";

async function capture(client, path) {
  const screenshot = await client.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(screenshot.data, "base64"));
}

await runBrowserSmoke({
  appUrl,
  debugPort,
  profilePrefix: "vitagraph-quality-ui-",
  initialViewport: { width: 1440, height: 1200, mobile: false },
}, async ({ client, evaluate, navigate, setViewport, tabTo, waitFor }) => {
  await navigate("/emr?demo=1", "document.getElementById('selectedPatientName')?.textContent === '김비타'");

  async function selectPatient(patientId, name, metricCount) {
    await evaluate(`document.querySelector('[data-patient-id="${patientId}"]').click()`);
    await waitFor(`document.getElementById('selectedPatientName')?.textContent === ${JSON.stringify(name)}`, `${name} 선택 실패`);
    await evaluate("document.getElementById('tab-claims').click()");
    await waitFor(`document.querySelectorAll('#diseaseQualityMetrics .quality-program-metric').length === ${metricCount}`, `${name} 질환 지표 렌더 실패`);
    await evaluate("document.getElementById('claimBoardTitle').scrollIntoView({ block: 'start' })");
    await evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  }

  async function snapshot() {
    return evaluate(`({
      tabs: [...document.querySelectorAll('#diseaseAssessmentTabs [role="tab"]')].map((node) => ({ id: node.dataset.diseaseAssessmentId, selected: node.getAttribute('aria-selected'), text: node.textContent })),
      panelLabelledBy: document.getElementById('diseaseAssessmentPanel').getAttribute('aria-labelledby'),
      title: document.getElementById('diseaseProgramTitle').textContent,
      headline: document.getElementById('diseaseQualitySummary').textContent,
      metrics: [...document.querySelectorAll('#diseaseQualityMetrics .quality-program-metric')].map((node) => ({ status: node.dataset.metricStatus, text: node.textContent })),
      diagnostic: document.getElementById('diseaseDiagnosticSummary').textContent,
      meta: document.getElementById('diseaseAssessmentMeta').textContent,
      claimSummary: document.getElementById('claimAttentionSummary').textContent,
      claimSummaryLayout: (() => {
        const headline = document.querySelector('#claimAttentionSummary .claim-attention-summary__content > strong');
        const counts = document.querySelector('#claimAttentionSummary .claim-attention-counts');
        const headlineRect = headline?.getBoundingClientRect();
        const countsRect = counts?.getBoundingClientRect();
        return {
          headlineWidth: headlineRect?.width ?? 0,
          headlineHeight: headlineRect?.height ?? 0,
          countsBelowHeadline: Boolean(headlineRect && countsRect && countsRect.top >= headlineRect.bottom - 1),
        };
      })(),
      claimText: [document.getElementById('claimAttentionList'), document.getElementById('claimAttentionAllList')].map((node) => node.textContent).join(' '),
      adjudicationSummary: document.getElementById('claimAdjudicationSummary').textContent,
      adjudicationText: document.getElementById('claimAdjudicationList').textContent,
      adjustedCount: document.querySelectorAll('.claim-adjudication-item[data-adjudication-state="adjusted"]').length,
      redCount: document.querySelectorAll('.claim-attention-item[data-claim-state="high-risk"]').length,
      yellowCount: document.querySelectorAll('.claim-attention-item[data-claim-state="needs-review"]').length,
      greenCount: document.querySelectorAll('.claim-attention-item[data-claim-state="verified"]').length,
      grayCount: document.querySelectorAll('.claim-attention-item[data-claim-state="insufficient"]').length,
      overflow: document.documentElement.scrollWidth - innerWidth,
      columns: getComputedStyle(document.querySelector('.claim-overview-grid')).gridTemplateColumns,
      metricDetailsOpen: document.querySelectorAll('#diseaseQualityMetrics .quality-program-metric[open]').length,
      qualityOpen: document.getElementById('diseaseQualityDisclosure').open,
      diagnosticOpen: document.getElementById('diseaseDiagnosticDisclosure').open,
      workflowOpen: document.getElementById('claimWorkflowDisclosure').open,
      closedDetailsVisible: [...document.querySelectorAll('#panel-claims details:not([open]) > :not(summary)')]
        .filter((node) => getComputedStyle(node).display !== 'none' && node.getClientRects().length > 0).length,
    })`);
  }

  await selectPatient("demo-patient-kim", "김비타", 5);
  const kim = await snapshot();
  assert(kim.tabs.length === 1 && kim.tabs[0].id === "pneumonia" && kim.tabs[0].selected === "true", `김비타 폐렴 전용 탭 오류: ${JSON.stringify(kim.tabs)}`);
  assert(/0\/5\s*지표 충족 예상/.test(kim.headline) && /평가대상 여부를 판단할 자료가 부족/.test(kim.headline), `김비타 보수적 요약 오류: ${kim.headline}`);
  assert(kim.metrics.length === 5 && kim.metrics.every(({ status }) => status === "insufficient"), `김비타 폐렴 대상 경계 오류: ${JSON.stringify(kim.metrics)}`);
  assert(/영상/.test(kim.diagnostic) && /지역사회/.test(kim.diagnostic), `김비타 폐렴 진단 정합성 오류: ${kim.diagnostic}`);
  assert(/2026-7th-plan/.test(kim.meta) && /2026-publication/.test(kim.meta), `폐렴 기준 버전 오류: ${kim.meta}`);
  assert(kim.redCount === 0 && kim.greenCount >= 2 && kim.grayCount >= 1, `김비타 청구 분포 오류: ${JSON.stringify(kim)}`);
  assert(!kim.qualityOpen && !kim.diagnosticOpen && !kim.workflowOpen && kim.metricDetailsOpen === 0, `김비타 기본 화면이 요약 상태가 아님: ${JSON.stringify(kim)}`);
  assert(kim.closedDetailsVisible === 0, `닫힌 급여 상세 내용이 화면에 노출됨: ${JSON.stringify(kim)}`);
  assert(kim.overflow <= 0, `김비타 1440 화면 가로 넘침: ${kim.overflow}`);
  assert(kim.claimSummaryLayout.headlineWidth >= 220 && kim.claimSummaryLayout.headlineHeight <= 80 && kim.claimSummaryLayout.countsBelowHeadline, `김비타 급여 요약 제목·카운트 배치가 붕괴함: ${JSON.stringify(kim.claimSummaryLayout)}`);
  await evaluate("scrollBy(0, -140)");
  await capture(client, pneumoniaPath);
  const progressiveDisclosure = await evaluate(`(() => {
    const quality = document.getElementById('diseaseQualityDisclosure');
    quality.open = true;
    const metric = quality.querySelector('.quality-program-metric');
    metric.querySelector('summary').click();
    const metricOpened = metric.open && /산소포화도/.test(metric.textContent);
    quality.open = false;
    const diagnostic = document.getElementById('diseaseDiagnosticDisclosure');
    diagnostic.querySelector('summary').click();
    const diagnosticOpened = diagnostic.open && diagnostic.querySelectorAll('.quality-diagnostic-axis').length === 4;
    diagnostic.open = false;
    return { metricOpened, diagnosticOpened, qualityClosed: !quality.open, diagnosticClosed: !diagnostic.open };
  })()`);
  assert(Object.values(progressiveDisclosure).every(Boolean), `클릭 상세 공개 동작 오류: ${JSON.stringify(progressiveDisclosure)}`);

  await selectPatient("demo-patient-choi", "최민아", 5);
  const choi = await snapshot();
  assert(choi.tabs.length === 1 && choi.tabs[0].id === "pneumonia", `최민아 관련 질환 탭 오류: ${JSON.stringify(choi.tabs)}`);
  assert(/0\/5\s*지표 충족 예상/.test(choi.headline) && /평가대상 여부를 판단할 자료가 부족/.test(choi.headline), `최민아 보수적 요약 오류: ${choi.headline}`);
  assert(choi.metrics.every(({ status }) => status === "insufficient"), `최민아 폐렴 대상 경계 오류: ${JSON.stringify(choi.metrics)}`);
  assert(choi.redCount === 0 && choi.yellowCount >= 1 && choi.greenCount >= 1 && choi.grayCount >= 1, `최민아 혼합 청구 분포 오류: ${JSON.stringify(choi)}`);
  await evaluate(`(() => {
    document.getElementById('diseaseQualityDisclosure').open = true;
    document.querySelector('#diseaseQualityMetrics [data-metric-status="insufficient"]').open = true;
    document.querySelector('.disease-assessment-card').scrollIntoView({ block: 'start' });
    scrollBy(0, -110);
  })()`);
  await capture(client, detailPath);
  await evaluate("document.getElementById('diseaseQualityDisclosure').open = false");

  await selectPatient("demo-patient-lee", "이준호", 3);
  const lee = await snapshot();
  assert(lee.tabs.length === 1 && lee.tabs[0].id === "copd", `이준호 COPD 전용 탭 오류: ${JSON.stringify(lee.tabs)}`);
  assert(/0\/3\s*지표 충족 예상/.test(lee.headline) && /평가대상 여부를 판단할 자료가 부족/.test(lee.headline), `이준호 COPD 보수적 요약 오류: ${lee.headline}`);
  assert(lee.metrics.every(({ status }) => status === "insufficient"), `이준호 COPD 대상 경계 오류: ${JSON.stringify(lee.metrics)}`);
  assert(/반복 확인/.test(lee.diagnostic) && /자동 진단/.test(lee.diagnostic), `이준호 COPD 진단 정합성 오류: ${lee.diagnostic}`);

  await selectPatient("demo-patient-park", "박여정", 3);
  const park = await snapshot();
  assert(/0\/3\s*지표 충족 예상/.test(park.headline) && /평가대상 여부를 판단할 자료가 부족/.test(park.headline), `박여정 COPD 보수적 요약 오류: ${park.headline}`);
  assert(park.metrics.every(({ status }) => status === "insufficient"), `박여정 COPD 대상 경계 오류: ${JSON.stringify(park.metrics)}`);
  assert(park.redCount === 0 && park.adjustedCount === 1 && park.yellowCount >= 1 && park.grayCount >= 1, `박여정 사전점검·실제 조정 분리 오류: ${JSON.stringify(park)}`);
  assert(park.adjustedCount === 1
    && /보험자 최종 결과 1건 · 조정 1건/.test(park.adjudicationSummary)
    && /일부 조정/.test(park.adjudicationText)
    && /가상 보험자 심사결정/.test(park.adjudicationText)
    && /SYNTHETIC_DOCUMENTATION_PARTIAL_REDUCTION/.test(park.adjudicationText),
  `박여정 실제 심사 조정 근거 오류: ${JSON.stringify(park)}`);
  await evaluate("scrollBy(0, -140)");
  await capture(client, reductionPath);

  await selectPatient("demo-patient-jung", "정수진", 3);
  const jungCopd = await snapshot();
  assert(jungCopd.tabs.length === 2 && jungCopd.tabs.map(({ id }) => id).join(",") === "copd,pneumonia", `정수진 질환 토글 오류: ${JSON.stringify(jungCopd.tabs)}`);
  assert(jungCopd.tabs[0].selected === "true" && /0\/3\s*지표 충족 예상/.test(jungCopd.headline) && /평가대상 여부를 판단할 자료가 부족/.test(jungCopd.headline), `정수진 기본 COPD 상태 오류: ${JSON.stringify(jungCopd)}`);
  assert(jungCopd.metrics.every(({ status }) => status === "insufficient"), `정수진 COPD 대상 경계 오류: ${JSON.stringify(jungCopd.metrics)}`);
  assert(jungCopd.redCount === 0 && /타기관/.test(jungCopd.claimText), `정수진 타기관 자료를 빨강으로 오인: ${JSON.stringify(jungCopd)}`);

  await evaluate("document.getElementById('diseaseQualityDisclosure').open = true; document.querySelector('[data-disease-assessment-id=\"pneumonia\"]').click()");
  await waitFor("document.getElementById('diseaseProgramTitle')?.textContent === '폐렴'", "정수진 폐렴 전환 실패");
  const jungPneumonia = await snapshot();
  assert(jungPneumonia.tabs[1].selected === "true" && /0\/5\s*지표 충족 예상/.test(jungPneumonia.headline) && /평가대상 여부를 판단할 자료가 부족/.test(jungPneumonia.headline), `정수진 폐렴 보수적 요약 오류: ${JSON.stringify(jungPneumonia)}`);
  assert(jungPneumonia.metrics.every(({ status }) => status === "insufficient"), `정수진 폐렴 대상 경계 오류: ${JSON.stringify(jungPneumonia.metrics)}`);
  assert(jungPneumonia.claimSummary === jungCopd.claimSummary && jungPneumonia.claimText === jungCopd.claimText, "질환 전환으로 전체 청구 주의사항이 바뀌었습니다.");
  const closedOnSwitch = await evaluate("!document.getElementById('diseaseQualityDisclosure').open && !document.getElementById('diseaseDiagnosticDisclosure').open && !document.getElementById('diseaseAssessmentSources').open");
  assert(closedOnSwitch, "질환 전환 시 이전 상세 패널이 닫히지 않았습니다.");
  await evaluate("document.querySelector('[data-disease-assessment-id=\"pneumonia\"]').focus(); document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))");
  await waitFor("document.querySelector('[data-disease-assessment-id=\"copd\"]')?.getAttribute('aria-selected') === 'true'", "질환 탭 키보드 순환 실패");
  const keyFocus = await evaluate("document.activeElement?.dataset?.diseaseAssessmentId");
  assert(keyFocus === "copd", `질환 탭 roving focus 오류: ${keyFocus}`);
  await evaluate("document.querySelector('[data-disease-assessment-id=\"pneumonia\"]').click(); document.querySelector('.disease-assessment-card').scrollIntoView({ block: 'start' }); scrollBy(0, -110)");
  await capture(client, mixedPath);

  await setViewport({ width: 390, height: 844, mobile: true });
  const focusable = await tabTo(".disease-assessment-card .claim-overview-disclosure > summary", 160);
  await evaluate(`new Promise((resolve) => {
    document.documentElement.style.scrollBehavior = 'auto';
    document.querySelector('.disease-assessment-card').scrollIntoView({ block: 'start' });
    scrollBy(0, -390);
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  })`);
  const mobile = await evaluate(`({
    overflow: document.documentElement.scrollWidth - innerWidth,
    overviewColumns: getComputedStyle(document.querySelector('.claim-overview-grid')).gridTemplateColumns,
    metricColumns: getComputedStyle(document.getElementById('diseaseQualityMetrics')).gridTemplateColumns,
    activeTag: document.activeElement?.tagName,
    selected: document.querySelector('#diseaseAssessmentTabs [aria-selected="true"]')?.dataset.diseaseAssessmentId,
  })`);
  assert(focusable && mobile.activeTag === "SUMMARY", `모바일 상세 토글 키보드 포커스 실패: ${JSON.stringify(mobile)}`);
  assert(mobile.selected === "pneumonia", `모바일 선택 질환 유지 실패: ${JSON.stringify(mobile)}`);
  assert(mobile.overflow <= 0, `390 화면 가로 넘침: ${mobile.overflow}`);
  assert(!mobile.overviewColumns.includes(" ") && !mobile.metricColumns.includes(" "), `390 화면이 1열이 아님: ${JSON.stringify(mobile)}`);
  await capture(client, mobilePath);

  process.stdout.write(`${JSON.stringify({ pneumoniaPath, mixedPath, reductionPath, mobilePath, detailPath, kim, choi, lee, park, jungCopd, jungPneumonia, mobile }, null, 2)}\n`);
});
