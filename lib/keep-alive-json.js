// JSON permits leading whitespace. Pulse while the model runs so the load
// balancer's idle timeout does not cut off an otherwise active translation.
export function keepAliveJson(task, { signal, intervalMs = 10_000 } = {}) {
  const encoder = new TextEncoder();
  let stopped = false, timer, abort;
  const stop = () => {
    stopped = true;
    clearInterval(timer);
    if (abort) signal?.removeEventListener("abort", abort);
  };
  const body = new ReadableStream({
    start(controller) {
      if (signal?.aborted) { stop(); controller.close(); return; }
      abort = () => { if (!stopped) { stop(); controller.close(); } };
      signal?.addEventListener("abort", abort, { once: true });
      controller.enqueue(encoder.encode("\n"));
      timer = setInterval(() => { if (!stopped) controller.enqueue(encoder.encode("\n")); }, intervalMs);
      Promise.resolve().then(task).then(async response => {
        const result = new Uint8Array(await response.arrayBuffer());
        if (!stopped) { stop(); controller.enqueue(result); controller.close(); }
      }).catch(error => {
        if (!stopped) { stop(); controller.error(error); }
      });
    },
    cancel() { stop(); },
  });
  return new Response(body, { headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store, no-transform",
    "content-encoding": "identity",
    "x-accel-buffering": "no",
  } });
}
