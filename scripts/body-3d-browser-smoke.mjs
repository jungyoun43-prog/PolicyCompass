import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  assert,
  runBrowserSmoke,
  startManagedAppServer,
  writeSmokeReport,
} from "./browser-smoke-harness.mjs";

const screenshotRoot = process.env.BODY_3D_SCREENSHOT_ROOT ?? "/tmp/vitagraph-body-3d-screens";
const reportPath = process.env.BODY_3D_SMOKE_REPORT ?? `${screenshotRoot}/body-3d-report.json`;
const patientScreenshot = `${screenshotRoot}/patient-body-3d-1440.png`;
const patientAngledScreenshot = `${screenshotRoot}/patient-body-3d-angled-1440.png`;
const patientMobileScreenshot = `${screenshotRoot}/patient-body-3d-390.png`;
const emrScreenshot = `${screenshotRoot}/emr-body-3d-1440.png`;

async function capture(client, path) {
  const screenshot = await client.call("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(screenshot.data, "base64"));
}

const app = await startManagedAppServer({ healthPath: "/map" });
try {
  await runBrowserSmoke({
    appUrl: app.appUrl,
    profilePrefix: "vitagraph-body-3d-",
    initialViewport: { width: 1440, height: 1100, mobile: false },
  }, async ({ client, evaluate, navigate, setViewport, waitFor }) => {
    await navigate("/map?sample=1", "Boolean(document.querySelector('[data-body-3d]'))");
    await evaluate("document.querySelector('[data-body-3d]').scrollIntoView({ block: 'center' })");
    await evaluate("document.querySelector('[data-body-3d] .body-3d-mode-3d').click()");
    await waitFor(
      "document.querySelector('[data-body-3d]')?.dataset.body3dState === 'ready'",
      "환자 3D 신체 지도가 준비되지 않았습니다.",
      { timeoutMs: 20_000 },
    );

    const patient = await evaluate(`(() => {
      const stage = document.querySelector('[data-body-context="patient"]');
      const viewer = stage.querySelector('model-viewer');
      const controls = [...stage.querySelectorAll('.body-3d-control')];
      return {
        state: stage.dataset.body3dState,
        viewerSource: new URL(viewer.getAttribute('src')).pathname,
        cameraControls: viewer.hasAttribute('camera-controls'),
        autoRotate: viewer.hasAttribute('auto-rotate'),
        hotspots: viewer.querySelectorAll('.body-hotspot').length,
        slottedHotspots: viewer.querySelectorAll('.body-hotspot[slot^="hotspot-"][data-position][data-normal]').length,
        visibleHotspots: viewer.querySelectorAll('.body-hotspot[data-visible]').length,
        imageHidden: stage.querySelector('.human-figure__image').hidden,
        controlHeights: controls.map((node) => Math.round(node.getBoundingClientRect().height)),
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    })()`);
    assert(patient.state === "ready", `환자 3D 상태 오류: ${JSON.stringify(patient)}`);
    assert(patient.viewerSource === "/assets/body-atlas-3d-v1.glb", `환자 모델 경로 오류: ${JSON.stringify(patient)}`);
    assert(patient.cameraControls && !patient.autoRotate, `환자 카메라 제어 오류: ${JSON.stringify(patient)}`);
    assert(patient.hotspots === 12 && patient.slottedHotspots === 12 && patient.visibleHotspots >= 8,
      `환자 3D 표식 오류: ${JSON.stringify(patient)}`);
    assert(patient.imageHidden && patient.controlHeights.every((height) => height >= 44), `환자 3D 조작 크기 오류: ${JSON.stringify(patient)}`);
    assert(patient.overflow <= 0, `환자 1440 화면 가로 넘침: ${patient.overflow}`);

    await evaluate("document.querySelector('model-viewer .hotspot-cardio').click()");
    await waitFor(
      "document.querySelector('model-viewer .hotspot-cardio')?.getAttribute('aria-pressed') === 'true'",
      "3D 심혈관 표식 선택이 기존 상세 상태와 연결되지 않았습니다.",
    );
    await evaluate("document.querySelector('[data-body-context=\"patient\"]').scrollIntoView({ block: 'center' })");
    await capture(client, patientScreenshot);
    await evaluate(`(() => {
      const viewer = document.querySelector('[data-body-context="patient"] model-viewer');
      viewer.setAttribute('camera-orbit', '34deg 75deg auto');
      viewer.jumpCameraToGoal?.();
    })()`);
    await waitFor(
      "Math.abs(document.querySelector('[data-body-context=\"patient\"] model-viewer').getCameraOrbit().theta) > 0.4",
      "3D 카메라 회전이 적용되지 않았습니다.",
    );
    await capture(client, patientAngledScreenshot);
    await evaluate("document.querySelector('[data-body-context=\"patient\"] .body-3d-reset').click()");

    await evaluate("document.querySelector('[data-body-context=\"patient\"] .body-3d-mode-2d').click()");
    const fallback = await evaluate(`(() => {
      const stage = document.querySelector('[data-body-context="patient"]');
      return {
        state: stage.dataset.body3dState,
        imageVisible: !stage.querySelector('.human-figure__image').hidden,
        viewerHidden: stage.querySelector('model-viewer').hidden,
        restoredHotspots: stage.querySelector('.human-figure').querySelectorAll(':scope > .body-hotspot').length,
      };
    })()`);
    assert(fallback.state === "2d" && fallback.imageVisible && fallback.viewerHidden && fallback.restoredHotspots === 12,
      `2D 복구 오류: ${JSON.stringify(fallback)}`);

    await evaluate("document.querySelector('[data-body-context=\"patient\"] .body-3d-mode-3d').click()");
    await waitFor(
      "document.querySelector('[data-body-context=\"patient\"]')?.dataset.body3dState === 'ready'",
      "환자 3D 재전환에 실패했습니다.",
    );
    await evaluate("document.querySelector('[data-body-context=\"patient\"] .body-3d-reset').click()");

    await setViewport({ width: 390, height: 844, mobile: true });
    await evaluate("document.querySelector('[data-body-context=\"patient\"]').scrollIntoView({ block: 'center' })");
    const patientMobile = await evaluate(`(() => {
      const stage = document.querySelector('[data-body-context="patient"]');
      const stageBox = stage.getBoundingClientRect();
      const controls = stage.querySelector('.body-3d-controls').getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - innerWidth,
        controlsInside: controls.left >= stageBox.left && controls.right <= stageBox.right,
        state: stage.dataset.body3dState,
      };
    })()`);
    assert(patientMobile.overflow <= 0 && patientMobile.controlsInside && patientMobile.state === "ready",
      `환자 모바일 3D 배치 오류: ${JSON.stringify(patientMobile)}`);
    await capture(client, patientMobileScreenshot);

    await setViewport({ width: 1440, height: 1100, mobile: false });
    await navigate("/emr?demo=1", "document.getElementById('selectedPatientName')?.textContent === '김비타'");
    await evaluate("document.querySelector('[data-tab=\"graph\"]').click()");
    await waitFor("document.getElementById('panel-graph')?.hidden === false", "EMR 신체 지도 탭이 열리지 않았습니다.");
    await evaluate("document.querySelector('[data-body-context=\"emr\"]').scrollIntoView({ block: 'center' })");
    await evaluate("document.querySelector('[data-body-context=\"emr\"] .body-3d-mode-3d').click()");
    await waitFor(
      "document.querySelector('[data-body-context=\"emr\"]')?.dataset.body3dState === 'ready'",
      "EMR 3D 신체 지도가 준비되지 않았습니다.",
      { timeoutMs: 20_000 },
    );
    await evaluate("document.querySelector('[data-body-context=\"emr\"] model-viewer .hotspot-respiratory').click()");
    await waitFor("document.getElementById('bodyDetailTitle')?.textContent === '폐·호흡'", "EMR 3D 표식과 진료과 상세가 연결되지 않았습니다.");
    const emr = await evaluate(`(() => {
      const stage = document.querySelector('[data-body-context="emr"]');
      return {
        state: stage.dataset.body3dState,
        hotspots: stage.querySelectorAll('model-viewer .body-hotspot').length,
        selected: stage.querySelector('model-viewer .hotspot-respiratory').getAttribute('aria-pressed'),
        detail: document.getElementById('bodyDetailTitle').textContent,
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    })()`);
    assert(emr.state === "ready" && emr.hotspots === 12 && emr.selected === "true" && emr.detail === "폐·호흡",
      `EMR 3D 연동 오류: ${JSON.stringify(emr)}`);
    assert(emr.overflow <= 0, `EMR 1440 화면 가로 넘침: ${emr.overflow}`);
    await capture(client, emrScreenshot);

    const report = {
      patient,
      fallback,
      patientMobile,
      emr,
      screenshots: { patientScreenshot, patientAngledScreenshot, patientMobileScreenshot, emrScreenshot },
    };
    await writeSmokeReport(reportPath, report);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  });
} finally {
  await app.stop();
}
