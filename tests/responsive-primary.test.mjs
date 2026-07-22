import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(new URL("../scripts/responsive-primary-smoke.mjs", import.meta.url), "utf8");

test("390px primary-action matrix covers every parent route", () => {
  for (const route of ["/", "/patient", "/map", "/connections", "/insights", "/journey", "/emr"]) {
    assert.match(script, new RegExp(`route: ${JSON.stringify(route).replaceAll("/", "\\/")}`));
  }
  assert.match(script, /action\.bottom <= 844/);
  assert.match(script, /action\.documentWidth <= 390/);
  assert.match(script, /action\.height >= 44 && action\.width >= 44/);
  assert.match(script, /action\.unobstructed/);
  assert.match(script, /keyboardFocus\.focused/);
  assert.match(script, /keyboardFocus\.focusVisible/);
  assert.match(script, /closedDisclosure/);
  assert.match(script, /disabled/);
});
