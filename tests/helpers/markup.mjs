import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * The UI contracts these tests guard used to live in static HTML files. After
 * the React migration the same markup lives in JSX sources; this helper reads
 * them and folds JSX attribute spellings back to their HTML forms so the
 * wording and structure assertions keep reading naturally.
 */
const JSX_TO_HTML = [
  [/\bclassName=/g, "class="],
  [/\bhtmlFor=/g, "for="],
  [/\bdefaultChecked\b/g, "checked"],
  [/\bdefaultValue=/g, "value="],
  [/\btabIndex=/g, "tabindex="],
  [/\bmaxLength=/g, "maxlength="],
  [/\bminLength=/g, "minlength="],
  [/\bautoComplete=/g, "autocomplete="],
  [/\bspellCheck=/g, "spellcheck="],
  [/\breadOnly\b/g, "readonly"],
  [/\bcolSpan=/g, "colspan="],
  [/\browSpan=/g, "rowspan="],
  [/\bdateTime=/g, "datetime="],
  [/\bstrokeWidth=/g, "stroke-width="],
  [/\bstrokeLinecap=/g, "stroke-linecap="],
  [/\bstrokeLinejoin=/g, "stroke-linejoin="],
  [/\bstrokeDasharray=/g, "stroke-dasharray="],
  [/\bfillRule=/g, "fill-rule="],
  [/\bclipRule=/g, "clip-rule="],
  [/\bviewBox=/g, "viewBox="],
];

export function jsxToHtmlish(source) {
  let text = source;
  for (const [pattern, replacement] of JSX_TO_HTML) text = text.replace(pattern, replacement);
  return text;
}

const PAGE_FILES = {
  "/": ["app/(gateway)/page.jsx", "app/(gateway)/layout.jsx"],
  "/patient": ["app/(landing)/patient/page.jsx", "app/(landing)/layout.jsx"],
  "/map": ["app/(map)/map/page.jsx", "app/(map)/layout.jsx"],
  "/connections": ["app/(connections)/connections/page.jsx", "app/(connections)/layout.jsx"],
  "/insights": ["app/(insights)/insights/page.jsx", "app/(insights)/layout.jsx"],
  "/journey": ["app/(journey)/journey/page.jsx", "app/(journey)/layout.jsx"],
};

const root = new URL("../..", import.meta.url).pathname;

export async function pageMarkup(route) {
  const files = PAGE_FILES[route];
  if (!files) throw new Error(`알 수 없는 경로: ${route}`);
  const sources = await Promise.all(files.map((file) => readFile(join(root, file), "utf8")));
  return jsxToHtmlish(sources.join("\n"));
}

async function collectJsx(directory) {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectJsx(path));
    else if (/\.(jsx|js)$/.test(entry.name)) files.push(path);
  }
  return files;
}

/** Concatenated EMR component sources, html-ish converted, path-bannered. */
export async function emrMarkup() {
  const files = ["app/(emr)/emr/page.jsx", "app/(emr)/layout.jsx", ...await collectJsx("components/emr")];
  const sources = await Promise.all(files.map(async (file) => `<!-- source:${file} -->\n${await readFile(join(root, file), "utf8")}`));
  return jsxToHtmlish(sources.join("\n"));
}

/** One EMR component source, html-ish converted. */
export async function componentMarkup(relativePath) {
  return jsxToHtmlish(await readFile(join(root, relativePath), "utf8"));
}
