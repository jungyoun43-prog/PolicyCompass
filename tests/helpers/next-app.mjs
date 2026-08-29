import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import http from "node:http";

const AI_ENV_BLANKS = {
  OPENAI_API_KEY: "",
  OPENROUTER_API_KEY: "",
  POLICYCOMPASS_FRONTIER_MODEL: "",
  POLICYCOMPASS_FRONTIER_API_KEY: "",
  POLICYCOMPASS_FRONTIER_BASE_URL: "",
  POLICYCOMPASS_OLLAMA_MODEL: "",
  POLICYCOMPASS_OLLAMA_URL: "",
};

export async function freePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function ensureBuild() {
  try {
    await access(new URL("../../.next/BUILD_ID", import.meta.url));
    return;
  } catch {
    // fall through to a fresh build
  }
  await new Promise((resolve, reject) => {
    const build = spawn("npx", ["next", "build"], {
      cwd: new URL("../..", import.meta.url),
      stdio: ["ignore", "inherit", "inherit"],
    });
    build.once("error", reject);
    build.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`next build exited with ${code}`))));
  });
}

/**
 * Starts the production Next server on an ephemeral port with AI credentials
 * blanked, so contract tests are hermetic even on machines where a developer
 * has real keys configured. Pass environment overrides to opt features on.
 */
export async function startNextServer(environment = {}) {
  await ensureBuild();
  const port = await freePort();
  // detached: the npx wrapper spawns next-server as a grandchild; killing the
  // whole process group is the only way the runner's stdio pipes ever close.
  const child = spawn("npx", ["next", "start", "-p", String(port)], {
    cwd: new URL("../..", import.meta.url),
    env: { ...process.env, ...AI_ENV_BLANKS, ...environment },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Next 서버 조기 종료: ${output}`);
    try {
      const response = await fetch(`${baseUrl}/api/clinical-copilot/status`);
      if (response.ok) return { baseUrl, child, port };
    } catch {
      // Startup polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill("SIGKILL");
  throw new Error(`Next 서버 시작 시간 초과: ${output}`);
}

function killGroup(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    try { child.kill(signal); } catch { /* already gone */ }
  }
}

export async function stopNextServer(child) {
  if (!child || child.exitCode !== null) return;
  killGroup(child, "SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  killGroup(child, "SIGKILL");
}
