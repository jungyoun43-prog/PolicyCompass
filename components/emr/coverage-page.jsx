"use client";

import { useEffect, useState } from "react";
import { PrescriptionDialog } from "./prescription-dialog.jsx";

const noop = () => {};
export function CoveragePage() {
  const [payload, setPayload] = useState(null);
  const [message, setMessage] = useState("EMR의 약 검색 결과에서 급여인정확인을 누르면 선택한 환자와 약의 검토가 이 창에 표시됩니다.");
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    const token = window.location.hash.slice(1);
    const opener = window.opener;
    if (!token || !opener) {
      return;
    }
    const receive = (event) => {
      if (event.origin !== window.location.origin || event.source !== opener || event.data?.token !== token || event.data?.type !== "coverage-context") return;
      const context = event.data.payload;
      if (!context?.patient || !context?.medicationId) return;
      setPayload(context);
      setMessage("");
      clearTimeout(timeout);
      window.removeEventListener("message", receive);
      // Once received, the review owns its state and no longer needs the EMR window.
      window.opener = null;
      window.history.replaceState(null, "", window.location.pathname);
    };
    window.addEventListener("message", receive);
    const timeout = setTimeout(() => setMessage("정보를 받지 못했습니다. EMR에서 검토 창을 다시 열어 주세요."), 15000);
    opener.postMessage({ type: "coverage-ready", token }, window.location.origin);
    return () => { clearTimeout(timeout); window.removeEventListener("message", receive); };
  }, []);
  if (!payload || closed) return <main className="coverage-page-empty"><h1>급여인정확인</h1><p>{closed ? "검토 창을 닫았습니다." : message}</p><a href="/emr">EMR로 이동</a></main>;
  return <>
    <PrescriptionDialog patient={payload.patient} encounter={payload.encounter} editable={false}
      applyMutation={noop} withDraftPreserved={noop} registerDirty={noop}
      setStatus={setMessage} activeDialog="prescription" setActiveDialog={noop}
      standalone initialCoverage={payload}
      onStandaloneClose={() => { setClosed(true); window.close(); }} />
    <span className="visually-hidden" role="status">{message}</span>
  </>;
}
