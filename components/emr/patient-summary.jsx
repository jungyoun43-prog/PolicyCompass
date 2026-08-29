"use client";

import { displayTimestamp, patientAgeLabel, SEX_LABELS } from "../../lib/emr/format.js";
import { confirmedActiveConditions, finalizedPatient } from "../../lib/emr/selectors.js";

/**
 * The selected patient's identity and safety context. It lives in the patient
 * rail so the sticky navigation stays a slim tab bar instead of a tall header
 * that covers the chart while scrolling.
 */
export function PatientSummaryCard({ patient, demo, updatedAt, onEditPatient }) {
  const conditions = confirmedActiveConditions(patient);
  const chart = finalizedPatient(patient);
  const allergies = chart.events.filter((event) => event.type === "allergy");
  const activeMedications = chart.events.filter((event) => event.type === "medication" && !["stopped", "cancelled"].includes(event.status));

  return (
    <section className="rail-selected-patient" data-safety-persistent aria-label="선택 환자 요약">
      <div className="patient-identity">
        <p className="rail-eyebrow">SELECTED PATIENT</p>
        <div className="patient-identity__row">
          <div>
            <h2 id="selectedPatientName">{patient.name}</h2>
            <span id="selectedPatientMeta">{[
              patientAgeLabel(patient).replace(/^만\s*/, ""),
              SEX_LABELS[patient.sex],
              patient.bloodType && patient.bloodType !== "unknown" ? `${patient.bloodType}형` : "",
            ].filter(Boolean).join(" · ")}</span>
          </div>
          <button className="clinical-button rail-edit-button" id="editPatient" type="button" aria-label="환자 정보 편집" onClick={onEditPatient}>편집</button>
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
      {demo ? null : (
        <div className="patient-header-actions">
          <span id="lastSavedAt">저장 {displayTimestamp(updatedAt)}</span>
        </div>
      )}
    </section>
  );
}
