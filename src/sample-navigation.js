const PERSONAL_SAMPLE_PATHS = new Set(["/map", "/connections", "/insights", "/journey"]);

export function preserveSampleNavigation(enabled) {
  if (!enabled) return;
  for (const link of document.querySelectorAll("a[href]")) {
    const rawHref = link.getAttribute("href");
    if (!rawHref) continue;
    const url = new URL(rawHref, window.location.origin);
    if (url.origin !== window.location.origin || !PERSONAL_SAMPLE_PATHS.has(url.pathname)) continue;
    url.searchParams.set("sample", "1");
    link.setAttribute("href", `${url.pathname}${url.search}${url.hash}`);
  }
}
