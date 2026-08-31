import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { assertFrontierDailyBudget } from "../lib/api.js";

test("frontier daily budget rejects with 429 once the ceiling is spent", async () => {
  const environment = { FRONTIER_DAILY_LIMIT: "2" };
  await assertFrontierDailyBudget(environment);
  await assertFrontierDailyBudget(environment);
  await assert.rejects(
    () => assertFrontierDailyBudget(environment),
    (error) => error.status === 429 && error.code === "FRONTIER_DAILY_LIMITED",
  );
});

test("an invalid limit falls back to the default instead of blocking traffic", async () => {
  const environment = { FRONTIER_DAILY_LIMIT: "0" };
  await assert.doesNotReject(() => assertFrontierDailyBudget(environment));
});

test("every frontier route checks the per-address window and the shared daily budget", async () => {
  const routes = [
    "app/api/medication-claim-review/route.js",
    "app/api/patient-question-assistant/route.js",
    "app/api/patient-question-assistant/refine/route.js",
  ];
  for (const route of routes) {
    const source = await readFile(new URL(`../${route}`, import.meta.url), "utf8");
    assert.match(source, /assertFrontierRequestAllowed\(request\);/, `${route} keeps the per-address window`);
    assert.match(source, /await assertFrontierDailyBudget\(\);/, `${route} awaits the shared daily budget`);
  }
});
