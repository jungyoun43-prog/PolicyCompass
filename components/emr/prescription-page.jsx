"use client";

import { useEffect, useRef, useState } from "react";
import { PrescriptionDialog } from "./prescription-dialog.jsx";

const noop = () => {};
export function PrescriptionPage() {
  const [payload, setPayload] = useState(null);
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState("EMR에서 약 처방 버튼을 눌러 이 창을 열어 주세요.");
  const bridge = useRef(null);
  const pending = useRef(null);
  useEffect(() => {
    const token = window.location.hash.slice(1);
    const opener = window.opener;
    if (!token || !opener) return;
    bridge.current = { token, opener };
    let lastSeen = Date.now();
    let disconnected = false;
    const disconnect = () => {
      if (disconnected) return;
      disconnected = true;
      setConnected(false);
      setMessage("원래 EMR과 연결이 종료됐습니다. EMR에서 약 처방 창을 다시 열어 주세요.");
      pending.current?.reject(new Error("EMR 연결이 종료돼 처방을 추가할 수 없습니다."));
      pending.current = null;
    };
    const receive = (event) => {
      if (event.origin !== window.location.origin || event.source !== opener || event.data?.token !== token) return;
      const data = event.data;
      if (data.type === "prescription-pong") lastSeen = Date.now();
      if (data.type === "prescription-context" && data.payload?.patient && data.payload?.encounter) {
        setPayload(data.payload);
        setConnected(true);
        setMessage("");
        lastSeen = Date.now();
        clearTimeout(timeout);
      } else if (data.type === "prescription-disconnected") disconnect();
      else if (data.type === "prescription-result" && data.requestId === pending.current?.id) {
        const request = pending.current;
        pending.current = null;
        if (data.ok) request.resolve();
        else request.reject(new Error(data.error || "처방을 추가하지 못했습니다."));
      }
    };
    window.addEventListener("message", receive);
    const timeout = setTimeout(disconnect, 15000);
    const poll = setInterval(() => {
      if (disconnected) return;
      if (opener.closed || Date.now() - lastSeen > 6000) { disconnect(); return; }
      opener.postMessage({ type: "prescription-ping", token }, window.location.origin);
    }, 1000);
    opener.postMessage({ type: "prescription-ready", token }, window.location.origin);
    return () => { clearTimeout(timeout); clearInterval(poll); window.removeEventListener("message", receive); };
  }, []);
  const submit = (prescription) => new Promise((resolve, reject) => {
    const connection = bridge.current;
    if (!connected || !connection || connection.opener.closed) return reject(new Error("EMR에서 처방 창을 다시 열어 주세요."));
    if (pending.current) return reject(new Error("처방을 저장하고 있습니다."));
    const id = crypto.randomUUID();
    pending.current = { id, resolve, reject };
    connection.opener.postMessage({ type: "prescription-submit", token: connection.token, requestId: id, prescription }, window.location.origin);
  });
  if (!payload) return <main className="coverage-page-empty"><h1>약 처방</h1><p role="status">{message}</p><a href="/emr">EMR로 이동</a></main>;
  return <PrescriptionDialog patient={payload.patient} encounter={payload.encounter} editable={connected}
    activeDialog="prescription" setActiveDialog={noop} registerDirty={noop} setStatus={setMessage}
    prescriptionStandalone onPrescriptionSubmit={submit} onStandaloneClose={() => window.close()}
    windowMessage={message} />;
}
