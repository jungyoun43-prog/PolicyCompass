import { readFile, writeFile } from "node:fs/promises";

const sourceUrl = new URL("../src/assets/body-atlas-3d-v3.glb", import.meta.url);
const outputUrl = new URL("../src/assets/body-atlas-3d-v4.glb", import.meta.url);

const ORGAN_TUNING = Object.freeze({
  Organ_Brain: Object.freeze({ scale: [0.86, 0.9, 0.86], translation: [0, 1.69, 0.006] }),
  Organ_Lung_L: Object.freeze({ scale: [0.84, 0.9, 0.82], translation: [0.045, 1.34, 0] }),
  Organ_Lung_R: Object.freeze({ scale: [0.84, 0.9, 0.82], translation: [-0.055, 1.34, 0.007] }),
  Organ_Heart: Object.freeze({ scale: [0.88, 0.9, 0.86], translation: [0.025, 1.27, 0.045] }),
  Organ_Liver: Object.freeze({ scale: [0.74, 0.86, 0.76], translation: [-0.01, 1.105, 0.038] }),
  Organ_Stomach: Object.freeze({ scale: [0.82, 0.88, 0.8], translation: [0.055, 1.09, 0] }),
  Organ_Kidney_L: Object.freeze({ scale: [0.88, 0.9, 0.84], translation: [0.056, 1.08, -0.042] }),
  Organ_Kidney_R: Object.freeze({ scale: [0.88, 0.9, 0.84], translation: [-0.07, 1.045, -0.055] }),
  Organ_Intestines: Object.freeze({ scale: [0.72, 0.78, 0.72], translation: [0, 0.95, -0.02] }),
});

function assertGlb(buffer) {
  if (buffer.subarray(0, 4).toString("ascii") !== "glTF") {
    throw new Error("입력 파일이 GLB가 아닙니다.");
  }
  if (buffer.readUInt32LE(4) !== 2 || buffer.readUInt32LE(8) !== buffer.length) {
    throw new Error("지원하지 않거나 손상된 GLB입니다.");
  }
  if (buffer.readUInt32LE(16) !== 0x4e4f534a) {
    throw new Error("첫 GLB 청크가 JSON이 아닙니다.");
  }
}

const source = await readFile(sourceUrl);
assertGlb(source);

const sourceJsonLength = source.readUInt32LE(12);
const document = JSON.parse(source.subarray(20, 20 + sourceJsonLength).toString("utf8").trim());

for (const node of document.nodes ?? []) {
  const tuning = ORGAN_TUNING[node.name];
  if (!tuning) continue;
  node.scale = [...tuning.scale];
  node.translation = [...tuning.translation];
}

document.asset = {
  ...document.asset,
  generator: "PolicyCompass clinical anatomy atlas 4.0 (contained-organ presentation)",
  extras: {
    ...document.asset?.extras,
    sourceModel: "body-atlas-3d-v3.glb",
    presentationTuning: "Organ meshes scaled and translated inside the closed clinical body shell.",
  },
};

const json = Buffer.from(JSON.stringify(document), "utf8");
const paddedJsonLength = Math.ceil(json.length / 4) * 4;
const paddedJson = Buffer.alloc(paddedJsonLength, 0x20);
json.copy(paddedJson);

const binaryChunks = source.subarray(20 + sourceJsonLength);
const header = Buffer.alloc(12);
header.write("glTF", 0, 4, "ascii");
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + paddedJson.length + binaryChunks.length, 8);

const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(paddedJson.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4);

await writeFile(outputUrl, Buffer.concat([header, jsonHeader, paddedJson, binaryChunks]));
process.stdout.write(`Wrote ${outputUrl.pathname}\n`);
