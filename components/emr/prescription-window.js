export function prescriptionWindowFeatures(host = window) {
  const screen = host.screen || {};
  const availableWidth = screen.availWidth || host.outerWidth || 1152;
  const availableHeight = screen.availHeight || host.outerHeight || 1016;
  const width = Math.max(100, Math.min(1120, availableWidth - 32));
  const height = Math.max(100, Math.min(920, availableHeight - 96));
  const left = Math.round((screen.availLeft ?? host.screenX ?? 0) + (availableWidth - width) / 2);
  const top = Math.round((screen.availTop ?? host.screenY ?? 0) + (availableHeight - height - 64) / 2);
  return `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`;
}

/** Keep mutations in the originating EMR; only structured prescription data crosses windows. */
export function openPrescriptionWindow(payload, onSubmit) {
  const token = crypto.randomUUID();
  const origin = window.location.origin;
  const child = window.open(`/emr/prescription#${token}`, `prescription-${token}`, prescriptionWindowFeatures());
  if (!child) return null;
  let disposed = false;
  const requests = new Map();
  const send = (message) => { if (!child.closed) child.postMessage({ ...message, token }, origin); };
  const receive = async (event) => {
    if (disposed || event.origin !== origin || event.source !== child || event.data?.token !== token) return;
    if (event.data.type === "prescription-ready") send({ type: "prescription-context", payload });
    if (event.data.type === "prescription-ping") send({ type: "prescription-pong" });
    if (event.data.type !== "prescription-submit" || typeof event.data.requestId !== "string") return;
    const { requestId, prescription } = event.data;
    if (!requests.has(requestId)) {
      requests.set(requestId, Promise.resolve().then(() => onSubmit(prescription)).then(
        () => ({ ok: true }),
        (error) => ({ ok: false, error: error instanceof Error ? error.message : "처방을 추가하지 못했습니다." }),
      ));
    }
    send({ type: "prescription-result", requestId, ...await requests.get(requestId) });
  };
  const dispose = () => {
    if (disposed) return;
    send({ type: "prescription-disconnected" });
    disposed = true;
    clearInterval(poll);
    window.removeEventListener("message", receive);
    window.removeEventListener("pagehide", dispose);
  };
  const poll = setInterval(() => { if (child.closed) dispose(); }, 1000);
  window.addEventListener("message", receive);
  window.addEventListener("pagehide", dispose);
  child.focus();
  return { dispose, focus: () => child.focus(), get closed() { return child.closed || disposed; } };
}
