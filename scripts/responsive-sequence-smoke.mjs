import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chrome = process.env.CHROME_BIN ?? "/usr/bin/google-chrome";
const appUrl = process.env.APP_URL ?? "http://127.0.0.1:4173";
const debugPort = Number.parseInt(process.env.CHROME_DEBUG_PORT ?? "9229", 10);
const viewports = [
  { width: 390, height: 844, mobile: true },
  { width: 768, height: 1024, mobile: false },
  { width: 1280, height: 800, mobile: false },
  { width: 1600, height: 900, mobile: false },
];
const routes = [
  { route: "/", selectors: [".gateway-intro", ".role-card--clinical", ".role-card--patient", ".handoff-panel", ".gateway-boundary"] },
  { route: "/patient", selectors: [".landing-hero", ".fact-strip", ".outcome", ".workflow", ".data-boundary", ".beta", ".closing"] },
  { route: "/map", selectors: [".map-hero", ".input-panel", ".body-panel", ".connection-portal", ".detail-panel", ".safety-banner"] },
  { route: "/connections", selectors: [".explorer-intro", ".scene-shell", ".explorer-detail"] },
  { route: "/insights", selectors: [".insight-hero", ".insight-status", ".question-panel", ".brief-rail"] },
  { route: "/journey", selectors: [".journey-intro", ".journey-workspace", ".journey-comparison"] },
  { route: "/emr", selectors: [".clinical-command", ".trust-strip", ".patient-rail", ".patient-workspace"] },
];
const profile = await mkdtemp(join(tmpdir(), "vitagraph-responsive-sequence-"));
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
  await client.call("Emulation.setTimezoneOverride", { timezoneId: "Asia/Seoul" });
  await client.call("Emulation.setLocaleOverride", { locale: "ko-KR" });
  await client.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await client.call("Page.addScriptToEvaluateOnNewDocument", { source: `{
    Date.now = () => 1735689600000;
    Math.random = () => 0.5;
    localStorage.clear();
    sessionStorage.clear();
  }` });

  const baseline = new Map();
  for (const viewport of viewports) {
    await client.call("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1 });
    for (const expectation of routes) {
      await client.call("Page.navigate", { url: `${appUrl}${expectation.route}` });
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const ready = await client.call("Runtime.evaluate", {
          expression: "document.readyState === 'complete'",
          returnByValue: true,
        }).catch(() => ({ result: { value: false } }));
        if (ready.result.value) break;
        await delay(50);
      }
      await client.call("Runtime.evaluate", {
        expression: "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
        awaitPromise: true,
      });
      const result = await client.call("Runtime.evaluate", { expression: `(() => {
        const selectors = ${JSON.stringify(expectation.selectors)};
        const elements = selectors.map((selector) => document.querySelector(selector));
        const visible = (element) => {
          if (!element || element.getClientRects().length === 0 || element.closest('details:not([open])')) return false;
          const style = getComputedStyle(element);
          return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0
            && !style.clipPath.includes('inset(50%)');
        };
        const bounds = elements.filter(visible).map((element) => {
          const rect = element.getBoundingClientRect();
          return { label: element.id || element.className, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
        });
        const focusables = [...document.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')]
          .filter(visible)
          .filter((element) => !element.matches(':disabled, [aria-disabled="true"]'));
        const clippedControls = focusables.flatMap((element) => {
          const rect = element.getBoundingClientRect();
          let ancestor = element.parentElement;
          let scrollable = false;
          while (ancestor && ancestor !== document.body) {
            const style = getComputedStyle(ancestor);
            if (ancestor.scrollWidth > ancestor.clientWidth + 1 && ['auto', 'scroll'].includes(style.overflowX)) {
              scrollable = true;
              break;
            }
            ancestor = ancestor.parentElement;
          }
          return !scrollable && (rect.left < -1 || rect.right > innerWidth + 1)
            ? [{ label: element.id || element.textContent.trim().slice(0, 32), left: rect.left, right: rect.right }]
            : [];
        });
        const overlaps = [];
        for (let index = 0; index < bounds.length; index += 1) {
          for (let next = index + 1; next < bounds.length; next += 1) {
            const left = Math.max(bounds[index].left, bounds[next].left);
            const right = Math.min(bounds[index].right, bounds[next].right);
            const top = Math.max(bounds[index].top, bounds[next].top);
            const bottom = Math.min(bounds[index].bottom, bounds[next].bottom);
            if (right - left > 2 && bottom - top > 2) overlaps.push([bounds[index].label, bounds[next].label]);
          }
        }
        return {
          missing: selectors.filter((_, index) => !elements[index]),
          sequence: elements.filter(Boolean).map((element) => element.matches('[aria-labelledby]')
            ? element.getAttribute('aria-labelledby')
            : element.className),
          ordered: elements.every((element, index) => index === 0 ||
            Boolean(elements[index - 1].compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)),
          neutralCssOrder: elements.filter(Boolean).every((element) => getComputedStyle(element).order === '0'),
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: innerWidth,
          invalidBounds: bounds.filter((rect) => rect.width <= 0 || rect.height <= 0 || rect.left < -1 || rect.right > innerWidth + 1),
          clippedControls,
          overlaps,
        };
      })()`, returnByValue: true });
      const observation = result.result.value;
      assert(observation.missing.length === 0, `${expectation.route} at ${viewport.width}: missing ${observation.missing.join(", ")}`);
      assert(observation.ordered, `${expectation.route} at ${viewport.width}: semantic landmarks are out of document order`);
      assert(observation.neutralCssOrder, `${expectation.route} at ${viewport.width}: CSS order overrides semantic sequence`);
      assert(observation.documentWidth <= viewport.width, `${expectation.route} at ${viewport.width}: document width ${observation.documentWidth}`);
      assert(observation.invalidBounds.length === 0, `${expectation.route} at ${viewport.width}: invalid major bounds ${JSON.stringify(observation.invalidBounds)}`);
      assert(observation.clippedControls.length === 0, `${expectation.route} at ${viewport.width}: clipped controls ${JSON.stringify(observation.clippedControls)}`);
      assert(observation.overlaps.length === 0, `${expectation.route} at ${viewport.width}: overlapping major regions ${JSON.stringify(observation.overlaps)}`);
      if (viewport.width === 390) baseline.set(expectation.route, observation.sequence);
      else assert(JSON.stringify(observation.sequence) === JSON.stringify(baseline.get(expectation.route)),
        `${expectation.route}: semantic sequence changed between 390x844 and ${viewport.width}x${viewport.height}`);
    }
  }
  console.log(`responsive layout matrix passed: ${routes.length} routes across ${viewports.length} viewports`);
} finally {
  client?.close();
  browser.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => browser.once("exit", resolve)), delay(2_000)]);
  if (browser.exitCode === null) browser.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 });
}
