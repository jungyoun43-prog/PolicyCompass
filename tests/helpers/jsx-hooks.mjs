import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { transform } from "esbuild";

/**
 * Module hooks that let the Node test runner import the React components as
 * they are written: `.jsx` is compiled on the fly with esbuild, the Next.js
 * `@/` alias resolves to the project root, and stylesheet imports become empty
 * modules. Registered from register-jsx.mjs via `node --import`.
 */
const root = new URL("../../", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const target = new URL(specifier.slice(2), root);
    for (const suffix of ["", ".jsx", ".js"]) {
      try {
        return await nextResolve(`${target.href}${suffix}`, context);
      } catch {
        // try the next extension
      }
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".css")) return { format: "module", source: "export default {};", shortCircuit: true };
  if (!url.endsWith(".jsx")) return nextLoad(url, context);
  const source = await readFile(fileURLToPath(url), "utf8");
  const { code } = await transform(source, {
    loader: "jsx",
    jsx: "automatic",
    format: "esm",
    sourcefile: fileURLToPath(url),
    sourcemap: "inline",
  });
  return { format: "module", source: code, shortCircuit: true };
}

export { pathToFileURL };
