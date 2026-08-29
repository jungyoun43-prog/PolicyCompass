/** Browser download/read helpers, unchanged from the pre-React controller. */
export function downloadText(value, filename, type = "text/plain;charset=utf-8") {
  const blob = new Blob([value], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}

export function downloadJson(value, filename) {
  downloadText(JSON.stringify(value, null, 2), filename, "application/json;charset=utf-8");
}

export async function readJsonFile(file, maximumBytes = 5 * 1024 * 1024) {
  if (!file) throw new Error("파일이 선택되지 않았습니다.");
  if (file.size > maximumBytes) throw new RangeError(`가져오기 파일은 ${Math.floor(maximumBytes / 1024 / 1024)}MB 이하여야 합니다.`);
  return JSON.parse(await file.text());
}

export const AUDIT_LABELS = {
  "patient.created": "환자 등록",
  "patient.updated": "환자 정보 변경",
  "patient.event.added": "임상 이벤트 추가",
  "patient.event.confirmed": "과거자료 검토·확정",
  "patient.event.voided": "임상 이벤트 취소",
  "encounter.checked-in": "오늘 진료 접수",
  "encounter.started": "진료 시작",
  "encounter.draft.saved": "SOAP·진료 초안 저장",
  "encounter.completed": "진료 완료",
  "encounter.signed": "진료 서명",
  "encounter.reopened": "서명 전 진료 재개",
  "encounter.cancelled": "진료 취소",
  "diagnosis.added": "진단 추가",
  "observation.added": "진료 측정 추가",
  "prescription.added": "처방 추가",
  "order.added": "오더 추가",
  "condition.removed": "진단 초안 삭제",
  "observation.removed": "진료 측정 초안 삭제",
  "medication.removed": "처방 초안 삭제",
  "service-request.removed": "오더 초안 삭제",
  "schema.migrated": "EMR 스키마 이관",
  "claim-rule.saved": "급여 규칙 저장",
  "claim-rule.retired": "급여 규칙 종료일 설정",
  "claim-review.stage.new": "급여 담당자 검토 · 검토 대기",
  "claim-review.stage.evidence": "급여 담당자 검토 · 자료 확인",
  "claim-review.stage.reviewing": "급여 담당자 검토 · 담당자 검토",
  "claim-review.stage.reviewed": "급여 담당자 검토 · 최종 판정",
  "claim-review.invalidated": "급여 담당자 검토 · 재검토 필요",
  "fhir.imported": "FHIR 가져오기",
  "fhir.exported": "의료기관용 FHIR 내보내기",
  "patient.transfer.exported": "환자용 PolicyCompass 전달",
  "backup.restored": "백업 복원",
  "demo.loaded": "예시 환자 불러오기",
};

export function isClearedEmrState(candidate) {
  return candidate?.demo === false
    && !candidate.storageError
    && !candidate.recoveryRaw
    && candidate.selectedPatientId === ""
    && candidate.selectedEncounterId === ""
    && Array.isArray(candidate.patients)
    && candidate.patients.length === 0
    && Array.isArray(candidate.audit)
    && candidate.audit.length === 0
    && Array.isArray(candidate.claimReviews)
    && candidate.claimReviews.length === 0
    && Array.isArray(candidate.rules)
    && candidate.rules.every(({ sample }) => sample === true);
}
