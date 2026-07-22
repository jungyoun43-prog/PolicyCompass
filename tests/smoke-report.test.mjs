import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runners = [
  ["scripts/emr-browser-smoke.mjs", "EMR_SMOKE_REPORT", "emr-smoke-report.json"],
  ["scripts/two-app-browser-smoke.mjs", "HANDOFF_SMOKE_REPORT", "handoff-smoke-report.json"],
];

for (const [path, environmentName, fileName] of runners) {
  test(`${path} leaves an atomic report outside the replaceable build directory`, async () => {
    const source = await readFile(path, "utf8");

    assert.match(source, new RegExp(`process\\.env\\.${environmentName}`));
    assert.ok(source.includes(`join("artifacts", "smoke", "${fileName}")`));
    assert.doesNotMatch(source, /join\("dist", "(?:emr|handoff)-smoke-report\.json"\)/);
    assert.match(source, /mkdir\(dirname\(reportPath\), \{ recursive: true \}\)/);
    assert.match(source, /rename\(temporaryReportPath, reportPath\)/);
  });
}
