import { cp, mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Build an isolated copy: production API routes and nonce middleware stay intact.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stage = path.join(root, "outputs", `static-demo-${Date.now()}`);
await mkdir(stage, { recursive: true });
for (const name of ["app", "components", "lib", "public", "src", "scripts", "package.json", "package-lock.json", "postcss.config.mjs", "jsconfig.json"]) {
  await cp(path.join(root, name), path.join(stage, name), {
    recursive: true,
    filter: (source) => source !== path.join(root, "app", "api"),
  });
}
await symlink(path.join(root, "node_modules"), path.join(stage, "node_modules"), process.platform === "win32" ? "junction" : "dir");
await writeFile(path.join(stage, "next.config.mjs"), 'export default { output: "export", trailingSlash: true, poweredByHeader: false, images: { unoptimized: true } };\n');
const shellPath = path.join(stage, "components", "root-shell.jsx");
const shell = (await readFile(shellPath, "utf8"))
  .replace('import { headers } from "next/headers";', "")
  .replace("  await headers();", "");
// Match the existing multiline body without altering page layouts.
await writeFile(shellPath, shell.replace("<body className={bodyClassName}>", '<body className={bodyClassName}>\n        <aside aria-label="데모 안내" style={{ padding: "8px 16px", background: "#fff4d6", color: "#41330d", fontSize: "13px", textAlign: "center" }}>정적 데모 · AI 서버 기능은 제공하지 않습니다. 실제 환자정보를 입력하지 마세요.</aside>'));
const unavailable = { local: { configured: false, model: "" }, frontier: { configured: false, model: "" }, configured: false, mode: "rule-based", model: "", staticDemo: true };
for (const endpoint of ["clinical-copilot/status", "medication-claim-review/status", "patient-question-assistant/status"]) {
  const target = path.join(stage, "app", "api", endpoint);
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, "route.js"), `export const dynamic = "force-static";\nexport function GET() { return Response.json(${JSON.stringify(unavailable)}); }\n`);
}
const result = spawnSync(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "build"], {
  cwd: stage, stdio: "inherit", windowsHide: true,
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
});
if (result.status !== 0) process.exit(result.status ?? 1);
await writeFile(path.join(root, "outputs", "static-demo-build.json"), JSON.stringify({ source: stage, directory: path.join(stage, "out"), builtAt: new Date().toISOString() }, null, 2));
console.log(`Static demo ready: ${path.join(stage, "out")}`);
