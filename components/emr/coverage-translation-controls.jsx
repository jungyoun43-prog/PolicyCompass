"use client";

import { Button } from "@/components/ui/button";

export function CoverageTranslationControls({ language, configured, busy, reviewBusy, translated, cached, error, onTranslate, onOriginal, onCancel }) {
  return <div className="coverage-translation" aria-busy={busy}>
    <div className="coverage-translation__actions">
      <Button type="button" disabled={reviewBusy || (!configured && !cached) || busy} onClick={translated ? onOriginal : onTranslate}>
        {busy ? "Haiku 번역 중…" : translated ? "원문 보기" : cached ? `${language.label} 번역본 보기` : `${language.label}로 전체 번역 · Haiku`}
      </Button>
      {busy ? <Button type="button" onClick={onCancel}>번역 취소</Button> : null}
      {translated ? <span role="status">{language.label} 번역본 · Haiku · 입력은 읽기 전용</span> : null}
    </div>
    <p>{!configured && !cached ? "Haiku 번역을 사용하려면 서버의 OpenRouter 연결이 필요합니다." : translated ? "검토 시작 시 이 번역본을 사용합니다. 입력을 수정하려면 원문 보기로 돌아가세요." : "버튼을 누르면 현재 진료데이터·보험 기준·지시문과 검토 결과를 Haiku로 전송합니다. 원문은 보관합니다."}</p>
    {error ? <p className="coverage-translation__error" role="alert">{error}</p> : null}
  </div>;
}
