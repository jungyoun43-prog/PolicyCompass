import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { appendPatientEvent, appendStateAudit, confirmPatientEvent } from "../src/emr-model.js";
import { assert, runBrowserSmoke, startManagedAppServer, writeSmokeReport } from "./browser-smoke-harness.mjs";

/**
 * The manual claim-review board on the React workbench: the calculated result
 * never moves, cards move between lanes only after a person records assignee,
 * reviewer and reason, drag and keyboard stage the same detail panel, and a
 * changed calculation invalidates the prior review visibly. Chart fixtures are
 * shaped with the model in Node and written straight into localStorage, the
 * way another tab would have saved them.
 */
const debugPort = Number.parseInt(process.env.CLAIM_CHROME_DEBUG_PORT ?? "9234", 10);
const reportPath = process.env.CLAIM_BOARD_REPORT
  ?? join("artifacts", "smoke", "claim-board-drag-report.json");
const screenshotPath = process.env.CLAIM_BOARD_SCREENSHOT
  ?? join("artifacts", "screenshots", "claim-board-1280.png");
const STORAGE_KEY = "policycompass-emr-v2";

const HELPERS = `(() => {
  if (window.__smoke) return;
  const setNative = (element, value) => {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };
  window.__smoke = {
    set(target, value) {
      const element = typeof target === 'string' ? document.querySelector(target) : target;
      if (!element) throw new Error('missing ' + target);
      setNative(element, value);
    },
    tab(key) {
      const trigger = document.getElementById('tab-' + key);
      trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      trigger.click();
    },
    state() {
      return JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)}));
    },
    detail() {
      return document.querySelector('#claimReviewDetailHost .claim-card__details');
    },
    field(name) {
      const detail = this.detail();
      const byPlaceholder = { assignee: '예: 김심사', reviewer: '이름 또는 담당 역할', reason: '예: 외부 검사', opinion: '확인한 근거' };
      if (name === 'stage') return detail?.querySelector('select[aria-label$="담당자 검토 단계 이동"]') ?? null;
      return [...(detail?.querySelectorAll('input, textarea') ?? [])].find((element) => element.placeholder.startsWith(byPlaceholder[name])) ?? null;
    },
    fillReview({ stage, assignee, reviewer, reason, opinion }) {
      if (stage) this.set(this.field('stage'), stage);
      if (assignee !== undefined) this.set(this.field('assignee'), assignee);
      if (reviewer !== undefined) this.set(this.field('reviewer'), reviewer);
      if (reason !== undefined) this.set(this.field('reason'), reason);
      if (opinion !== undefined) this.set(this.field('opinion'), opinion);
      this.detail().querySelector('.claim-review-apply').click();
    },
  };
})();`;

const app = await startManagedAppServer({
  appUrl: process.env.EMR_URL?.trim() || process.env.APP_URL?.trim() || "",
  healthPath: "/emr",
});

try {
  await runBrowserSmoke({
    appUrl: app.appUrl,
    debugPort,
    profilePrefix: "policycompass-claim-board-",
    initialViewport: { width: 1280, height: 800, mobile: false },
  }, async ({ client, evaluate, navigate, setViewport, tabTo, waitFor }) => {
    await client.call("Page.addScriptToEvaluateOnNewDocument", { source: HELPERS });
    const readState = async () => JSON.parse(await evaluate(`localStorage.getItem(${JSON.stringify(STORAGE_KEY)})`));
    const writeState = (state) => evaluate(`localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${JSON.stringify(JSON.stringify(state))})`);
    const openBoard = async () => {
      await navigate("/emr", "document.getElementById('selectedPatientName')?.textContent === '급여 검토 테스트'");
      await evaluate(HELPERS);
      await evaluate("__smoke.tab('claims'); document.getElementById('claimWorkflowDisclosure').open = true");
    };
    const cardSelector = (lane = "") => `${lane ? `[data-claim-review-lane="${lane}"] ` : ""}[data-claim-evaluation-id$=":demo-bp-follow-up"]`;

    // A first visit opens the sample chart; the real record is one click away.
    await navigate("/emr", "document.getElementById('selectedPatientName')?.textContent === '김비타'");
    await evaluate(HELPERS);
    await evaluate("document.getElementById('exitDemo').click()");
    await waitFor("document.getElementById('patientListEmpty').hidden === false && Boolean(document.getElementById('patientBirthDate')?.max)", "Empty local record did not open.");
    await evaluate(`(() => {
      __smoke.set('#patientMrn', 'CLAIM-SMOKE-1');
      __smoke.set('#patientName', '급여 검토 테스트');
      __smoke.set('#patientSex', 'unknown');
      document.getElementById('patientForm').requestSubmit();
    })()`);
    await waitFor(
      "document.getElementById('selectedPatientName')?.textContent === '급여 검토 테스트'",
      "Claim smoke patient was not created after form submission.",
    );

    // Confirmed chart facts arrive the way another tab would have saved them.
    const browserToday = await evaluate("new Date().toISOString().slice(0, 10)");
    {
      let saved = await readState();
      const patientId = saved.selectedPatientId;
      const baseTime = Date.parse(saved.updatedAt) + 1000;
      saved = appendPatientEvent(saved, patientId, {
        id: "claim-smoke-hypertension",
        type: "condition",
        system: "urn:kr:kcd",
        code: "I10",
        label: "고혈압",
        date: browserToday,
        status: "active",
        clinicalStatus: "active",
        verificationStatus: "confirmed",
        source: { kind: "manual", label: "직접 입력 · 검토 대기" },
      }, new Date(baseTime).toISOString());
      saved = confirmPatientEvent(saved, patientId, "claim-smoke-hypertension", new Date(baseTime + 1000).toISOString());
      saved = appendPatientEvent(saved, patientId, {
        id: "claim-smoke-blood-pressure",
        type: "observation",
        system: "http://loinc.org",
        code: "85354-9",
        label: "혈압",
        value: "128/78",
        unit: "mmHg",
        date: browserToday,
        status: "final",
        source: { kind: "manual", label: "직접 입력 · 검토 대기" },
      }, new Date(baseTime + 2000).toISOString());
      saved = confirmPatientEvent(saved, patientId, "claim-smoke-blood-pressure", new Date(baseTime + 3000).toISOString());
      await writeState(saved);
    }
    await openBoard();
    await waitFor(
      "document.querySelectorAll('[data-claim-review-lane]').length === 4 && document.querySelectorAll('[data-claim-evaluation-id]').length === 1",
      "Claim review board did not render four workflow lanes and the applicable rule card.",
    );

    const initial = await evaluate(`(() => {
      const lanes = [...document.querySelectorAll('[data-claim-review-lane]')];
      const card = document.querySelector(${JSON.stringify(cardSelector())});
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
    assert(initial.summaryCounts.reduce((sum, count) => sum + count, 0) === 1, "Immutable rule summary does not contain the applicable evaluation.");
    assert(initial.laneCounts[0] === 1 && initial.laneCounts.slice(1).every((count) => count === 0), "Fresh card is not in the manual unclassified lane.");
    assert(Math.max(...initial.laneWidths) - Math.min(...initial.laneWidths) <= 2, `Desktop review lanes are not equal width: ${initial.laneWidths.join(", ")}`);
    assert(initial.documentWidth <= initial.viewportWidth, `Desktop claim board overflows the viewport: ${initial.documentWidth}/${initial.viewportWidth}`);
    const cardId = initial.cardId;
    const card = `document.querySelector('[data-claim-evaluation-id="${cardId}"]')`;

    // The card summary opens the shared right-hand detail panel.
    const before = await evaluate(`(() => {
      const toggle = ${card}.querySelector('.claim-card__summary');
      return {
        expanded: toggle.getAttribute('aria-expanded'),
        hostActive: document.getElementById('claimReviewDetailHost').dataset.active,
        summaryStatus: ${card}.querySelector('.claim-computed-status')?.textContent,
        summaryText: toggle.textContent,
      };
    })()`);
    assert(before.expanded === "false"
      && before.hostActive === "false"
      && /자동 판정/.test(before.summaryStatus ?? "")
      && !/기간·횟수|판정 제외|적용 조건/.test(before.summaryText ?? ""),
    `Collapsed claim card exposed verbose detail text: ${JSON.stringify(before)}`);
    await evaluate(`${card}.querySelector('.claim-card__summary').click()`);
    await waitFor("document.getElementById('claimReviewDetailHost').dataset.active === 'true' && Boolean(__smoke.detail())", "Claim detail panel did not open.");
    const after = await evaluate(`(() => {
      const details = __smoke.detail();
      const host = document.getElementById('claimReviewDetailHost');
      return {
        expanded: ${card}.querySelector('.claim-card__summary').getAttribute('aria-expanded'),
        regionRole: details.getAttribute('role'),
        labelledBy: details.getAttribute('aria-labelledby'),
        calculationHeading: details.querySelector('[data-claim-detail-section="timeline"] h6')?.textContent,
        calculation: details.querySelector('.claim-auto-calculation')?.textContent,
        evidenceHeading: details.querySelector('[data-claim-detail-section="evidence"] h6')?.textContent,
        evidence: details.querySelector('.claim-evidence')?.textContent,
        inPersistentHost: host.contains(details),
        hostPosition: getComputedStyle(host).position,
        live: document.getElementById('claimBoardLive')?.textContent,
      };
    })()`);
    assert(after.expanded === "true"
      && after.regionRole === "dialog"
      && Boolean(after.labelledBy)
      && after.calculationHeading === "시간·횟수 계산"
      && /시행 횟수|기간·횟수 미집계/.test(after.calculation ?? "")
      && after.evidenceHeading === "EMR에서 확인한 사실"
      && /고혈압[\s\S]*직접 입력 · 의료진 검토 확정/.test(after.evidence ?? "")
      && /혈압[\s\S]*직접 입력 · 의료진 검토 확정/.test(after.evidence ?? "")
      && after.inPersistentHost === true
      && after.hostPosition === "sticky"
      && /근거와 규칙 세부정보를 열었습니다/.test(after.live ?? ""),
    `Claim evidence disclosure was not accessible or complete: ${JSON.stringify(after)}`);
    const disclosure = { before, after };
    await evaluate("document.getElementById('claimBoardTitle').scrollIntoView({ block: 'start' })");
    const screenshot = await client.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await mkdir(dirname(screenshotPath), { recursive: true });
    await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
    await evaluate(`${card}.querySelector('.claim-card__summary').click()`);
    await waitFor("document.getElementById('claimReviewDetailHost').dataset.active === 'false'", "Claim detail panel did not close.");

    // Dragging onto a lane stages the target stage in the detail panel; nothing moves yet.
    await evaluate(`(() => {
      const source = ${card};
      const dropzone = document.querySelector('[data-claim-review-dropzone="evidence"]');
      const transfer = new DataTransfer();
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      dropzone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      dropzone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
    })()`);
    await waitFor(
      `${card}.closest('[data-claim-review-lane]')?.dataset.claimReviewLane === 'new' && __smoke.field('stage')?.value === 'evidence'`,
      "Drag-and-drop did not stage evidence reconciliation in the persistent detail panel.",
    );
    const stagedDrag = await evaluate(`(() => {
      const review = __smoke.state().claimReviews.find((item) => item.evaluationId === ${JSON.stringify(cardId)});
      return {
        computedStatus: ${card}.dataset.status,
        renderedLane: ${card}.closest('[data-claim-review-lane]')?.dataset.claimReviewLane,
        selectedStage: __smoke.field('stage').value,
        hostActive: document.getElementById('claimReviewDetailHost').dataset.active,
        live: document.getElementById('claimBoardLive').textContent,
        summaryCounts: [...document.querySelectorAll('.claim-result-chip b')].map((node) => Number(node.textContent)),
        durableStage: review?.stage,
      };
    })()`);
    assert(stagedDrag.computedStatus === initial.computedStatus, "Staging a drag changed the calculated reimbursement result.");
    assert(stagedDrag.renderedLane === "new" && stagedDrag.selectedStage === "evidence", "Drag did not remain in the current lane while staging its target in the detail panel.");
    assert(stagedDrag.hostActive === "true" && /끌어왔습니다/.test(stagedDrag.live), "Drag did not open the persistent detail panel with an announcement.");
    assert(JSON.stringify(stagedDrag.summaryCounts) === JSON.stringify(initial.summaryCounts), "Staging a drag changed the immutable rule summary.");
    assert(stagedDrag.durableStage === undefined, "Drag persisted a review stage before the required human fields were saved.");

    await evaluate("__smoke.fillReview({ assignee: '김심사', reviewer: '이검토', reason: '외부 검사 결과와 기간 기준 확인', opinion: '자료 확인 단계로 배정' })");
    await waitFor(`document.querySelector(${JSON.stringify(cardSelector("evidence"))}) !== null`, "Saving the staged drag did not move the review card to evidence reconciliation.");
    const afterDrag = await evaluate(`(() => {
      const saved = __smoke.state();
      const audit = saved.audit.at(-1);
      const review = saved.claimReviews.find((item) => item.evaluationId === ${JSON.stringify(cardId)});
      return {
        computedStatus: ${card}.dataset.status,
        renderedLane: ${card}.closest('[data-claim-review-lane]')?.dataset.claimReviewLane,
        live: document.getElementById('claimBoardLive').textContent,
        summaryCounts: [...document.querySelectorAll('.claim-result-chip b')].map((node) => Number(node.textContent)),
        auditAction: audit.action,
        auditDetail: audit.detail,
        auditEntityId: audit.entityId,
        durableStage: review?.stage,
        durableAssignee: review?.assignee,
        durableReviewer: review?.reviewer,
        durableCalculatedStatus: review?.calculatedStatus,
        fingerprintLength: review?.fingerprint?.length ?? 0,
      };
    })()`);
    assert(afterDrag.computedStatus === initial.computedStatus, "Saving the drag review changed the calculated reimbursement result.");
    assert(afterDrag.renderedLane === "evidence", "Saved drag review does not render in evidence reconciliation.");
    assert(JSON.stringify(afterDrag.summaryCounts) === JSON.stringify(initial.summaryCounts), "Saving the drag review changed the immutable rule summary.");
    assert(afterDrag.auditAction === "claim-review.stage.evidence" && afterDrag.auditEntityId === cardId, "Saved drag review was not audited against the evaluation.");
    assert(/규칙 판정 .* 유지/.test(afterDrag.auditDetail), "Review audit does not state that the calculated result was preserved.");
    assert(/자동 규칙 판정[\s\S]*변경되지 않았습니다/.test(afterDrag.live), `Assistive live status does not explain the safe move semantics: ${JSON.stringify(afterDrag.live)}`);
    assert(afterDrag.durableStage === "evidence" && afterDrag.durableAssignee === "김심사" && afterDrag.durableReviewer === "이검토", "Saved drag review did not persist the stage, assignee, and reviewer together.");
    assert(afterDrag.durableCalculatedStatus === initial.computedStatus && afterDrag.fingerprintLength > 0, "Durable review state did not bind the stage to its calculated result fingerprint.");

    // The review survives the bounded audit history rolling past its own entry.
    let auditRollover;
    {
      let saved = await readState();
      for (let index = 0; index < 1001; index += 1) {
        saved = appendStateAudit(
          saved,
          "patient.updated",
          `급여 검토 감사 보존 경계 ${index}`,
          new Date(Date.parse("2026-07-22T01:00:00.000Z") + index).toISOString(),
          saved.selectedPatientId,
        );
      }
      await writeState(saved);
      const review = saved.claimReviews.find((item) => item.evaluationId === cardId);
      auditRollover = {
        auditLength: saved.audit.length,
        stageAuditPresent: saved.audit.some((item) => item.action === "claim-review.stage.evidence"),
        durableStage: review?.stage,
        fingerprintLength: review?.fingerprint?.length ?? 0,
      };
    }
    assert(auditRollover.auditLength === 1000 && auditRollover.stageAuditPresent === false, "Claim smoke did not cross the bounded audit-history retention edge.");
    assert(auditRollover.durableStage === "evidence" && auditRollover.fingerprintLength > 0, "Audit rollover removed the durable review state.");

    await openBoard();
    await waitFor(`document.querySelector(${JSON.stringify(cardSelector("evidence"))}) !== null`, "Review stage did not persist through a reload.");
    await evaluate(`${card}.querySelector('.claim-card__summary').click()`);
    await waitFor("Boolean(__smoke.field('assignee'))", "Reloaded detail panel did not open.");
    const reloadedAssignment = await evaluate(`(() => {
      const review = __smoke.state().claimReviews.find((item) => item.evaluationId === ${JSON.stringify(cardId)});
      return {
        owner: ${card}.querySelector('.claim-card__owner')?.textContent,
        assigneeInput: __smoke.field('assignee')?.value,
        durableAssignee: review?.assignee,
      };
    })()`);
    assert(reloadedAssignment.durableAssignee === "김심사"
      && reloadedAssignment.assigneeInput === "김심사"
      && /김심사/.test(reloadedAssignment.owner ?? ""),
    `Assignee did not persist into the reloaded card and detail panel: ${JSON.stringify(reloadedAssignment)}`);

    // Keyboard: the stage select is reachable and stages without saving.
    const selectSelector = '#claimReviewDetailHost select[aria-label$="담당자 검토 단계 이동"]';
    assert(await tabTo(selectSelector), "Keyboard focus could not reach the claim review stage control.");
    await evaluate("__smoke.set(__smoke.field('stage'), 'reviewing')");
    const stagedKeyboard = await evaluate(`(() => {
      const review = __smoke.state().claimReviews.find((item) => item.evaluationId === ${JSON.stringify(cardId)});
      return {
        renderedLane: ${card}.closest('[data-claim-review-lane]')?.dataset.claimReviewLane,
        selectedStage: __smoke.field('stage').value,
        durableStage: review?.stage,
        requiredFields: ['assignee', 'reviewer', 'reason'].every((name) => Boolean(__smoke.field(name))),
        saveButton: Boolean(__smoke.detail().querySelector('.claim-review-apply')),
      };
    })()`);
    assert(stagedKeyboard.renderedLane === "evidence"
      && stagedKeyboard.selectedStage === "reviewing"
      && stagedKeyboard.durableStage === "evidence",
    `Keyboard stage selection persisted before save: ${JSON.stringify(stagedKeyboard)}`);
    assert(stagedKeyboard.requiredFields && stagedKeyboard.saveButton, "Keyboard stage selection did not expose the required human fields and save step.");
    await evaluate("__smoke.fillReview({ assignee: '김심사', reviewer: '이검토', reason: '자료 확인 완료 후 담당자 검토' })");
    await waitFor(`document.querySelector(${JSON.stringify(cardSelector("reviewing"))}) !== null`, "Saving the keyboard-selected stage did not move the card.");

    const beforeStale = await evaluate(`(() => {
      const saved = __smoke.state();
      const review = saved.claimReviews.find((item) => item.evaluationId === ${JSON.stringify(cardId)});
      return {
        durableStage: review?.stage,
        durableAssignee: review?.assignee,
        calculatedStatus: review?.calculatedStatus,
        invalidationCount: saved.audit.filter((item) => item.action === 'claim-review.invalidated' && item.entityId === ${JSON.stringify(cardId)}).length,
      };
    })()`);
    assert(beforeStale.durableStage === "reviewing" && beforeStale.durableAssignee === "김심사" && beforeStale.calculatedStatus === initial.computedStatus, "Keyboard save did not update the durable review and assignee safely.");

    // A confirmed follow-up service changes the calculation; the stored review stays put until a person acts.
    let changedComputation;
    {
      let saved = await readState();
      const patientId = saved.selectedPatientId;
      const serviceId = "claim-smoke-follow-up-service";
      saved = appendPatientEvent(saved, patientId, {
        id: serviceId,
        type: "procedure",
        date: browserToday,
        system: "urn:policycompass:demo:service",
        code: "DEMO-BP-FOLLOWUP",
        label: "고혈압 추적검사",
        status: "completed",
        source: { kind: "manual", label: "직접 입력 · 검토 대기" },
      });
      saved = confirmPatientEvent(saved, patientId, serviceId);
      await writeState(saved);
      const review = saved.claimReviews.find((item) => item.evaluationId === cardId);
      changedComputation = {
        storedStage: review?.stage,
        storedCalculatedStatus: review?.calculatedStatus,
        invalidationCount: saved.audit.filter((item) => item.action === "claim-review.invalidated" && item.entityId === cardId).length,
      };
    }
    assert(changedComputation.storedStage === "reviewing" && changedComputation.storedCalculatedStatus === initial.computedStatus, "Clinical change unexpectedly rewrote the prior review before safe resolution.");
    assert(changedComputation.invalidationCount === beforeStale.invalidationCount, "Direct clinical change audited review invalidation during a read-only calculation.");

    await openBoard();
    await waitFor(`document.querySelector(${JSON.stringify(cardSelector("new"))}+'[data-claim-review-stale="true"]') !== null`, "Changed claim computation did not safely return the prior review to the unclassified lane.");
    await evaluate(`${card}.querySelector('.claim-card__summary').click()`);
    await waitFor("Boolean(__smoke.field('stage'))", "Stale card detail did not open.");
    const staleView = await evaluate(`(() => {
      const saved = __smoke.state();
      const review = saved.claimReviews.find((item) => item.evaluationId === ${JSON.stringify(cardId)});
      return {
        computedStatus: ${card}?.dataset.status,
        stale: ${card}?.dataset.claimReviewStale,
        warning: ${card}?.querySelector('.claim-review-stale')?.textContent,
        renderedStage: __smoke.field('stage')?.value,
        storedStage: review?.stage,
        invalidationCount: saved.audit.filter((item) => item.action === 'claim-review.invalidated' && item.entityId === ${JSON.stringify(cardId)}).length,
      };
    })()`);
    assert(staleView.computedStatus !== initial.computedStatus, "Clinical evidence did not change the deterministic reimbursement result in the staleness smoke.");
    assert(staleView.stale === "true" && staleView.renderedStage === "new" && /재검토 필요/.test(staleView.warning ?? ""), `Stale review is not visibly and accessibly marked for re-review: ${JSON.stringify(staleView)}`);
    assert(staleView.storedStage === "reviewing" && staleView.invalidationCount === beforeStale.invalidationCount, "Pure board rendering mutated or audited the durable stale review.");

    await evaluate("__smoke.fillReview({ stage: 'evidence', assignee: '김심사', reviewer: '이검토', reason: '변경된 임상 근거 재확인' })");
    await waitFor(`document.querySelector(${JSON.stringify(cardSelector("evidence"))}+'[data-claim-review-stale="false"]') !== null`, "Saving explicit re-review did not persist a fresh evidence-reconciliation stage.");
    const staleRecovery = await evaluate(`(() => {
      const saved = __smoke.state();
      const review = saved.claimReviews.find((item) => item.evaluationId === ${JSON.stringify(cardId)});
      const relevantAudit = saved.audit.filter((item) => item.entityId === ${JSON.stringify(cardId)} && item.action.startsWith('claim-review.'));
      return {
        computedStatus: ${card}?.dataset.status,
        durableStage: review?.stage,
        durableAssignee: review?.assignee,
        invalidatedAt: review?.invalidatedAt,
        invalidatedFrom: review?.invalidatedFrom,
        invalidationCount: relevantAudit.filter((item) => item.action === 'claim-review.invalidated').length,
        lastActions: relevantAudit.slice(-2).map((item) => item.action),
        live: document.getElementById('claimBoardLive')?.textContent,
      };
    })()`);
    assert(staleRecovery.computedStatus === staleView.computedStatus, "Manual stale-review recovery changed the calculated reimbursement result.");
    assert(staleRecovery.durableStage === "evidence" && staleRecovery.durableAssignee === "김심사" && !staleRecovery.invalidatedAt && !staleRecovery.invalidatedFrom, "Fresh review stage and assignee did not replace the invalidated durable record cleanly.");
    assert(staleRecovery.invalidationCount === beforeStale.invalidationCount + 1, "Stale review invalidation was not audited exactly once.");
    assert(JSON.stringify(staleRecovery.lastActions) === JSON.stringify(["claim-review.invalidated", "claim-review.stage.evidence"]), "Stale recovery audit ordering is unclear.");
    assert(/자동 규칙 판정[\s\S]*변경되지 않았습니다/.test(staleRecovery.live ?? ""), "Assistive live status does not confirm the calculated result survived the re-review.");

    const responsive = [];
    for (const viewport of [
      { width: 768, height: 1024, mobile: false, columns: 1 },
      { width: 1600, height: 900, mobile: false, columns: 2 },
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

    // On a phone the same detail panel becomes a full-screen drawer with a 44px stage control.
    await setViewport({ width: 390, height: 844, mobile: true });
    await evaluate(`(() => { if (document.getElementById('claimReviewDetailHost').dataset.active === 'true') __smoke.detail().querySelector('.claim-card__details-close').click(); })()`);
    await waitFor("document.getElementById('claimReviewDetailHost').dataset.active === 'false'", "Detail panel did not close before the mobile check.");
    await evaluate(`${card}.querySelector('.claim-card__summary').click()`);
    await waitFor("Boolean(__smoke.field('stage'))", "Mobile detail drawer did not open.");
    const mobile = await evaluate(`(() => {
      const details = __smoke.detail();
      return {
        laneCount: document.querySelectorAll('[data-claim-review-lane]').length,
        laneColumns: getComputedStyle(document.getElementById('claimBoard')).gridTemplateColumns.split(' ').length,
        selectHeight: __smoke.field('stage').getBoundingClientRect().height,
        detailPosition: getComputedStyle(details).position,
        detailInHost: document.getElementById('claimReviewDetailHost').contains(details),
        handleDisplay: getComputedStyle(document.querySelector('.claim-drag-handle')).display,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
      };
    })()`);
    assert(mobile.laneCount === 4 && mobile.laneColumns === 1, "Mobile review board is not a single-column four-stage flow.");
    assert(mobile.detailPosition === "fixed" && mobile.detailInHost === true, `Mobile did not reopen the shared detail as a full-screen drawer: ${JSON.stringify(mobile)}`);
    assert(mobile.selectHeight >= 44 && mobile.handleDisplay === "none", `Mobile does not expose the 44px stage fallback while suppressing the drag cue: ${JSON.stringify(mobile)}`);
    assert(mobile.documentWidth <= mobile.viewportWidth, `Mobile claim board overflows the viewport: ${mobile.documentWidth}/${mobile.viewportWidth}`);

    await writeSmokeReport(reportPath, {
      suite: "claim-board-drag",
      generatedAt: new Date().toISOString(),
      automaticResultPreserved: true,
      dragAndDrop: true,
      keyboardAndMobileStageControl: true,
      stagedBeforeHumanSave: { drag: stagedDrag, keyboard: stagedKeyboard },
      localPersistence: true,
      auditTrail: true,
      reloadedAssignment,
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
} finally {
  await app.stop();
}

console.log(`claim board drag smoke passed; report ${reportPath}`);
