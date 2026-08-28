import { handleNodeRequest } from "../scripts/app-server.mjs";

export const config = { runtime: "nodejs" };

/**
 * Vercel Serverless Function entry point. `vercel.json` rewrites every route here,
 * so this handler serves both the built pages and the same-origin AI APIs.
 */
export default function handler(request, response) {
  handleNodeRequest(request, response);
}
