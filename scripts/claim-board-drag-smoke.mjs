import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { assert, runBrowserSmoke, writeSmokeReport } from "./browser-smoke-harness.mjs";

const appUrl = process.env.EMR_URL ?? "http://127.0.0.1:4173";
const debugPort = Number.parseInt(process.env.CLAIM_CHROME_DEBUG_PORT ?? "9234", 10);
const reportPath = process.env.CLAIM_BOARD_REPORT
  ?? join("artifacts", "smoke", "claim-board-drag-report.json");
const screenshotPath = process.env.CLAIM_BOARD_SCREENSHOT
  ?? join("artifacts", "screenshots", "claim-board-1280.png");

await runBrowserSmoke({
  appUrl,
  debugPort,
  profilePrefix: "vitagraph-claim-board-",
  initialViewport: { width: 1280, height: 800, mobile: false },
}, async ({ client, evaluate, navigate, setViewport, tabTo, waitFor }) => {
  await navigate("/emr", "Boolean(document.getElementById('patientBirthDate')?.max)");
  await evaluate(`(() => {
    document.getElementById('patientMrn').value = 'CLAIM-SMOKE-1';
    document.getElementById('patientName').value = '급여 검토 테스트';
    document.getElementById('patientSex').value = 'unknown';
    document.getElementById('patientForm').requestSubmit();
  })()`);
  await waitFor(
    "document.getElementById('selectedPatientName')?.textContent === '급여 검토 테스트'",
    "Claim smoke patient was not created after form submission.",
  );
  const creation = await evaluate(`({
    selectedName: document.getElementById('selectedPatientName')?.textContent,
    formMessage: document.getElementById('patientFormMessage')?.textContent,
    workspaceStatus: document.getElementById('workspaceStatus')?.textContent,
    stored: localStorage.getItem('vitagraph-emr-v2'),
  })`);
  assert(creation.selectedName === "급여 검토 테스트", `Claim smoke patient was not created: ${JSON.stringify(creation)}`);
  await evaluate("document.getElementById('tab-claims').click(); document.getElementById('claimWorkflowDisclosure').open = true");
  await waitFor(
    "document.querySelectorAll('[data-claim-review-lane]').length === 4 && document.querySelectorAll('[data-claim-evaluation-id]').length === 3",
    "Claim review board did not render four workflow lanes and three rule cards.",
  );

  const initial = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('[data-claim-evaluation-id]')];
    const lanes = [...document.querySelectorAll('[data-claim-review-lane]')];
    const card = cards.find((item) => item.dataset.claimEvaluationId.endsWith(':demo-bp-follow-up'));
    if (!card) throw new Error('고혈압 추적검사 카드를 찾지 못했습니다.');
    return {
      cardId: card.dataset.claimEvaluationId,
      computedStatus: card.dataset.status,
      summaryCounts: [...document.querySelectorAll('.claim-result-chip b')].map((node) => Number(node.textContent)),
      laneCounts: lanes.map((lane) => lane.querySelectorAll('[data-claim-evaluation-id]').length),
      laneWidths: lanes.map((lane) => Math.round(lane.getBoundingClientRect().width)),
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
    };
  })()`);
  assert(initial.summaryCounts.reduce((sum, count) => sum + count, 0) === 3, "Immutable rule summary does not contain all evaluations.");
  assert(initial.laneCounts[0] === 3 && initial.laneCounts.slice(1).every((count) => count === 0), "Fresh cards are not in the manual unclassified lane.");
  assert(Math.max(...initial.laneWidths) - Math.min(...initial.laneWidths) <= 2, `Desktop review lanes are not equal width: ${initial.laneWidths.join(', ')}`);
  assert(initial.documentWidth <= initial.viewportWidth, `Desktop claim board overflows the viewport: ${initial.documentWidth}/${initial.viewportWidth}`);
  const disclosure = await evaluate(`(() => {
    const card = document.querySelector('[data-claim-evaluation-id="${initial.cardId}"]');
    const toggle = card.querySelector('[data-claim-detail-toggle]');
    const details = card.querySelector('.claim-card__details');
    const before = {
      expanded: toggle.getAttribute('aria-expanded'),
      open: details.open,
      summaryStatus: card.querySelector('.claim-computed-status')?.textContent,
      summaryText: toggle.textContent,
      summaryHasVerboseFacts: Boolean(card.querySelector('.claim-facts')),
    };
    toggle.click();
    const after = {
      expanded: toggle.getAttribute('aria-expanded'),
      open: details.open,
      regionRole: details.getAttribute('role'),
      ariaModal: details.getAttribute('aria-modal'),
      labelledBy: details.getAttribute('aria-labelledby'),
      calculation: details.querySelector('.claim-auto-calculation')?.textContent,
      evidence: details.querySelector('.claim-evidence')?.textContent,
      live: document.getElementById('claimBoardLive')?.textContent,
    };
    toggle.click();
    return { before, after };
  })()`);
  assert(disclosure.before.expanded === "false"
    && disclosure.before.open === false
    && /자동 판정/.test(disclosure.before.summaryStatus ?? "")
    && disclosure.before.summaryHasVerboseFacts === false
    && !/기간·횟수|판정 제외|적용 조건/.test(disclosure.before.summaryText ?? ""),
  `Collapsed claim card exposed verbose detail text: ${JSON.stringify(disclosure)}`);
  assert(disclosure.after.expanded === "true"
    && disclosure.after.open === true
    && disclosure.after.regionRole === "dialog"
    && disclosure.after.ariaModal === "true"
    && Boolean(disclosure.after.labelledBy)
    && /EMR 기간·횟수 자동 계산/.test(disclosure.after.calculation ?? "")
    && /시행 횟수|기간·횟수 미집계/.test(disclosure.after.calculation ?? "")
    && /연결 차트 근거/.test(disclosure.after.evidence ?? "")
    && /세부정보를 열었습니다/.test(disclosure.after.live ?? ""),
  `Claim evidence disclosure was not accessible or complete: ${JSON.stringify(disclosure)}`);
  await evaluate("document.getElementById('claimBoardTitle').scrollIntoView({ block: 'start' })");
  const screenshot = await client.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await mkdir(dirname(screenshotPath), { recursive: true });
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));

  await evaluate(`(() => {
    const card = document.querySelector('[data-claim-evaluation-id="${initial.cardId}"]');
    const lane = document.querySelector('[data-claim-review-lane="evidence"]');
    const transfer = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    lane.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    lane.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
  })()`);
  await waitFor(
    `document.querySelector('[data-claim-review-lane="evidence"] [data-claim-evaluation-id="${initial.cardId}"]') !== null`,
    "Drag-and-drop did not move the review card to evidence reconciliation.",
  );

  const afterDrag = await evaluate(`(() => {
    const card = document.querySelector('[data-claim-evaluation-id="${initial.cardId}"]');
    const saved = JSON.parse(localStorage.getItem('vitagraph-emr-v2'));
    const audit = saved.audit.at(-1);
    const review = saved.claimReviews.find((item) => item.evaluationId === '${initial.cardId}');
    return {
      computedStatus: card.dataset.status,
      selectedStage: card.querySelector('[data-claim-review-select]').value,
      live: document.getElementById('claimBoardLive').textContent,
      summaryCounts: [...document.querySelectorAll('.claim-result-chip b')].map((node) => Number(node.textContent)),
      auditAction: audit.action,
      auditDetail: audit.detail,
      auditEntityId: audit.entityId,
      durableStage: review?.stage,
      durableCalculatedStatus: review?.calculatedStatus,
      durableAsOf: review?.calculatedAsOf,
      fingerprintLength: review?.fingerprint?.length ?? 0,
    };
  })()`);
  assert(afterDrag.computedStatus === initial.computedStatus, "Dragging changed the calculated reimbursement result.");
  assert(afterDrag.selectedStage === "evidence", "Dragged card control does not reflect its review stage.");
  assert(JSON.stringify(afterDrag.summaryCounts) === JSON.stringify(initial.summaryCounts), "Dragging changed the immutable rule summary.");
  assert(afterDrag.auditAction === "claim-review.stage.evidence" && afterDrag.auditEntityId === initial.cardId, "Review drag was not audited against the evaluation.");
  assert(/규칙 판정 .* 유지/.test(afterDrag.auditDetail), "Review audit does not state that the calculated result was preserved.");
  assert(/자동 규칙 판정 .*변경되지 않았습니다/.test(afterDrag.live), "Assistive live status does not explain the safe move semantics.");
  assert(afterDrag.durableStage === "evidence", "Review drag was not persisted independently of the audit log.");
  assert(afterDrag.durableCalculatedStatus === initial.computedStatus && afterDrag.fingerprintLength > 0, "Durable review state did not bind the stage to its calculated result fingerprint.");

  const auditRollover = await evaluate(`(async () => {
    const { appendStateAudit } = await import('/emr-model.js');
    let saved = JSON.parse(localStorage.getItem('vitagraph-emr-v2'));
    for (let index = 0; index < 1001; index += 1) {
      saved = appendStateAudit(
        saved,
        'patient.updated',
        '급여 검토 감사 보존 경계 ' + index,
        new Date(Date.parse('2026-07-22T01:00:00.000Z') + index).toISOString(),
        saved.selectedPatientId,
      );
    }
    localStorage.setItem('vitagraph-emr-v2', JSON.stringify(saved));
    const review = saved.claimReviews.find((item) => item.evaluationId === '${initial.cardId}');
    return {
      auditLength: saved.audit.length,
      stageAuditPresent: saved.audit.some((item) => item.action === 'claim-review.stage.evidence'),
      durableStage: review?.stage,
      fingerprintLength: review?.fingerprint?.length ?? 0,
    };
  })()`);
  assert(auditRollover.auditLength === 1000 && auditRollover.stageAuditPresent === false, "Claim smoke did not cross the bounded audit-history retention edge.");
  assert(auditRollover.durableStage === "evidence" && auditRollover.fingerprintLength > 0, "Audit rollover removed the durable review state.");

  await navigate("/emr", "document.getElementById('selectedPatientName')?.textContent === '급여 검토 테스트'");
  await evaluate("document.getElementById('tab-claims').click(); document.getElementById('claimWorkflowDisclosure').open = true");
  await waitFor(
    `document.querySelector('[data-claim-review-lane="evidence"] [data-claim-evaluation-id="${initial.cardId}"]') !== null`,
    "Review stage did not persist through a reload.",
  );

  const selectSelector = `[data-claim-review-select="${initial.cardId}"]`;
  await evaluate(`document.querySelector('[data-claim-detail-toggle="${initial.cardId}"]').click()`);
  assert(await tabTo(selectSelector), "Keyboard focus could not reach the claim review stage control.");
  await evaluate(`(() => {
    const select = document.querySelector(${JSON.stringify(selectSelector)});
    select.value = 'reviewing';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor(
    `document.querySelector('[data-claim-review-lane="reviewing"] [data-claim-evaluation-id="${initial.cardId}"]') !== null`,
    "Keyboard-compatible stage control did not move the card.",
  );

  const beforeStale = await evaluate(`(() => {
    const saved = JSON.parse(localStorage.getItem('vitagraph-emr-v2'));
    const review = saved.claimReviews.find((item) => item.evaluationId === '${initial.cardId}');
    return {
      durableStage: review?.stage,
      calculatedStatus: review?.calculatedStatus,
      invalidationCount: saved.audit.filter((item) => item.action === 'claim-review.invalidated' && item.entityId === '${initial.cardId}').length,
    };
  })()`);
  assert(beforeStale.durableStage === "reviewing" && beforeStale.calculatedStatus === initial.computedStatus, "Keyboard move did not update the durable review record safely.");

  const changedComputation = await evaluate(`(async () => {
    const { appendPatientEvent, confirmPatientEvent } = await import('/emr-model.js');
    let saved = JSON.parse(localStorage.getItem('vitagraph-emr-v2'));
    const patientId = saved.selectedPatientId;
    const eventDate = new Date().toISOString().slice(0, 10);
    const conditionId = 'claim-smoke-i10';
    const observationId = 'claim-smoke-bp';
    saved = appendPatientEvent(saved, patientId, {
      id: conditionId,
      type: 'condition',
      date: eventDate,
      system: 'urn:kr:kcd',
      code: 'I10',
      label: '고혈압',
      source: { kind: 'manual', label: '직접 입력 · 검토 대기' },
    });
    saved = confirmPatientEvent(saved, patientId, conditionId);
    saved = appendPatientEvent(saved, patientId, {
      id: observationId,
      type: 'observation',
      date: eventDate,
      system: 'http://loinc.org',
      code: '85354-9',
      label: '혈압',
      value: '120/80',
      unit: 'mmHg',
      source: { kind: 'manual', label: '직접 입력 · 검토 대기' },
    });
    saved = confirmPatientEvent(saved, patientId, observationId);
    localStorage.setItem('vitagraph-emr-v2', JSON.stringify(saved));
    const review = saved.claimReviews.find((item) => item.evaluationId === '${initial.cardId}');
    return {
      storedStage: review?.stage,
      storedCalculatedStatus: review?.calculatedStatus,
      invalidationCount: saved.audit.filter((item) => item.action === 'claim-review.invalidated' && item.entityId === '${initial.cardId}').length,
    };
  })()`);
  assert(changedComputation.storedStage === "reviewing" && changedComputation.storedCalculatedStatus === initial.computedStatus, "Clinical change unexpectedly rewrote the prior review before safe resolution.");
  assert(changedComputation.invalidationCount === beforeStale.invalidationCount, "Direct clinical change audited review invalidation during a read-only calculation.");

  await navigate("/emr", "document.getElementById('selectedPatientName')?.textContent === '급여 검토 테스트'");
  await evaluate("document.getElementById('tab-claims').click(); document.getElementById('claimWorkflowDisclosure').open = true");
  await waitFor(
    `document.querySelector('[data-claim-review-lane="new"] [data-claim-evaluation-id="${initial.cardId}"][data-claim-review-stale="true"]') !== null`,
    "Changed claim computation did not safely return the prior review to the unclassified lane.",
  );

  const staleView = await evaluate(`(() => {
    const card = document.querySelector('[data-claim-evaluation-id="${initial.cardId}"]');
    const saved = JSON.parse(localStorage.getItem('vitagraph-emr-v2'));
    const review = saved.claimReviews.find((item) => item.evaluationId === '${initial.cardId}');
    return {
      computedStatus: card?.dataset.status,
      stale: card?.dataset.claimReviewStale,
      warning: card?.querySelector('.claim-review-stale')?.textContent,
      renderedStage: card?.querySelector('[data-claim-review-select]')?.value,
      storedStage: review?.stage,
      auditLength: saved.audit.length,
      invalidationCount: saved.audit.filter((item) => item.action === 'claim-review.invalidated' && item.entityId === '${initial.cardId}').length,
    };
  })()`);
  assert(staleView.computedStatus !== initial.computedStatus, "Clinical evidence did not change the deterministic reimbursement result in the staleness smoke.");
  assert(staleView.stale === "true" && staleView.renderedStage === "new" && /재검토 필요/.test(staleView.warning ?? ""), "Stale review is not visibly and accessibly marked for re-review.");
  assert(staleView.storedStage === "reviewing" && staleView.invalidationCount === beforeStale.invalidationCount, "Pure board rendering mutated or audited the durable stale review.");

  await evaluate(`(() => {
    const select = document.querySelector('[data-claim-review-select="${initial.cardId}"]');
    select.value = 'evidence';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor(
    `document.querySelector('[data-claim-review-lane="evidence"] [data-claim-evaluation-id="${initial.cardId}"][data-claim-review-stale="false"]') !== null`,
    "Explicit re-review did not persist a fresh evidence-reconciliation stage.",
  );

  const staleRecovery = await evaluate(`(() => {
    const card = document.querySelector('[data-claim-evaluation-id="${initial.cardId}"]');
    const saved = JSON.parse(localStorage.getItem('vitagraph-emr-v2'));
    const review = saved.claimReviews.find((item) => item.evaluationId === '${initial.cardId}');
    const relevantAudit = saved.audit.filter((item) => item.entityId === '${initial.cardId}' && item.action.startsWith('claim-review.'));
    return {
      computedStatus: card?.dataset.status,
      durableStage: review?.stage,
      invalidatedAt: review?.invalidatedAt,
      invalidatedFrom: review?.invalidatedFrom,
      invalidationCount: relevantAudit.filter((item) => item.action === 'claim-review.invalidated').length,
      lastActions: relevantAudit.slice(-2).map((item) => item.action),
      live: document.getElementById('claimBoardLive')?.textContent,
    };
  })()`);
  assert(staleRecovery.computedStatus === staleView.computedStatus, "Manual stale-review recovery changed the calculated reimbursement result.");
  assert(staleRecovery.durableStage === "evidence" && !staleRecovery.invalidatedAt && !staleRecovery.invalidatedFrom, "Fresh review stage did not replace the invalidated durable record cleanly.");
  assert(staleRecovery.invalidationCount === beforeStale.invalidationCount + 1, "Stale review invalidation was not audited exactly once.");
  assert(JSON.stringify(staleRecovery.lastActions) === JSON.stringify(["claim-review.invalidated", "claim-review.stage.evidence"]), "Stale recovery audit ordering is unclear.");
  assert(/이전 검토.*무효화/.test(staleRecovery.live ?? ""), "Assistive live status does not explain stale review invalidation.");

  const responsive = [];
  for (const viewport of [
    { width: 768, height: 1024, mobile: false, columns: 2 },
    { width: 1600, height: 900, mobile: false, columns: 4 },
  ]) {
    await setViewport(viewport);
    const geometry = await evaluate(`(() => ({
      columns: getComputedStyle(document.getElementById('claimBoard')).gridTemplateColumns.split(' ').length,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
    }))()`);
    assert(geometry.columns === viewport.columns, `${viewport.width}px claim board has ${geometry.columns} columns instead of ${viewport.columns}.`);
    assert(geometry.documentWidth <= geometry.viewportWidth, `${viewport.width}px claim board overflows the viewport: ${geometry.documentWidth}/${geometry.viewportWidth}`);
    responsive.push({ viewport: `${viewport.width}x${viewport.height}`, ...geometry });
  }

  await setViewport({ width: 390, height: 844, mobile: true });
  const mobile = await evaluate(`(() => {
    const lanes = [...document.querySelectorAll('[data-claim-review-lane]')];
    const card = document.querySelector('[data-claim-evaluation-id="${initial.cardId}"]');
    const toggle = card.querySelector('[data-claim-detail-toggle]');
    if (toggle.getAttribute('aria-expanded') !== 'true') toggle.click();
    const select = card.querySelector('[data-claim-review-select]');
    const handle = document.querySelector('.claim-drag-handle');
    return {
      laneCount: lanes.length,
      laneColumns: getComputedStyle(document.getElementById('claimBoard')).gridTemplateColumns.split(' ').length,
      selectHeight: select.getBoundingClientRect().height,
      handleDisplay: getComputedStyle(handle).display,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
    };
  })()`);
  assert(mobile.laneCount === 4 && mobile.laneColumns === 1, "Mobile review board is not a single-column four-stage flow.");
  assert(mobile.selectHeight >= 44 && mobile.handleDisplay === "none", "Mobile does not expose the 44px stage fallback while suppressing the drag cue.");
  assert(mobile.documentWidth <= mobile.viewportWidth, `Mobile claim board overflows the viewport: ${mobile.documentWidth}/${mobile.viewportWidth}`);

  await writeSmokeReport(reportPath, {
    suite: "claim-board-drag",
    generatedAt: new Date().toISOString(),
    automaticResultPreserved: true,
    dragAndDrop: true,
    keyboardAndMobileStageControl: true,
    localPersistence: true,
    auditTrail: true,
    durableAcrossAuditRollover: auditRollover,
    staleInvalidation: { beforeStale, changedComputation, staleView, staleRecovery },
    screenshot: screenshotPath,
    desktop: initial,
    afterDrag,
    disclosure,
    responsive,
    mobile,
  });
});

console.log(`claim board drag smoke passed; report ${reportPath}`);
