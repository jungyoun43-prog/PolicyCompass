"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  addPatient,
  createDemoEmrState,
  selectPatient,
  updatePatient,
} from "../../src/emr-model.js";
import { claimEvaluationsFor, currentEncounterFor } from "../../lib/emr/selectors.js";
import { useEmrStore } from "./store.js";
import { ClinicalFooter, ClinicalHeader, SafetyNotes } from "./chrome.jsx";
import { Tabs as TabsPrimitive } from "radix-ui";

import { PatientRail } from "./patient-rail.jsx";
import { WorkspaceHeader } from "./workspace-header.jsx";
import { DataUtilities } from "./data-utilities.jsx";
import { EncounterTab } from "./tabs/encounter-tab.jsx";
import { OverviewTab } from "./tabs/overview-tab.jsx";
import { ChartTab } from "./tabs/chart-tab.jsx";
import { BodyTab } from "./tabs/body-tab.jsx";
import { ClaimsTab } from "./tabs/claims-tab.jsx";
import { JourneyTab } from "./tabs/journey-tab.jsx";
import { DataTab } from "./tabs/data-tab.jsx";

export function EmrApp() {
  const store = useEmrStore();
  const { state, status, setStatus, applyMutation, replaceState, ready } = store;
  const [activeTab, setActiveTab] = useState("encounter");
  const [viewedEncounterId, setViewedEncounterId] = useState("");
  const [editRequest, setEditRequest] = useState(null);
  const [ai, setAi] = useState({ checked: false, configured: false, label: "규칙 기반 모드", detail: "연결 확인 중" });
  const [fhirReport, setFhirReport] = useState(null);
  const dirtyGuardsRef = useRef({ encounter: () => false, patientForm: () => false, manualEvent: () => false });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(window.location.hostname);
      try {
        const [copilotResult, reviewResult] = await Promise.all([
          fetch("/api/clinical-copilot/status", { headers: { accept: "application/json" } }).then((res) => (res.ok ? res.json() : {})).catch(() => ({})),
          fetch("/api/medication-claim-review/status", { headers: { accept: "application/json" } }).then((res) => (res.ok ? res.json() : {})).catch(() => ({})),
        ]);
        if (cancelled) return;
        const localConfigured = loopback && copilotResult.configured === true;
        const frontierConfigured = reviewResult.frontier?.configured === true;
        setAi(frontierConfigured
          ? { checked: true, configured: true, label: "AI 검토 모델 연결", detail: reviewResult.frontier.model }
          : localConfigured
            ? { checked: true, configured: true, label: "로컬 AI 연결", detail: copilotResult.model }
            : { checked: true, configured: false, label: "규칙 기반 모드", detail: "모델 미연결" });
      } catch {
        if (!cancelled) setAi({ checked: true, configured: false, label: "규칙 기반 모드", detail: "모델 미연결" });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const patient = useMemo(
    () => state?.patients.find(({ id }) => id === state.selectedPatientId) ?? null,
    [state],
  );
  const encounter = useMemo(
    () => currentEncounterFor(patient, { viewedEncounterId, selectedEncounterId: state?.selectedEncounterId ?? "" }),
    [patient, viewedEncounterId, state],
  );
  const evaluations = useMemo(
    () => (patient && state ? claimEvaluationsFor(patient, state.rules) : []),
    [patient, state],
  );
  const preflightEvaluations = useMemo(
    () => (patient && state
      ? claimEvaluationsFor(patient, state.rules, { includeCurrentDraft: true, encounterId: encounter?.id ?? "" })
      : []),
    [patient, state, encounter],
  );

  /** The pre-React guard: pending clinical input blocks patient/context switches. */
  const blockClinicalContextChange = useCallback(({ patientChanged = false } = {}) => {
    const guards = dirtyGuardsRef.current;
    const hasClinicalComposer = guards.encounter();
    const hasManualEvent = patientChanged && guards.manualEvent();
    if (!hasClinicalComposer && !hasManualEvent) return false;
    setStatus(hasManualEvent
      ? "추가하지 않은 과거 기록 입력이 있습니다. 현재 환자에 추가하거나 입력을 지운 뒤 환자를 전환하세요."
      : "추가하지 않은 측정·진단·처방·오더 입력이 있습니다. 현재 진료에 추가하거나 입력을 지운 뒤 전환·완료·취소하세요.", "error");
    return true;
  }, [setStatus]);

  useEffect(() => {
    const listener = (event) => {
      const guards = dirtyGuardsRef.current;
      if (!guards.patientForm() && !guards.encounter() && !guards.manualEvent()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, []);

  const handleSelectPatient = useCallback(async (patientId) => {
    if (patientId !== state.selectedPatientId && blockClinicalContextChange({ patientChanged: true })) return;
    try {
      await replaceState((current) => selectPatient(current, patientId), { persist: !state.demo });
      setViewedEncounterId("");
      setActiveTab("encounter");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "환자 선택을 저장하지 못했습니다.", "error");
    }
  }, [state, blockClinicalContextChange, replaceState, setStatus]);

  const handleSavePatient = useCallback(async (mode, payload) => {
    if (mode !== "create" && mode !== state.selectedPatientId) {
      throw new Error("편집 대상 환자가 바뀌었습니다. 편집을 취소하고 다시 시작하세요.");
    }
    if (mode === "create") {
      if (patient && blockClinicalContextChange({ patientChanged: true })) {
        throw new Error("현재 환자의 미등록 임상 입력을 먼저 추가하거나 지우세요.");
      }
      await applyMutation((current) => addPatient(current, payload), "환자를 등록했습니다.");
    } else {
      await applyMutation((current) => updatePatient(current, mode, payload), "환자 정보를 수정했습니다.");
    }
  }, [state, patient, blockClinicalContextChange, applyMutation]);

  const handleLoadDemo = useCallback(() => {
    if (blockClinicalContextChange({ patientChanged: true })) return;
    replaceState(() => createDemoEmrState(), {
      persist: false,
      message: "예시 환자를 불러왔습니다. 변경 내용은 저장되지 않습니다.",
    });
    setViewedEncounterId("");
    setActiveTab("encounter");
  }, [blockClinicalContextChange, replaceState]);

  const handleExitDemo = useCallback(() => {
    if (blockClinicalContextChange({ patientChanged: true })) return;
    replaceState(() => store.savedState, { persist: false, message: "내 로컬 기록으로 돌아왔습니다." });
    setViewedEncounterId("");
    setActiveTab("encounter");
  }, [blockClinicalContextChange, replaceState, store.savedState]);

  const selectTab = useCallback((tab, { focus = false } = {}) => {
    setActiveTab(tab);
    if (focus) requestAnimationFrame(() => document.getElementById(`tab-${tab}`)?.focus());
  }, []);

  if (!ready) {
    return (
      <>
        <a className="skip-link" href="#mainContent">본문으로 건너뛰기</a>
        <ClinicalHeader />
        <main className="emr-shell" id="mainContent" aria-busy="true" />
        <ClinicalFooter />
      </>
    );
  }

  const tabProps = {
    state,
    patient,
    encounter,
    evaluations,
    preflightEvaluations,
    ai,
    store,
    viewedEncounterId,
    setViewedEncounterId,
    selectTab,
    dirtyGuardsRef,
    blockClinicalContextChange,
    fhirReport,
    setFhirReport,
  };

  return (
    <>
      <a className="skip-link" href="#mainContent">본문으로 건너뛰기</a>
      <ClinicalHeader demo={state.demo} onExitDemo={handleExitDemo} utilities={<DataUtilities {...tabProps} />} ai={ai} />
      <main className="emr-shell" id="mainContent" inert={store.busy ? "" : undefined} aria-busy={store.busy || undefined}>
        {fhirReport ? (
          <details className="fhir-import-report" id="fhirImportReport">
            <summary><b>FHIR 가져오기 보고서</b><span id="fhirImportReportSummary">외부 미검증 · 지원 {fhirReport.supported}건 · 제외 {fhirReport.unsupported}건</span></summary>
            <ul id="fhirImportIssues">
              <li>가져온 기록의 기관·작성자·전자서명은 검증되지 않았습니다. 타임라인에는 표시되지만 확정 요약·AI·급여 근거에서는 제외됩니다.</li>
              {(fhirReport.unsupportedItems ?? []).map((item, index) => (
                <li key={index}>{item.resourceType}{item.id ? "/" + item.id : ""} · {item.reason}</li>
              ))}
              {fhirReport.unsupportedTruncated ? <li>추가 제외 항목 {fhirReport.unsupportedTruncated}건</li> : null}
            </ul>
          </details>
        ) : null}


        <p className={`workspace-status${status.tone ? " is-" + status.tone : ""}`} id="workspaceStatus" role="status" aria-live="polite">{status.message}</p>

        <div className="clinical-layout">
          <PatientRail
            patients={state.patients}
            selectedPatientId={state.selectedPatientId}
            demo={state.demo}
            updatedAt={state.updatedAt}
            onEditPatient={() => patient && setEditRequest(patient)}
            onSelectPatient={handleSelectPatient}
            onLoadDemo={handleLoadDemo}
            onSavePatient={handleSavePatient}
            editRequest={editRequest}
            onEditConsumed={() => setEditRequest(null)}
            onFormStateChange={({ pending }) => { dirtyGuardsRef.current.patientForm = () => pending; }}
          />

          <section className="patient-workspace" aria-label="선택 환자 차트">
            {!patient ? (
              <div className="workspace-empty" id="workspaceEmpty">
                <img className="workspace-empty__mark" src="/assets/clinical-workspace-empty.png" width={176} height={176} alt="" aria-hidden="true" />
                <h2>환자를 선택하면 진료 화면이 열립니다.</h2>
                <p>차트·신체 지도·급여 보드를 한 화면에서 확인합니다.</p>
              </div>
            ) : (
              <TabsPrimitive.Root asChild value={activeTab} onValueChange={(tab) => selectTab(tab)} activationMode="manual">
              <div id="workspaceContent">
                <WorkspaceHeader
                  patient={patient}
                  activeTab={activeTab}
                  onSelectTab={selectTab}
                />
                <TabsPrimitive.Content asChild forceMount value="encounter"><section className="workspace-panel encounter-panel" id="panel-encounter" data-panel="encounter" hidden={activeTab !== "encounter"}>
                  <EncounterTab {...tabProps} />
                </section></TabsPrimitive.Content>
                <TabsPrimitive.Content asChild forceMount value="overview"><section className="workspace-panel" id="panel-overview" data-panel="overview" hidden={activeTab !== "overview"}>
                  <OverviewTab {...tabProps} />
                </section></TabsPrimitive.Content>
                <TabsPrimitive.Content asChild forceMount value="chart"><section className="workspace-panel" id="panel-chart" data-panel="chart" hidden={activeTab !== "chart"}>
                  <ChartTab {...tabProps} />
                </section></TabsPrimitive.Content>
                <TabsPrimitive.Content asChild forceMount value="graph"><section className="workspace-panel" id="panel-graph" data-panel="graph" hidden={activeTab !== "graph"}>
                  <BodyTab {...tabProps} active={activeTab === "graph"} />
                </section></TabsPrimitive.Content>
                <TabsPrimitive.Content asChild forceMount value="claims"><section className="workspace-panel" id="panel-claims" data-panel="claims" hidden={activeTab !== "claims"}>
                  <ClaimsTab {...tabProps} />
                </section></TabsPrimitive.Content>
                <TabsPrimitive.Content asChild forceMount value="journey"><section className="workspace-panel" id="panel-journey" data-panel="journey" hidden={activeTab !== "journey"}>
                  <JourneyTab {...tabProps} />
                </section></TabsPrimitive.Content>
                <TabsPrimitive.Content asChild forceMount value="data"><section className="workspace-panel" id="panel-data" data-panel="data" hidden={activeTab !== "data"}>
                  <DataTab {...tabProps} />
                </section></TabsPrimitive.Content>
              </div>
              </TabsPrimitive.Root>
            )}
          </section>
        </div>

        <SafetyNotes />
      </main>
      <ClinicalFooter />
    </>
  );
}
