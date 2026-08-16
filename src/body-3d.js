const BODY_STAGE_SELECTOR = ".body-stage[data-body-3d]";
const MODEL_VIEWER_TAG = "model-viewer";
const STYLE_ID = "vitagraph-body-3d-styles";
const controllers = new WeakMap();

export const CLINICAL_BODY_PALETTE = Object.freeze({
  body: "#98a6a2",
  brain: "#9b89aa",
  lung: "#b66f79",
  heart: "#994954",
  liver: "#8e5b47",
  stomach: "#b47761",
  kidney: "#7f596c",
  intestines: "#ad8155",
});

export const CLINICAL_ORGAN_NODES = Object.freeze([
  "Organ_Brain",
  "Organ_Lung_L",
  "Organ_Lung_R",
  "Organ_Heart",
  "Organ_Liver",
  "Organ_Stomach",
  "Organ_Kidney_L",
  "Organ_Kidney_R",
  "Organ_Intestines",
]);

const ORGAN_ROLE_BY_NODE = Object.freeze({
  organ_brain: "brain",
  organ_lung_l: "lung",
  organ_lung_r: "lung",
  organ_heart: "heart",
  organ_liver: "liver",
  organ_stomach: "stomach",
  organ_kidney_l: "kidney",
  organ_kidney_r: "kidney",
  organ_intestines: "intestines",
});

export function classifyClinicalPartName(name) {
  const normalized = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized) return "";
  if (normalized === "clinicalbody" || normalized.startsWith("clinicalbody")
    || normalized.startsWith("clinical_body") || normalized.includes("bodymatte")) {
    return "body";
  }
  for (const [nodeName, role] of Object.entries(ORGAN_ROLE_BY_NODE)) {
    if (normalized === nodeName || normalized.startsWith(`${nodeName}_`) || normalized.endsWith(`_${nodeName}`)) {
      return role;
    }
  }
  return "";
}

export function collectClinicalMaterialRoles(gltf = {}) {
  const roleByMaterial = new Map();
  const nodeNamesByMaterial = new Map();
  const meshes = Array.isArray(gltf.meshes) ? gltf.meshes : [];
  const nodes = Array.isArray(gltf.nodes) ? gltf.nodes : [];

  for (const node of nodes) {
    const role = classifyClinicalPartName(node?.name);
    const mesh = Number.isInteger(node?.mesh) ? meshes[node.mesh] : null;
    if (!role || !Array.isArray(mesh?.primitives)) continue;
    for (const primitive of mesh.primitives) {
      if (!Number.isInteger(primitive?.material)) continue;
      const currentRole = roleByMaterial.get(primitive.material);
      if (!currentRole || currentRole === role) roleByMaterial.set(primitive.material, role);
      else roleByMaterial.set(primitive.material, "mixed");
      const names = nodeNamesByMaterial.get(primitive.material) || [];
      names.push(String(node.name));
      nodeNamesByMaterial.set(primitive.material, names);
    }
  }

  const materials = Array.isArray(gltf.materials) ? gltf.materials : [];
  for (let materialIndex = 0; materialIndex < materials.length; materialIndex += 1) {
    if (roleByMaterial.has(materialIndex)) continue;
    const role = classifyClinicalPartName(materials[materialIndex]?.name);
    if (role) roleByMaterial.set(materialIndex, role);
  }

  return [...roleByMaterial.entries()]
    .filter(([, role]) => role !== "mixed")
    .map(([materialIndex, role]) => Object.freeze({
      materialIndex,
      role,
      nodeNames: Object.freeze([...(nodeNamesByMaterial.get(materialIndex) || [])]),
    }))
    .sort((left, right) => left.materialIndex - right.materialIndex);
}

/**
 * Default positions assume an upright, Y-up human model measuring about 1.8 m,
 * centred on X=0 with its front facing +Z. A model-specific map can be supplied
 * with data-body-hotspots JSON or data-position/data-normal on each button.
 */
export const DEFAULT_BODY_HOTSPOTS = Object.freeze({
  neuro: Object.freeze({ position: "0m 1.700471m 0.127357m", normal: "0m -0.031234m 0.999512m" }),
  mental: Object.freeze({ position: "-0.045881m 1.612608m 0.106694m", normal: "-0.672362m -0.207114m 0.710657m" }),
  sensory: Object.freeze({ position: "0.045364m 1.602123m 0.103617m", normal: "0.74119m -0.258962m 0.619336m" }),
  cardio: Object.freeze({ position: "0.040251m 1.267674m 0.114577m", normal: "0.032159m 0.142488m 0.989274m" }),
  respiratory: Object.freeze({ position: "-0.075211m 1.341651m 0.102501m", normal: "-0.014847m 0.229358m 0.973229m" }),
  digestive: Object.freeze({ position: "0.033391m 1.069086m 0.109779m", normal: "0.16129m 0.017887m 0.986745m" }),
  endocrine: Object.freeze({ position: "0m 1.457834m 0.055641m", normal: "0m 0.571657m 0.820493m" }),
  renal: Object.freeze({ position: "-0.090459m 1.036107m 0.090562m", normal: "-0.380413m -0.04878m 0.923529m" }),
  pelvic: Object.freeze({ position: "0.097345m 0.788257m 0.075701m", normal: "-0.217139m -0.098761m 0.971132m" }),
  musculoskeletal: Object.freeze({ position: "-0.123453m 1.358282m 0.088196m", normal: "-0.698065m 0.214793m 0.683059m" }),
  rheumatology: Object.freeze({ position: "0.148136m 0.498407m 0.054939m", normal: "-0.292484m -0.107901m 0.950163m" }),
  dermatology: Object.freeze({ position: "0.445189m 1.165366m 0.157094m", normal: "-0.431618m 0.509806m 0.74418m" }),
});

const BODY_3D_CSS = `
  .body-stage[data-body-3d].is-body-3d {
    background:
      radial-gradient(ellipse at 50% 37%, rgb(255 255 255 / 98%) 0 17%, rgb(241 246 244 / 88%) 44%, transparent 70%),
      linear-gradient(180deg, #f2f6f4 0%, #e6eeea 68%, #dce7e2 100%);
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--line, #d5dde6) 72%, transparent),
      inset 0 -64px 104px rgb(33 66 63 / 8%);
  }

  .body-stage[data-body-3d].is-body-3d::before {
    z-index: 0;
    inset: 6% 17% 15%;
    width: auto;
    height: auto;
    border: 0;
    border-radius: 50%;
    background:
      radial-gradient(ellipse at 50% 42%, rgb(255 255 255 / 68%) 0 24%, rgb(188 211 203 / 26%) 58%, transparent 74%);
    opacity: 1;
  }

  .body-stage[data-body-3d].is-body-3d::after {
    z-index: 0;
    inset: auto 16% 6%;
    width: auto;
    height: 11%;
    border: 0;
    border-radius: 50%;
    background: radial-gradient(ellipse, rgb(24 54 51 / 22%) 0%, rgb(36 72 68 / 8%) 46%, transparent 72%);
    filter: blur(10px);
    opacity: 0.78;
    transform: none;
  }

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
    color: var(--ink, #172431);
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
    transform: scale(1.08) !important;
  }

  .body-stage[data-body-3d].is-body-3d model-viewer .body-hotspot::before {
    width: 40px;
    height: 40px;
    border-color: color-mix(in srgb, currentColor 26%, transparent);
    background: radial-gradient(circle, color-mix(in srgb, currentColor 16%, transparent), transparent 67%);
  }

  .body-stage[data-body-3d].is-body-3d model-viewer .body-hotspot.is-current::before {
    transform: scale(1.02);
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
    .body-stage[data-body-3d].is-body-3d::before {
      inset-inline: 7%;
    }

    .body-stage[data-body-3d].is-body-3d::after {
      inset-inline: 8%;
    }
  }

  @media (prefers-reduced-motion: reduce) {
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

function prefersReducedMotion(ownerWindow) {
  return Boolean(ownerWindow?.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
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

function numberString(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(fallback);
  return String(Math.min(maximum, Math.max(minimum, number)));
}

function toneMappingValue(value) {
  const supported = new Set(["auto", "aces", "agx", "commerce", "neutral", "reinhard", "cineon", "linear", "none"]);
  const normalized = String(value || "neutral").toLowerCase();
  return supported.has(normalized) ? normalized : "neutral";
}

function hotspotArea(button) {
  return button.dataset.area || button.dataset.bodyArea || "";
}

function restoreAttribute(element, name, value) {
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
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
    this.initialOrbit = options.initialOrbit || stage.dataset.bodyInitialCameraOrbit || "0deg 87deg 4.45m";
    this.frontTarget = options.frontTarget || stage.dataset.bodyCameraTarget || "0m 0.91m 0m";
    this.frontFieldOfView = options.frontFieldOfView || stage.dataset.bodyFieldOfView || "24deg";
    this.toneMapping = toneMappingValue(options.toneMapping || stage.dataset.bodyToneMapping);
    this.exposure = numberString(options.exposure || stage.dataset.bodyExposure, 0.9, 0.5, 2);
    this.shadowIntensity = numberString(
      options.shadowIntensity || stage.dataset.bodyShadowIntensity,
      1.12,
      0,
      2,
    );
    this.shadowSoftness = numberString(
      options.shadowSoftness || stage.dataset.bodyShadowSoftness,
      0.68,
      0,
      1,
    );
    this.materialTreatment = String(
      options.materialTreatment || stage.dataset.bodyMaterialTreatment || "clinical-neutral",
    ).toLowerCase();
    this.bodyMaterials = [];
    this.organMaterials = [];
    this.clinicalMaterialStates = new Map();
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
    this.createStatus();
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

  createStatus() {
    const status = this.ownerDocument.createElement("p");
    status.className = "body-3d-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    this.stage.append(status);
    this.status = status;

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

    this.figure.setAttribute("aria-busy", "true");
    this.status.textContent = "3D 신체 지도를 준비하고 있습니다.";

    this.activationPromise = (async () => {
      try {
        await waitForModelViewer(this.ownerWindow, this.runtimeModule);
        if (this.destroyed || this.requestedMode !== "3d") return false;
        this.mountViewer();
        this.mode = "3d";
        this.stage.dataset.body3dState = this.ready ? "ready" : "loading";
        this.stage.dataset.body3dPresentation = "clinical";
        this.stage.classList.remove("is-body-2d");
        this.stage.classList.remove("has-body-3d-error");
        this.stage.classList.add("is-body-3d");
        this.image.hidden = true;
        this.viewer.hidden = false;
        this.moveHotspotsToViewer();
        this.status.textContent = this.ready
          ? "3D 신체 지도를 표시했습니다."
          : "3D 신체 지도를 불러오고 있습니다.";
        dispatchStageEvent(this.stage, "body-3d:modechange", {
          controller: this,
          context: this.context,
          mode: "3d",
          reason,
        });
        return true;
      } catch (error) {
        this.handleError(error, reason);
        return false;
      } finally {
        this.activationPromise = null;
        if (!this.destroyed) restoreAttribute(this.figure, "aria-busy", this.originalFigureBusy);
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
    viewer.setAttribute("loading", "eager");
    viewer.setAttribute("reveal", "auto");
    viewer.setAttribute("interaction-prompt", "none");
    viewer.setAttribute("touch-action", "pan-y");
    viewer.setAttribute("disable-tap", "");
    viewer.setAttribute("camera-orbit", this.initialOrbit);
    viewer.setAttribute("camera-target", this.frontTarget);
    viewer.setAttribute("field-of-view", this.frontFieldOfView);
    viewer.setAttribute("min-field-of-view", this.stage.dataset.bodyMinFieldOfView || "20deg");
    viewer.setAttribute("max-field-of-view", this.stage.dataset.bodyMaxFieldOfView || "36deg");
    viewer.setAttribute("shadow-intensity", this.shadowIntensity);
    viewer.setAttribute("shadow-softness", this.shadowSoftness);
    viewer.setAttribute("exposure", this.exposure);
    viewer.setAttribute("tone-mapping", this.toneMapping);
    viewer.setAttribute("environment-image", "neutral");
    if (this.reducedMotion) viewer.setAttribute("interpolation-decay", "0");
    viewer.hidden = true;

    const signal = this.abortController.signal;
    viewer.addEventListener("load", () => { void this.handleLoad(); }, { signal });
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
    if (announce) this.status.textContent = "2D 신체 지도를 표시했습니다.";
    if (changed || reason === "user") {
      dispatchStageEvent(this.stage, "body-3d:modechange", {
        controller: this,
        context: this.context,
        mode: "2d",
        reason,
      });
    }
  }

  async discoverClinicalMaterials() {
    const materials = this.viewer?.model?.materials;
    if (!Array.isArray(materials)) return;
    await Promise.all(materials.map(async (material) => {
      if (typeof material?.ensureLoaded === "function") await material.ensureLoaded();
    }));
    const mappedRoles = collectClinicalMaterialRoles(this.viewer?.originalGltfJson || {});
    const roleByMaterial = new Map(mappedRoles.map(({ materialIndex, role }) => [materialIndex, role]));

    this.bodyMaterials = [];
    this.organMaterials = [];
    this.clinicalMaterialStates.clear();

    for (let materialIndex = 0; materialIndex < materials.length; materialIndex += 1) {
      const material = materials[materialIndex];
      const role = roleByMaterial.get(materialIndex) || classifyClinicalPartName(material?.name);
      if (!role || role === "mixed") continue;
      const pbr = material?.pbrMetallicRoughness;
      if (!pbr) continue;
      const state = Object.freeze({
        material,
        materialIndex,
        role,
        originalColor: Object.freeze([...pbr.baseColorFactor]),
        originalAlphaMode: typeof material.getAlphaMode === "function" ? material.getAlphaMode() : "OPAQUE",
        originalAlphaCutoff: typeof material.getAlphaCutoff === "function" ? material.getAlphaCutoff() : 0.5,
      });
      this.clinicalMaterialStates.set(material, state);
      if (role === "body") this.bodyMaterials.push(state);
      else if (CLINICAL_BODY_PALETTE[role]) this.organMaterials.push(state);
    }

    const organNodeNames = new Set(
      mappedRoles
        .filter(({ role }) => role !== "body")
        .flatMap(({ nodeNames }) => nodeNames),
    );
    this.stage.dataset.body3dOrganNodes = String(organNodeNames.size);
    this.stage.dataset.body3dOrganMaterials = String(this.organMaterials.length);
  }

  setMaterialAppearance(state, color, alpha, roughness, { discard = false } = {}) {
    const { material } = state;
    const pbr = material?.pbrMetallicRoughness;
    if (!pbr) return false;
    try {
      pbr.setBaseColorFactor(color);
      const adjustedColor = [...pbr.baseColorFactor];
      pbr.setBaseColorFactor([
        adjustedColor[0],
        adjustedColor[1],
        adjustedColor[2],
        alpha,
      ]);
      pbr.setMetallicFactor(0);
      pbr.setRoughnessFactor(roughness);
      if (typeof material.setAlphaMode === "function") {
        material.setAlphaMode(discard ? "MASK" : (alpha < 1 ? "BLEND" : state.originalAlphaMode));
      }
      if (typeof material.setAlphaCutoff === "function") {
        material.setAlphaCutoff(discard ? 1 : state.originalAlphaCutoff);
      }
      return true;
    } catch {
      return false;
    }
  }

  async applyClinicalMaterials() {
    await this.discoverClinicalMaterials();
    const hasOrgans = this.organMaterials.length > 0;
    const bodyColor = this.options.bodyColor
      || this.stage.dataset.bodySurfaceColor
      || CLINICAL_BODY_PALETTE.body;
    const configuredBodyOpacity = Number(
      this.options.bodyOpacity ?? this.stage.dataset.bodySurfaceOpacity,
    );
    const bodyOpacity = hasOrgans
      ? (Number.isFinite(configuredBodyOpacity) ? Math.min(0.64, Math.max(0.34, configuredBodyOpacity)) : 0.54)
      : 1;
    let changed = 0;

    if (this.materialTreatment !== "original") {
      for (const state of this.bodyMaterials) {
        if (this.setMaterialAppearance(state, bodyColor, bodyOpacity, 0.78)) changed += 1;
      }
      for (const state of this.organMaterials) {
        const color = CLINICAL_BODY_PALETTE[state.role];
        if (this.setMaterialAppearance(
          state,
          color,
          1,
          0.7,
        )) changed += 1;
      }
    } else {
      for (const state of this.organMaterials) {
        const alpha = state.originalColor[3] ?? 1;
        if (this.setMaterialAppearance(
          state,
          state.originalColor,
          alpha,
          state.material.pbrMetallicRoughness.roughnessFactor,
        )) {
          changed += 1;
        }
      }
    }

    this.viewer.dataset.bodyMaterialTreatment = hasOrgans ? "clinical-layered" : "clinical-neutral";
    const organsState = hasOrgans ? "visible" : "unsupported";
    this.stage.dataset.body3dOrgans = organsState;
    this.viewer.dataset.bodyOrgans = organsState;
    return changed;
  }

  async handleLoad() {
    if (this.destroyed) return;
    let adjustedMaterials;
    try {
      adjustedMaterials = await this.applyClinicalMaterials();
    } catch (error) {
      this.handleError(error, "material-error");
      return;
    }
    if (this.destroyed) return;
    this.ready = true;
    this.stage.dataset.body3dState = this.mode === "3d" ? "ready" : "2d";
    this.stage.dataset.body3dMaterials = String(adjustedMaterials);
    restoreAttribute(this.figure, "aria-busy", this.originalFigureBusy);
    this.status.textContent = "3D 신체 지도를 불러왔습니다.";
    dispatchStageEvent(this.stage, "body-3d:ready", {
      controller: this,
      context: this.context,
      viewer: this.viewer,
      adjustedMaterials,
      organMaterials: this.organMaterials.length,
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
    this.status?.remove();
    for (const marker of this.placeholders.values()) marker.remove();
    this.stage.classList.remove("is-body-2d", "is-body-3d", "has-body-3d-error");
    delete this.stage.dataset.body3dState;
    delete this.stage.dataset.body3dPresentation;
    delete this.stage.dataset.body3dMaterials;
    delete this.stage.dataset.body3dOrgans;
    delete this.stage.dataset.body3dOrganNodes;
    delete this.stage.dataset.body3dOrganMaterials;
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
