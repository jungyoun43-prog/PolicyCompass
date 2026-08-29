"use client";

import { useEffect } from "react";

/**
 * Runs one of the proven page controllers after the server-rendered markup is
 * on screen — the same load order the static pages had with a deferred module
 * script. The personal pages navigate with full document loads, so each visit
 * evaluates its controller fresh.
 */
const LOADERS = {
  landing: () => import("../src/landing.js"),
  map: () => Promise.all([import("../src/app.js"), import("../src/body-3d.js")]),
  connections: () => import("../src/connections.js"),
  insights: () => import("../src/insights.js"),
  journey: () => import("../src/journey.js"),
};

export function LegacyScript({ page }) {
  useEffect(() => {
    LOADERS[page]?.().catch((error) => {
      console.error(`${page} controller failed to start`, error);
    });
  }, [page]);
  return null;
}
