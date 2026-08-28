import http from "node:http";

import { handleNodeRequest } from "./app-server.mjs";

const port = Number.parseInt(process.env.PORT ?? "10000", 10);

const server = http.createServer(handleNodeRequest);

server.listen(port, "0.0.0.0", () => {
  console.log(`Listening on port ${port}`);
});
