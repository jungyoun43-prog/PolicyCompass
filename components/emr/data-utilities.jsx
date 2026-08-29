"use client";

import { useRef, useState } from "react";

import {
  addPatient,
  appendStateAudit,
  loadEmrState,
  parseEmrBackup,
  prepareUnverifiedBackupRestore,
  recoverEmrState,
  restoreEmrBackupState,
  saveEmrState,
  exportEmrBackup,
} from "../../src/emr-model.js";
import { parseEmrFhirBundle } from "../../src/emr-fhir.js";
import { exportPatientFhirBundle } from "../../src/emr-fhir-export.js";
import { createPatientTransferPackage, patientTransferFilename } from "../../src/patient-transfer.js";
import { downloadJson, isClearedEmrState, readJsonFile } from "../../lib/emr/files.js";
import { today } from "../../lib/emr/format.js";

/**
 * The command-bar 데이터 작업 panel: FHIR import/export, patient transfer,
 * backup export/restore. Every path keeps the pre-React trust boundaries -
 * imports are quarantined as unverified, exports are blocked over unsaved input
 * or cross-tab drift, and the transfer confirm shows the one-time code.
 */
export function DataUtilities({ state, patient, store, setFhirReport, setViewedEncounterId, selectTab, dirtyGuardsRef, blockClinicalContextChange }) {
  const { setStatus, withTransition, replaceState } = store;
  const [transferStatus, setTransferStatus] = useState({ message: "", tone: "" });
  const fhirInputRef = useRef(null);
  const backupInputRef = useRef(null);

  const hasUnsavedInput = () => {
    const guards = dirtyGuardsRef.current;
    return guards.patientForm() || guards.encounter() || guards.manualEvent();
  };

  const currentExportBlocker = (exportState = state) => {
    if (exportState.storageError) return "손상된 로컬 저장을 정리하기 전에는 내보낼 수 없습니다.";
    if (hasUnsavedInput()) return "미저장 환자·진료·임상항목·과거기록 입력을 먼저 저장하거나 취소한 뒤 내보내세요.";
    const persisted = loadEmrState();
    if (persisted.storageError) return "현재 저장 상태를 확인할 수 없어 내보내기를 차단했습니다.";
    if (isClearedEmrState(persisted) && !isClearedEmrState(exportState)) return "다른 탭에서 전체 삭제가 적용되어 내보내기를 차단했습니다.";
    if (persisted.revision !== exportState.revision) return "다른 탭의 최신 변경을 먼저 반영한 뒤 내보내세요.";
    return "";
  };

  const exportBackup = () => {
    const exportState = state.demo ? store.savedState : state;
    const blocker = currentExportBlocker(exportState);
    if (blocker) {
      setStatus(blocker, "error");
      return;
    }
    downloadJson(exportEmrBackup(exportState), "policycompass-emr-backup-" + today() + ".json");
    setStatus(state.demo ? "기존 로컬 기록을 백업했습니다." : "전체 로컬 기록을 JSON으로 내보냈습니다.", "success");
  };

  const onFhirImport = async (event) => {
    const input = event.target;
    try {
      if (blockClinicalContextChange({ patientChanged: true })) return;
      const file = input.files?.[0];
      await withTransition(async () => {
        const bundle = await readJsonFile(file, 2 * 1024 * 1024);
        const result = parseEmrFhirBundle(bundle);
        setFhirReport(result.provenance);
        const persistedBase = state.demo ? loadEmrState() : state;
        const expectedRevision = persistedBase.revision;
        if (persistedBase.storageError) throw new Error("손상된 로컬 저장을 먼저 원본으로 내보낸 뒤 복원 또는 삭제하세요.");
        const importedPatient = result.patient;
        if (persistedBase.patients.some((item) => item.id === importedPatient.id || (importedPatient.mrn && item.mrn === importedPatient.mrn))) {
          throw new Error("같은 FHIR 환자 ID 또는 등록번호가 이미 있습니다. 기존 환자 병합은 지원하지 않습니다.");
        }
        let candidate = addPatient(persistedBase, importedPatient);
        candidate = appendStateAudit(
          candidate,
          "fhir.imported",
          `FHIR R4 · 지원 ${result.provenance.supported}건 · 제외 ${result.provenance.unsupported}건`,
          new Date().toISOString(),
          importedPatient.id,
        );
        const saved = await saveEmrState(candidate, undefined, expectedRevision);
        await replaceState(() => saved, { persist: false }).catch(() => {});
        store.setSavedState(saved);
        setViewedEncounterId("");
        selectTab("encounter");
        setStatus("FHIR R4에서 환자 1명과 임상기록 " + importedPatient.events.length + "건을 가져왔습니다. 외부 미검증 기록은 확정 요약·AI·급여 근거에서 제외하며 미지원 " + result.provenance.unsupported + "건입니다.", "success");
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "FHIR 가져오기에 실패했습니다.", "error");
    } finally {
      input.value = "";
    }
  };

  const onBackupRestore = async (event) => {
    const input = event.target;
    if (hasUnsavedInput()) {
      input.value = "";
      setStatus("미저장 환자·진료·임상항목·과거기록 입력을 먼저 저장하거나 취소한 뒤 백업을 복원하세요.", "error");
      return;
    }
    try {
      const file = input.files?.[0];
      await withTransition(async () => {
        const backup = await readJsonFile(file);
        const parsed = parseEmrBackup(backup);
        if (!window.confirm("이 JSON 백업은 암호화·전자서명·원본 기관을 검증하지 않습니다. 복원된 모든 임상 기록은 출처 미검증으로 격리되어 AI·급여 근거·FHIR 내보내기·환자용 정제 연결에서 제외되며, 복원 초안도 로컬 확정·서명할 수 없습니다. 백업의 기관 규칙·감사 이력·담당자 검토 단계도 신뢰하지 않고 복원하지 않습니다. 현재 기록 교체는 별도 백업 없이는 복구할 수 없습니다.")) {
          setStatus("백업 복원을 취소했습니다.");
          return;
        }
        const persistedState = state.demo ? store.savedState : state;
        const restoredAt = new Date().toISOString();
        let saved;
        if (persistedState.storageError && persistedState.recoveryRaw) {
          let candidate = prepareUnverifiedBackupRestore(parsed, persistedState, restoredAt);
          candidate = { ...candidate, revision: Date.now() * 1_000 };
          candidate = appendStateAudit(candidate, "backup.restored", `환자 ${candidate.patients.length}명`, restoredAt);
          saved = await recoverEmrState(candidate, persistedState.recoveryRaw);
        } else {
          saved = await restoreEmrBackupState(parsed, persistedState, undefined, restoredAt);
        }
        await replaceState(() => saved, { persist: false }).catch(() => {});
        store.setSavedState(saved);
        setViewedEncounterId("");
        setFhirReport(null);
        setStatus("백업의 모든 임상 기록을 출처 미검증 상태로 복원·격리했습니다. 이 로컬 샌드박스에서는 AI·급여·FHIR·환자용 정제 연결·로컬 서명의 근거에서 제외합니다.", "success");
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "백업 복원에 실패했습니다.", "error");
    } finally {
      input.value = "";
    }
  };

  const onExportFhir = async () => {
    if (!patient) {
      setStatus("FHIR로 내보낼 환자를 먼저 선택하세요.", "error");
      return;
    }
    if (!state.demo) {
      const blocker = currentExportBlocker();
      if (blocker) {
        setStatus(blocker, "error");
        return;
      }
    }
    try {
      const bundle = exportPatientFhirBundle(patient);
      if (!window.confirm(`${patient.name} 환자의 식별정보와 임상기록이 포함된 의료기관용 FHIR를 내보낼까요? 환자 앱 전달에는 사용하지 마세요.`)) return;
      if (!state.demo) {
        await store.applyMutation(
          (current) => appendStateAudit(current, "fhir.exported", "의료기관용 FHIR R4", new Date().toISOString(), patient.id),
          "FHIR 내보내기 이력을 저장했습니다.",
          { announce: false },
        );
      }
      downloadJson(bundle, `policycompass-fhir-${today()}.json`);
      setStatus(`선택 환자의 완료·서명 진료를 FHIR R4 Bundle로 내보냈습니다.${state.demo ? " · 예시 환자 파일" : ""}`, "success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "FHIR 내보내기에 실패했습니다.", "error");
    }
  };

  const onExportTransfer = async () => {
    if (!patient) {
      setTransferStatus({ message: "환자 전달 파일로 내보낼 환자를 먼저 선택하세요.", tone: "error" });
      return;
    }
    if (state.demo) {
      setTransferStatus({ message: "예시 환자는 환자 전달 파일로 내보낼 수 없습니다. 로컬 실제 기록에서 선택하세요.", tone: "error" });
      return;
    }
    const blocker = currentExportBlocker();
    if (blocker) {
      setTransferStatus({ message: blocker, tone: "error" });
      return;
    }
    try {
      const exportedAt = new Date().toISOString();
      const transferPackage = createPatientTransferPackage(patient, exportedAt);
      const { includedConditions, includedMeasurements } = transferPackage.summary;
      if (!window.confirm(`${patient.name} 환자의 최소 건강정보를 파일로 내보낼까요?\n\n전달 확인 코드: ${transferPackage.transferCode}\n확정 질환 ${includedConditions}개 · 최종 측정 ${includedMeasurements}개\n\n환자명과 코드를 대조하세요. 코드는 파일과 다른 경로로 환자에게 안내해야 합니다.`)) {
        setTransferStatus({ message: "환자 전달 파일 내보내기를 취소했습니다.", tone: "" });
        return;
      }
      await store.applyMutation(
        (current) => appendStateAudit(current, "patient.transfer.exported", `확정 질환 ${includedConditions}개 · 최종 측정 ${includedMeasurements}개`, new Date().toISOString(), patient.id),
        "환자 전달 내보내기 이력을 저장했습니다.",
        { announce: false },
      );
      downloadJson(transferPackage, patientTransferFilename(exportedAt));
      setTransferStatus({
        message: `${patient.name} 환자용 JSON을 내보냈습니다. 전달 확인 코드 ${transferPackage.transferCode} · 확정 질환 ${includedConditions}개 · 최종 측정 ${includedMeasurements}개. 코드는 별도 경로로 안내하세요.`,
        tone: "success",
      });
    } catch (error) {
      setTransferStatus({ message: error instanceof Error ? error.message : "환자용 PolicyCompass JSON 내보내기에 실패했습니다.", tone: "error" });
    }
  };

  return (
    <details className="emr-utilities" id="emrUtilities">
      <summary className="clinical-button">데이터 작업</summary>
      <div className="emr-utility-panel">
        <p className="emr-utility-heading"><b>가져오기·전달·백업</b><span>진료 화면과 분리된 로컬 데이터 작업입니다.</span></p>
        <div className="emr-utility-actions">
          <input className="visually-hidden" id="fhirImport" type="file" accept=".json,application/json,application/fhir+json" ref={fhirInputRef} onChange={onFhirImport} />
          <label className="clinical-button" htmlFor="fhirImport">FHIR 가져오기</label>
          <button className="clinical-button clinical-button--patient-transfer" id="syncPersonalRecord" type="button" aria-describedby="patientTransferGuidance" onClick={onExportTransfer}>환자 전달 파일 내보내기</button>
          <button className="clinical-button" id="exportFhir" type="button" onClick={onExportFhir}>의료기관용 FHIR</button>
          <button className="clinical-button" id="exportEmr" type="button" onClick={exportBackup}>백업 내보내기</button>
          <input className="visually-hidden" id="importEmr" type="file" accept=".json,application/json" ref={backupInputRef} onChange={onBackupRestore} />
          <label className="clinical-button" htmlFor="importEmr">백업 복원</label>
        </div>
        <div className="patient-transfer-guidance" id="patientTransferGuidance">
          <div>
            <b>선택 환자에게 직접 전달</b>
            <span>선택 환자의 이름과 일회성 확인 코드를 대조한 뒤 확정 질환·최종 측정만 내보냅니다. 코드는 파일과 다른 경로로 환자에게 전달하세요. 가져오면 저장 전 현재 기록만 교체되고 기존 Journey는 바뀌지 않습니다.</span>
          </div>
          <p id="personalSyncStatus" role="status" aria-live="polite" data-tone={transferStatus.tone || undefined}>{transferStatus.message}</p>
        </div>
      </div>
    </details>
  );
}

export { }; // exportBackup reachable through DataUtilities only; DataTab receives it via prop
