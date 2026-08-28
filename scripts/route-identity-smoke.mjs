import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chrome = process.env.CHROME_BIN ?? "/usr/bin/google-chrome";
const appUrl = process.env.APP_URL ?? "http://127.0.0.1:4173";
const debugPort = Number.parseInt(process.env.CHROME_DEBUG_PORT ?? "9226", 10);
const viewport = { width: 390, height: 844, deviceScaleFactor: 1, mobile: true };
const identities = [
  { route: "/", selector: "#gatewayTitle", text: "사용할 공간을 선택하세요." },
  { route: "/patient", selector: "#landingTitle", text: "내 건강 기록을 내가 이어 보는 공간." },
  { route: "/map", selector: "#pageTitle", text: "내 몸의 신호를 연결해서 보기" },
  { route: "/connections", selector: "#explorerTitle", text: "기록과 추론을 나눠 보기" },
  { route: "/insights", selector: "#insightTitle", text: "진료실에서 바로 꺼내 보는 질문 브리프" },
  { route: "/journey", selector: "#journeyPageTitle", text: "한 장면이 아니라 변화를 봅니다." },
  { route: "/emr", selector: "#emrTitle", text: "오늘 진료" },
];

const profile = await mkdtemp(join(tmpdir(), "policycompass-route-identity-"));
const browser = spawn(chrome, [
  "--headless",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-background-networking",
  "--lang=ko-KR",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  async call(method, params = {}) {
    await this.ready;
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function waitForEndpoint() {
  const endpoint = `http://127.0.0.1:${debugPort}/json/version`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(endpoint);
      if (response.ok) return;
    } catch {
      // Chrome is still starting.
    }
    await delay(100);
  }
  throw new Error("Chrome DevTools endpoint did not start.");
}

let client;
try {
  await waitForEndpoint();
  const targetResponse = await fetch(
    `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent("about:blank")}`,
    { method: "PUT" },
  );
  const target = await targetResponse.json();
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.call("Page.enable");
  await client.call("Runtime.enable");
  await client.call("Emulation.setDeviceMetricsOverride", viewport);
  await client.call("Emulation.setTimezoneOverride", { timezoneId: "Asia/Seoul" });
  await client.call("Emulation.setLocaleOverride", { locale: "ko-KR" });
  await client.call("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await client.call("Page.addScriptToEvaluateOnNewDocument", {
    source: `{
      const fixedNow = 1_735_689_600_000;
      Date.now = () => fixedNow;
      Math.random = () => 0.5;
      localStorage.clear();
      sessionStorage.clear();
    }`,
  });

  const passedRoutes = [];
  for (const expectation of identities) {
    await client.call("Page.navigate", { url: `${appUrl}${expectation.route}` });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const ready = await client.call("Runtime.evaluate", {
        expression: `document.readyState === "complete" && Boolean(document.querySelector(${JSON.stringify(expectation.selector)}))`,
        returnByValue: true,
      }).catch(() => ({ result: { value: false } }));
      if (ready.result.value) break;
      await delay(50);
    }

    const result = await client.call("Runtime.evaluate", {
      expression: `(() => {
        const element = document.querySelector(${JSON.stringify(expectation.selector)});
        if (!element) return { missing: true };
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const closedDisclosure = element.closest("details:not([open])");
        return {
          text: element.textContent.replace(/\\s+/g, " ").trim(),
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height,
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          closedDisclosure: Boolean(closedDisclosure),
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
        };
      })()`,
      returnByValue: true,
    });
    const identity = result.result.value;
    const label = expectation.route;
    assert(!identity.missing, `${label}: identity element is missing`);
    assert(identity.text === expectation.text, `${label}: expected identity “${expectation.text}”, got “${identity.text}”`);
    assert(identity.display !== "none" && identity.visibility !== "hidden" && identity.opacity !== "0", `${label}: identity is visually hidden`);
    assert(!identity.closedDisclosure, `${label}: identity requires opening a disclosure`);
    assert(identity.width > 0 && identity.height > 0, `${label}: identity has no rendered bounds`);
    assert(identity.top >= 0 && identity.bottom <= 844, `${label}: identity is outside the initial 390x844 viewport (${identity.top}-${identity.bottom})`);
    assert(identity.left >= 0 && identity.right <= 390, `${label}: identity overflows horizontally (${identity.left}-${identity.right})`);
    assert(identity.viewportWidth === 390 && identity.viewportHeight === 844, `${label}: unexpected viewport ${identity.viewportWidth}x${identity.viewportHeight}`);
    passedRoutes.push(expectation.route);
  }

  console.log(`route identity matrix passed at 390x844: ${passedRoutes.join(", ")}`);
} finally {
  client?.close();
  browser.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => browser.once("exit", resolve)), delay(2_000)]);
  if (browser.exitCode === null) browser.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
