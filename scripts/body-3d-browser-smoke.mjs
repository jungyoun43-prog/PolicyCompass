import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  assert,
  runBrowserSmoke,
  startManagedAppServer,
  writeSmokeReport,
} from "./browser-smoke-harness.mjs";

const screenshotRoot = process.env.BODY_3D_SCREENSHOT_ROOT ?? "/tmp/policycompass-body-3d-screens";
const reportPath = process.env.BODY_3D_SMOKE_REPORT ?? `${screenshotRoot}/body-3d-report.json`;
const patientScreenshot = `${screenshotRoot}/patient-body-3d-1440.png`;
const patientAngledScreenshot = `${screenshotRoot}/patient-body-3d-angled-1440.png`;
const patientSideScreenshot = `${screenshotRoot}/patient-body-3d-side-1440.png`;
const patientRearScreenshot = `${screenshotRoot}/patient-body-3d-rear-1440.png`;
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
    profilePrefix: "policycompass-body-3d-",
    initialViewport: { width: 1440, height: 1100, mobile: false },
  }, async ({ client, evaluate, navigate, setViewport, waitFor }) => {
    await navigate("/map?sample=1", "Boolean(document.querySelector('[data-body-3d]'))");
    await evaluate("document.querySelector('[data-body-3d]').scrollIntoView({ block: 'center' })");
    await waitFor(
      "document.querySelector('[data-body-3d]')?.dataset.body3dState === 'ready'",
      "환자 3D 신체 지도가 준비되지 않았습니다.",
      { timeoutMs: 45_000 },
    );

    const patient = await evaluate(`(() => {
      const stage = document.querySelector('[data-body-context="patient"]');
      const viewer = stage.querySelector('model-viewer');
      const expectedOrganNodes = [
        'Organ_Brain', 'Organ_Lung_L', 'Organ_Lung_R', 'Organ_Heart', 'Organ_Liver',
        'Organ_Stomach', 'Organ_Kidney_L', 'Organ_Kidney_R', 'Organ_Intestines',
      ];
      const gltf = viewer.originalGltfJson;
      const nodeMaterialIndexes = (nodeNames) => nodeNames.flatMap((nodeName) => {
        const node = gltf.nodes?.find(({ name }) => name === nodeName);
        const mesh = Number.isInteger(node?.mesh) ? gltf.meshes?.[node.mesh] : null;
        return mesh?.primitives?.map(({ material }) => material).filter(Number.isInteger) || [];
      });
      const organNodeNames = expectedOrganNodes.filter((name) => gltf.nodes?.some((node) => node.name === name));
      const organMaterialIndexes = [...new Set(nodeMaterialIndexes(organNodeNames))];
      const bodyMaterialIndex = nodeMaterialIndexes(['ClinicalBody'])[0];
      const bodyMaterial = viewer.model?.materials?.[bodyMaterialIndex]
        || viewer.model?.materials?.find(({ name = '' }) => /body|human|skin/i.test(name));
      const bodyPbr = bodyMaterial?.pbrMetallicRoughness;
      return {
        state: stage.dataset.body3dState,
        presentation: stage.dataset.body3dPresentation,
        viewerSource: new URL(viewer.getAttribute('src')).pathname,
        cameraControls: viewer.hasAttribute('camera-controls'),
        autoRotate: viewer.hasAttribute('auto-rotate'),
        disableTap: viewer.hasAttribute('disable-tap'),
        toneMapping: viewer.getAttribute('tone-mapping'),
        exposure: Number(viewer.getAttribute('exposure')),
        shadowIntensity: Number(viewer.getAttribute('shadow-intensity')),
        shadowSoftness: Number(viewer.getAttribute('shadow-softness')),
        materialTreatment: viewer.dataset.bodyMaterialTreatment,
        adjustedMaterials: Number(stage.dataset.body3dMaterials),
        organState: stage.dataset.body3dOrgans,
        organNodeNames,
        organMaterialIndexes,
        organMaterialCount: organMaterialIndexes.length,
        organAlphas: organMaterialIndexes.map((index) => viewer.model.materials[index].pbrMetallicRoughness.baseColorFactor[3]),
        organControlPresent: Boolean(stage.querySelector('.body-3d-organs')),
        modeControlCount: stage.querySelectorAll('.body-3d-mode-2d, .body-3d-mode-3d').length,
        controlCount: stage.querySelectorAll('.body-3d-control, .body-3d-controls').length,
        bodyColor: bodyPbr ? [...bodyPbr.baseColorFactor] : [],
        bodyAlpha: bodyPbr?.baseColorFactor?.[3],
        bodyRoughness: bodyPbr?.roughnessFactor,
        hotspots: viewer.querySelectorAll('.body-hotspot').length,
        slottedHotspots: viewer.querySelectorAll('.body-hotspot[slot^="hotspot-"][data-position][data-normal]').length,
        visibleHotspots: viewer.querySelectorAll('.body-hotspot[data-visible]').length,
        imageHidden: stage.querySelector('.human-figure__image').hidden,
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    })()`);
    assert(patient.state === "ready", `환자 3D 상태 오류: ${JSON.stringify(patient)}`);
    assert(patient.viewerSource === "/assets/body-atlas-3d-v4.glb", `환자 모델 경로 오류: ${JSON.stringify(patient)}`);
    assert(patient.cameraControls && !patient.autoRotate, `환자 카메라 제어 오류: ${JSON.stringify(patient)}`);
    assert(patient.presentation === "clinical" && patient.disableTap && patient.toneMapping === "neutral",
      `환자 3D 의료용 렌더 설정 오류: ${JSON.stringify(patient)}`);
    assert(patient.exposure >= 0.85 && patient.exposure <= 1 && patient.shadowIntensity >= 1 && patient.shadowSoftness >= 0.6,
      `환자 3D 조명·그림자 설정 오류: ${JSON.stringify(patient)}`);
    assert(patient.materialTreatment === "clinical-layered" && patient.adjustedMaterials >= 10
      && Math.max(...patient.bodyColor.slice(0, 3)) - Math.min(...patient.bodyColor.slice(0, 3)) < 0.08
      && patient.bodyAlpha >= 0.48 && patient.bodyAlpha <= 0.64 && patient.bodyRoughness >= 0.75,
      `환자 3D 외피 재질 보정 오류: ${JSON.stringify(patient)}`);
    assert(patient.organState === "visible" && patient.organNodeNames.length === 9
      && patient.organMaterialCount === 9 && patient.organAlphas.every((alpha) => alpha > 0.95)
      && !patient.organControlPresent && patient.modeControlCount === 0 && patient.controlCount === 0,
      `환자 3D 장기 기본 표시 오류: ${JSON.stringify(patient)}`);
    assert(patient.hotspots === 12 && patient.slottedHotspots === 12 && patient.visibleHotspots >= 8,
      `환자 3D 표식 오류: ${JSON.stringify(patient)}`);
    assert(patient.imageHidden, `환자 3D 폴백 이미지 표시 오류: ${JSON.stringify(patient)}`);
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
      viewer.setAttribute('camera-orbit', '34deg 75deg 4.45m');
      viewer.jumpCameraToGoal?.();
    })()`);
    await waitFor(
      "Math.abs(document.querySelector('[data-body-context=\"patient\"] model-viewer').getCameraOrbit().theta) > 0.4",
      "3D 카메라 회전이 적용되지 않았습니다.",
    );
    await capture(client, patientAngledScreenshot);
    await evaluate(`(() => {
      const viewer = document.querySelector('[data-body-context="patient"] model-viewer');
      viewer.setAttribute('camera-orbit', '90deg 80deg 4.45m');
      viewer.jumpCameraToGoal?.();
    })()`);
    await waitFor(
      "Math.abs(document.querySelector('[data-body-context=\"patient\"] model-viewer').getCameraOrbit().theta - Math.PI / 2) < 0.12",
      "3D 측면 카메라가 적용되지 않았습니다.",
    );
    await capture(client, patientSideScreenshot);
    await evaluate(`(() => {
      const viewer = document.querySelector('[data-body-context="patient"] model-viewer');
      viewer.setAttribute('camera-orbit', '180deg 80deg 4.45m');
      viewer.jumpCameraToGoal?.();
    })()`);
    await waitFor(
      "Math.abs(Math.abs(document.querySelector('[data-body-context=\"patient\"] model-viewer').getCameraOrbit().theta) - Math.PI) < 0.12",
      "3D 후면 카메라가 적용되지 않았습니다.",
    );
    await capture(client, patientRearScreenshot);
    await evaluate(`(() => {
      const viewer = document.querySelector('[data-body-context="patient"] model-viewer');
      viewer.setAttribute('camera-orbit', '0deg 87deg 4.45m');
      viewer.jumpCameraToGoal?.();
    })()`);

    await setViewport({ width: 390, height: 844, mobile: true });
    await evaluate("document.querySelector('[data-body-context=\"patient\"]').scrollIntoView({ block: 'center' })");
    const patientMobile = await evaluate(`(() => {
      const stage = document.querySelector('[data-body-context="patient"]');
      return {
        overflow: document.documentElement.scrollWidth - innerWidth,
        controlCount: stage.querySelectorAll('.body-3d-control, .body-3d-controls').length,
        state: stage.dataset.body3dState,
      };
    })()`);
    assert(patientMobile.overflow <= 0 && patientMobile.controlCount === 0 && patientMobile.state === "ready",
      `환자 모바일 3D 배치 오류: ${JSON.stringify(patientMobile)}`);
    await capture(client, patientMobileScreenshot);

    await setViewport({ width: 1440, height: 1100, mobile: false });
    await navigate("/emr?demo=1", "document.getElementById('selectedPatientName')?.textContent === '김비타'");
    await evaluate("document.querySelector('[data-tab=\"graph\"]').click()");
    await waitFor("document.getElementById('panel-graph')?.hidden === false", "EMR 신체 지도 탭이 열리지 않았습니다.");
    await evaluate("document.querySelector('[data-body-context=\"emr\"]').scrollIntoView({ block: 'center' })");
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
      patientMobile,
      emr,
      screenshots: {
        patientScreenshot,
        patientAngledScreenshot,
        patientSideScreenshot,
        patientRearScreenshot,
        patientMobileScreenshot,
        emrScreenshot,
      },
    };
    await writeSmokeReport(reportPath, report);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  });
} finally {
  await app.stop();
}
