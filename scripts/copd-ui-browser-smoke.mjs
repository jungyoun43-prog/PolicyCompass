import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { assert, runBrowserSmoke } from "./browser-smoke-harness.mjs";

const appUrl = process.env.EMR_URL ?? "http://127.0.0.1:4173";
const debugPort = Number.parseInt(process.env.COPD_UI_DEBUG_PORT ?? "9242", 10);
const desktopPath = process.env.COPD_UI_DESKTOP_SCREENSHOT ?? "/tmp/vitagraph-copd-screens/copd-quality-1440.png";
const reductionPath = process.env.COPD_UI_REDUCTION_SCREENSHOT ?? "/tmp/vitagraph-copd-screens/copd-reduction-1440.png";
const mobilePath = process.env.COPD_UI_MOBILE_SCREENSHOT ?? "/tmp/vitagraph-copd-screens/copd-quality-390.png";
const mobileQualityPath = process.env.COPD_UI_MOBILE_QUALITY_SCREENSHOT ?? "/tmp/vitagraph-copd-screens/copd-quality-detail-390.png";

async function capture(client, path) {
  const screenshot = await client.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(screenshot.data, "base64"));
}

await runBrowserSmoke({
  appUrl,
  debugPort,
  profilePrefix: "vitagraph-copd-ui-",
  initialViewport: { width: 1440, height: 1200, mobile: false },
}, async ({ client, evaluate, navigate, setViewport, tabTo, waitFor }) => {
  await navigate("/emr?demo=1", "document.getElementById('selectedPatientName')?.textContent === '김비타'");

  async function selectPatient(patientId, name) {
    await evaluate(`document.querySelector('[data-patient-id="${patientId}"]').click()`);
    await waitFor(`document.getElementById('selectedPatientName')?.textContent === ${JSON.stringify(name)}`, `${name} 선택 실패`);
    await evaluate("document.getElementById('tab-claims').click()");
    await waitFor("document.querySelectorAll('#copdQualityMetrics .copd-quality-metric').length === 3", "COPD 세 지표 렌더 실패");
    await evaluate("document.getElementById('claimBoardTitle').scrollIntoView({ block: 'start' })");
    await evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  }

  await selectPatient("demo-patient-lee", "이준호");
  const normal = await evaluate(`({
    headline: document.getElementById('copdQualitySummary').textContent,
    metrics: [...document.querySelectorAll('#copdQualityMetrics .copd-quality-metric')].map((node) => node.textContent),
    diagnostic: document.getElementById('copdDiagnosticSummary').textContent,
    meta: document.getElementById('copdAssessmentMeta').textContent,
    overflow: document.documentElement.scrollWidth - innerWidth,
    columns: getComputedStyle(document.querySelector('.claim-overview-grid')).gridTemplateColumns,
  })`);
  assert(/평가대상 예상/.test(normal.headline) && /3개 기여/.test(normal.headline), `정상 기여 요약 오류: ${JSON.stringify(normal)}`);
  assert(normal.metrics.length === 3 && normal.metrics.every((text) => /기여 예상/.test(text)), `정상 세 지표 오류: ${JSON.stringify(normal.metrics)}`);
  assert(/반복 확인/.test(normal.diagnostic) && /자동 진단/.test(normal.diagnostic), `진단 정합성 요약 오류: ${normal.diagnostic}`);
  assert(/2026-12th-plan/.test(normal.meta) && /2026-v1.3/.test(normal.meta), `버전 메타 오류: ${normal.meta}`);
  assert(normal.overflow <= 0, `1440 정상 화면 가로 넘침: ${normal.overflow}`);
  await evaluate("scrollBy(0, -150)");
  await capture(client, desktopPath);

  await selectPatient("demo-patient-park", "박여정");
  const reduced = await evaluate(`({
    redCount: document.querySelectorAll('.claim-attention-item[data-claim-state="reduced"]').length,
    redText: document.querySelector('.claim-attention-item[data-claim-state="reduced"]')?.textContent,
    summary: document.getElementById('claimAttentionSummary').textContent,
    overflow: document.documentElement.scrollWidth - innerWidth,
  })`);
  assert(reduced.redCount === 1, `최종 삭감 빨강은 정확히 한 건이어야 함: ${JSON.stringify(reduced)}`);
  assert(/일부 삭감 확정/.test(reduced.redText) && /합성 심사 결과/.test(reduced.redText), `빨강 근거 오류: ${reduced.redText}`);
  assert(/최종 삭감 1건/.test(reduced.summary), `빨강 요약 오류: ${reduced.summary}`);
  assert(reduced.overflow <= 0, `1440 삭감 화면 가로 넘침: ${reduced.overflow}`);
  await evaluate("scrollBy(0, -150)");
  await capture(client, reductionPath);

  await selectPatient("demo-patient-jung", "정수진");
  const external = await evaluate(`({
    pftStatus: document.querySelector('#copdQualityMetrics .copd-quality-metric')?.dataset.metricStatus,
    pftText: document.querySelector('#copdQualityMetrics .copd-quality-metric')?.textContent,
    redCount: document.querySelectorAll('.claim-attention-item[data-claim-state="reduced"]').length,
    grayTexts: [...document.querySelectorAll('.claim-attention-item[data-claim-state="insufficient"]')].map((node) => node.textContent),
    diagnostic: document.getElementById('copdDiagnosticSummary').textContent,
  })`);
  assert(external.pftStatus === "insufficient" && /타기관/.test(external.pftText), `타기관 PFT 회색 확인 오류: ${JSON.stringify(external)}`);
  assert(external.redCount === 0 && external.grayTexts.some((text) => /외부자료|타기관/.test(text)), `타기관 자료를 빨강으로 오인: ${JSON.stringify(external)}`);
  assert(/자료가 부족/.test(external.diagnostic), `타기관 PFT가 진단 기준으로 사용됨: ${external.diagnostic}`);

  await setViewport({ width: 390, height: 844, mobile: true });
  await selectPatient("demo-patient-lee", "이준호");
  const focusable = await tabTo(".copd-assessment-card .claim-overview-disclosure > summary", 140);
  const mobile = await evaluate(`({
    overflow: document.documentElement.scrollWidth - innerWidth,
    overviewColumns: getComputedStyle(document.querySelector('.claim-overview-grid')).gridTemplateColumns,
    metricColumns: getComputedStyle(document.getElementById('copdQualityMetrics')).gridTemplateColumns,
    activeTag: document.activeElement?.tagName,
  })`);
  assert(focusable && mobile.activeTag === "SUMMARY", `모바일 상세 토글 키보드 포커스 실패: ${JSON.stringify(mobile)}`);
  assert(mobile.overflow <= 0, `390 화면 가로 넘침: ${mobile.overflow}`);
  assert(!mobile.overviewColumns.includes(" ") && !mobile.metricColumns.includes(" "), `390 화면이 1열이 아님: ${JSON.stringify(mobile)}`);
  await evaluate("document.getElementById('claimBoardTitle').scrollIntoView({ block: 'start' })");
  await evaluate("scrollBy(0, -120)");
  await capture(client, mobilePath);
  await evaluate("document.querySelector('.copd-assessment-card').scrollIntoView({ block: 'start' })");
  await evaluate("scrollBy(0, -120)");
  await capture(client, mobileQualityPath);

  process.stdout.write(`${JSON.stringify({ desktopPath, reductionPath, mobilePath, mobileQualityPath, normal, reduced, external, mobile }, null, 2)}\n`);
});
