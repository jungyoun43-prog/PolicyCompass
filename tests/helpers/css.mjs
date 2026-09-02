import { readFile } from "node:fs/promises";
import { join } from "node:path";

import postcss from "postcss";

/**
 * Structural access to a stylesheet for tests. A regex over CSS text breaks
 * on reformatting and cannot tell which of several same-selector rules wins;
 * these helpers parse the sheet once and answer the questions tests actually
 * ask: "which declarations does this selector end up with, in this container?"
 */
const root = new URL("../..", import.meta.url).pathname;
const cache = new Map();

export async function stylesheet(relativePath) {
  if (!cache.has(relativePath)) {
    cache.set(relativePath, postcss.parse(await readFile(join(root, relativePath), "utf8")));
  }
  return cache.get(relativePath);
}

function containerOf(rule) {
  const parts = [];
  let node = rule.parent;
  while (node && node.type !== "root") {
    if (node.type === "atrule") parts.unshift(`@${node.name} ${node.params}`.trim());
    node = node.parent;
  }
  return parts.join(" ");
}

const normalize = (selector) => selector.replace(/\s+/g, " ").trim();

/**
 * Every rule whose selector list contains `selector`, optionally restricted to
 * rules inside a container such as "@media (max-width: 620px)". Returned in
 * source order, so the last entry is the one that wins ties.
 */
export function rulesFor(sheet, selector, { container = "" } = {}) {
  const wanted = normalize(selector);
  const matches = [];
  sheet.walkRules((rule) => {
    if (rule.parent.type === "atrule" && /keyframes/.test(rule.parent.name)) return;
    if (!rule.selectors.map(normalize).includes(wanted)) return;
    if (container && !containerOf(rule).includes(container)) return;
    if (!container && containerOf(rule)) return;
    matches.push(rule);
  });
  return matches;
}

/**
 * The declarations `selector` ends up with in the given container, later
 * same-selector rules overriding earlier ones. Returns { prop: value }.
 */
export function declarationsFor(sheet, selector, options = {}) {
  const declarations = {};
  for (const rule of rulesFor(sheet, selector, options)) {
    rule.walkDecls((decl) => { declarations[decl.prop] = decl.value; });
  }
  return declarations;
}

/** Whether any rule for `selector` exists (optionally within a container). */
export function hasRule(sheet, selector, options = {}) {
  return rulesFor(sheet, selector, options).length > 0;
}

/** All selectors anywhere in the sheet that match `pattern` (string or RegExp). */
export function selectorsMatching(sheet, pattern) {
  const found = [];
  sheet.walkRules((rule) => {
    for (const selector of rule.selectors.map(normalize)) {
      if (typeof pattern === "string" ? selector.includes(pattern) : pattern.test(selector)) found.push(selector);
    }
  });
  return found;
}
