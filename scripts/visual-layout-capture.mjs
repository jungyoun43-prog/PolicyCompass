import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  runBrowserSmoke,
  startManagedAppServer,
} from "./browser-smoke-harness.mjs";

const captureRoot = process.env.VISUAL_CAPTURE_ROOT ?? "/tmp/vitagraph-visual-layout";
const reportPath = join(captureRoot, "report.json");
const maxFullPageHeight = Number.parseInt(process.env.VISUAL_CAPTURE_MAX_HEIGHT ?? "6000", 10);
const focusedOnly = process.env.VISUAL_CAPTURE_FOCUSED_ONLY === "1";

const requestedViewports = new Set(
  (process.env.VISUAL_CAPTURE_VIEWPORTS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

const allViewports = Object.freeze([
  { name: "ultrawide", width: 2560, height: 1440, mobile: false },
  { name: "wide", width: 1920, height: 1080, mobile: false },
  { name: "desktop", width: 1440, height: 1100, mobile: false },
  { name: "tablet", width: 768, height: 1024, mobile: false },
  { name: "mobile", width: 390, height: 844, mobile: true },
]);

const knownViewportNames = new Set(allViewports.map((viewport) => viewport.name));
const unknownViewportNames = [...requestedViewports].filter((name) => !knownViewportNames.has(name));
if (unknownViewportNames.length > 0) {
  throw new Error(`Unknown VISUAL_CAPTURE_VIEWPORTS: ${unknownViewportNames.join(", ")}`);
}

const viewports = Object.freeze(
  allViewports.filter((viewport) => requestedViewports.size === 0 || requestedViewports.has(viewport.name)),
);

const requestedRoutes = new Set(
  (process.env.VISUAL_CAPTURE_ROUTES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

const allRoutes = Object.freeze([
  { name: "gateway", path: "/" },
  { name: "patient", path: "/patient" },
  { name: "map", path: "/map?sample=1" },
  { name: "connections", path: "/connections?sample=1" },
  { name: "insights", path: "/insights?sample=1" },
  { name: "journey", path: "/journey?sample=1" },
  { name: "emr", path: "/emr?demo=1" },
]);

const knownRouteNames = new Set(allRoutes.map((route) => route.name));
const unknownRouteNames = [...requestedRoutes].filter((name) => !knownRouteNames.has(name));
if (unknownRouteNames.length > 0) {
  throw new Error(`Unknown VISUAL_CAPTURE_ROUTES: ${unknownRouteNames.join(", ")}`);
}

const routes = Object.freeze(
  allRoutes.filter((route) => requestedRoutes.size === 0 || requestedRoutes.has(route.name)),
);

if (focusedOnly && routes.some((route) => route.name !== "map")) {
  throw new Error("VISUAL_CAPTURE_FOCUSED_ONLY is currently supported only for the map route");
}

async function capture(client, path, { fullPage = false } = {}) {
  const options = { format: "png", fromSurface: true, captureBeyondViewport: fullPage };
  if (fullPage) {
    const { contentSize } = await client.call("Page.getLayoutMetrics");
    options.clip = {
      x: 0,
      y: 0,
      width: Math.ceil(contentSize.width),
      height: Math.min(Math.ceil(contentSize.height), maxFullPageHeight),
      scale: 1,
    };
  }
  const screenshot = await client.call("Page.captureScreenshot", options, 12_000);
  await writeFile(path, Buffer.from(screenshot.data, "base64"));
}

const app = await startManagedAppServer({ appUrl: "", healthPath: "/patient" });
const results = [];

try {
  await mkdir(captureRoot, { recursive: true });
  for (const route of routes) {
    await runBrowserSmoke({
      appUrl: app.appUrl,
      profilePrefix: `vitagraph-visual-${route.name}-`,
      initialViewport: viewports[0],
      cdpTimeoutMs: 30_000,
      stepTimeoutMs: 20_000,
      attemptTimeoutMs: 120_000,
    }, async ({ client, delay, evaluate, navigate, setViewport, waitFor }) => {
      for (const viewport of viewports) {
        await setViewport(viewport);
        await navigate(route.path, "Boolean(document.querySelector('main'))");
        await evaluate("scrollTo(0, 0)");
        await delay(route.name === "map" || route.name === "emr" ? 1_800 : 650);

        const metrics = await evaluate(`(() => {
          const visible = (element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          };
          const describe = (element) => {
            const rect = element.getBoundingClientRect();
            return {
              tag: element.tagName.toLowerCase(),
              id: element.id || null,
              className: typeof element.className === 'string' ? element.className.slice(0, 120) : '',
              text: (element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 100),
              width: Math.round(rect.width * 10) / 10,
              height: Math.round(rect.height * 10) / 10,
            };
          };
          const horizontalOverflow = [...document.querySelectorAll('body *')]
            .filter(visible)
            .filter((element) => {
              const style = getComputedStyle(element);
              return element.scrollWidth > element.clientWidth + 2
                && !['auto', 'scroll'].includes(style.overflowX);
            })
            .slice(0, 24)
            .map(describe);
          const narrowText = [...document.querySelectorAll('h1,h2,h3,p,a,button,summary,label,strong,small')]
            .filter(visible)
            .filter((element) => {
              const text = (element.textContent || '').replace(/\\s+/g, '').trim();
              const rect = element.getBoundingClientRect();
              const fontSize = Number.parseFloat(getComputedStyle(element).fontSize) || 16;
              return text.length >= 4 && rect.width < fontSize * 2.2 && rect.height > fontSize * 3;
            })
            .slice(0, 24)
            .map(describe);
          const keyElements = Object.fromEntries(Object.entries({
            pageTitle: 'h1',
            mapUpdate: '#analyzeButton',
            mapBodyHeading: '#bodyTitle',
            gatewayClinicalAction: '.role-card--clinical .role-action',
            gatewayPersonalAction: '.role-card--patient .role-action',
          }).map(([name, selector]) => {
            const element = document.querySelector(selector);
            if (!element || !visible(element)) return [name, null];
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return [name, {
              ...describe(element),
              top: Math.round(rect.top * 10) / 10,
              right: Math.round(rect.right * 10) / 10,
              bottom: Math.round(rect.bottom * 10) / 10,
              left: Math.round(rect.left * 10) / 10,
              fontSize: style.fontSize,
              color: style.color,
              backgroundColor: style.backgroundColor,
              borderColor: style.borderColor,
            }];
          }));
          return {
            title: document.title,
            viewport: { width: innerWidth, height: innerHeight },
            document: {
              width: document.documentElement.scrollWidth,
              clientWidth: document.documentElement.clientWidth,
              height: document.documentElement.scrollHeight,
              horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
            },
            horizontalOverflow,
            narrowText,
            keyElements,
          };
      })()`);

        const prefix = `${route.name}-${viewport.name}`;
        const viewportPath = join(captureRoot, `${prefix}-viewport.png`);
        const fullPath = join(captureRoot, `${prefix}-full.png`);
        if (!focusedOnly) {
          await capture(client, viewportPath);
          await capture(client, fullPath, { fullPage: true });
        }
        let focusedPath = null;
        if (route.name === "map") {
          await evaluate("document.querySelector('[data-body-3d]').scrollIntoView({ block: 'center' })");
          await waitFor(
            "document.querySelector('[data-body-3d]')?.dataset.body3dState === 'ready'",
            `${viewport.name}: 3D body did not become ready before focused capture`,
            { timeoutMs: 45_000 },
          );
          await delay(500);
          focusedPath = join(captureRoot, `${prefix}-body.png`);
          await capture(client, focusedPath);
        }
        results.push({
          route,
          viewport,
          metrics,
          screenshots: {
            viewportPath: focusedOnly ? null : viewportPath,
            fullPath: focusedOnly ? null : fullPath,
            focusedPath,
          },
        });
        await writeFile(reportPath, `${JSON.stringify({ captureRoot, results }, null, 2)}\n`, "utf8");
      }
    });
  }
  await writeFile(reportPath, `${JSON.stringify({ captureRoot, results }, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ captureRoot, reportPath, captures: results.length }, null, 2)}\n`);
} finally {
  await app.stop();
}
