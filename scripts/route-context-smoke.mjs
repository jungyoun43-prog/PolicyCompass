import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chrome = process.env.CHROME_BIN ?? "/usr/bin/google-chrome";
const appUrl = process.env.APP_URL ?? "http://127.0.0.1:4173";
const debugPort = Number.parseInt(process.env.CHROME_DEBUG_PORT ?? "9227", 10);
const routes = ["/", "/patient", "/map", "/connections", "/insights", "/journey", "/emr"];
const profile = await mkdtemp(join(tmpdir(), "policycompass-route-context-"));
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

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function waitForEndpoint() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok) return;
    } catch {}
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
  await client.call("Network.setBlockedURLs", { urls: ["https://*/*", `${appUrl}/assets/*`] });
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

  for (const route of routes) {
    await client.call("Page.navigate", { url: `${appUrl}${route}` });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const ready = await client.call("Runtime.evaluate", {
        expression: "document.readyState === 'complete' && Boolean(document.querySelector('[data-route-context]'))",
        returnByValue: true,
      }).catch(() => ({ result: { value: false } }));
      if (ready.result.value) break;
      await delay(50);
    }
    const result = await client.call("Runtime.evaluate", { expression: `(() => {
      const elements = [...document.querySelectorAll('[data-route-context]')];
      const element = elements[0];
      if (!element) return { missing: true };
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        count: elements.length, text: element.textContent.replace(/\\s+/g, ' ').trim(),
        top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
        width: rect.width, height: rect.height, display: style.display,
        visibility: style.visibility, opacity: style.opacity,
        closedDisclosure: Boolean(element.closest('details:not([open])')),
        documentWidth: document.documentElement.scrollWidth,
      };
    })()`, returnByValue: true });
    const context = result.result.value;
    assert(!context.missing, `${route}: route context missing`);
    assert(context.count === 1, `${route}: expected one route context, got ${context.count}`);
    assert(context.text.length > 0, `${route}: route context has no readable text`);
    assert(context.display !== "none" && context.visibility !== "hidden" && context.opacity !== "0", `${route}: route context hidden`);
    assert(!context.closedDisclosure, `${route}: route context requires disclosure`);
    assert(context.width > 0 && context.height > 0, `${route}: route context has no bounds`);
    assert(context.top >= 0 && context.bottom <= 844, `${route}: route context outside initial viewport (${context.top}-${context.bottom})`);
    assert(context.left >= 0 && context.right <= 390, `${route}: route context overflows (${context.left}-${context.right})`);
    assert(context.documentWidth <= 390, `${route}: document horizontally overflows (${context.documentWidth})`);
  }
  console.log(`route context matrix passed: ${routes.length} routes at 390x844`);
} finally {
  client?.close();
  browser.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => browser.once("exit", resolve)), delay(2_000)]);
  if (browser.exitCode === null) {
    browser.kill("SIGKILL");
    await new Promise((resolve) => browser.once("exit", resolve));
  }
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
