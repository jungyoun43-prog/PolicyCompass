import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function assert(value, message) {
  if (!value) throw new Error(message);
}

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

async function waitForEndpoint(debugPort) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok) return;
    } catch {
      // Chrome is still starting.
    }
    await delay(100);
  }
  throw new Error("Chrome DevTools endpoint did not start.");
}

async function stopBrowser(browser) {
  if (browser.exitCode !== null) return;
  browser.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => browser.once("exit", resolve)),
    delay(2_000),
  ]);
  if (browser.exitCode === null) {
    browser.kill("SIGKILL");
    await Promise.race([
      new Promise((resolve) => browser.once("exit", resolve)),
      delay(2_000),
    ]);
  }
}

async function removeProfile(profile) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return;
    } catch (error) {
      lastError = error;
      await delay(100 * (attempt + 1));
    }
  }
  throw lastError;
}

export async function writeSmokeReport(reportPath, payload) {
  await mkdir(dirname(reportPath), { recursive: true });
  const temporaryPath = `${reportPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(temporaryPath, reportPath);
}

export async function runBrowserSmoke({
  appUrl = "http://127.0.0.1:4173",
  debugPort,
  profilePrefix,
  initialViewport = { width: 1280, height: 800, mobile: false },
}, callback) {
  const chrome = process.env.CHROME_BIN ?? "/usr/bin/google-chrome";
  const profile = await mkdtemp(join(tmpdir(), profilePrefix));
  const browser = spawn(chrome, [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-background-networking",
    "--disable-component-update",
    "--lang=ko-KR",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });

  let client;
  let runError;
  try {
    await waitForEndpoint(debugPort);
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
    await client.call("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    await client.call("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
      const NativeDate = Date;
      const fixedTime = Date.parse('2026-07-22T03:00:00.000Z');
      window.Date = new Proxy(NativeDate, {
        apply: () => new NativeDate(fixedTime).toString(),
        construct: (target, args) => Reflect.construct(target, args.length ? args : [fixedTime]),
        get: (target, property, receiver) => property === 'now' ? () => fixedTime : Reflect.get(target, property, receiver),
      });
      Math.random = () => 0.5;
    })();` });

    async function evaluate(expression) {
      const response = await client.call("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (response.exceptionDetails) {
        throw new Error(response.exceptionDetails.exception?.description
          ?? response.exceptionDetails.text
          ?? "Browser evaluation failed.");
      }
      return response.result.value;
    }

    async function waitFor(expression, message, attempts = 200) {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          if (await evaluate(expression)) return;
        } catch {
          // Navigation can replace the execution context between polls.
        }
        await delay(75);
      }
      throw new Error(message);
    }

    async function navigate(path, readyExpression = "document.readyState === 'complete'") {
      const url = path.startsWith("http") ? path : `${appUrl}${path}`;
      await client.call("Page.navigate", { url });
      await waitFor(
        `document.readyState === 'complete' && (${readyExpression})`,
        `${path} did not become ready.`,
      );
    }

    async function setViewport({ width, height, mobile = width <= 620 }) {
      await client.call("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        screenWidth: width,
        screenHeight: height,
        deviceScaleFactor: 1,
        mobile,
      });
      await evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    }

    async function press(key, code = key) {
      const keyCode = key === "Tab" ? 9 : key === "ArrowRight" ? 39 : key === "ArrowLeft" ? 37 : 0;
      await client.call("Input.dispatchKeyEvent", {
        type: "keyDown",
        key,
        code,
        windowsVirtualKeyCode: keyCode,
      });
      await client.call("Input.dispatchKeyEvent", {
        type: "keyUp",
        key,
        code,
        windowsVirtualKeyCode: keyCode,
      });
    }

    async function tabTo(selector, attempts = 80) {
      await evaluate("document.activeElement?.blur()");
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (await evaluate(`document.activeElement === document.querySelector(${JSON.stringify(selector)})`)) return true;
        await press("Tab", "Tab");
      }
      return false;
    }

    await setViewport(initialViewport);
    return await callback({
      appUrl,
      client,
      delay,
      evaluate,
      navigate,
      press,
      setViewport,
      tabTo,
      waitFor,
    });
  } catch (error) {
    runError = error;
    throw error;
  } finally {
    client?.close();
    await stopBrowser(browser);
    try {
      await removeProfile(profile);
    } catch (cleanupError) {
      if (!runError) throw cleanupError;
      console.error(`Failed to clean Chrome profile ${profile}: ${cleanupError.message}`);
    }
  }
}
