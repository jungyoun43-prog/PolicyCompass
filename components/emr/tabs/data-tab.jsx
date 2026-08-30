"use client";

import { Button } from "@/components/ui/button";

import { clearEmrState, exportEmrBackup, loadEmrState } from "../../../src/emr-model.js";
import { AUDIT_LABELS, downloadJson, downloadText, isClearedEmrState } from "../../../lib/emr/files.js";
import { displayTimestamp, today } from "../../../lib/emr/format.js";

export function DataTab({ state, store, dirtyGuardsRef }) {
  const { setStatus, withTransition, bumpGeneration, replaceState } = store;

  const exportBackup = () => {
    const exportState = state.demo ? store.savedState : state;
    if (exportState.storageError) {
      setStatus("손상된 로컬 저장을 정리하기 전에는 내보낼 수 없습니다.", "error");
      return;
    }
    const guards = dirtyGuardsRef.current;
    if (guards.patientForm() || guards.encounter() || guards.manualEvent()) {
      setStatus("미저장 환자·진료·임상항목·과거기록 입력을 먼저 저장하거나 취소한 뒤 내보내세요.", "error");
      return;
    }
    const persisted = loadEmrState();
    if (persisted.storageError) {
      setStatus("현재 저장 상태를 확인할 수 없어 내보내기를 차단했습니다.", "error");
      return;
    }
    if (isClearedEmrState(persisted) && !isClearedEmrState(exportState)) {
      setStatus("다른 탭에서 전체 삭제가 적용되어 내보내기를 차단했습니다.", "error");
      return;
    }
    if (persisted.revision !== exportState.revision) {
      setStatus("다른 탭의 최신 변경을 먼저 반영한 뒤 내보내세요.", "error");
      return;
    }
    downloadJson(exportEmrBackup(exportState), "policycompass-emr-backup-" + today() + ".json");
    setStatus(state.demo ? "기존 로컬 기록을 백업했습니다." : "전체 로컬 기록을 JSON으로 내보냈습니다.", "success");
  };

  const onWipe = async () => {
    if (!window.confirm("이 브라우저의 PolicyCompass EMR 환자 기록과 기관 규칙을 모두 삭제할까요? 백업 없이는 복구할 수 없습니다.")) return;
    try {
      await withTransition(async () => {
        const cleared = await clearEmrState();
        bumpGeneration();
        await replaceState(() => cleared, { persist: false, message: "이 브라우저의 PolicyCompass EMR 기록을 모두 삭제했습니다." })
          .catch(() => {});
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "로컬 기록을 삭제하지 못했습니다.", "error");
    }
  };

  const audit = [...state.audit].reverse();
  const facts = [
    ["저장 위치", state.demo ? "메모리 전용 예시 환자" : "브라우저 localStorage"],
    ["환자 수", state.patients.length + "명"],
    ["진료 회차", state.patients.reduce((sum, patient) => sum + patient.events.filter((event) => event.type === "encounter").length, 0) + "건"],
    ["임상 이벤트", state.patients.reduce((sum, patient) => sum + patient.events.length, 0) + "건"],
    ["데이터 스키마", `v${state.version} · revision ${state.revision}`],
    ["급여 규칙", state.rules.length + "개"],
    ["마지막 변경", displayTimestamp(state.updatedAt)],
    ["저장 상태", state.storageError ? "복구 필요" : "정상"],
    ["백업 암호화", "없음 · 별도 보호 필요"],
  ];

  return (
    <div className="data-layout">
      <section className="clinical-card" aria-labelledby="auditTitle">
        <div className="card-heading">
          <div><p className="rail-eyebrow">AUDIT TRAIL</p><h3 id="auditTitle">로컬 변경 이력</h3></div>
          <span className="rail-count" id="auditCount">{audit.length}건</span>
        </div>
        <ol className="audit-list" id="auditList">
          {audit.length === 0 ? <p className="summary-empty">아직 로컬 변경 이력이 없습니다.</p> : audit.map((event, index) => (
            <li key={index}>
              <time>{displayTimestamp(event.at)}</time>
              <div>
                <b>{AUDIT_LABELS[event.action] ?? event.action}</b>
                <span>{[event.actor, event.patientId, event.encounterId, event.entityId, event.detail].filter(Boolean).join(" · ")}</span>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section className="clinical-card data-control-card" aria-labelledby="dataControlTitle">
        <div className="card-heading"><div><p className="rail-eyebrow">LOCAL DATA CONTROL</p><h3 id="dataControlTitle">백업과 초기화</h3></div></div>
        <p>브라우저 데이터 삭제·기기 교체에 대비해 암호화된 저장장치에 JSON 백업을 보관하세요. 이 샌드박스 백업 파일 자체는 암호화되지 않습니다.</p>
        <dl className="data-facts" id="dataFacts">
          {facts.map(([term, description]) => (
            <div style={{ display: "contents" }} key={term}><dt>{term}</dt><dd>{description}</dd></div>
          ))}
        </dl>
        <div className="data-actions">
          <Button variant="primary" id="exportEmrSecondary" type="button" onClick={exportBackup}>전체 백업 내보내기</Button>
          <Button id="exportRecoveryRaw" type="button" hidden={!state.recoveryRaw} onClick={() => {
            if (!state.recoveryRaw) {
              setStatus("내보낼 손상 저장 원본이 없습니다.");
              return;
            }
            downloadText(state.recoveryRaw, "policycompass-emr-recovery-raw-" + today() + ".json", "application/json;charset=utf-8");
            setStatus("손상 저장 원본을 변경 없이 내보냈습니다.", "success");
          }}>손상 저장 원본 내보내기</Button>
          <Button variant="danger" id="wipeEmr" type="button" onClick={onWipe}>이 브라우저 기록 모두 삭제</Button>
        </div>
      </section>
    </div>
  );
}
