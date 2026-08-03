const BODY_STAGE_SELECTOR = ".body-stage[data-body-3d]";
const MODEL_VIEWER_TAG = "model-viewer";
const STYLE_ID = "vitagraph-body-3d-styles";
const VIEW_PREFERENCE_KEY = "vitagraph-body-view";
const controllers = new WeakMap();

/**
 * Default positions assume an upright, Y-up human model measuring about 1.8 m,
 * centred on X=0 with its front facing +Z. A model-specific map can be supplied
 * with data-body-hotspots JSON or data-position/data-normal on each button.
 */
export const DEFAULT_BODY_HOTSPOTS = Object.freeze({
  neuro: Object.freeze({ position: "0m 1.68m 0.1m", normal: "0m 0m 1m" }),
  mental: Object.freeze({ position: "-0.15m 1.57m 0.09m", normal: "-0.15m 0m 1m" }),
  sensory: Object.freeze({ position: "0.14m 1.6m 0.12m", normal: "0.12m 0m 1m" }),
  cardio: Object.freeze({ position: "-0.14m 1.27m 0.17m", normal: "-0.08m 0m 1m" }),
  respiratory: Object.freeze({ position: "0.16m 1.31m 0.15m", normal: "0.08m 0m 1m" }),
  digestive: Object.freeze({ position: "-0.13m 1.03m 0.16m", normal: "-0.08m 0m 1m" }),
  endocrine: Object.freeze({ position: "0.13m 1.1m 0.18m", normal: "0.08m 0m 1m" }),
  renal: Object.freeze({ position: "-0.18m 0.9m 0.09m", normal: "-0.12m 0m 1m" }),
  pelvic: Object.freeze({ position: "0.12m 0.77m 0.15m", normal: "0.08m 0m 1m" }),
  musculoskeletal: Object.freeze({ position: "-0.18m 0.53m 0.06m", normal: "-0.15m 0m 1m" }),
  rheumatology: Object.freeze({ position: "0.18m 0.48m 0.06m", normal: "0.15m 0m 1m" }),
  dermatology: Object.freeze({ position: "0.22m 1.42m 0.05m", normal: "0.16m 0m 1m" }),
});

const BODY_3D_CSS = `
  .body-stage[data-body-3d] .body-3d-controls {
    position: absolute;
    z-index: 9;
    top: 12px;
    right: 12px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px;
    border: 1px solid color-mix(in srgb, var(--line, #d5dde6) 82%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--surface, #fff) 92%, transparent);
    box-shadow: 0 8px 24px rgb(18 35 53 / 10%);
    backdrop-filter: blur(12px);
  }

  .body-stage[data-body-3d] .body-3d-control {
    min-width: 42px;
    min-height: 44px;
    margin: 0;
    padding: 0 12px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--muted, #596979);
    font: inherit;
    font-size: 0.78rem;
    font-weight: 700;
    line-height: 1;
    cursor: pointer;
  }

  .body-stage[data-body-3d] .body-3d-control:hover:not(:disabled) {
    background: color-mix(in srgb, var(--data-cyan, #258aa3) 9%, var(--surface, #fff));
    color: var(--ink, #172431);
  }

  .body-stage[data-body-3d] .body-3d-control:focus-visible {
    outline: 3px solid color-mix(in srgb, var(--data-cyan, #258aa3) 36%, transparent);
    outline-offset: 2px;
  }

  .body-stage[data-body-3d] .body-3d-control[aria-pressed="true"] {
    background: var(--ink, #172431);
    color: var(--surface, #fff);
  }

  .body-stage[data-body-3d] .body-3d-control:disabled {
    opacity: 0.46;
    cursor: not-allowed;
  }

  .body-stage[data-body-3d] .body-3d-reset[hidden],
  .body-stage[data-body-3d] model-viewer[hidden] {
    display: none !important;
  }

  .body-stage[data-body-3d] model-viewer.body-3d-viewer {
    position: absolute;
    z-index: 2;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    min-height: 100%;
    overflow: hidden;
    background: transparent;
    touch-action: pan-y;
    --poster-color: transparent;
    --progress-bar-color: var(--data-cyan, #258aa3);
    --progress-bar-height: 2px;
  }

  .body-stage[data-body-3d].is-body-3d .human-figure {
    isolation: isolate;
  }

  .body-stage[data-body-3d].is-body-3d model-viewer .body-hotspot {
    position: relative !important;
    inset: auto !important;
    top: auto !important;
    right: auto !important;
    bottom: auto !important;
    left: auto !important;
    transform: none !important;
  }

  .body-stage[data-body-3d].is-body-3d model-viewer .body-hotspot:hover:not(:disabled),
  .body-stage[data-body-3d].is-body-3d model-viewer .body-hotspot:focus-visible:not(:disabled) {
    transform: scale(1.12) !important;
  }

  .body-stage[data-body-3d].is-body-3d model-viewer .body-hotspot:not([data-visible]) {
    opacity: 0;
    pointer-events: none;
  }

  .body-stage[data-body-3d] .body-3d-status {
    position: absolute !important;
    width: 1px !important;
    height: 1px !important;
    padding: 0 !important;
    margin: -1px !important;
    overflow: hidden !important;
    clip: rect(0, 0, 0, 0) !important;
    white-space: nowrap !important;
    border: 0 !important;
  }

  @media (max-width: 640px) {
    .body-stage[data-body-3d] .body-3d-controls {
      top: 8px;
      right: 8px;
    }

    .body-stage[data-body-3d] .body-3d-control {
      min-height: 44px;
      padding-inline: 11px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .body-stage[data-body-3d] .body-3d-control,
    .body-stage[data-body-3d] model-viewer .body-hotspot {
      transition: none !important;
    }
  }
`;

function injectStyles(ownerDocument) {
  if (!ownerDocument?.head || ownerDocument.getElementById(STYLE_ID)) return;
  const style = ownerDocument.createElement("style");
  style.id = STYLE_ID;
  style.textContent = BODY_3D_CSS;
  ownerDocument.head.append(style);
}

function normalizeInitialMode(value) {
  const mode = String(value || "auto").toLowerCase();
  return ["2d", "3d", "auto"].includes(mode) ? mode : "auto";
}

function resolveModelSource(stage, options) {
  const explicit = options.model || stage.dataset.bodyModel || stage.dataset.bodySrc;
  if (explicit) return explicit;
  const shorthand = stage.dataset.body3d;
  if (!shorthand || ["true", "auto", "2d", "3d"].includes(shorthand.toLowerCase())) return "";
  return shorthand;
}

function resolvePoster(stage, figure, options) {
  return options.poster
    || stage.dataset.bodyPoster
    || figure.querySelector(".human-figure__image")?.getAttribute("src")
    || "";
}

function resolveSameOriginUrl(value, baseUrl, label) {
  if (!value) return "";
  const url = new URL(value, baseUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.origin !== new URL(baseUrl).origin) {
    throw new Error(`${label}은(는) 같은 출처의 HTTP(S) 경로여야 합니다.`);
  }
  return url.href;
}

function hasWebGl(ownerDocument) {
  try {
    const canvas = ownerDocument.createElement("canvas");
    const context = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!context) return false;
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function readViewPreference(ownerWindow) {
  try {
    const value = ownerWindow?.localStorage?.getItem(VIEW_PREFERENCE_KEY);
    return value === "2d" || value === "3d" ? value : "";
  } catch {
    return "";
  }
}

function writeViewPreference(ownerWindow, value) {
  try {
    ownerWindow?.localStorage?.setItem(VIEW_PREFERENCE_KEY, value);
  } catch {
    // A blocked storage API must not prevent the body map from working.
  }
}

function prefersReducedMotion(ownerWindow) {
  return Boolean(ownerWindow?.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

function prefersReducedData(ownerWindow) {
  return Boolean(ownerWindow?.navigator?.connection?.saveData);
}

function parseHotspotMap(stage, options) {
  const supplied = options.hotspots;
  if (supplied && typeof supplied === "object" && !Array.isArray(supplied)) return supplied;
  const raw = stage.dataset.bodyHotspots;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function vectorString(value, fallback) {
  if (Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)) {
    return value.map((part) => `${part}m`).join(" ");
  }
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
}

function hotspotArea(button) {
  return button.dataset.area || button.dataset.bodyArea || "";
}

function restoreAttribute(element, name, value) {
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

function createButton(ownerDocument, className, text, label) {
  const button = ownerDocument.createElement("button");
  button.className = `body-3d-control ${className}`;
  button.type = "button";
  button.textContent = text;
  button.setAttribute("aria-label", label);
  return button;
}

function dispatchStageEvent(stage, name, detail) {
  const EventConstructor = stage.ownerDocument.defaultView?.CustomEvent || CustomEvent;
  stage.dispatchEvent(new EventConstructor(name, { bubbles: true, detail }));
}

async function waitForModelViewer(ownerWindow, runtimeModule, timeoutMs = 6_000) {
  const registry = ownerWindow?.customElements;
  if (!registry) throw new Error("이 브라우저에서는 Web Components를 사용할 수 없습니다.");
  if (registry.get(MODEL_VIEWER_TAG)) return;

  if (runtimeModule) {
    const runtimeUrl = resolveSameOriginUrl(runtimeModule, ownerWindow.document.baseURI, "3D 런타임");
    await import(runtimeUrl);
    if (registry.get(MODEL_VIEWER_TAG)) return;
  }

  let timeoutId;
  try {
    await Promise.race([
      registry.whenDefined(MODEL_VIEWER_TAG),
      new Promise((_, reject) => {
        timeoutId = ownerWindow.setTimeout(
          () => reject(new Error("로컬 3D 런타임을 불러오지 못했습니다.")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    ownerWindow.clearTimeout(timeoutId);
  }
}

export class Body3DController {
  constructor(stage, options = {}) {
    if (!(stage instanceof stage.ownerDocument.defaultView.HTMLElement)) {
      throw new TypeError("Body3DController에는 body-stage 요소가 필요합니다.");
    }

    this.stage = stage;
    this.options = options;
    this.ownerDocument = stage.ownerDocument;
    this.ownerWindow = stage.ownerDocument.defaultView;
    this.figure = stage.querySelector(".human-figure");
    this.image = this.figure?.querySelector(".human-figure__image") || null;
    this.hotspots = this.figure ? [...this.figure.querySelectorAll(".body-hotspot")] : [];
    this.hotspotMap = parseHotspotMap(stage, options);
    this.modelSource = resolveModelSource(stage, options);
    this.poster = this.figure ? resolvePoster(stage, this.figure, options) : "";
    this.runtimeModule = options.runtimeModule
      || stage.dataset.bodyViewerModule
      || this.ownerDocument.documentElement.dataset.bodyViewerModule
      || "";
    this.context = options.context || stage.dataset.bodyContext || "shared";
    this.initialMode = normalizeInitialMode(options.initialMode || stage.dataset.bodyInitial);
    this.frontOrbit = options.frontOrbit || stage.dataset.bodyCameraOrbit || "0deg 75deg auto";
    this.frontTarget = options.frontTarget || stage.dataset.bodyCameraTarget || "auto auto auto";
    this.frontFieldOfView = options.frontFieldOfView || stage.dataset.bodyFieldOfView || "28deg";
    this.reducedMotion = prefersReducedMotion(this.ownerWindow);
    this.abortController = new AbortController();
    this.placeholders = new Map();
    this.originalAttributes = new Map();
    this.viewer = null;
    this.observer = null;
    this.attributeObserver = null;
    this.mode = "2d";
    this.requestedMode = "2d";
    this.destroyed = false;
    this.ready = false;
    this.activationPromise = null;
    this.originalFigureBusy = this.figure?.getAttribute("aria-busy") ?? null;

    if (!this.figure || !this.image || !this.hotspots.length) {
      throw new Error("3D 신체 지도에는 human-figure, 이미지와 핫스폿 버튼이 필요합니다.");
    }

    injectStyles(this.ownerDocument);
    this.createPlaceholders();
    this.createControls();
    this.observeHotspotAttributes();
    this.set2D({ announce: false, reason: "initial" });
    this.scheduleInitialActivation();
  }

  createPlaceholders() {
    for (const button of this.hotspots) {
      const marker = this.ownerDocument.createComment(`body-3d:${hotspotArea(button) || "hotspot"}`);
      button.before(marker);
      this.placeholders.set(button, marker);
      this.originalAttributes.set(button, {
        slot: button.getAttribute("slot"),
        position: button.getAttribute("data-position"),
        normal: button.getAttribute("data-normal"),
        visible: button.getAttribute("data-visible"),
        visibilityAttribute: button.getAttribute("data-visibility-attribute"),
      });
    }
  }

  createControls() {
    const controls = this.ownerDocument.createElement("div");
    controls.className = "body-3d-controls";
    controls.setAttribute("role", "group");
    controls.setAttribute("aria-label", "신체 지도 보기 방식");

    this.twoDButton = createButton(this.ownerDocument, "body-3d-mode-2d", "2D", "2D 신체 지도 보기");
    this.threeDButton = createButton(this.ownerDocument, "body-3d-mode-3d", "3D", "회전 가능한 3D 신체 지도 보기");
    this.resetButton = createButton(this.ownerDocument, "body-3d-reset", "정면", "3D 신체 지도를 정면으로 되돌리기");
    this.resetButton.hidden = true;

    controls.append(this.twoDButton, this.threeDButton, this.resetButton);
    this.stage.append(controls);
    this.controls = controls;

    const status = this.ownerDocument.createElement("p");
    status.className = "body-3d-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    this.stage.append(status);
    this.status = status;

    const signal = this.abortController.signal;
    this.twoDButton.addEventListener("click", () => this.set2D({ reason: "user" }), { signal });
    this.threeDButton.addEventListener("click", () => this.activate3D({ reason: "user" }), { signal });
    this.resetButton.addEventListener("click", () => this.resetFrontView(), { signal });
  }

  scheduleInitialActivation() {
    if (!this.modelSource) {
      this.markUnavailable("3D 모델 경로가 지정되지 않아 2D 지도를 표시합니다.");
      return;
    }
    if (!hasWebGl(this.ownerDocument)) {
      this.markUnavailable("WebGL을 사용할 수 없어 2D 지도를 표시합니다.");
      return;
    }

    const savedMode = this.initialMode === "auto" ? readViewPreference(this.ownerWindow) : "";
    const wants3D = this.initialMode === "3d"
      || (this.initialMode === "auto" && savedMode !== "2d" && !prefersReducedData(this.ownerWindow));
    if (!wants3D) return;
    this.requestedMode = "3d";

    if (!("IntersectionObserver" in this.ownerWindow)) {
      this.activate3D({ reason: "initial" });
      return;
    }

    this.observer = new this.ownerWindow.IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      this.observer?.disconnect();
      this.observer = null;
      this.activate3D({ reason: "viewport" });
    }, { rootMargin: "240px 0px", threshold: 0.01 });
    this.observer.observe(this.stage);
  }

  observeHotspotAttributes() {
    if (!("MutationObserver" in this.ownerWindow)) return;
    this.attributeObserver = new this.ownerWindow.MutationObserver((records) => {
      if (this.mode !== "3d") return;
      const changedButtons = new Set(records.map((record) => record.target));
      for (const button of changedButtons) this.placeHotspot(button);
    });
    for (const button of this.hotspots) {
      this.attributeObserver.observe(button, {
        attributes: true,
        attributeFilter: ["data-area", "data-body-area", "data-body-position", "data-body-normal"],
      });
    }
  }

  async activate3D({ reason = "api" } = {}) {
    if (this.destroyed) return false;
    this.requestedMode = "3d";
    this.observer?.disconnect();
    this.observer = null;

    if (!this.modelSource || !hasWebGl(this.ownerDocument)) {
      this.markUnavailable("3D 지도를 사용할 수 없어 2D 지도를 유지합니다.");
      return false;
    }
    if (this.mode === "3d" && this.viewer) return true;
    if (this.activationPromise) return this.activationPromise;

    this.threeDButton.disabled = true;
    this.figure.setAttribute("aria-busy", "true");
    this.status.textContent = "3D 신체 지도를 준비하고 있습니다.";

    this.activationPromise = (async () => {
      try {
        await waitForModelViewer(this.ownerWindow, this.runtimeModule);
        if (this.destroyed || this.requestedMode !== "3d") return false;
        this.mountViewer();
        this.mode = "3d";
        this.stage.dataset.body3dState = this.ready ? "ready" : "loading";
        this.stage.classList.remove("is-body-2d");
        this.stage.classList.add("is-body-3d");
        this.image.hidden = true;
        this.viewer.hidden = false;
        this.moveHotspotsToViewer();
        this.updateControls();
        this.status.textContent = this.ready
          ? "3D 신체 지도를 표시했습니다."
          : "3D 신체 지도를 불러오고 있습니다.";
        dispatchStageEvent(this.stage, "body-3d:modechange", {
          controller: this,
          context: this.context,
          mode: "3d",
          reason,
        });
        if (reason === "user") writeViewPreference(this.ownerWindow, "3d");
        return true;
      } catch (error) {
        this.handleError(error, reason);
        return false;
      } finally {
        this.activationPromise = null;
        if (!this.destroyed) {
          this.threeDButton.disabled = false;
          restoreAttribute(this.figure, "aria-busy", this.originalFigureBusy);
        }
      }
    })();

    return this.activationPromise;
  }

  mountViewer() {
    if (this.viewer) return;
    const viewer = this.ownerDocument.createElement(MODEL_VIEWER_TAG);
    viewer.className = "body-3d-viewer";
    viewer.setAttribute("src", resolveSameOriginUrl(this.modelSource, this.ownerDocument.baseURI, "3D 모델"));
    if (this.poster) viewer.setAttribute("poster", this.poster);
    viewer.setAttribute("alt", this.options.alt || this.stage.dataset.bodyAlt || this.figure.getAttribute("aria-label") || "3D 신체 건강 지도");
    viewer.setAttribute("camera-controls", "");
    viewer.setAttribute("disable-pan", "");
    viewer.setAttribute("loading", "lazy");
    viewer.setAttribute("reveal", "auto");
    viewer.setAttribute("interaction-prompt", "none");
    viewer.setAttribute("touch-action", "pan-y");
    viewer.setAttribute("camera-orbit", this.frontOrbit);
    viewer.setAttribute("camera-target", this.frontTarget);
    viewer.setAttribute("field-of-view", this.frontFieldOfView);
    viewer.setAttribute("min-field-of-view", this.stage.dataset.bodyMinFieldOfView || "18deg");
    viewer.setAttribute("max-field-of-view", this.stage.dataset.bodyMaxFieldOfView || "38deg");
    viewer.setAttribute("shadow-intensity", this.stage.dataset.bodyShadowIntensity || "0.45");
    viewer.setAttribute("environment-image", "neutral");
    if (this.reducedMotion) viewer.setAttribute("interpolation-decay", "0");
    viewer.hidden = true;

    const signal = this.abortController.signal;
    viewer.addEventListener("load", () => this.handleLoad(), { signal });
    viewer.addEventListener("error", (event) => {
      const message = event?.detail?.message || "3D 모델을 불러오지 못했습니다.";
      this.handleError(new Error(message), "model-error");
    }, { signal });

    this.figure.append(viewer);
    this.viewer = viewer;
  }

  moveHotspotsToViewer() {
    for (const button of this.hotspots) {
      this.placeHotspot(button);
      this.viewer.append(button);
    }
  }

  placeHotspot(button) {
    const area = hotspotArea(button);
    if (!area) return;
    const supplied = this.hotspotMap[area] || {};
    const defaults = DEFAULT_BODY_HOTSPOTS[area] || { position: "0m 1m 0.1m", normal: "0m 0m 1m" };
    const original = this.originalAttributes.get(button) || {};
    const position = vectorString(
      button.dataset.bodyPosition || supplied.position || original.position,
      defaults.position,
    );
    const normal = vectorString(
      button.dataset.bodyNormal || supplied.normal || original.normal,
      defaults.normal,
    );
    button.setAttribute("slot", `hotspot-${area}`);
    button.setAttribute("data-position", position);
    button.setAttribute("data-normal", normal);
    button.setAttribute("data-visibility-attribute", "visible");

    if (typeof this.viewer?.updateHotspot === "function") {
      try {
        this.viewer.updateHotspot({ name: `hotspot-${area}`, position, normal });
      } catch {
        // The element attributes remain the source of truth for runtimes that
        // do not expose updateHotspot or have not completed their first load.
      }
    }
  }

  restoreHotspots() {
    for (const button of this.hotspots) {
      const marker = this.placeholders.get(button);
      if (marker?.parentNode) marker.parentNode.insertBefore(button, marker.nextSibling);
      const original = this.originalAttributes.get(button);
      if (!original) continue;
      restoreAttribute(button, "slot", original.slot);
      restoreAttribute(button, "data-position", original.position);
      restoreAttribute(button, "data-normal", original.normal);
      restoreAttribute(button, "data-visible", original.visible);
      restoreAttribute(button, "data-visibility-attribute", original.visibilityAttribute);
    }
  }

  set2D({ announce = true, reason = "api" } = {}) {
    if (this.destroyed) return;
    const changed = this.mode !== "2d";
    this.requestedMode = "2d";
    this.mode = "2d";
    this.observer?.disconnect();
    this.observer = null;
    this.restoreHotspots();
    if (this.viewer) this.viewer.hidden = true;
    this.image.hidden = false;
    restoreAttribute(this.figure, "aria-busy", this.originalFigureBusy);
    this.stage.dataset.body3dState = "2d";
    this.stage.classList.remove("is-body-3d");
    this.stage.classList.add("is-body-2d");
    this.updateControls();
    if (announce) this.status.textContent = "2D 신체 지도를 표시했습니다.";
    if (changed || reason === "user") {
      dispatchStageEvent(this.stage, "body-3d:modechange", {
        controller: this,
        context: this.context,
        mode: "2d",
        reason,
      });
    }
    if (reason === "user") writeViewPreference(this.ownerWindow, "2d");
  }

  updateControls() {
    const is3D = this.mode === "3d";
    this.twoDButton.setAttribute("aria-pressed", String(!is3D));
    this.threeDButton.setAttribute("aria-pressed", String(is3D));
    this.resetButton.hidden = !is3D;
  }

  resetFrontView() {
    if (!this.viewer || this.mode !== "3d") return;
    this.viewer.setAttribute("camera-orbit", this.frontOrbit);
    this.viewer.setAttribute("camera-target", this.frontTarget);
    this.viewer.setAttribute("field-of-view", this.frontFieldOfView);
    if (this.reducedMotion && typeof this.viewer.jumpCameraToGoal === "function") {
      this.viewer.jumpCameraToGoal();
    }
    this.status.textContent = "3D 신체 지도를 정면으로 되돌렸습니다.";
    dispatchStageEvent(this.stage, "body-3d:reset", {
      controller: this,
      context: this.context,
    });
  }

  handleLoad() {
    if (this.destroyed) return;
    this.ready = true;
    this.stage.dataset.body3dState = this.mode === "3d" ? "ready" : "2d";
    restoreAttribute(this.figure, "aria-busy", this.originalFigureBusy);
    this.status.textContent = "3D 신체 지도를 불러왔습니다.";
    dispatchStageEvent(this.stage, "body-3d:ready", {
      controller: this,
      context: this.context,
      viewer: this.viewer,
    });
  }

  handleError(error, reason = "error") {
    const message = error instanceof Error ? error.message : String(error);
    this.set2D({ announce: false, reason });
    this.stage.dataset.body3dState = "error";
    this.stage.classList.add("has-body-3d-error");
    this.status.textContent = `${message} 2D 신체 지도를 표시합니다.`;
    dispatchStageEvent(this.stage, "body-3d:error", {
      controller: this,
      context: this.context,
      error,
      message,
      reason,
    });
  }

  markUnavailable(message) {
    this.requestedMode = "2d";
    this.threeDButton.disabled = true;
    this.threeDButton.title = message;
    this.stage.dataset.body3dState = "unavailable";
    this.status.textContent = message;
    dispatchStageEvent(this.stage, "body-3d:unavailable", {
      controller: this,
      context: this.context,
      message,
    });
  }

  refreshHotspots(hotspots = null) {
    if (hotspots && typeof hotspots === "object" && !Array.isArray(hotspots)) {
      this.hotspotMap = hotspots;
    }
    if (this.mode === "3d") {
      for (const button of this.hotspots) this.placeHotspot(button);
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.requestedMode = "2d";
    this.set2D({ announce: false, reason: "destroy" });
    this.destroyed = true;
    this.observer?.disconnect();
    this.attributeObserver?.disconnect();
    this.abortController.abort();
    this.viewer?.remove();
    this.controls?.remove();
    this.status?.remove();
    for (const marker of this.placeholders.values()) marker.remove();
    this.stage.classList.remove("is-body-2d", "is-body-3d", "has-body-3d-error");
    delete this.stage.dataset.body3dState;
    controllers.delete(this.stage);
  }
}

export function enhanceBodyStage(stage, options = {}) {
  if (!stage) return null;
  const existing = controllers.get(stage);
  if (existing) return existing;
  try {
    const controller = new Body3DController(stage, options);
    controllers.set(stage, controller);
    return controller;
  } catch (error) {
    dispatchStageEvent(stage, "body-3d:error", {
      controller: null,
      context: options.context || stage.dataset?.bodyContext || "shared",
      error,
      message: error instanceof Error ? error.message : String(error),
      reason: "initialization",
    });
    return null;
  }
}

export function initBody3d(root = document, options = {}) {
  if (!root?.querySelectorAll) return [];
  const stages = root.matches?.(BODY_STAGE_SELECTOR)
    ? [root]
    : [...root.querySelectorAll(BODY_STAGE_SELECTOR)];
  return stages.map((stage) => enhanceBodyStage(stage, options)).filter(Boolean);
}

export function getBody3dController(stage) {
  return controllers.get(stage) || null;
}

function autoInit() {
  if (typeof document === "undefined") return;
  const run = () => initBody3d(document);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
}

autoInit();
