import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const scripts = [
  ["scripts/first-use-patient-smoke.mjs", "first-use-patient-report.json"],
  ["scripts/first-use-clinician-smoke.mjs", "first-use-clinician-report.json"],
  ["scripts/graph-discovery-smoke.mjs", "graph-discovery-report.json"],
];

test("첫 사용 브라우저 검증은 환자·의료진·그래프 과업과 원자적 보고서를 제공한다", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  for (const [file, report] of scripts) {
    const source = await readFile(file, "utf8");
    assert.match(source, new RegExp(report.replaceAll(".", "\\.")), file);
    assert.match(source, /writeSmokeReport\(/, file);
    assert.match(source, /390[\s\S]*844[\s\S]*768[\s\S]*1024[\s\S]*1280[\s\S]*800[\s\S]*1600[\s\S]*900/, file);
  }
  assert.equal(packageJson.scripts["smoke:first-use-patient"], "node scripts/first-use-patient-smoke.mjs");
  assert.equal(packageJson.scripts["smoke:first-use-clinician"], "node scripts/first-use-clinician-smoke.mjs");
  assert.equal(packageJson.scripts["smoke:graph-discovery"], "node scripts/graph-discovery-smoke.mjs");
});

test("사용성 대리 검증은 실제 사용자 연구의 남은 범위를 명시한다", async () => {
  const protocol = await readFile("USABILITY.md", "utf8");

  assert.match(protocol, /자동 검증은.*증명하지 않는다/s);
  assert.match(protocol, /개인 사용자 3명.*의료진.*3명/s);
  assert.match(protocol, /실제 환자정보를 사용하지 않고/);
  assert.match(protocol, /기록할 지표/);
});
