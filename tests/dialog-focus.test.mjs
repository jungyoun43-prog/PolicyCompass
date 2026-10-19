import assert from "node:assert/strict";
import test from "node:test";

import { restoreDialogFocus } from "../components/emr/dialog-kit.jsx";

// Native DOM signals consumed by the close-autofocus handler. Real Radix
// lifecycle/keyboard integration is covered by the coordinator's browser run.
function launcher(overrides = {}) {
  let focusCount = 0;
  const target = {
    isConnected: true,
    matches: () => false,
    closest: () => null,
    getClientRects: () => [{}],
    ownerDocument: { defaultView: { getComputedStyle: () => ({ visibility: "visible" }) } },
    focus: () => { focusCount++; },
    ...overrides,
  };
  return { target, focusCount: () => focusCount };
}
const closeEvent = () => ({ defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });

test("닫기 autofocus는 보이는 launcher로 복귀하고 Radix의 없는 Trigger 복귀를 대체한다", () => {
  const button = launcher();
  const event = closeEvent();
  restoreDialogFocus(event, { current: button.target });
  assert.equal(button.focusCount(), 1);
  assert.equal(event.defaultPrevented, true);
});

test("중첩 창과 주 처방 창은 각자 지정한 opener에만 복귀한다", () => {
  const main = launcher();
  const inner = launcher();
  restoreDialogFocus(closeEvent(), { current: inner.target });
  assert.equal(inner.focusCount(), 1);
  assert.equal(main.focusCount(), 0);
  restoreDialogFocus(closeEvent(), { current: main.target });
  assert.equal(inner.focusCount(), 1);
  assert.equal(main.focusCount(), 1);
});

for (const [name, overrides] of [
  ["unmounted launcher", { isConnected: false }],
  ["disabled launcher", { matches: () => true }],
  ["hidden/inert ancestor", { closest: () => ({}) }],
  ["display:none or closed disclosure", { getClientRects: () => [] }],
  ["visibility:hidden", { ownerDocument: { defaultView: { getComputedStyle: () => ({ visibility: "hidden" }) } } }],
  ["visibility:collapse", { ownerDocument: { defaultView: { getComputedStyle: () => ({ visibility: "collapse" }) } } }],
]) {
  test(`닫기 복귀는 ${name} 안으로 초점을 보내지 않는다`, () => {
    const button = launcher(overrides);
    const event = closeEvent();
    restoreDialogFocus(event, { current: button.target });
    assert.equal(button.focusCount(), 0);
    assert.equal(event.defaultPrevented, false);
  });
}

test("embedded/standalone 화면은 외부 launcher 복귀를 강제하지 않는다", () => {
  const button = launcher();
  const event = closeEvent();
  restoreDialogFocus(event, { current: button.target }, true);
  assert.equal(button.focusCount(), 0);
  assert.equal(event.defaultPrevented, false);
});

test("타깃이 없거나 기존 handler가 막은 autofocus는 그대로 둔다", () => {
  const event = closeEvent();
  restoreDialogFocus(event);
  restoreDialogFocus(event, { current: null });
  assert.equal(event.defaultPrevented, false);
  const button = launcher();
  event.preventDefault();
  restoreDialogFocus(event, { current: button.target });
  assert.equal(button.focusCount(), 0);
});
