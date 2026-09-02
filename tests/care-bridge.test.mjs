import assert from "node:assert/strict";
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

/** Temporarily replaces globals, returning a function that restores them. */
function installGlobals(overrides) {
  const saved = Object.entries(overrides).map(([name]) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  for (const [name, value] of Object.entries(overrides)) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  return () => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
}

test("retired bridge module has no read, write, event, or BroadcastChannel synchronization path", async () => {
  // Every synchronization primitive the old bridge used is stubbed to record
  // its use; a fresh module instance is imported so import-time side effects
  // are observed as well as what retirement itself does.
  const calls = [];
  const record = (name) => (...args) => { calls.push([name, ...args]); };
  const removed = [];
  const storage = {
    getItem: record("getItem"),
    setItem: record("setItem"),
    removeItem(key) { removed.push(key); },
  };
  const restore = installGlobals({
    BroadcastChannel: class { constructor(...args) { calls.push(["BroadcastChannel", ...args]); } },
    addEventListener: record("addEventListener"),
    dispatchEvent: record("dispatchEvent"),
    localStorage: storage,
    window: globalThis,
  });

  try {
    const bridge = await import("../src/care-bridge.js?isolation=no-sync-path");

    assert.deepEqual(
      Object.keys(bridge).sort(),
      ["CARE_BRIDGE_STORAGE_KEY", "PERSONAL_SYNC_SUSPENDED_KEY", "retireLegacyCareBridge"],
      "the module exposes only the retirement API, no publish/subscribe/read surface",
    );
    assert.equal(bridge.CARE_BRIDGE_STORAGE_KEY, CARE_BRIDGE_STORAGE_KEY);
    assert.equal(bridge.PERSONAL_SYNC_SUSPENDED_KEY, PERSONAL_SYNC_SUSPENDED_KEY);

    assert.equal(bridge.retireLegacyCareBridge(), true);
    assert.equal(bridge.retireLegacyCareBridge(storage), true);

    assert.deepEqual(calls, [], "no getItem, setItem, BroadcastChannel, dispatchEvent or addEventListener use");
    assert.deepEqual(removed, [
      CARE_BRIDGE_STORAGE_KEY, PERSONAL_SYNC_SUSPENDED_KEY,
      CARE_BRIDGE_STORAGE_KEY, PERSONAL_SYNC_SUSPENDED_KEY,
    ]);
  } finally {
    restore();
  }
});
