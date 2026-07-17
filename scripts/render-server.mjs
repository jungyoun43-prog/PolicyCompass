import http from "node:http";

import worker from "../dist/server/index.js";

const port = Number.parseInt(process.env.PORT ?? "10000", 10);

const server = http.createServer((request, response) => {
  void (async () => {
    const host = request.headers.host ?? `127.0.0.1:${port}`;
    const url = new URL(request.url ?? "/", `http://${host}`);
    const workerResponse = await worker.fetch(
      new Request(url, { method: request.method ?? "GET" }),
    );
    response.writeHead(workerResponse.status, Object.fromEntries(workerResponse.headers));
    response.end(Buffer.from(await workerResponse.arrayBuffer()));
  })().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown server error";
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end(message);
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Listening on port ${port}`);
});
