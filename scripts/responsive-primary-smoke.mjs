import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chrome = process.env.CHROME_BIN ?? "/usr/bin/google-chrome";
const appUrl = process.env.APP_URL ?? "http://127.0.0.1:4173";
const debugPort = Number.parseInt(process.env.CHROME_DEBUG_PORT ?? "9228", 10);
const routes = [
  { route: "/", selector: ".role-card--clinical .role-action", text: "의료진 EMR 열기" },
  { route: "/patient", selector: ".landing-actions .landing-button--primary", text: "환자용 기록 가져오기" },
  { route: "/map", selector: "#analyzeButton", text: "건강 지도 업데이트" },
  { route: "/connections", selector: "#connectionsPrimaryEntry", text: "관계 지도 바로 보기", beforeSelector: ".explorer-first-use" },
  { route: "/insights", selector: "#refreshClinicalSnapshot", text: "가져온 기록 다시 확인" },
  { route: "/journey", selector: "#journeyEmpty .journey-first-action--primary", text: "첫 지도 만들기", beforeSelector: ".journey-data-tools" },
  { route: "/emr", selector: "#loadDemo", text: "예시 환자 불러오기" },
];
const profile = await mkdtemp(join(tmpdir(), "policycompass-responsive-primary-"));
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const browser = spawn(chrome, [
  "--headless", "--no-sandbox", "--disable-gpu", "--disable-background-networking",
  "--disable-component-update", "--lang=ko-KR", `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`, "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }
  async call(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.socket.close(); }
}

function assert(value, message) { if (!value) throw new Error(message); }
async function waitForEndpoint() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok) return; } catch {}
    await delay(100);
  }
  throw new Error("Chrome DevTools endpoint did not start.");
}

let client;
try {
  await waitForEndpoint();
  const target = await (await fetch(
    `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent("about:blank")}`,
    { method: "PUT" },
  )).json();
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.call("Page.enable");
  await client.call("Runtime.enable");
  await client.call("Network.enable");
  await client.call("Network.setBlockedURLs", { urls: ["https://*/*"] });
  await client.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await client.call("Emulation.setTimezoneOverride", { timezoneId: "Asia/Seoul" });
  await client.call("Emulation.setLocaleOverride", { locale: "ko-KR" });
  await client.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await client.call("Page.addScriptToEvaluateOnNewDocument", { source: `{
    Date.now = () => 1735689600000;
    Math.random = () => 0.5;
    localStorage.clear();
    sessionStorage.clear();
  }` });

  const failures = [];
  for (const expectation of routes) {
    await client.call("Page.navigate", { url: `${appUrl}${expectation.route}` });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const ready = await client.call("Runtime.evaluate", {
        expression: `document.readyState === 'complete' && Boolean(document.querySelector(${JSON.stringify(expectation.selector)}))`,
        returnByValue: true,
      }).catch(() => ({ result: { value: false } }));
      if (ready.result.value) break;
      await delay(50);
    }
    const result = await client.call("Runtime.evaluate", { expression: `(() => {
      const element = document.querySelector(${JSON.stringify(expectation.selector)});
      if (!element) return { missing: true };
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const center = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const secondary = ${JSON.stringify(expectation.beforeSelector ?? "")}
        ? document.querySelector(${JSON.stringify(expectation.beforeSelector ?? "")})
        : null;
      return {
        text: element.textContent.replace(/\\s+/g, ' ').trim(),
        top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
        width: rect.width, height: rect.height, display: style.display,
        visibility: style.visibility, opacity: Number(style.opacity),
        disabled: element.matches(':disabled, [aria-disabled="true"]'),
        closedDisclosure: Boolean(element.closest('details:not([open])')),
        unobstructed: center === element || element.contains(center),
        documentWidth: document.documentElement.scrollWidth,
        precedesSecondary: !secondary || Boolean(element.compareDocumentPosition(secondary) & Node.DOCUMENT_POSITION_FOLLOWING),
      };
    })()`, returnByValue: true });
    const action = result.result.value;
    await client.call("Runtime.evaluate", { expression: "document.activeElement?.blur()" });
    let keyboardFocus = { focused: false, focusVisible: false };
    for (let attempt = 0; attempt < 60; attempt += 1) {
      keyboardFocus = (await client.call("Runtime.evaluate", { expression: `(() => {
        const element = document.querySelector(${JSON.stringify(expectation.selector)});
        const style = element ? getComputedStyle(element) : null;
        return {
          focused: document.activeElement === element,
          focusVisible: Boolean(style) && ((style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) >= 3)
            || style.boxShadow !== 'none'),
        };
      })()`, returnByValue: true })).result.value;
      if (keyboardFocus.focused) break;
      await client.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      await client.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    }
    const checks = [
      [!action.missing, "primary action missing"],
      [action.text?.includes(expectation.text), `unexpected primary action “${action.text}”`],
      [action.display !== "none" && action.visibility !== "hidden" && action.opacity > 0, "primary action hidden"],
      [!action.disabled, "primary action disabled"],
      [!action.closedDisclosure, "primary action requires disclosure"],
      [action.height >= 44 && action.width >= 44, `primary target is smaller than 44px (${action.width}x${action.height})`],
      [action.top >= 0 && action.bottom <= 844, `primary action is outside 390x844 (${action.top}-${action.bottom})`],
      [action.left >= 0 && action.right <= 390, `primary action clips horizontally (${action.left}-${action.right})`],
      [action.documentWidth <= 390, `document horizontally overflows (${action.documentWidth})`],
      [action.unobstructed, "primary action center is obstructed"],
      [action.precedesSecondary, `primary action does not precede ${expectation.beforeSelector}`],
      [keyboardFocus.focused, "primary action cannot receive keyboard focus"],
      [keyboardFocus.focusVisible, "primary action has no visible focus indicator"],
    ];
    for (const [passed, message] of checks) if (!passed) failures.push(`${expectation.route}: ${message}`);
  }
  assert(failures.length === 0, failures.join("\n"));
  console.log(`responsive primary-action matrix passed: ${routes.length} routes at 390x844`);
} finally {
  client?.close();
  browser.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => browser.once("exit", resolve)), delay(2_000)]);
  if (browser.exitCode === null) browser.kill("SIGKILL");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await rm(profile, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 });
      break;
    } catch (error) {
      if (attempt === 2) throw error;
      await delay(100);
    }
  }
}
