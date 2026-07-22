import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(new URL("../scripts/primary-action-smoke.mjs", import.meta.url), "utf8");

test("primary-action browser contract activates every originating route", () => {
  for (const route of ["/", "/patient", "/map", "/connections", "/insights", "/journey", "/emr"]) {
    assert.ok(script.includes(`from: ${JSON.stringify(route)}`) || script.includes(`navigate(${JSON.stringify(route)})`));
  }
  assert.match(script, /querySelector\(\$\{selector\}\)\.click\(\)/);
  assert.match(script, /location\.pathname/);
  assert.match(script, /location\.hash/);
  assert.match(script, /formError/);
  assert.match(script, /patientList/);
  assert.match(script, /checkInPatient/);
  assert.match(script, /__printInvoked/);
  assert.match(script, /activatedEmrAction/);
  assert.match(script, /expectedStatus/);
  assert.match(script, /Network\.setBlockedURLs/);
  assert.match(script, /Emulation\.setTimezoneOverride/);
  assert.match(script, /Emulation\.setLocaleOverride/);
  assert.match(script, /prefers-reduced-motion/);
  assert.match(script, /Date\.now=\(\)=>1735689600000;Math\.random=\(\)=>0\.5/);
});

test("건강 지도 입력은 선택 가능한 질환 뒤에 제출 동작을 제공한다", async () => {
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  assert.ok(html.indexOf('class="signal-fieldset"') < html.indexOf('id="analyzeButton"'));
});

test("빈 EMR은 하나의 명시적 샘플 워크스페이스 동작만 제공한다", async () => {
  const html = await readFile(new URL("../src/emr.html", import.meta.url), "utf8");
  assert.equal((html.match(/id="loadDemo"/g) ?? []).length, 1);
  assert.equal((html.match(/샘플 워크스페이스 열기/g) ?? []).length, 1);
});
