import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const [patientHtml, emrHtml, adapterSource, buildSource, packageJson] = await Promise.all([
  readFile(new URL("../src/index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/emr.html", import.meta.url), "utf8"),
  readFile(new URL("../src/body-3d.js", import.meta.url), "utf8"),
  readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
]);
const {
  CLINICAL_BODY_PALETTE,
  CLINICAL_ORGAN_NODES,
  classifyClinicalPartName,
  collectClinicalMaterialRoles,
} = await import(new URL("../src/body-3d.js", import.meta.url));

test("환자 지도와 EMR은 같은 자체 호스팅 3D 전신 뷰어를 사용한다", () => {
  for (const [html, context] of [[patientHtml, "patient"], [emrHtml, "emr"]]) {
    assert.match(html, /data-body-3d/);
    assert.match(html, /data-body-model="\/assets\/body-atlas-3d-v3\.glb"/);
    assert.match(html, /data-body-viewer-module="\/vendor\/model-viewer-4\.3\.1\.min\.js"/);
    assert.match(html, new RegExp(`data-body-context="${context}"`));
    assert.match(html, /src="\/assets\/body-atlas-v4\.webp"/);
    assert.match(html, /<script type="module" src="\/body-3d\.js"><\/script>/);
  }
  assert.equal(packageJson.dependencies["@google/model-viewer"], "4.3.1");
  assert.match(buildSource, /type: "model\/gltf-binary"/);
  assert.match(buildSource, /max-age=31536000, immutable/);
  assert.match(buildSource, /script-src 'self' 'wasm-unsafe-eval'/);
});

test("3D 어댑터는 12개 영역, 2D 복구, 정면 복귀와 접근 가능한 조작을 보존한다", () => {
  const mappedAreas = [...adapterSource.matchAll(/^  ([a-z]+): Object\.freeze\(/gm)].map((match) => match[1]);
  assert.deepEqual(mappedAreas, [
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
  assert.match(adapterSource, /"신체 지도 보기 방식"/);
  assert.match(adapterSource, /"2D 신체 지도 보기"/);
  assert.match(adapterSource, /"회전 가능한 3D 신체 지도 보기"/);
  assert.match(adapterSource, /"3D 신체 지도를 정면으로 되돌리기"/);
  assert.match(adapterSource, /set2D\(\{ announce: false, reason \}\)/);
  assert.match(adapterSource, /prefers-reduced-motion: reduce/);
  assert.match(adapterSource, /navigator\?\.connection\?\.saveData/);
  assert.match(adapterSource, /touch-action: pan-y/);
  assert.match(adapterSource, /data-visibility-attribute/);
  assert.match(adapterSource, /CLINICAL_BODY_PALETTE/);
  assert.match(adapterSource, /"내부 장기 숨기기"/);
  assert.match(adapterSource, /"내부 장기 표시하기"/);
  assert.match(adapterSource, /body-3d:organschange/);
  assert.match(adapterSource, /alpha < 1 \? "BLEND"/);
  assert.match(adapterSource, /discard \? "MASK"/);
  assert.match(adapterSource, /setAlphaCutoff\(discard \? 1/);
  assert.match(adapterSource, /bodyOpacity.*0\.26/s);
  assert.match(adapterSource, /setMaterialAppearance\(state, bodyColor, bodyOpacity, 0\.72\)/);
  assert.match(adapterSource, /this\.organsVisible \? 1 : 0,\s+0\.62/);
  assert.match(adapterSource, /"shadow-softness"/);
  assert.match(adapterSource, /"tone-mapping"/);
  assert.match(adapterSource, /"disable-tap"/);
  assert.match(adapterSource, /linear-gradient\(180deg, #f6f8f7/);
  assert.doesNotMatch(adapterSource, /auto-rotate|https:\/\/modelviewer|sketchfab\.com\/models/);
});

test("v3 임상 노드 매핑은 외피와 9개 내부 장기 재질을 분리한다", () => {
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

test("배포하는 GLB는 유효한 바이너리 glTF이며 웹용 크기를 유지한다", async () => {
  const modelUrl = new URL("../src/assets/body-atlas-3d-v3.glb", import.meta.url);
  const [buffer, metadata] = await Promise.all([readFile(modelUrl), stat(modelUrl)]);
  assert.equal(buffer.subarray(0, 4).toString("ascii"), "glTF");
  assert.equal(buffer.readUInt32LE(4), 2);
  assert.equal(buffer.readUInt32LE(8), buffer.length);
  assert.ok(metadata.size < 2 * 1024 * 1024, `GLB가 2MB를 넘습니다: ${metadata.size}`);

  const jsonLength = buffer.readUInt32LE(12);
  assert.equal(buffer.readUInt32LE(16), 0x4e4f534a);
  const document = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString("utf8").trim());
  assert.equal(document.asset?.version, "2.0");
  assert.match(document.asset?.generator || "", /procedural clinical anatomy atlas 3\.0/i);
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
