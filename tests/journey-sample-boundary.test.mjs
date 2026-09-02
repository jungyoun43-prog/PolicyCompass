import assert from "node:assert/strict";
import test from "node:test";

import { createJourneyBackup, normalizeJourney } from "../src/journey-model.js";

/**
 * src/journey.js is a vanilla controller: it wires itself to the page at
 * import time through `document`, `window` and `localStorage`. These tests
 * give it a tiny in-memory document and a recording storage, import a fresh
 * module instance per scenario, and observe what the controls do — instead of
 * reading the controller's source text.
 */
const STORAGE_KEY = "policycompass-journey";
const ELEMENT_IDS = [
  "journeyTimeline", "journeyEmpty", "comparisonTitle", "comparisonCopy", "addedSignals", "steadySignals",
  "removedSignals", "measurementChanges", "journeyComparison", "journeyComparisonDetail", "journeyChanges",
  "journeyContexts", "journeyNextReviews", "journeyPriorComparison", "clearJourney", "exportJourney",
  "importJourneyTrigger", "journeyImport", "journeyTransferStatus", "journeyReviewAction", "reviewJourneyChanges",
];

function fakeElement(tagName = "div") {
  const listeners = new Map();
  const attributes = new Map();
  const element = {
    tagName: tagName.toUpperCase(),
    children: [],
    dataset: {},
    className: "",
    textContent: "",
    hidden: false,
    disabled: false,
    value: "",
    files: [],
    clicks: 0,
    addEventListener(type, handler) { listeners.set(type, [...(listeners.get(type) ?? []), handler]); },
    async dispatch(type) { for (const handler of listeners.get(type) ?? []) await handler(); },
    click() { element.clicks += 1; return element.dispatch("click"); },
    append(...nodes) { element.children.push(...nodes); },
    replaceChildren(...nodes) { element.children = nodes; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    remove() {},
    focus() {},
    scrollIntoView() {},
  };
  return element;
}

function descendants(element, found = []) {
  for (const child of element.children ?? []) {
    found.push(child);
    descendants(child, found);
  }
  return found;
}

function recordingStorage(entries = {}, { denyWrites = false } = {}) {
  const values = new Map(Object.entries(entries));
  const calls = { getItem: [], setItem: [], removeItem: [] };
  return {
    calls,
    value(key) { return values.get(key) ?? null; },
    getItem(key) { calls.getItem.push(key); return values.get(key) ?? null; },
    setItem(key, value) {
      calls.setItem.push([key, value]);
      if (denyWrites) throw new DOMException("blocked", "QuotaExceededError");
      values.set(key, value);
    },
    removeItem(key) {
      calls.removeItem.push(key);
      if (denyWrites) throw new DOMException("blocked", "SecurityError");
      values.delete(key);
    },
  };
}

let instance = 0;

/** Boots a fresh journey controller against a fake page and hands it to `run`. */
async function withJourneyPage({ search = "", storage = recordingStorage() }, run) {
  const byId = new Map(ELEMENT_IDS.map((id) => [id, fakeElement()]));
  const body = fakeElement("body");
  const confirms = [];
  const objectUrls = [];
  const document = {
    body,
    querySelector: (selector) => byId.get(selector.replace(/^#/, "")) ?? null,
    querySelectorAll: () => [],
    createElement: (tagName) => fakeElement(tagName),
    createTextNode: (text) => ({ textContent: text }),
  };
  const window = {
    location: { search, origin: "https://policycompass.test" },
    confirm(message) { confirms.push(message); return true; },
    matchMedia: () => ({ matches: true }),
    setTimeout: () => 0,
  };
  const saved = ["window", "document", "localStorage"].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  const savedCreateObjectUrl = URL.createObjectURL;
  const savedRevokeObjectUrl = URL.revokeObjectURL;
  for (const [name, value] of [["window", window], ["document", document], ["localStorage", storage]]) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  URL.createObjectURL = (blob) => { objectUrls.push(blob); return "blob:journey"; };
  URL.revokeObjectURL = () => {};
  try {
    instance += 1;
    await import(`../src/journey.js?instance=${instance}`);
    const el = Object.fromEntries(byId);
    await run({
      el,
      body,
      storage,
      confirms,
      objectUrls,
      status: () => ({ text: el.journeyTransferStatus.textContent, className: el.journeyTransferStatus.className }),
      cards: () => el.journeyTimeline.children.filter(({ className }) => className === "snapshot-card"),
      removeButtons: () => descendants(el.journeyTimeline).filter(({ className }) => className === "snapshot-remove"),
    });
  } finally {
    URL.createObjectURL = savedCreateObjectUrl;
    URL.revokeObjectURL = savedRevokeObjectUrl;
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

const savedJourney = normalizeJourney([
  { id: "snap-june", date: "2026-06-01", conditionIds: ["hypertension"], measurements: [] },
  { id: "snap-july", date: "2026-07-01", conditionIds: ["hypertension", "diabetes"], measurements: [] },
]);
const savedEntries = { [STORAGE_KEY]: JSON.stringify(savedJourney) };

function backupFile(journey) {
  const text = JSON.stringify(createJourneyBackup(journey));
  return { size: text.length, text: async () => text };
}

test("Journey sample query is detected before storage is read", async () => {
  await withJourneyPage({ search: "?sample=1", storage: recordingStorage(savedEntries) }, ({ el, storage, cards, status }) => {
    assert.deepEqual(storage.calls.getItem, [], "sample mode never reads the stored journey");
    assert.equal(cards().length, 0);
    assert.equal(el.journeyTimeline.hidden, true);
    assert.equal(el.journeyEmpty.hidden, false);
    assert.equal(status().text, "예시 모드 · 기존 Journey를 읽거나 변경하지 않습니다.");
    assert.equal(storage.value(STORAGE_KEY), savedEntries[STORAGE_KEY]);
  });

  await withJourneyPage({ search: "?sample=0", storage: recordingStorage(savedEntries) }, ({ el, storage, cards }) => {
    assert.deepEqual(storage.calls.getItem, [STORAGE_KEY]);
    assert.equal(cards().length, 2);
    assert.equal(el.journeyTimeline.hidden, false);
    assert.equal(el.journeyEmpty.hidden, true);
  });

  await withJourneyPage({ search: "", storage: recordingStorage(savedEntries) }, async ({ el, storage, cards, confirms }) => {
    assert.deepEqual(storage.calls.getItem, [STORAGE_KEY]);
    assert.equal(cards().length, 2);

    // Persisting an empty journey removes the key; a non-empty one writes it as JSON.
    await el.clearJourney.click();
    assert.equal(confirms.length, 1);
    assert.deepEqual(storage.calls.removeItem, [STORAGE_KEY]);
    assert.equal(storage.value(STORAGE_KEY), null);
    assert.equal(cards().length, 0);

    el.journeyImport.files = [backupFile(savedJourney.slice(0, 1))];
    await el.journeyImport.dispatch("change");
    assert.equal(storage.calls.setItem.length, 1);
    assert.equal(storage.calls.setItem[0][0], STORAGE_KEY);
    assert.deepEqual(JSON.parse(storage.value(STORAGE_KEY)).map(({ id }) => id), ["snap-june"]);
    assert.equal(cards().length, 1);
  });
});

test("Journey writes persist before in-memory delete, restore, or clear is committed", async () => {
  await withJourneyPage({ storage: recordingStorage(savedEntries, { denyWrites: true }) }, async ({ el, storage, cards, removeButtons, status }) => {
    assert.equal(cards().length, 2);

    await removeButtons()[0].click();
    assert.equal(storage.calls.setItem.length, 1, "delete attempted the write first");
    assert.equal(cards().length, 2, "the record stays because the write failed");
    assert.deepEqual(status(), { text: "브라우저 저장소를 사용할 수 없어 Journey 기록을 삭제하지 않았습니다.", className: "journey-transfer-status is-error" });

    el.journeyImport.files = [backupFile(savedJourney.slice(0, 1))];
    await el.journeyImport.dispatch("change");
    assert.equal(storage.calls.setItem.length, 2, "restore attempted the write first");
    assert.deepEqual(cards().length, 2, "the current journey stays because the write failed");
    assert.deepEqual(status(), { text: "브라우저 저장소를 사용할 수 없어 Journey 백업을 복원하지 않았습니다.", className: "journey-transfer-status is-error" });
    assert.equal(el.journeyImport.value, "");

    await el.clearJourney.click();
    assert.deepEqual(storage.calls.removeItem, [STORAGE_KEY], "clear attempted the removal first");
    assert.equal(cards().length, 2, "the journey stays because the removal failed");
    assert.equal(el.clearJourney.hidden, false);
    assert.deepEqual(status(), { text: "브라우저 저장소를 사용할 수 없어 Journey 기록을 지우지 않았습니다.", className: "journey-transfer-status is-error" });

    assert.equal(storage.value(STORAGE_KEY), savedEntries[STORAGE_KEY], "stored data is untouched");
  });

  await withJourneyPage({ storage: recordingStorage(savedEntries) }, async ({ el, storage, cards, removeButtons, status }) => {
    await removeButtons()[0].click();
    assert.deepEqual(JSON.parse(storage.value(STORAGE_KEY)).map(({ id }) => id), ["snap-july"]);
    assert.equal(cards().length, 1);
    assert.deepEqual(status(), { text: "2026-06-01 Journey 기록을 삭제했습니다.", className: "journey-transfer-status is-success" });

    el.journeyImport.files = [backupFile(savedJourney)];
    await el.journeyImport.dispatch("change");
    assert.deepEqual(JSON.parse(storage.value(STORAGE_KEY)).map(({ id }) => id), ["snap-june", "snap-july"]);
    assert.equal(cards().length, 2);
    assert.match(status().text, /기록 2개를 복원했습니다/);

    await el.clearJourney.click();
    assert.equal(storage.value(STORAGE_KEY), null);
    assert.equal(cards().length, 0);
    assert.equal(el.clearJourney.hidden, true);
    assert.deepEqual(status(), { text: "이 브라우저의 Journey 기록을 모두 지웠습니다.", className: "journey-transfer-status is-success" });
  });
});

test("Journey sample mode disables every backup and destructive data control", async () => {
  await withJourneyPage({ search: "?sample=1", storage: recordingStorage(savedEntries) }, async ({ el, body, storage, status, confirms, objectUrls }) => {
    assert.equal(el.importJourneyTrigger.disabled, true);
    assert.equal(el.journeyImport.disabled, true);
    assert.equal(el.exportJourney.disabled, true);
    assert.equal(el.clearJourney.hidden, true);
    assert.deepEqual(status(), { text: "예시 모드 · 기존 Journey를 읽거나 변경하지 않습니다.", className: "journey-transfer-status" });

    await el.exportJourney.click();
    assert.deepEqual(status(), { text: "예시 모드에서는 Journey 내보내기를 사용할 수 없습니다.", className: "journey-transfer-status is-error" });
    assert.equal(objectUrls.length, 0, "no backup blob is created");
    assert.equal(body.children.length, 0, "no download link is attached");

    await el.importJourneyTrigger.click();
    assert.deepEqual(status(), { text: "예시 모드에서는 Journey 백업을 복원할 수 없습니다.", className: "journey-transfer-status is-error" });
    assert.equal(el.journeyImport.clicks, 0, "the file picker is not opened");

    el.journeyImport.value = "backup.json";
    el.journeyImport.files = [backupFile(savedJourney)];
    await el.journeyImport.dispatch("change");
    assert.deepEqual(status(), { text: "예시 모드에서는 Journey 백업을 복원할 수 없습니다.", className: "journey-transfer-status is-error" });
    assert.equal(el.journeyImport.value, "", "the chosen file is discarded");

    await el.clearJourney.click();
    assert.deepEqual(status(), { text: "예시 모드에서는 저장된 Journey를 삭제하지 않습니다.", className: "journey-transfer-status is-error" });

    assert.deepEqual(confirms, [], "no destructive confirmation is ever asked");
    assert.deepEqual(storage.calls, { getItem: [], setItem: [], removeItem: [] }, "storage is neither read nor written");
    assert.equal(storage.value(STORAGE_KEY), savedEntries[STORAGE_KEY]);
  });
});
