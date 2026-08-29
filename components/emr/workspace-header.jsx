"use client";

import { displayDate, displayTimestamp, INSURANCE_LABELS, patientAgeLabel, SEX_LABELS } from "../../lib/emr/format.js";
import { confirmedActiveConditions, finalizedPatient } from "../../lib/emr/selectors.js";

const TABS = [
  ["encounter", "오늘 진료"],
  ["overview", "환자 요약"],
  ["chart", "과거 기록"],
  ["graph", "신체 지도"],
  ["claims", "급여 보드"],
  ["journey", "Journey"],
  ["data", "감사·데이터"],
];

export function WorkspaceHeader({ patient, demo, updatedAt, activeTab, onSelectTab, onEditPatient }) {
  const conditions = confirmedActiveConditions(patient);
  const chart = finalizedPatient(patient);
  const allergies = chart.events.filter((event) => event.type === "allergy");
  const activeMedications = chart.events.filter((event) => event.type === "medication" && !["stopped", "cancelled"].includes(event.status));

  const onTabKeyDown = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = TABS.findIndex(([key]) => key === activeTab);
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? TABS.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length;
    onSelectTab(TABS[nextIndex][0], { focus: true });
  };

  return (
    <div className="patient-workspace-navigation" data-safety-persistent>
      <header className="patient-safety-header">
        <div className="patient-identity">
          <p className="rail-eyebrow">SELECTED PATIENT</p>
          <div>
            <h2 id="selectedPatientName">{patient.name}</h2>
            <span id="selectedPatientMeta">{[
              patient.mrn || "등록번호 없음",
              patient.birthDate ? displayDate(patient.birthDate) : "생년월일 미상",
              patientAgeLabel(patient),
              SEX_LABELS[patient.sex],
              patient.bloodType && patient.bloodType !== "unknown" ? `${patient.bloodType}형` : "혈액형 미상",
              INSURANCE_LABELS[patient.insuranceType],
            ].filter(Boolean).join(" · ")}</span>
          </div>
          <div className="patient-condition-summary" aria-label="확정 활성 질환">
            <span className="patient-condition-summary__label">현재 질환</span>
            <div
              className="patient-condition-summary__list"
              id="selectedPatientConditions"
              role="list"
              aria-live="polite"
              aria-label={conditions.length ? `확정 활성 질환: ${conditions.map(({ label }) => label).join(", ")}` : "확정 활성 질환 없음"}
            >
              {conditions.length === 0 ? (
                <span className="patient-condition-summary__empty" role="listitem">확정 활성 질환 없음</span>
              ) : (
                <>
                  {conditions.slice(0, 2).map((condition) => (
                    <span className="patient-condition-chip" role="listitem" key={condition.id}>
                      <strong>{condition.label}</strong>
                      {condition.code ? <small>{condition.code}</small> : null}
                    </span>
                  ))}
                  {conditions.length > 2 ? (
                    <span className="patient-condition-summary__more" role="listitem">외 {conditions.length - 2}개</span>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
        <div className="safety-alerts" id="safetyAlerts" aria-label="환자 안전 알림">
          {allergies.length
            ? allergies.slice(0, 3).map((allergy) => (
              <span className="safety-chip safety-chip--allergy" key={allergy.id}>알레르기 · {allergy.label}</span>
            ))
            : <span className="safety-chip">알레르기 확인 필요</span>}
          <span className="safety-chip">활성 약물 {activeMedications.length}건</span>
        </div>
        <div className="patient-header-actions">
          <button className="clinical-button" id="editPatient" type="button" onClick={onEditPatient}>환자 정보 편집</button>
          <span id="lastSavedAt">{demo ? "예시 · 미저장" : "저장 " + displayTimestamp(updatedAt)}</span>
        </div>
      </header>

      <div className="workspace-tabs" role="tablist" aria-label="선택 환자 화면" aria-orientation="horizontal" onKeyDown={onTabKeyDown}>
        {TABS.map(([key, label]) => (
          <button
            key={key}
            id={`tab-${key}`}
            type="button"
            role="tab"
            aria-selected={activeTab === key}
            aria-controls={`panel-${key}`}
            data-tab={key}
            tabIndex={activeTab === key ? 0 : -1}
            ref={activeTab === key ? (node) => node?.dataset.focusable : undefined}
            onClick={() => onSelectTab(key)}
          >{label}</button>
        ))}
      </div>
    </div>
  );
}
