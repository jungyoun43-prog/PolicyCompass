import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/journey.js", import.meta.url), "utf8");

test("Journey sample query is detected before storage is read", () => {
  assert.match(source, /const sampleMode = new URLSearchParams\(window\.location\.search\)\.get\("sample"\) === "1"/);
  assert.match(source, /function readJourney\(\) \{\s*if \(sampleMode\) return \[\];\s*try \{ return normalizeJourney\(JSON\.parse\(localStorage\.getItem/s);
  assert.match(source, /function persistJourney\(nextJourney\) \{\s*if \(sampleMode\) return false;\s*try \{[\s\S]*?localStorage\.removeItem[\s\S]*?localStorage\.setItem[\s\S]*?return true;\s*\} catch \{\s*return false;/);
});

test("Journey writes persist before in-memory delete, restore, or clear is committed", () => {
  assert.match(source, /const nextJourney = journey\.filter[\s\S]*?if \(!persistJourney\(nextJourney\)\)[\s\S]*?journey = nextJourney/);
  assert.match(source, /if \(!persistJourney\(imported\)\) throw new Error[\s\S]*?journey = imported/);
  assert.match(source, /if \(!persistJourney\(\[\]\)\)[\s\S]*?return;[\s\S]*?journey = \[\]/);
});

test("Journey sample mode disables every backup and destructive data control", () => {
  assert.match(source, /elements\.export\.addEventListener\("click", \(\) => \{\s*if \(sampleMode\)/s);
  assert.match(source, /elements\.importTrigger\.addEventListener\("click", \(\) => \{\s*if \(sampleMode\)/s);
  assert.match(source, /elements\.importInput\.addEventListener\("change", async \(\) => \{\s*if \(sampleMode\)/s);
  assert.match(source, /elements\.clear\.addEventListener\("click", \(\) => \{\s*if \(sampleMode\)/s);
  assert.match(source, /if \(sampleMode\) \{[\s\S]*?importTrigger\.disabled = true;[\s\S]*?importInput\.disabled = true;[\s\S]*?export\.disabled = true;[\s\S]*?clear\.hidden = true;/);
  assert.match(source, /예시 모드 · 기존 Journey를 읽거나 변경하지 않습니다/);
});
