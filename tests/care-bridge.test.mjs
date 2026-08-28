import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CARE_BRIDGE_STORAGE_KEY,
  PERSONAL_SYNC_SUSPENDED_KEY,
  retireLegacyCareBridge,
} from "../src/care-bridge.js";

function memoryStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    removeItem(key) {
      values.delete(key);
    },
    value(key) {
      return values.get(key) ?? null;
    },
  };
}

test("legacy automatic care bridge state is removed without touching unrelated storage", () => {
  const storage = memoryStorage({
    [CARE_BRIDGE_STORAGE_KEY]: "sensitive-old-snapshot",
    [PERSONAL_SYNC_SUSPENDED_KEY]: "1",
    "policycompass-scene": "personal-state",
    "policycompass-emr-v1": "clinical-state",
  });

  assert.equal(retireLegacyCareBridge(storage), true);
  assert.equal(storage.value(CARE_BRIDGE_STORAGE_KEY), null);
  assert.equal(storage.value(PERSONAL_SYNC_SUSPENDED_KEY), null);
  assert.equal(storage.value("policycompass-scene"), "personal-state");
  assert.equal(storage.value("policycompass-emr-v1"), "clinical-state");
});

test("legacy bridge retirement degrades normally when localStorage getter throws SecurityError", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new DOMException("blocked", "SecurityError");
    },
  });
  try {
    assert.doesNotThrow(() => retireLegacyCareBridge());
    assert.equal(retireLegacyCareBridge(), false);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  }
});

test("legacy bridge retirement is fail-safe when removeItem is denied", () => {
  const storage = {
    removeItem() {
      throw new DOMException("blocked", "SecurityError");
    },
  };
  assert.equal(retireLegacyCareBridge(storage), false);
});

test("retired bridge module has no read, write, event, or BroadcastChannel synchronization path", async () => {
  const source = await readFile(new URL("../src/care-bridge.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /getItem\s*\(/);
  assert.doesNotMatch(source, /setItem\s*\(/);
  assert.doesNotMatch(source, /BroadcastChannel|dispatchEvent|addEventListener/);
  assert.doesNotMatch(source, /publishClinicalSnapshot|publishPatientBrief|subscribeCareBridge|readCareBridge/);
});
