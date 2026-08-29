import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const DEFAULT_CDP_TIMEOUT_MS = 8_000;
const DEFAULT_STEP_TIMEOUT_MS = 8_000;
const DEFAULT_ATTEMPT_TIMEOUT_MS = 120_000;
const MAX_LOG_BYTES = 32_000;
const activeBrowsers = new Set();

export const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function assert(value, message) {
  if (!value) throw new Error(message);
}

export class SmokeTimeoutError extends Error {
  constructor(message, timeoutMs) {
    super(message);
    this.name = "SmokeTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

function appendBoundedLog(current, chunk) {
  return `${current}${chunk}`.slice(-MAX_LOG_BYTES);
}

export async function withTimeout(promise, timeoutMs, label, onTimeout) {
  const boundedMs = positiveInteger(timeoutMs, DEFAULT_STEP_TIMEOUT_MS);
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new SmokeTimeoutError(`${label} timed out after ${boundedMs}ms.`, boundedMs);
          try {
            onTimeout?.(error);
          } finally {
            reject(error);
          }
        }, boundedMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function reserveTcpPort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => probe.close(resolve));
  assert(port > 0, "A dynamic local port could not be reserved.");
  return port;
}

function childExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForChildExit(child, timeoutMs) {
  if (childExited(child)) return true;
  return await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    delay(timeoutMs).then(() => false),
  ]);
}

export async function stopChildProcess(child, {
  termTimeoutMs = 2_000,
  killTimeoutMs = 2_000,
  processGroup = false,
} = {}) {
  if (!child || childExited(child)) return;

  const signal = (name) => {
    try {
      if (processGroup && process.platform !== "win32" && child.pid) {
        process.kill(-child.pid, name);
      } else {
        child.kill(name);
      }
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  };

  signal("SIGTERM");
  if (await waitForChildExit(child, termTimeoutMs)) return;
  signal("SIGKILL");
  await waitForChildExit(child, killTimeoutMs);
}

export function terminateActiveBrowsers(signal = "SIGKILL") {
  for (const browser of activeBrowsers) {
    try {
      browser.kill(signal);
    } catch {
      // A browser that has already exited is already bounded.
    }
  }
}

class CdpClient {
  constructor(url, { timeoutMs = DEFAULT_CDP_TIMEOUT_MS } = {}) {
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    this.timeoutMs = timeoutMs;
    this.events = [];
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new SmokeTimeoutError(
          `Chrome DevTools WebSocket did not open after ${this.timeoutMs}ms.`,
          this.timeoutMs,
        ));
        this.socket.close();
      }, this.timeoutMs);
      this.socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Chrome DevTools WebSocket failed to open."));
      }, { once: true });
    });
    this.socket.addEventListener("message", ({ data }) => {
      let message;
      try {
        message = JSON.parse(data);
      } catch {
        return;
      }
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      if (message.method === "Runtime.exceptionThrown") {
        const detail = message.params?.exceptionDetails;
        this.recordEvent({
          source: "browser-exception",
          message: detail?.exception?.description ?? detail?.text ?? "unknown",
        });
      } else if (message.method === "Log.entryAdded") {
        const entry = message.params?.entry;
        this.recordEvent({
          source: "browser-log",
          level: entry?.level,
          message: entry?.text ?? "unknown",
          url: entry?.url,
        });
      } else if (message.method === "Runtime.consoleAPICalled") {
        this.recordEvent({
          source: "browser-console",
          level: message.params?.type,
          message: (message.params?.args ?? [])
            .map((argument) => argument.value ?? argument.description ?? "")
            .join(" "),
        });
      } else if (message.method === "Network.loadingFailed") {
        this.recordEvent({
          source: "network",
          requestId: message.params?.requestId,
          message: message.params?.errorText,
        });
      }
    });
    this.socket.addEventListener("close", () => {
      this.closed = true;
      this.rejectPending(new Error("Chrome DevTools connection closed."));
    });
  }

  recordEvent(event) {
    this.events.push({ at: new Date().toISOString(), ...event });
    if (this.events.length > 200) this.events.shift();
  }

  rejectPending(error) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
  }

  async call(method, params = {}, timeoutMs = this.timeoutMs) {
    await this.ready;
    if (this.closed) throw new Error("Chrome DevTools connection is closed.");
    const id = this.nextId;
    this.nextId += 1;
    const boundedMs = positiveInteger(timeoutMs, this.timeoutMs);
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new SmokeTimeoutError(
          `Chrome DevTools command ${method} timed out after ${boundedMs}ms.`,
          boundedMs,
        ));
      }, boundedMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.rejectPending(new Error("Chrome DevTools connection closed."));
    try {
      this.socket.close();
    } catch {
      // Closing is best effort after the browser has exited.
    }
  }
}

async function waitForEndpoint(browser, debugPort, browserLog, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (childExited(browser)) {
      throw new Error(`Chrome exited before DevTools became ready.\n${browserLog()}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`, {
        signal: AbortSignal.timeout(Math.min(750, Math.max(100, deadline - Date.now()))),
      });
      if (response.ok) return;
      lastError = new Error(`Chrome DevTools health check returned ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new SmokeTimeoutError(
    `Chrome DevTools endpoint did not start after ${timeoutMs}ms: ${lastError?.message ?? "unknown"}\n${browserLog()}`,
    timeoutMs,
  );
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

export async function waitForAppHealth(appUrl, {
  path = "/patient",
  timeoutMs = 10_000,
  requestTimeoutMs = 1_000,
  child,
  childOutput = () => "",
} = {}) {
  const healthUrl = new URL(path, appUrl).href;
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (child && childExited(child)) {
      throw new Error(`Application server exited before becoming ready.\n${childOutput()}`);
    }
    try {
      const response = await fetch(healthUrl, {
        signal: AbortSignal.timeout(Math.min(requestTimeoutMs, Math.max(100, deadline - Date.now()))),
      });
      if (response.ok) return { appUrl, healthUrl, status: response.status };
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new SmokeTimeoutError(
    `Application health check failed after ${timeoutMs}ms for ${healthUrl}: ${lastError?.message ?? "unknown"}`
      + (child ? `\n${childOutput()}` : ""),
    timeoutMs,
  );
}

/**
 * Smoke runs target the production server, so a Next build must exist. Reuse
 * the current .next output when present; build once when it is missing.
 */
export async function ensureNextBuild() {
  const { access } = await import("node:fs/promises");
  try {
    await access(".next/BUILD_ID");
    return;
  } catch {
    // fall through to a fresh build
  }
  await new Promise((resolve, reject) => {
    const build = spawn("npx", ["next", "build"], { stdio: ["ignore", "inherit", "inherit"] });
    build.once("error", reject);
    build.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`next build exited with ${code}`))));
  });
}

export async function startManagedAppServer({
  appUrl = process.env.APP_URL?.trim() || "",
  healthPath = "/patient",
  startupTimeoutMs = 10_000,
} = {}) {
  if (appUrl) {
    const normalized = new URL(appUrl).href.replace(/\/$/, "");
    await waitForAppHealth(normalized, { path: healthPath, timeoutMs: startupTimeoutMs });
    return {
      appUrl: normalized,
      managed: false,
      output: () => "",
      stop: async () => {},
    };
  }

  await ensureNextBuild();
  const port = await reserveTcpPort();
  const localUrl = `http://127.0.0.1:${port}`;
  let output = "";
  // detached so the whole npx → next-server group can be stopped together.
  const server = spawn("npx", ["next", "start", "-p", String(port)], {
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  server.stdout.on("data", (chunk) => {
    output = appendBoundedLog(output, chunk);
  });
  server.stderr.on("data", (chunk) => {
    output = appendBoundedLog(output, chunk);
  });
  let spawnError;
  server.once("error", (error) => {
    spawnError = error;
    output = appendBoundedLog(output, error.stack ?? error.message);
  });

  try {
    await waitForAppHealth(localUrl, {
      path: healthPath,
      timeoutMs: startupTimeoutMs,
      child: server,
      childOutput: () => output,
    });
    if (spawnError) throw spawnError;
  } catch (error) {
    await stopChildProcess(server);
    throw error;
  }

  return {
    appUrl: localUrl,
    managed: true,
    output: () => output,
    server,
    stop: () => stopChildProcess(server, { processGroup: true }),
  };
}

async function captureBrowserDiagnostics({
  client,
  root,
  metadata,
  error,
  browserLog,
  captureTimeoutMs = 1_500,
}) {
  await mkdir(root, { recursive: true });
  let dom = `<!-- DOM unavailable: ${error?.message ?? "unknown failure"} -->`;
  let screenshot = Buffer.alloc(0);
  if (client && !client.closed) {
    dom = await client.call("Runtime.evaluate", {
      expression: "document.documentElement?.outerHTML ?? ''",
      returnByValue: true,
    }, captureTimeoutMs).then(({ result }) => result?.value ?? dom).catch((captureError) => (
      `<!-- DOM capture failed: ${captureError.message} -->`
    ));
    screenshot = await client.call("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    }, captureTimeoutMs).then(({ data }) => Buffer.from(data ?? "", "base64")).catch(() => Buffer.alloc(0));
  }

  const paths = {
    log: join(root, "failure.log.json"),
    dom: join(root, "failure.dom.html"),
    screenshot: join(root, "failure.png"),
    manifest: join(root, "failure.manifest.json"),
  };
  const artifacts = [
    { type: "log", path: paths.log, metadata },
    { type: "dom", path: paths.dom, metadata },
    { type: "screenshot", path: paths.screenshot, metadata },
  ];
  await Promise.all([
    writeFile(paths.log, `${JSON.stringify({
      ...metadata,
      error: {
        name: error?.name ?? "Error",
        message: error?.message ?? "Unknown browser failure",
        stack: error?.stack,
      },
      browserStderr: browserLog,
      events: client?.events ?? [],
    }, null, 2)}\n`, "utf8"),
    writeFile(paths.dom, dom, "utf8"),
    writeFile(paths.screenshot, screenshot),
    writeFile(paths.manifest, `${JSON.stringify({ ...metadata, artifacts }, null, 2)}\n`, "utf8"),
  ]);
  return { paths, artifacts };
}

export async function runBrowserSmoke({
  appUrl = "http://127.0.0.1:4173",
  debugPort = 0,
  profilePrefix = "policycompass-browser-smoke-",
  initialViewport = { width: 1280, height: 800, mobile: false },
  cdpTimeoutMs = positiveInteger(process.env.BROWSER_CDP_TIMEOUT_MS, DEFAULT_CDP_TIMEOUT_MS),
  stepTimeoutMs = positiveInteger(process.env.BROWSER_STEP_TIMEOUT_MS, DEFAULT_STEP_TIMEOUT_MS),
  attemptTimeoutMs = positiveInteger(
    process.env.BROWSER_ATTEMPT_TIMEOUT_MS,
    DEFAULT_ATTEMPT_TIMEOUT_MS,
  ),
  diagnosticRoot = process.env.PR_GATE_CELL_ROOT,
  diagnosticMetadata = {},
  signal,
}, callback) {
  const chrome = process.env.CHROME_BIN ?? "/usr/bin/google-chrome";
  const profile = await mkdtemp(join(tmpdir(), profilePrefix));
  const resolvedDebugPort = Number.isInteger(debugPort) && debugPort > 0
    ? debugPort
    : await reserveTcpPort();
  let browserStderr = "";
  let spawnError;
  const browser = spawn(chrome, [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-sync",
    "--metrics-recording-only",
    "--no-first-run",
    "--force-color-profile=srgb",
    "--lang=ko-KR",
    `--remote-debugging-port=${resolvedDebugPort}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  activeBrowsers.add(browser);
  browser.stderr.setEncoding("utf8");
  browser.stderr.on("data", (chunk) => {
    browserStderr = appendBoundedLog(browserStderr, chunk);
  });
  browser.once("error", (error) => {
    spawnError = error;
    browserStderr = appendBoundedLog(browserStderr, error.stack ?? error.message);
  });

  let client;
  let runError;
  let attemptTimedOut = false;
  let abortHandler;
  const stepRecords = [];
  try {
    await waitForEndpoint(
      browser,
      resolvedDebugPort,
      () => browserStderr,
      Math.min(attemptTimeoutMs, Math.max(cdpTimeoutMs, 3_000)),
    );
    if (spawnError) throw spawnError;
    const targetResponse = await fetch(
      `http://127.0.0.1:${resolvedDebugPort}/json/new?${encodeURIComponent("about:blank")}`,
      { method: "PUT", signal: AbortSignal.timeout(cdpTimeoutMs) },
    );
    assert(targetResponse.ok, `Chrome target creation returned HTTP ${targetResponse.status}.`);
    const target = await targetResponse.json();
    client = new CdpClient(target.webSocketDebuggerUrl, { timeoutMs: cdpTimeoutMs });
    await client.call("Page.enable");
    await client.call("Runtime.enable");
    await client.call("Log.enable");
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
      return response.result?.value;
    }

    async function waitFor(expression, message, options = {}) {
      const configuredTimeout = typeof options === "number"
        ? options * 75
        : positiveInteger(options.timeoutMs, stepTimeoutMs);
      const pollMs = typeof options === "object"
        ? positiveInteger(options.pollMs, 75, 1_000)
        : 75;
      const deadline = Date.now() + configuredTimeout;
      let lastError;
      while (Date.now() < deadline) {
        try {
          if (await evaluate(expression)) return;
        } catch (error) {
          lastError = error;
        }
        await delay(Math.min(pollMs, Math.max(0, deadline - Date.now())));
      }
      throw new SmokeTimeoutError(
        `${message}${lastError ? ` Last browser error: ${lastError.message}` : ""}`,
        configuredTimeout,
      );
    }

    async function navigate(path, readyExpression = "document.readyState === 'complete'") {
      const url = path.startsWith("http") ? path : new URL(path, `${appUrl}/`).href;
      await client.call("Page.navigate", { url });
      await waitFor(
        `document.readyState === 'complete' && location.href === ${JSON.stringify(url)} && (${readyExpression})`,
        `${path} did not become ready.`,
        { timeoutMs: stepTimeoutMs },
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

    async function step(name, action, { timeoutMs = stepTimeoutMs } = {}) {
      const order = stepRecords.length + 1;
      const startedAt = new Date().toISOString();
      const started = performance.now();
      const record = { order, name, startedAt, timeoutMs };
      try {
        const value = await withTimeout(action(), timeoutMs, `Browser step "${name}"`);
        Object.assign(record, {
          finishedAt: new Date().toISOString(),
          elapsedMs: Math.round(performance.now() - started),
          outcome: "passed",
        });
        stepRecords.push(Object.freeze(record));
        return value;
      } catch (error) {
        Object.assign(record, {
          finishedAt: new Date().toISOString(),
          elapsedMs: Math.round(performance.now() - started),
          outcome: "failed",
          error: error.message,
        });
        stepRecords.push(Object.freeze(record));
        throw error;
      }
    }

    async function captureDiagnostics(root, metadata, error) {
      return await captureBrowserDiagnostics({
        client,
        root,
        metadata,
        error,
        browserLog: browserStderr,
      });
    }

    const api = {
      appUrl,
      browserLog: () => browserStderr,
      captureDiagnostics,
      client,
      debugPort: resolvedDebugPort,
      delay,
      evaluate,
      navigate,
      press,
      profile,
      setViewport,
      step,
      stepRecords,
      tabTo,
      waitFor,
    };

    await setViewport(initialViewport);
    const callbackPromise = Promise.resolve().then(() => callback(api));
    const abortPromise = signal
      ? new Promise((_, reject) => {
        abortHandler = () => {
          const error = signal.reason instanceof Error
            ? signal.reason
            : new Error("Browser smoke aborted.");
          void stopChildProcess(browser);
          reject(error);
        };
        if (signal.aborted) abortHandler();
        else signal.addEventListener("abort", abortHandler, { once: true });
      })
      : new Promise(() => {});
    return await withTimeout(
      Promise.race([callbackPromise, abortPromise]),
      attemptTimeoutMs,
      "Browser smoke attempt",
      () => {
        attemptTimedOut = true;
        void stopChildProcess(browser);
      },
    );
  } catch (error) {
    runError = error;
    if (diagnosticRoot) {
      await captureBrowserDiagnostics({
        client: attemptTimedOut ? undefined : client,
        root: diagnosticRoot,
        metadata: {
          appUrl,
          debugPort: resolvedDebugPort,
          profilePrefix,
          steps: stepRecords,
          ...diagnosticMetadata,
        },
        error,
        browserLog: browserStderr,
      }).catch(() => {});
    }
    throw error;
  } finally {
    if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
    client?.close();
    await stopChildProcess(browser);
    activeBrowsers.delete(browser);
    try {
      await removeProfile(profile);
    } catch (cleanupError) {
      if (!runError) throw cleanupError;
      console.error(`Failed to clean Chrome profile ${profile}: ${cleanupError.message}`);
    }
  }
}
