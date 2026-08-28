import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chrome = process.env.CHROME_BIN ?? "/usr/bin/google-chrome";
const appUrl = process.env.APP_URL ?? "http://127.0.0.1:4173";
const appOrigin = new URL(appUrl).origin;
const debugPort = Number.parseInt(process.env.CHROME_DEBUG_PORT ?? "9230", 10);
const routes = ["/", "/patient", "/map", "/connections", "/insights", "/journey", "/emr"];
const viewports = [
  { name: "mobile", width: 390, height: 844, mobile: true },
  { name: "desktop", width: 1280, height: 800, mobile: false },
];
const fixedTime = Date.parse("2025-01-01T00:00:00.000Z");
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const profile = await mkdtemp(join(tmpdir(), "policycompass-accessibility-"));
let chromeStderr = "";

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
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

browser.stderr.on("data", (chunk) => {
  chromeStderr = `${chromeStderr}${chunk}`.slice(-8_000);
});

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of this.listeners.get(message.method) ?? []) {
        Promise.resolve(listener(message.params)).catch(() => {});
      }
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  async call(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Chrome DevTools command timed out: ${method}`));
      }, 15_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error("Chrome DevTools connection closed."));
    }
    this.pending.clear();
    this.socket.close();
  }
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function waitForEndpoint() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (browser.exitCode !== null) {
      throw new Error(`Chrome exited before DevTools became ready.\n${chromeStderr}`);
    }
    try {
      if ((await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`Chrome DevTools endpoint did not start.\n${chromeStderr}`);
}

async function evaluate(client, expression) {
  const response = await client.call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  }
  return response.result.value;
}

async function navigate(client, url) {
  const navigation = await client.call("Page.navigate", { url });
  if (navigation.errorText) throw new Error(`${url}: navigation failed (${navigation.errorText})`);
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const ready = await evaluate(client, `document.readyState === "complete" && Boolean(document.body)`);
      if (ready) {
        await delay(75);
        return;
      }
    } catch {}
    await delay(50);
  }
  throw new Error(`${url}: document did not become ready`);
}

const domAuditExpression = `(() => {
  const compact = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
  const describe = (element) => {
    const tag = element.localName || element.nodeName.toLowerCase();
    if (element.id) return tag + '#' + element.id;
    const name = element.getAttribute('name');
    if (name) return tag + '[name="' + name + '"]';
    const role = element.getAttribute('role');
    if (role) return tag + '[role="' + role + '"]';
    return tag;
  };
  const isInsideClosedDisclosure = (element) => {
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.localName !== 'details' || ancestor.open) continue;
      const summary = ancestor.querySelector(':scope > summary');
      if (!summary || !summary.contains(element)) return true;
    }
    return false;
  };
  const isVisuallyHidden = (element) => {
    if (!(element instanceof Element) || !element.isConnected) return true;
    if (element.matches('input[type="hidden"]') || element.closest('[hidden], [inert]')) return true;
    if (isInsideClosedDisclosure(element)) return true;
    if (typeof element.checkVisibility === 'function' && !element.checkVisibility({
      checkOpacity: true,
      checkVisibilityCSS: true,
    })) return true;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return true;
    if (Number(style.opacity) === 0) return true;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || element.getClientRects().length === 0) return true;
    const clip = style.clip.replace(/\\s+/g, '');
    const clipped = style.clipPath === 'inset(50%)' || clip === 'rect(0px,0px,0px,0px)';
    if (clipped && rect.width <= 2 && rect.height <= 2) return true;
    return false;
  };
  const hasDomLabel = (element) => {
    if (compact(element.getAttribute('aria-label'))) return true;
    const labelledBy = compact(element.getAttribute('aria-labelledby'));
    if (labelledBy && labelledBy.split(/\\s+/).some((id) => compact(document.getElementById(id)?.textContent))) return true;
    if ([...(element.labels ?? [])].some((label) => compact(label.textContent))) return true;
    if (compact(element.getAttribute('title'))) return true;
    if (element.localName === 'button' && compact(element.textContent)) return true;
    const type = compact(element.getAttribute('type')).toLowerCase();
    if (element.localName === 'input' && ['button', 'reset', 'submit'].includes(type) && compact(element.value)) return true;
    if (element.localName === 'input' && type === 'image' && element.hasAttribute('alt')) return true;
    return false;
  };
  const idCounts = new Map();
  for (const element of document.querySelectorAll('[id]')) {
    if (!element.id) continue;
    idCounts.set(element.id, (idCounts.get(element.id) ?? 0) + 1);
  }
  const duplicateIds = [...idCounts].filter(([, count]) => count > 1).map(([id, count]) => id + ' (' + count + ')');
  const visibleFormControls = [...document.querySelectorAll('button, input, select, textarea')]
    .filter((element) => !isVisuallyHidden(element));
  const unlabeledControls = visibleFormControls.filter((element) => !hasDomLabel(element)).map(describe);
  const ariaHiddenFocusables = [...document.querySelectorAll('[aria-hidden="true"], [aria-hidden="true"] *')]
    .filter((element) => !isVisuallyHidden(element) && !element.matches(':disabled') && element.tabIndex >= 0)
    .map(describe);
  const missingAlt = [...document.querySelectorAll('img:not([alt])')].map(describe);
  const visibleHeadings = [...document.querySelectorAll('h1')].filter((element) => !isVisuallyHidden(element));
  const documentWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0);
  const viewportWidth = document.documentElement.clientWidth;
  return {
    duplicateIds,
    unlabeledControls,
    ariaHiddenFocusables,
    missingAlt,
    missingHeading: visibleHeadings.length === 0,
    missingLanguage: !compact(document.documentElement.getAttribute('lang')),
    horizontalOverflow: documentWidth > viewportWidth + 1,
    documentWidth,
    viewportWidth,
  };
})()`;

const axVisibilityFunction = `function() {
  if (!(this instanceof Element) || !this.isConnected) return { visible: false };
  for (let ancestor = this; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.localName !== 'details' || ancestor.open) continue;
    const summary = ancestor.querySelector(':scope > summary');
    if (!summary || !summary.contains(this)) return { visible: false, closedDisclosure: true };
  }
  if (this.matches('input[type="hidden"]') || this.closest('[hidden], [inert]')) return { visible: false };
  if (typeof this.checkVisibility === 'function' && !this.checkVisibility({
    checkOpacity: true,
    checkVisibilityCSS: true,
  })) return { visible: false };
  const style = getComputedStyle(this);
  const rect = this.getBoundingClientRect();
  const clip = style.clip.replace(/\\s+/g, '');
  const clipped = style.clipPath === 'inset(50%)' || clip === 'rect(0px,0px,0px,0px)';
  if (clipped && rect.width <= 2 && rect.height <= 2) return { visible: false, visuallyHidden: true };
  if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) {
    return { visible: false };
  }
  if (rect.width <= 0 || rect.height <= 0 || this.getClientRects().length === 0) return { visible: false };
  const tag = this.localName;
  const description = this.id ? tag + '#' + this.id : tag + (this.getAttribute('role') ? '[role="' + this.getAttribute('role') + '"]' : '');
  return { visible: true, description };
}`;

const interactiveRoles = new Set([
  "button", "checkbox", "combobox", "disclosuretriangle", "link", "listbox", "menuitem",
  "menuitemcheckbox", "menuitemradio", "option", "radio", "searchbox", "slider", "spinbutton",
  "switch", "tab", "textbox", "treeitem",
]);

function axProperty(node, name) {
  return node.properties?.find((property) => property.name === name)?.value?.value;
}

async function visibleAxDescription(client, backendNodeId) {
  if (!backendNodeId) return null;
  let objectId;
  try {
    const resolved = await client.call("DOM.resolveNode", { backendNodeId });
    objectId = resolved.object?.objectId;
    if (!objectId) return null;
    const response = await client.call("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: axVisibilityFunction,
      returnByValue: true,
    });
    if (response.exceptionDetails) return null;
    return response.result.value;
  } catch {
    return null;
  } finally {
    if (objectId) await client.call("Runtime.releaseObject", { objectId }).catch(() => {});
  }
}

async function auditAxTree(client) {
  const { nodes } = await client.call("Accessibility.getFullAXTree", { depth: -1 });
  const unnamed = [];
  for (const node of nodes) {
    if (node.ignored) continue;
    const role = String(node.role?.value ?? "");
    const normalizedRole = role.toLowerCase();
    const focusable = axProperty(node, "focusable") === true;
    const structuralRoot = normalizedRole === "rootwebarea" || normalizedRole === "webarea";
    if (!interactiveRoles.has(normalizedRole) && (!focusable || structuralRoot)) continue;
    if (String(node.name?.value ?? "").trim()) continue;
    const domNode = await visibleAxDescription(client, node.backendDOMNodeId);
    if (domNode?.visible) unnamed.push(`${role || "focusable"} ${domNode.description}`);
  }
  return unnamed;
}

function appendList(failures, context, label, values) {
  if (values.length) failures.push(`${context}: ${label}: ${values.slice(0, 12).join(", ")}`);
}

async function stopBrowser() {
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

async function removeProfile() {
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

let client;
let runError;
try {
  await waitForEndpoint();
  const target = await (await fetch(
    `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent("about:blank")}`,
    { method: "PUT" },
  )).json();
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.call("Page.enable");
  await client.call("Runtime.enable");
  await client.call("DOM.enable");
  await client.call("Accessibility.enable");

  const blockedExternalUrls = new Set();
  const interceptionErrors = [];
  client.on("Fetch.requestPaused", async ({ requestId, request }) => {
    try {
      if (new URL(request.url).origin === appOrigin) {
        await client.call("Fetch.continueRequest", { requestId });
      } else {
        blockedExternalUrls.add(request.url);
        await client.call("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
      }
    } catch (error) {
      interceptionErrors.push(error.message);
    }
  });
  await client.call("Fetch.enable", {
    patterns: [
      { urlPattern: "http://*/*", requestStage: "Request" },
      { urlPattern: "https://*/*", requestStage: "Request" },
    ],
  });
  await client.call("Emulation.setTimezoneOverride", { timezoneId: "Asia/Seoul" });
  await client.call("Emulation.setLocaleOverride", { locale: "ko-KR" });
  await client.call("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await client.call("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    const NativeDate = Date;
    const fixedTime = ${fixedTime};
    window.Date = new Proxy(NativeDate, {
      apply: () => new NativeDate(fixedTime).toString(),
      construct: (target, args) => Reflect.construct(target, args.length ? args : [fixedTime]),
      get: (target, property, receiver) => property === 'now' ? () => fixedTime : Reflect.get(target, property, receiver),
    });
    Math.random = () => 0.5;
    try { localStorage.clear(); } catch {}
    try { sessionStorage.clear(); } catch {}
  })();` });

  const failures = [];
  for (const viewport of viewports) {
    await client.call("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      screenWidth: viewport.width,
      screenHeight: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.mobile,
    });
    for (const route of routes) {
      await navigate(client, new URL(route, appUrl).href);
      const context = `${route} @ ${viewport.width}x${viewport.height}`;
      const dom = await evaluate(client, domAuditExpression);
      appendList(failures, context, "duplicate IDs", dom.duplicateIds);
      appendList(failures, context, "unlabeled visible form controls", dom.unlabeledControls);
      appendList(failures, context, "images missing alt", dom.missingAlt);
      appendList(failures, context, "focusable elements inside aria-hidden", dom.ariaHiddenFocusables);
      if (dom.missingHeading) failures.push(`${context}: no visible h1`);
      if (dom.missingLanguage) failures.push(`${context}: html element has no lang`);
      if (dom.horizontalOverflow) {
        failures.push(`${context}: horizontal overflow (${dom.documentWidth}px document / ${dom.viewportWidth}px viewport)`);
      }
      appendList(failures, context, "unnamed visible interactive AX nodes", await auditAxTree(client));
    }
  }
  assert(interceptionErrors.length === 0, `Network interception failed:\n${interceptionErrors.join("\n")}`);
  assert(failures.length === 0, failures.join("\n"));
  console.log(
    `accessibility matrix passed: ${routes.length * viewports.length} route/viewport combinations; `
    + `${blockedExternalUrls.size} external URL(s) blocked`,
  );
} catch (error) {
  runError = error;
} finally {
  client?.close();
  await stopBrowser();
  try {
    await removeProfile();
  } catch (cleanupError) {
    if (runError) console.error(`Failed to clean Chrome profile ${profile}: ${cleanupError.message}`);
    else runError = cleanupError;
  }
}

if (runError) throw runError;
