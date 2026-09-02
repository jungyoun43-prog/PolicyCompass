import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import MapPage from "../app/(map)/map/page.jsx";
import { BodyTab } from "../components/emr/tabs/body-tab.jsx";
import { createDemoEmrState } from "../src/emr-demo-state.js";
import { renderComponent } from "./helpers/render.mjs";

const [adapterSource, loaderSource, bodyTabSource, middlewareSource, packageJson] = await Promise.all([
  readFile(new URL("../src/body-3d.js", import.meta.url), "utf8"),
  readFile(new URL("../components/legacy-script.jsx", import.meta.url), "utf8"),
  readFile(new URL("../components/emr/tabs/body-tab.jsx", import.meta.url), "utf8"),
  readFile(new URL("../middleware.js", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
]);
const {
  Body3DController,
  CLINICAL_BODY_PALETTE,
  CLINICAL_ORGAN_NODES,
  DEFAULT_BODY_HOTSPOTS,
  classifyClinicalPartName,
  collectClinicalMaterialRoles,
} = await import(new URL("../src/body-3d.js", import.meta.url));

const demoState = createDemoEmrState("2026-09-02T00:00:00.000Z");
const demoPatient = demoState.patients.find(({ id }) => id === demoState.selectedPatientId);
const patientHtml = renderComponent(MapPage);
const emrHtml = renderComponent(BodyTab, { patient: demoPatient, selectTab: () => {}, active: false });

/** The opening tag of the first element carrying `attribute` (a data-* name), or "". */
function tagWithAttribute(html, attribute) {
  return html.match(new RegExp(`<[a-z0-9]+[^>]*\\b${attribute}(?:="[^"]*")?[^>]*>`))?.[0] ?? "";
}
const attributeOf = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;

/**
 * Enough of a DOM element for the controller's viewer/hotspot code paths:
 * attributes, dataset, children and listeners are recorded, nothing renders.
 */
class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.attributes = new Map();
    this.dataset = {};
    this.children = [];
    this.listeners = [];
    this.hidden = false;
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }

  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }

  hasAttribute(name) { return this.attributes.has(name); }

  append(...nodes) { this.children.push(...nodes); }

  addEventListener(type) { this.listeners.push(type); }
}

const hexToRgb = (hex) => [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);

/** A model-viewer material double that records the PBR and alpha calls the controller makes. */
function fakeMaterial(name) {
  const pbr = {
    baseColorFactor: [0.5, 0.5, 0.5, 1],
    metallicFactor: 0.4,
    roughnessFactor: 0.5,
    setBaseColorFactor(value) {
      pbr.baseColorFactor = typeof value === "string" ? [...hexToRgb(value), 1] : [...value];
    },
    setMetallicFactor(value) { pbr.metallicFactor = value; },
    setRoughnessFactor(value) { pbr.roughnessFactor = value; },
  };
  const material = {
    name,
    alphaMode: "OPAQUE",
    alphaCutoff: 0.5,
    pbrMetallicRoughness: pbr,
    getAlphaMode: () => material.alphaMode,
    getAlphaCutoff: () => material.alphaCutoff,
    setAlphaMode(value) { material.alphaMode = value; },
    setAlphaCutoff(value) { material.alphaCutoff = value; },
  };
  return material;
}

/**
 * A controller whose constructor never ran (that needs a browser): the given
 * fields stand in for what the real one collects from the stage element.
 */
function bareController(fields) {
  return Object.assign(Object.create(Body3DController.prototype), fields);
}

/** A loaded scene: one body shell plus the organ nodes, each with its own material. */
function loadedScene({ organs = true, options = {} } = {}) {
  const nodeNames = organs ? ["ClinicalBody", ...CLINICAL_ORGAN_NODES] : ["ClinicalBody"];
  const materials = nodeNames.map((name) => fakeMaterial(`${name}_Material`));
  const controller = bareController({
    options,
    stage: { dataset: {} },
    viewer: {
      dataset: {},
      model: { materials },
      originalGltfJson: {
        nodes: nodeNames.map((name, mesh) => ({ name, mesh })),
        meshes: nodeNames.map((_, material) => ({ primitives: [{ material }] })),
        materials: materials.map(({ name }) => ({ name })),
      },
    },
    bodyMaterials: [],
    organMaterials: [],
    clinicalMaterialStates: new Map(),
    materialTreatment: "clinical-neutral",
  });
  return { controller, materials, nodeNames };
}

function parseBinaryGltf(buffer) {
  const jsonLength = buffer.readUInt32LE(12);
  const document = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString("utf8").trim());
  const binaryOffset = 20 + jsonLength + 8;
  const componentLayouts = {
    5121: { bytes: 1, read: "readUInt8" },
    5123: { bytes: 2, read: "readUInt16LE" },
    5125: { bytes: 4, read: "readUInt32LE" },
    5126: { bytes: 4, read: "readFloatLE" },
  };
  const componentCounts = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

  const readAccessor = (accessorIndex) => {
    const accessor = document.accessors[accessorIndex];
    const view = document.bufferViews[accessor.bufferView];
    const layout = componentLayouts[accessor.componentType];
    const componentCount = componentCounts[accessor.type];
    assert.ok(layout && componentCount, `지원하지 않는 GLB accessor입니다: ${accessorIndex}`);
    const offset = binaryOffset + (view.byteOffset || 0) + (accessor.byteOffset || 0);
    const stride = view.byteStride || layout.bytes * componentCount;
    return Array.from({ length: accessor.count }, (_, itemIndex) => {
      const itemOffset = offset + itemIndex * stride;
      const values = Array.from({ length: componentCount }, (__, componentIndex) => (
        buffer[layout.read](itemOffset + componentIndex * layout.bytes)
      ));
      return componentCount === 1 ? values[0] : values;
    });
  };

  return { document, readAccessor };
}

test("환자 지도와 EMR은 같은 자체 호스팅 3D 전신 뷰어를 사용한다", () => {
  for (const [html, context] of [[patientHtml, "patient"], [emrHtml, "emr"]]) {
    const stage = tagWithAttribute(html, "data-body-3d");
    assert.ok(stage, `${context} 화면에 data-body-3d 무대가 렌더링되어야 합니다.`);
    assert.match(attributeOf(stage, "class"), /\bbody-stage\b/);
    assert.equal(attributeOf(stage, "data-body-model"), "/assets/body-atlas-3d-v4.glb");
    assert.equal(attributeOf(stage, "data-body-context"), context);
    const poster = html.match(/<img[^>]*\bclass="human-figure__image"[^>]*>/)?.[0] ?? "";
    assert.equal(attributeOf(poster, "src"), "/assets/body-atlas-v5.webp");
  }
  // source-check: the runtime is loaded inside useEffect (browser only); SSR never runs it, so only the source shows the bundle imports replace a CDN.
  assert.match(loaderSource, /import\("@google\/model-viewer"\)/);
  assert.match(loaderSource, /import\("\.\.\/src\/body-3d\.js"\)/);
  assert.match(bodyTabSource, /import\("@google\/model-viewer"\)/);
  assert.equal(packageJson.dependencies["@google/model-viewer"], "4.3.1");
  // source-check: middleware.js imports "next/server", which Node cannot resolve outside the Next bundler, so the CSP cannot be exercised here.
  assert.match(middlewareSource, /wasm-unsafe-eval/);
  assert.match(middlewareSource, /\["\/emr", "\/map"\]/);
});

test("3D 어댑터는 12개 영역, 자동 3D 표시와 안전한 폴백을 보존한다", async () => {
  assert.deepEqual(Object.keys(DEFAULT_BODY_HOTSPOTS), [
    "neuro",
    "mental",
    "sensory",
    "cardio",
    "respiratory",
    "digestive",
    "endocrine",
    "renal",
    "pelvic",
    "musculoskeletal",
    "rheumatology",
    "dermatology",
  ]);
  // source-check: the controller only builds its DOM inside a browser, so "no mode/reset/organ buttons" is a negative contract on generated markup that needs one.
  assert.doesNotMatch(adapterSource, /createButton\([^\n]*body-3d-mode-(?:2d|3d)/);
  assert.doesNotMatch(adapterSource, /body-3d-control|body-3d-reset|정면/);
  assert.doesNotMatch(adapterSource, /createButton\([^\n]*body-3d-organs/);

  // 오류는 안내 없이 2D로 되돌리고, 상태와 이벤트로만 알린다.
  const set2DCalls = [];
  const stageEvents = [];
  const errorStage = {
    dataset: {},
    classList: { added: [], add(...names) { this.added.push(...names); } },
    ownerDocument: { defaultView: null },
    dispatchEvent(event) { stageEvents.push(event); },
  };
  const failing = bareController({
    stage: errorStage,
    status: { textContent: "" },
    context: "patient",
    set2D(args) { set2DCalls.push(args); },
  });
  failing.handleError(new Error("WebGL 컨텍스트가 끊어졌습니다."), "model-error");
  assert.deepEqual(set2DCalls, [{ announce: false, reason: "model-error" }]);
  assert.equal(errorStage.dataset.body3dState, "error");
  assert.ok(errorStage.classList.added.includes("has-body-3d-error"));
  assert.equal(failing.status.textContent, "WebGL 컨텍스트가 끊어졌습니다. 2D 신체 지도를 표시합니다.");
  assert.deepEqual(stageEvents.map(({ type }) => type), ["body-3d:error"]);
  assert.equal(stageEvents[0].detail.reason, "model-error");

  // source-check: reduced-motion is read from window.matchMedia in the constructor, which needs a real stage element.
  assert.match(adapterSource, /prefers-reduced-motion: reduce/);
  // source-check: "never persists a view preference" is a negative contract on browser storage calls.
  assert.doesNotMatch(adapterSource, /policycompass-body-view|saveData/);

  // 뷰어는 즉시 로드하고 세로 스크롤을 막지 않으며, 탭 선택과 자동 회전은 끈다.
  const figure = new FakeElement("div");
  const mounting = bareController({
    viewer: null,
    ownerDocument: { baseURI: "http://localhost:3000/map", createElement: (tag) => new FakeElement(tag) },
    modelSource: "/assets/body-atlas-3d-v4.glb",
    poster: "/assets/body-atlas-v5.webp",
    options: {},
    stage: { dataset: { bodyAlt: "회전 가능한 3D 건강 지도" } },
    figure,
    initialOrbit: "0deg 87deg 4.45m",
    frontTarget: "0m 0.91m 0m",
    frontFieldOfView: "24deg",
    shadowIntensity: "1.12",
    shadowSoftness: "0.68",
    exposure: "0.9",
    toneMapping: "neutral",
    reducedMotion: false,
    abortController: new AbortController(),
  });
  mounting.mountViewer();
  const viewer = mounting.viewer;
  assert.equal(viewer.tagName, "model-viewer");
  assert.equal(viewer.getAttribute("src"), "http://localhost:3000/assets/body-atlas-3d-v4.glb");
  assert.equal(viewer.getAttribute("poster"), "/assets/body-atlas-v5.webp");
  assert.equal(viewer.getAttribute("alt"), "회전 가능한 3D 건강 지도");
  assert.equal(viewer.getAttribute("loading"), "eager");
  assert.equal(viewer.getAttribute("touch-action"), "pan-y");
  assert.ok(viewer.hasAttribute("disable-tap"));
  assert.ok(viewer.hasAttribute("camera-controls"));
  assert.equal(viewer.getAttribute("shadow-softness"), "0.68");
  assert.equal(viewer.getAttribute("tone-mapping"), "neutral");
  assert.equal(viewer.hasAttribute("auto-rotate"), false);
  assert.equal(viewer.hidden, true, "뷰어는 모델이 준비될 때까지 숨겨 둡니다.");
  assert.ok(figure.children.includes(viewer));
  assert.deepEqual(viewer.listeners, ["load", "error"]);
  // 외부 호스트의 모델은 같은 출처 검사에서 거부된다.
  const external = bareController({ ...mounting, viewer: null, modelSource: "https://sketchfab.com/models/body.glb" });
  assert.throws(() => external.mountViewer(), /같은 출처/);

  // 표식은 기본 좌표와 함께 가시성 속성을 받아 모델 뒤에서 숨겨진다.
  const hotspot = new FakeElement("button");
  hotspot.dataset = { area: "cardio" };
  const placing = bareController({ hotspotMap: {}, originalAttributes: new Map(), viewer: null });
  placing.placeHotspot(hotspot);
  assert.equal(hotspot.getAttribute("slot"), "hotspot-cardio");
  assert.equal(hotspot.getAttribute("data-position"), DEFAULT_BODY_HOTSPOTS.cardio.position);
  assert.equal(hotspot.getAttribute("data-normal"), DEFAULT_BODY_HOTSPOTS.cardio.normal);
  assert.equal(hotspot.getAttribute("data-visibility-attribute"), "visible");

  // 임상 재질: 외피는 반투명 회색, 장기는 불투명 팔레트 색.
  const { controller, materials } = loadedScene();
  const changed = await controller.applyClinicalMaterials();
  assert.equal(changed, materials.length);
  const [body, ...organs] = materials;
  assert.equal(body.alphaMode, "BLEND");
  assert.deepEqual(body.pbrMetallicRoughness.baseColorFactor, [...hexToRgb(CLINICAL_BODY_PALETTE.body), 0.54]);
  assert.equal(body.pbrMetallicRoughness.roughnessFactor, 0.78);
  assert.equal(body.pbrMetallicRoughness.metallicFactor, 0);
  for (const [index, organ] of organs.entries()) {
    const role = classifyClinicalPartName(CLINICAL_ORGAN_NODES[index]);
    assert.equal(organ.alphaMode, "OPAQUE", `${organ.name}는 불투명해야 합니다.`);
    assert.deepEqual(organ.pbrMetallicRoughness.baseColorFactor, [...hexToRgb(CLINICAL_BODY_PALETTE[role]), 1]);
    assert.equal(organ.pbrMetallicRoughness.roughnessFactor, 0.7);
  }
  assert.equal(controller.stage.dataset.body3dOrgans, "visible");
  assert.equal(controller.viewer.dataset.bodyMaterialTreatment, "clinical-layered");
  // 외피 불투명도 설정은 안전 범위로 잘린다.
  const configured = loadedScene({ options: { bodyOpacity: 0.1 } });
  await configured.controller.applyClinicalMaterials();
  assert.equal(configured.materials[0].pbrMetallicRoughness.baseColorFactor[3], 0.34);
  // 장기가 없는 모델은 외피를 불투명하게 두고 장기 미지원을 표시한다.
  const shellOnly = loadedScene({ organs: false });
  await shellOnly.controller.applyClinicalMaterials();
  assert.equal(shellOnly.materials[0].alphaMode, "OPAQUE");
  assert.equal(shellOnly.materials[0].pbrMetallicRoughness.baseColorFactor[3], 1);
  assert.equal(shellOnly.controller.stage.dataset.body3dOrgans, "unsupported");
  // 폐기(discard) 재질은 MASK와 cutoff 1로 완전히 숨긴다.
  const discarded = fakeMaterial("Organ_Heart_Material");
  const state = { material: discarded, originalAlphaMode: "OPAQUE", originalAlphaCutoff: 0.5 };
  assert.ok(controller.setMaterialAppearance(state, CLINICAL_BODY_PALETTE.heart, 1, 0.7, { discard: true }));
  assert.equal(discarded.alphaMode, "MASK");
  assert.equal(discarded.alphaCutoff, 1);
  assert.ok(controller.setMaterialAppearance(state, CLINICAL_BODY_PALETTE.heart, 1, 0.7));
  assert.equal(discarded.alphaMode, "OPAQUE");
  assert.equal(discarded.alphaCutoff, 0.5);

  // source-check: the stage backdrop lives in a stylesheet string the controller injects at runtime; no export exposes it.
  assert.match(adapterSource, /linear-gradient\(180deg, #f2f6f4/);
  // source-check: "no external runtime or model host" is a negative contract over every URL in the module.
  assert.doesNotMatch(adapterSource, /auto-rotate|https:\/\/modelviewer|sketchfab\.com\/models/);
});

test("3D 진료과 표식은 대표 신체 부위의 실제 외피 표면에 붙는다", async () => {
  const coordinates = Object.fromEntries(Object.entries(DEFAULT_BODY_HOTSPOTS).map(([area, value]) => [
    area,
    value.position.split(/\s+/).map((part) => Number.parseFloat(part)),
  ]));

  assert.ok(coordinates.endocrine[1] > coordinates.cardio[1] + 0.15, "내분비 표식은 갑상선 높이에 있어야 합니다.");
  assert.ok(coordinates.cardio[0] > 0, "심혈관 표식은 GLB 심장 노드가 있는 신체 왼쪽 가슴이어야 합니다.");
  assert.ok(coordinates.renal[1] > coordinates.pelvic[1] + 0.2, "신장 표식은 골반보다 위에 있어야 합니다.");
  assert.ok(coordinates.musculoskeletal[0] < -0.1 && coordinates.musculoskeletal[0] > -0.18
    && coordinates.musculoskeletal[1] > 1.2, "근골격 표식은 어깨 표면에 있어야 합니다.");
  assert.ok(coordinates.rheumatology[1] < 0.6, "류마티스 표식은 대표 관절인 무릎 높이에 있어야 합니다.");
  assert.ok(coordinates.dermatology[0] > 0.4 && coordinates.dermatology[0] < 0.48
    && coordinates.dermatology[1] > 1, "피부 표식은 아래팔 표면에 있어야 합니다.");

  const buffer = await readFile(new URL("../public/assets/body-atlas-3d-v4.glb", import.meta.url));
  const jsonLength = buffer.readUInt32LE(12);
  const document = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString("utf8").trim());
  const accessor = document.accessors[
    document.meshes[0].primitives[0].attributes.POSITION
  ];
  const view = document.bufferViews[accessor.bufferView];
  const stride = view.byteStride || 12;
  const positionsOffset = 20 + jsonLength + 8 + (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const surface = Array.from({ length: accessor.count }, (_, index) => [
    buffer.readFloatLE(positionsOffset + index * stride),
    buffer.readFloatLE(positionsOffset + index * stride + 4),
    buffer.readFloatLE(positionsOffset + index * stride + 8),
  ]);

  for (const [area, point] of Object.entries(coordinates)) {
    const nearestDistance = Math.sqrt(surface.reduce((minimum, vertex) => Math.min(
      minimum,
      vertex.reduce((sum, value, axis) => sum + (value - point[axis]) ** 2, 0),
    ), Number.POSITIVE_INFINITY));
    assert.ok(nearestDistance < 0.001, `${area} 표식이 외피에서 ${(nearestDistance * 100).toFixed(2)}cm 떨어져 있습니다.`);
  }
});

test("v4 임상 노드 매핑은 외피와 9개 내부 장기 재질을 분리한다", () => {
  const nodeNames = ["ClinicalBody", ...CLINICAL_ORGAN_NODES];
  const gltf = {
    nodes: nodeNames.map((name, mesh) => ({ name, mesh })),
    meshes: nodeNames.map((_, material) => ({ primitives: [{ material }] })),
    materials: nodeNames.map((name) => ({ name: `${name}_Material` })),
  };
  const roles = collectClinicalMaterialRoles(gltf);

  assert.deepEqual(roles.map(({ role }) => role), [
    "body",
    "brain",
    "lung",
    "lung",
    "heart",
    "liver",
    "stomach",
    "kidney",
    "kidney",
    "intestines",
  ]);
  assert.deepEqual(roles.flatMap(({ nodeNames: names }) => names), nodeNames);
  assert.equal(classifyClinicalPartName("ClinicalBodyMatteGrayV3"), "body");
  assert.equal(classifyClinicalPartName("Material_Organ_Kidney_R"), "kidney");
  assert.equal(Object.keys(CLINICAL_BODY_PALETTE).length, 8);
  assert.match(CLINICAL_BODY_PALETTE.body, /^#[0-9a-f]{6}$/i);
});

test("v4의 모든 장기 정점은 닫힌 신체 외피 안에 충분한 여유를 두고 들어간다", async () => {
  const buffer = await readFile(new URL("../public/assets/body-atlas-3d-v4.glb", import.meta.url));
  const { document, readAccessor } = parseBinaryGltf(buffer);
  const bodyPrimitive = document.meshes[0].primitives[0];
  const bodyPositions = readAccessor(bodyPrimitive.attributes.POSITION);
  const bodyIndices = readAccessor(bodyPrimitive.indices);
  const bodyAccessor = document.accessors[bodyPrimitive.attributes.POSITION];
  const triangles = Array.from({ length: bodyIndices.length / 3 }, (_, triangleIndex) => (
    [0, 1, 2].map((corner) => bodyPositions[bodyIndices[triangleIndex * 3 + corner]])
  ));

  const columns = 64;
  const rows = 106;
  const [minX, minY] = bodyAccessor.min;
  const [maxX, maxY] = bodyAccessor.max;
  const columnAt = (x) => Math.max(0, Math.min(
    columns - 1,
    Math.floor(((x - minX) / (maxX - minX)) * columns),
  ));
  const rowAt = (y) => Math.max(0, Math.min(
    rows - 1,
    Math.floor(((y - minY) / (maxY - minY)) * rows),
  ));
  const bins = Array.from({ length: columns * rows }, () => []);

  for (let triangleIndex = 0; triangleIndex < triangles.length; triangleIndex += 1) {
    const triangle = triangles[triangleIndex];
    const firstColumn = columnAt(Math.min(...triangle.map((point) => point[0])));
    const lastColumn = columnAt(Math.max(...triangle.map((point) => point[0])));
    const firstRow = rowAt(Math.min(...triangle.map((point) => point[1])));
    const lastRow = rowAt(Math.max(...triangle.map((point) => point[1])));
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        bins[row * columns + column].push(triangleIndex);
      }
    }
  }

  const rayCrossings = (x, y) => {
    const crossings = [];
    for (const triangleIndex of bins[rowAt(y) * columns + columnAt(x)]) {
      const [a, b, c] = triangles[triangleIndex];
      const denominator = (b[1] - c[1]) * (a[0] - c[0])
        + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(denominator) < 1e-12) continue;
      const weightA = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1]))
        / denominator;
      const weightB = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1]))
        / denominator;
      const weightC = 1 - weightA - weightB;
      if (weightA < -1e-7 || weightB < -1e-7 || weightC < -1e-7) continue;
      crossings.push(weightA * a[2] + weightB * b[2] + weightC * c[2]);
    }
    crossings.sort((a, b) => a - b);
    return crossings.filter((value, index) => (
      index === 0 || Math.abs(value - crossings[index - 1]) > 1e-6
    ));
  };

  for (const node of document.nodes.slice(1)) {
    const primitive = document.meshes[node.mesh].primitives[0];
    const localPositions = readAccessor(primitive.attributes.POSITION);
    const scale = node.scale || [1, 1, 1];
    const translation = node.translation || [0, 0, 0];
    const outside = [];
    let minimumDepthClearance = Number.POSITIVE_INFINITY;

    for (const local of localPositions) {
      const point = local.map((value, axis) => value * scale[axis] + translation[axis]);
      const crossings = rayCrossings(point[0], point[1]);
      const forwardCrossings = crossings.filter((z) => z > point[2] + 1e-8);
      if (forwardCrossings.length % 2 !== 1) {
        outside.push(point);
        continue;
      }
      const behind = crossings.filter((z) => z <= point[2]);
      const lowerBoundary = Math.max(...behind);
      const upperBoundary = Math.min(...forwardCrossings);
      minimumDepthClearance = Math.min(
        minimumDepthClearance,
        point[2] - lowerBoundary,
        upperBoundary - point[2],
      );
    }

    assert.equal(outside.length, 0, `${node.name} 정점 ${outside.length}개가 신체 외피 밖에 있습니다.`);
    assert.ok(
      minimumDepthClearance > 0.004,
      `${node.name}의 외피 여유가 ${(minimumDepthClearance * 100).toFixed(2)}cm에 불과합니다.`,
    );
  }
});

test("배포하는 GLB는 유효한 바이너리 glTF이며 웹용 크기를 유지한다", async () => {
  const modelUrl = new URL("../public/assets/body-atlas-3d-v4.glb", import.meta.url);
  const [buffer, metadata] = await Promise.all([readFile(modelUrl), stat(modelUrl)]);
  assert.equal(buffer.subarray(0, 4).toString("ascii"), "glTF");
  assert.equal(buffer.readUInt32LE(4), 2);
  assert.equal(buffer.readUInt32LE(8), buffer.length);
  assert.ok(metadata.size < 2 * 1024 * 1024, `GLB가 2MB를 넘습니다: ${metadata.size}`);

  const jsonLength = buffer.readUInt32LE(12);
  assert.equal(buffer.readUInt32LE(16), 0x4e4f534a);
  const document = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString("utf8").trim());
  assert.equal(document.asset?.version, "2.0");
  assert.match(document.asset?.generator || "", /clinical anatomy atlas 4\.0/i);
  assert.equal(document.asset?.extras?.license, "CC0-1.0");
  assert.match(document.asset?.extras?.organGeometry || "", /not diagnostic anatomy/i);
  assert.deepEqual(document.scenes?.[0]?.nodes, [...Array(10).keys()]);
  assert.equal(document.nodes?.length, 10);
  assert.equal(document.meshes?.length, 10);
  assert.equal(document.materials?.length, 10);
  assert.deepEqual(document.nodes.map(({ name }) => name), ["ClinicalBody", ...CLINICAL_ORGAN_NODES]);
  assert.doesNotMatch(
    JSON.stringify([document.nodes, document.meshes, document.materials]),
    /short|garment|underwear|modesty|tights/i,
  );
  const bodyPositionAccessor = document.meshes[0].primitives[0].attributes.POSITION;
  assert.ok(document.accessors[bodyPositionAccessor].count >= 50_000);
  assert.equal(document.materials[0].name, "ClinicalBodyShellGray");
  assert.equal(document.materials[0].alphaMode, "BLEND");
  const bodyColor = document.materials[0].pbrMetallicRoughness.baseColorFactor;
  assert.ok(Math.max(...bodyColor.slice(0, 3)) - Math.min(...bodyColor.slice(0, 3)) < 0.08);
  assert.ok(bodyColor[3] > 0.1 && bodyColor[3] < 0.6);

  const nodes = Object.fromEntries(document.nodes.map((node) => [node.name, node]));
  for (const name of CLINICAL_ORGAN_NODES) {
    assert.ok(nodes[name].scale.every((value) => value > 0.7 && value < 1), `${name}는 외피 안으로 축소되어야 합니다.`);
  }
  assert.deepEqual(nodes.Organ_Intestines.scale, [0.72, 0.78, 0.72]);
  assert.ok(nodes.Organ_Lung_L.translation[0] > 0);
  assert.ok(nodes.Organ_Lung_R.translation[0] < 0);
  assert.ok(nodes.Organ_Heart.translation[0] > 0);
  assert.ok(nodes.Organ_Liver.translation[0] < 0);
  assert.ok(nodes.Organ_Stomach.translation[0] > 0);
  assert.ok(nodes.Organ_Kidney_L.translation[0] > 0);
  assert.ok(nodes.Organ_Kidney_R.translation[0] < 0);
  const kidneyHeightDifference = nodes.Organ_Kidney_L.translation[1] - nodes.Organ_Kidney_R.translation[1];
  assert.ok(kidneyHeightDifference >= 0.015 && kidneyHeightDifference <= 0.045);
  const averageLungDepth = (nodes.Organ_Lung_L.translation[2] + nodes.Organ_Lung_R.translation[2]) / 2;
  assert.ok(nodes.Organ_Heart.translation[2] - averageLungDepth >= 0.03);
  assert.ok(nodes.Organ_Liver.translation[2] - nodes.Organ_Kidney_R.translation[2] >= 0.05);
  assert.ok(nodes.Organ_Stomach.translation[2] - nodes.Organ_Kidney_L.translation[2] >= 0.04);
  assert.ok(nodes.Organ_Intestines.translation[1] < nodes.Organ_Stomach.translation[1]);
  assert.ok(nodes.Organ_Intestines.translation[1] < nodes.Organ_Liver.translation[1]);

  const localBounds = (name) => {
    const node = nodes[name];
    const accessorIndex = document.meshes[node.mesh].primitives[0].attributes.POSITION;
    const accessor = document.accessors[accessorIndex];
    return accessor.max.map((value, axis) => value - accessor.min[axis]);
  };
  const leftLungSize = localBounds("Organ_Lung_L");
  const rightLungSize = localBounds("Organ_Lung_R");
  assert.ok(rightLungSize.reduce((value, part) => value * part, 1)
    > leftLungSize.reduce((value, part) => value * part, 1));
  const liverAccessor = document.accessors[
    document.meshes[nodes.Organ_Liver.mesh].primitives[0].attributes.POSITION
  ];
  assert.ok(nodes.Organ_Liver.translation[0] + liverAccessor.max[0] > 0);
});
