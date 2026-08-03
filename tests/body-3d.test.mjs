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

test("환자 지도와 EMR은 같은 자체 호스팅 3D 전신 뷰어를 사용한다", () => {
  for (const [html, context] of [[patientHtml, "patient"], [emrHtml, "emr"]]) {
    assert.match(html, /data-body-3d/);
    assert.match(html, /data-body-model="\/assets\/body-atlas-3d-v2\.glb"/);
    assert.match(html, /data-body-viewer-module="\/vendor\/model-viewer-4\.3\.1\.min\.js"/);
    assert.match(html, new RegExp(`data-body-context="${context}"`));
    assert.match(html, /src="\/assets\/body-atlas-v4\.webp"/);
    assert.match(html, /<script type="module" src="\/body-3d\.js"><\/script>/);
  }
  assert.equal(packageJson.dependencies["@google/model-viewer"], "4.3.1");
  assert.match(buildSource, /type: "model\/gltf-binary"/);
  assert.match(buildSource, /max-age=31536000, immutable/);
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
  assert.match(adapterSource, /baseColorTexture\?\.texture/);
  assert.match(adapterSource, /setRoughnessFactor\(0\.58\)/);
  assert.match(adapterSource, /"shadow-softness"/);
  assert.match(adapterSource, /"tone-mapping"/);
  assert.match(adapterSource, /"disable-tap"/);
  assert.match(adapterSource, /linear-gradient\(180deg, #f6f8f7/);
  assert.doesNotMatch(adapterSource, /auto-rotate|https:\/\/modelviewer|sketchfab\.com\/models/);
});

test("배포하는 GLB는 유효한 바이너리 glTF이며 웹용 크기를 유지한다", async () => {
  const modelUrl = new URL("../src/assets/body-atlas-3d-v2.glb", import.meta.url);
  const [buffer, metadata] = await Promise.all([readFile(modelUrl), stat(modelUrl)]);
  assert.equal(buffer.subarray(0, 4).toString("ascii"), "glTF");
  assert.equal(buffer.readUInt32LE(4), 2);
  assert.equal(buffer.readUInt32LE(8), buffer.length);
  assert.ok(metadata.size < 2 * 1024 * 1024, `GLB가 2MB를 넘습니다: ${metadata.size}`);

  const jsonLength = buffer.readUInt32LE(12);
  assert.equal(buffer.readUInt32LE(16), 0x4e4f534a);
  const document = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString("utf8").trim());
  assert.equal(document.asset?.version, "2.0");
  assert.match(document.asset?.generator || "", /neutral clinical-body converter 2\.1/i);
  assert.equal(document.asset?.extras?.shapingTargetWeight, 0.4);
  assert.deepEqual(document.scenes?.[0]?.nodes, [0]);
  assert.equal(document.nodes?.length, 1);
  assert.equal(document.meshes?.length, 1);
  assert.equal(document.materials?.length, 1);
  assert.doesNotMatch(
    JSON.stringify([document.nodes, document.meshes, document.materials]),
    /short|garment|underwear|modesty|tights/i,
  );
  const positionAccessor = document.meshes[0].primitives[0].attributes.POSITION;
  assert.ok(document.accessors[positionAccessor].count >= 50_000);
  assert.ok(document.materials?.some(({ name = "" }) => /body|clinical/i.test(name)));
});
