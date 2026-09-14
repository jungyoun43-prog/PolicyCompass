import assert from "node:assert/strict";
import test from "node:test";
import { openPrescriptionWindow } from "../components/emr/prescription-window.js";

test("처방 창은 원래 창·토큰을 확인하고 중복 저장을 막으며 연결을 해제한다", async () => {
  const listeners = new Map();
  const messages = [];
  let url;
  let writes = 0;
  const child = { closed: false, focus() {}, postMessage(data, origin) { messages.push({ data, origin }); } };
  const previous = globalThis.window;
  globalThis.window = {
    location: { origin: "https://example.test" },
    open(value) { url = value; return child; },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
  };
  let bridge;
  try {
    bridge = openPrescriptionWindow({ patient: { id: "p1" } }, async () => { writes++; });
    assert.match(url, /^\/emr\/prescription#/);
    const token = url.split("#")[1];
    const receive = listeners.get("message");
    const event = { origin: "https://example.test", source: child, data: { type: "prescription-submit", token, requestId: "r1", prescription: { label: "test" } } };
    await receive({ ...event, origin: "https://other.test" });
    await receive({ ...event, source: {} });
    await receive({ ...event, data: { ...event.data, token: "wrong" } });
    assert.equal(writes, 0);
    await receive({ ...event, data: { token, type: "prescription-ping" } });
    assert.equal(messages.at(-1).data.type, "prescription-pong");
    await Promise.all([receive(event), receive(event)]);
    assert.equal(writes, 1);
    assert.equal(messages.filter(({ data }) => data.ok).length, 2);
    bridge.dispose();
    await receive({ ...event, data: { ...event.data, requestId: "r2" } });
    assert.equal(writes, 1);
    assert.equal(messages.at(-1).data.type, "prescription-disconnected");
    assert.equal(listeners.size, 0);
  } finally {
    bridge?.dispose();
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});
