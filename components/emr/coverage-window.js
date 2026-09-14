/** Transfer the selected chart in memory only, after a same-origin window handshake. */
export function openCoverageWindow(payload) {
  const token = crypto.randomUUID();
  const origin = window.location.origin;
  let child;
  let timeout;
  const receive = (event) => {
    if (event.origin !== origin || event.source !== child || event.data?.token !== token || event.data?.type !== "coverage-ready") return;
    child.postMessage({ type: "coverage-context", token, payload }, origin);
    window.removeEventListener("message", receive);
    clearTimeout(timeout);
  };
  window.addEventListener("message", receive);
  child = window.open(`/emr/coverage#${token}`, `coverage-${token}`, "popup=yes,width=850,height=900,resizable=yes,scrollbars=yes");
  if (!child) {
    window.removeEventListener("message", receive);
    return false;
  }
  timeout = setTimeout(() => window.removeEventListener("message", receive), 60000);
  child.focus();
  return true;
}
