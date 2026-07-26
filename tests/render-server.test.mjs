import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import test from "node:test";

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startRenderServer(environment = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ["scripts/render-server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, OPENAI_API_KEY: "", PORT: String(port), ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/patient-question-assistant/status`);
      if (response.ok) return { baseUrl, child };
    } catch {
      // Startup polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill("SIGKILL");
  throw new Error("Render server did not start.");
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 1_000)),
  ]);
}

test("production server exposes same-origin patient AI status and keeps credentials server-side", async () => {
  const { baseUrl, child } = await startRenderServer();
  try {
    const statusResponse = await fetch(`${baseUrl}/api/patient-question-assistant/status`);
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json();
    assert.equal(status.frontier.configured, false);
    assert.equal(status.frontier.model, "gpt-5.6-sol");

    const insights = await fetch(`${baseUrl}/insights`);
    assert.match(insights.headers.get("content-security-policy") ?? "", /connect-src 'self'/);
    const emr = await fetch(`${baseUrl}/emr`);
    assert.match(emr.headers.get("content-security-policy") ?? "", /connect-src 'self'/);
    assert.doesNotMatch(emr.headers.get("content-security-policy") ?? "", /https?:\/\//);
    const map = await fetch(`${baseUrl}/map`);
    assert.match(map.headers.get("content-security-policy") ?? "", /connect-src 'none'/);

    const crossOrigin = await fetch(`${baseUrl}/api/patient-question-assistant`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: "{}",
    });
    assert.equal(crossOrigin.status, 403);

    const unconfigured = await fetch(`${baseUrl}/api/patient-question-assistant`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl },
      body: JSON.stringify({ provider: "frontier", consent: true }),
    });
    assert.equal(unconfigured.status, 503);
    assert.equal((await unconfigured.json()).code, "FRONTIER_NOT_CONFIGURED");
  } finally {
    await stop(child);
  }
});
