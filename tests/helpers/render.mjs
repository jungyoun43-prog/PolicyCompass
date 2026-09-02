import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Renders a component the way the server does and returns the HTML the
 * browser would receive. Effects do not run, so this tests markup, wording
 * and structure for given props — the contract a source-regex test only
 * approximates. Needs the JSX hooks from register-jsx.mjs to be active.
 */
export function renderComponent(Component, props = {}) {
  return renderToStaticMarkup(createElement(Component, props));
}

const PAGES = {
  "/": () => import("../../app/(gateway)/page.jsx"),
  "/patient": () => import("../../app/(landing)/patient/page.jsx"),
  "/map": () => import("../../app/(map)/map/page.jsx"),
  "/connections": () => import("../../app/(connections)/connections/page.jsx"),
  "/insights": () => import("../../app/(insights)/insights/page.jsx"),
  "/journey": () => import("../../app/(journey)/journey/page.jsx"),
  "/emr": () => import("../../app/(emr)/emr/page.jsx"),
};

/** Server-renders a route's page component (not its layout, which needs a request). */
export async function renderPage(route) {
  const load = PAGES[route];
  if (!load) throw new Error(`알 수 없는 경로: ${route}`);
  const { default: Page } = await load();
  return renderComponent(Page);
}

/** The opening tag of the element with `id` in rendered HTML, or "" when absent. */
export function openingTag(html, id) {
  return html.match(new RegExp(`<[a-z0-9]+[^>]*\\bid="${id}"[^>]*>`))?.[0] ?? "";
}
