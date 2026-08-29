"use client";

import { useEffect, useState } from "react";

import { patientAgeLabel, QUEUE_LABELS, SEX_LABELS, ageFromBirthDate } from "../../lib/emr/format.js";
import { encounterQueueStatus, todayEncounterForPatient } from "../../lib/emr/selectors.js";

const QUEUE_FILTERS = [
  ["all", "전체"],
  ["waiting", "대기"],
  ["in-progress", "진료 중"],
  ["completed", "완료"],
];

const EMPTY_FORM = {
  mrn: "", name: "", birthDate: "", ageYears: "", sex: "unknown", phone: "", address: "",
  bloodType: "unknown", insuranceType: "unknown",
  emergencyName: "", emergencyRelation: "", emergencyPhone: "", memo: "",
};

export function patientFormHasPendingInput(form, mode) {
  if (mode !== "create") return true;
  return ["mrn", "name", "birthDate", "ageYears", "phone", "address", "emergencyName", "emergencyRelation", "emergencyPhone", "memo"]
    .some((key) => String(form[key] ?? "").trim())
    || form.sex !== "unknown" || form.bloodType !== "unknown" || form.insuranceType !== "unknown";
}

export function PatientRail({
  patients,
  selectedPatientId,
  demo,
  onSelectPatient,
  onLoadDemo,
  onSavePatient,
  editRequest,
  onEditConsumed,
  onFormStateChange,
}) {
  const [query, setQuery] = useState("");
  const [queueFilter, setQueueFilter] = useState("all");
  const [composerOpen, setComposerOpen] = useState(false);
  const [mode, setMode] = useState("create");
  const [form, setForm] = useState(EMPTY_FORM);
  const [message, setMessage] = useState("");

  // 환자 정보 편집 buttons elsewhere in the workspace hand the patient here.
  useEffect(() => {
    if (!editRequest) return;
    const patient = editRequest;
    setMode(patient.id);
    setForm({
      mrn: patient.mrn ?? "",
      name: patient.name ?? "",
      birthDate: patient.birthDate ?? "",
      ageYears: patient.birthDate
        ? ageFromBirthDate(patient.birthDate).replace(/\D/g, "")
        : String(patient.ageYears ?? ""),
      sex: patient.sex ?? "unknown",
      phone: patient.phone ?? "",
      address: patient.address ?? "",
      bloodType: patient.bloodType ?? "unknown",
      insuranceType: patient.insuranceType ?? "unknown",
      emergencyName: patient.emergencyContact?.name ?? "",
      emergencyRelation: patient.emergencyContact?.relation ?? "",
      emergencyPhone: patient.emergencyContact?.phone ?? "",
      memo: patient.memo ?? "",
    });
    setMessage("");
    setComposerOpen(true);
    onEditConsumed?.();
  }, [editRequest, onEditConsumed]);

  useEffect(() => {
    onFormStateChange?.({ pending: patientFormHasPendingInput(form, mode), mode });
  }, [form, mode, onFormStateChange]);

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setMode("create");
    setMessage("");
  };

  const visible = patients.filter((patient) => {
    const haystack = (patient.name + " " + patient.mrn).toLocaleLowerCase("ko");
    const status = encounterQueueStatus(todayEncounterForPatient(patient));
    const statusMatches = queueFilter === "all"
      || (queueFilter === "completed" ? ["completed", "signed", "legacy", "external"].includes(status) : status === queueFilter);
    const trimmed = query.trim().toLocaleLowerCase("ko");
    return (!trimmed || haystack.includes(trimmed)) && statusMatches;
  }).sort((left, right) => {
    const priority = { "in-progress": 0, waiting: 1, completed: 2, signed: 3, legacy: 4, external: 5, none: 6 };
    const leftStatus = encounterQueueStatus(todayEncounterForPatient(left));
    const rightStatus = encounterQueueStatus(todayEncounterForPatient(right));
    return priority[leftStatus] - priority[rightStatus] || left.name.localeCompare(right.name, "ko");
  });

  const todayCount = patients.filter((patient) => encounterQueueStatus(todayEncounterForPatient(patient)) !== "none").length;

  const submit = async (event) => {
    event.preventDefault();
    setMessage("");
    const mrn = form.mrn.trim();
    const name = form.name.trim();
    if (!mrn || !name) {
      setMessage("등록번호와 이름을 입력하세요.");
      return;
    }
    if (patients.some((patient) => patient.mrn === mrn && patient.id !== mode)) {
      setMessage("같은 등록번호가 이미 있습니다.");
      return;
    }
    const payload = {
      mrn,
      name,
      birthDate: form.birthDate,
      ageYears: form.birthDate ? null : form.ageYears,
      sex: form.sex,
      phone: form.phone,
      address: form.address,
      bloodType: form.bloodType,
      insuranceType: form.insuranceType,
      emergencyContact: { name: form.emergencyName, relation: form.emergencyRelation, phone: form.emergencyPhone },
      memo: form.memo,
    };
    try {
      await onSavePatient(mode, payload);
      resetForm();
      setComposerOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "환자 저장에 실패했습니다.");
    }
  };

  return (
    <aside className="patient-rail" aria-labelledby="patientRailTitle">
      <div className="rail-heading">
        <div>
          <p className="rail-eyebrow">TODAY&apos;S WORKLIST</p>
          <h2 id="patientRailTitle">오늘 환자</h2>
        </div>
        <span className="rail-count" id="patientCount">{todayCount}/{patients.length}명</span>
      </div>

      <label className="patient-search">
        <span className="visually-hidden">환자 검색</span>
        <input id="patientSearch" type="search" placeholder="이름 또는 등록번호 검색" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>

      <div className="queue-filters" id="queueFilters" role="group" aria-label="오늘 환자 진료 상태 필터">
        {QUEUE_FILTERS.map(([value, label]) => (
          <button key={value} type="button" data-queue-filter={value} aria-pressed={queueFilter === value} onClick={() => setQueueFilter(value)}>{label}</button>
        ))}
      </div>

      <details className="patient-composer" id="patientComposer" open={composerOpen} onToggle={(event) => setComposerOpen(event.currentTarget.open)}>
        <summary><span>{mode === "create" ? "새 환자 등록" : "환자 정보 편집"}</span><span aria-hidden="true">＋</span></summary>
        <form id="patientForm" noValidate autoComplete="off" spellCheck="false" onSubmit={submit}>
          <fieldset className="form-fieldset">
            <legend>기본 정보</legend>
            <label>등록번호<input id="patientMrn" name="mrn" required maxLength={40} placeholder="예: PC-1003" autoComplete="off" value={form.mrn} onChange={set("mrn")} /></label>
            <label>이름<input id="patientName" name="name" required maxLength={40} placeholder="환자 이름" autoComplete="off" value={form.name} onChange={set("name")} /></label>
            <div className="form-pair">
              <label>생년월일<input id="patientBirthDate" name="birthDate" type="date" autoComplete="off" max={new Date().toISOString().slice(0, 10)} value={form.birthDate} onChange={(event) => {
                const birthDate = event.target.value;
                setForm((current) => ({
                  ...current,
                  birthDate,
                  ageYears: birthDate ? ageFromBirthDate(birthDate).replace(/\D/g, "") : "",
                }));
              }} /></label>
              <label>만 나이 직접 입력<input id="patientAgeYears" name="ageYears" type="number" min={0} max={130} inputMode="numeric" placeholder="생년월일 미상 시" disabled={Boolean(form.birthDate)} value={form.ageYears} onChange={set("ageYears")} /></label>
            </div>
            <label>성별<select id="patientSex" name="sex" value={form.sex} onChange={set("sex")}><option value="unknown">미상</option><option value="female">여성</option><option value="male">남성</option><option value="other">기타</option></select></label>
            <p className="field-help">생년월일을 입력하면 만 나이를 자동 계산하며, 미상인 경우에만 직접 나이를 사용합니다.</p>
          </fieldset>

          <fieldset className="form-fieldset">
            <legend>연락·보험 정보</legend>
            <label>연락처<input id="patientPhone" name="phone" type="tel" maxLength={40} autoComplete="off" placeholder="예: 010-1234-5678" value={form.phone} onChange={set("phone")} /></label>
            <label>주소<input id="patientAddress" name="address" maxLength={200} autoComplete="off" placeholder="시·군·구 포함 주소" value={form.address} onChange={set("address")} /></label>
            <div className="form-pair">
              <label>혈액형<select id="patientBloodType" name="bloodType" value={form.bloodType} onChange={set("bloodType")}><option value="unknown">미상</option><option value="A+">A+</option><option value="A-">A-</option><option value="B+">B+</option><option value="B-">B-</option><option value="AB+">AB+</option><option value="AB-">AB-</option><option value="O+">O+</option><option value="O-">O-</option></select></label>
              <label>보험 유형<select id="patientInsuranceType" name="insuranceType" value={form.insuranceType} onChange={set("insuranceType")}><option value="unknown">미상</option><option value="national-health">건강보험</option><option value="medical-aid">의료급여</option><option value="industrial">산재보험</option><option value="auto">자동차보험</option><option value="self-pay">일반·비급여</option><option value="other">기타</option></select></label>
            </div>
          </fieldset>

          <fieldset className="form-fieldset">
            <legend>비상 연락처</legend>
            <label>이름<input id="patientEmergencyName" name="emergencyName" maxLength={40} autoComplete="off" value={form.emergencyName} onChange={set("emergencyName")} /></label>
            <div className="form-pair">
              <label>관계<input id="patientEmergencyRelation" name="emergencyRelation" maxLength={40} placeholder="예: 배우자" value={form.emergencyRelation} onChange={set("emergencyRelation")} /></label>
              <label>연락처<input id="patientEmergencyPhone" name="emergencyPhone" type="tel" maxLength={40} autoComplete="off" value={form.emergencyPhone} onChange={set("emergencyPhone")} /></label>
            </div>
          </fieldset>

          <label>환자 메모<textarea id="patientMemo" name="memo" rows={3} maxLength={2000} placeholder="접수·의사소통 참고사항. 주민등록번호는 입력하지 마세요." value={form.memo} onChange={set("memo")} /></label>
          <p className="form-message" id="patientFormMessage" role="alert">{message}</p>
          <div className="compact-actions">
            <button className="clinical-button clinical-button--primary" type="submit">환자 저장</button>
            <button className="clinical-button" id="cancelPatientEdit" type="button" hidden={mode === "create"} onClick={resetForm}>편집 취소</button>
          </div>
        </form>
      </details>

      <ul className="patient-list" id="patientList" aria-label="환자 목록">
        {visible.map((patient) => {
          const queueStatus = encounterQueueStatus(todayEncounterForPatient(patient));
          return (
            <li key={patient.id}>
              <button type="button" data-patient-id={patient.id} aria-current={String(patient.id === selectedPatientId)} onClick={() => onSelectPatient(patient.id)}>
                <strong>{patient.name}</strong>
                <small>{[patient.mrn || "등록번호 없음", patientAgeLabel(patient), SEX_LABELS[patient.sex]].filter(Boolean).join(" · ")}</small>
                <em className={`queue-badge queue-badge--${queueStatus}`}>{QUEUE_LABELS[queueStatus]}</em>
              </button>
            </li>
          );
        })}
        {patients.length > 0 && visible.length === 0 ? <li className="rail-empty">검색 결과가 없습니다.</li> : null}
      </ul>

      <div className="rail-empty" id="patientListEmpty" hidden={patients.length > 0}>
        <b>등록된 환자 없음</b>
        <p>새 환자를 등록하거나 예시 환자를 불러오세요.</p>
        <button className="clinical-button clinical-button--demo" id="loadDemo" type="button" onClick={onLoadDemo}>예시 환자 불러오기</button>
      </div>
    </aside>
  );
}
