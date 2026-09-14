"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { medicationReviewNotice } from "../../src/medication-review-prompt.js";

export const MEDICATION_PRODUCTS = {
  "benralizumab-30": {
    name: "파센라 프리필드시린지주 30mg",
    english: "FASENRA PFS",
    image: "https://www.astrazeneca.co.kr/wp-content/uploads/mangboard/2021/04/16/F707_pasenla.gif",
    source: "https://astrazeneca.co.kr/product/?board_pid=49&mode=view",
    criteria: [
      "성인 중증 호산구성 천식으로 고용량 ICS-LABA와 LAMA 투여에도 적절하게 조절되지 않는 경우",
      "투여 전 12개월 내 호산구 ≥300 cells/μL이면서 급성악화 ≥4회 또는 6개월 이상 경구 스테로이드 지속 투여, 혹은 호산구 ≥400 cells/μL이면서 급성악화 ≥3회",
      "매년 치료 반응과 전반적 천식 조절을 평가하고 투여 소견서 제출",
      "생물학적 제제 병용·교체 및 스테로이드 용량 등 세부 조건은 등록 기준 원문 확인",
    ],
  },
  "durvalumab-500": {
    name: "임핀지주 500mg",
    english: "IMFINZI",
    image: "https://www.astrazeneca.co.kr/wp-content/uploads/mangboard/2019/05/13/F446_imfinzi_pic.gif",
    source: "https://astrazeneca.co.kr/product/?vid=36",
    criteria: [
      "PD-L1 발현율 ≥1%인 절제 불가능한 국소 진행성 3기 비소세포폐암",
      "백금 기반 동시적 항암화학방사선요법 2주기 이상 후 질병 진행이 없는 안정병변 이상",
      "CCRT 종료 후 42일 이내 시작, 급여 인정 기간 12개월",
      "이전 면역관문억제제 치료가 없는 경우에 한하며 투여기관 등 세부 조건은 등록 기준 원문 확인",
    ],
  },
};

export function MedicationCoverageOverview({ medication }) {
  const [failed, setFailed] = useState(false);
  const product = MEDICATION_PRODUCTS[medication.id];
  const notice = medicationReviewNotice(medication.id);
  // Presentation summary of the existing catalog notice; not a new official policy source.
  const criteria = product.criteria;
  return <>
    <div className="coverage-product">
      <a className="coverage-product__image" href={product.source} target="_blank" rel="noreferrer" aria-label={`${product.name} 제조사 제품정보`}>
        {failed ? <span>제품 사진 보기 ↗</span> : (
          <img src={product.image} alt={`${product.name} 제조사 제품 사진`} width="140" height="90" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        )}
      </a>
      <div><h4>{product.name} <small>[{product.english}]</small></h4>
        <p>성분명: {medication.ingredient} · 제조사: 한국아스트라제네카</p>
        <a href={product.source} target="_blank" rel="noreferrer">제품정보 · 사진 출처 ↗</a>
      </div>
    </div>
    <section className="coverage-criteria">
      <h4>급여인정 기준 (요약)</h4>
      {criteria.length ? <ol>{criteria.map((criterion, index) => <li key={index}>{criterion.replace(/^(?:[가-힣]\.|\d+[.)]|[-•])\s*/, "")}</li>)}</ol> : <p>등록된 기준 원문을 확인해 주세요.</p>}
      <details><summary>상세 기준 보기</summary><pre>{notice}</pre></details>
      <p className="coverage-provenance">프로젝트에 등록된 검토용 기준입니다. 최신 공식 고시 확인이 필요합니다.</p>
    </section>
  </>;
}

export function MedicationCoverageSummary({ review }) {
  const [copied, setCopied] = useState("");
  const modelSummary = review.markdown?.match(/\*\*최종 판단:\*\*\s*([^\n]+)/)?.[1]
    || review.markdown?.match(/\*\*사유:\*\*\s*([^\n]+)/)?.[1];
  const summary = modelSummary || (review.markdown ? "상단의 모델 검토 보고에서 기준별 판정과 근거를 확인하세요." : review.summary);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(review.markdown || `${review.verdictLabel}\n${summary}`);
      setCopied("복사했습니다.");
    } catch { setCopied("복사하지 못했습니다. 내용을 선택해 복사하세요."); }
  };
  return <section className="coverage-summary">
    <div><h4>{review.generatedBy === "rule" ? "규칙 기반 요약" : "AI 요약 의견"}</h4>
      <Button type="button" onClick={copy}>요약 내용 복사</Button></div>
    <p>{summary}</p><span role="status">{copied}</span>
  </section>;
}
