"use client";

import { useState } from "react";
import { Popover } from "radix-ui";
import { Button } from "@/components/ui/button";
import { COVERAGE_COUNTRIES, medicationCoveragePolicies } from "../../src/medication-coverage-policies.js";

export function CoveragePolicyPicker({ medicationId, selectedPolicy, disabled, onSelect }) {
  const [open, setOpen] = useState(false);
  const [country, setCountry] = useState(selectedPolicy.countryCode);
  const policies = medicationCoveragePolicies(medicationId);
  const choose = (policy) => { onSelect(policy.id); setOpen(false); };
  return <Popover.Root open={open} onOpenChange={(value) => { setOpen(value); if (value) setCountry(selectedPolicy.countryCode); }}>
    <Popover.Trigger asChild>
      <Button type="button" className="coverage-policy-trigger" disabled={disabled}>다른 나라 사례 확인</Button>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content className="coverage-policy-picker" align="end" sideOffset={8} collisionPadding={12} aria-labelledby="coveragePolicyPickerTitle">
        <div className="coverage-policy-picker__heading"><h3 id="coveragePolicyPickerTitle">나라별 보험 기준</h3>
          <Popover.Close asChild><Button type="button" aria-label="나라별 보험 기준 닫기">닫기</Button></Popover.Close>
        </div>
        <p>같은 약의 기준을 불러옵니다. 미국은 보험자를 선택하세요.</p>
        <div className="coverage-policy-picker__countries" role="group" aria-label="기준 국가">
          {COVERAGE_COUNTRIES.map(({ code, label }) => <Button key={code} type="button" aria-pressed={country === code} onClick={() => {
            setCountry(code);
            const available = policies.filter((policy) => policy.countryCode === code);
            if (available.length === 1) choose(available[0]);
          }}>{label}</Button>)}
        </div>
        <div className="coverage-policy-picker__policies" role="group" aria-label="보험자와 제도">
          {policies.filter((policy) => policy.countryCode === country).map((policy) => <button key={policy.id} type="button" aria-pressed={selectedPolicy.id === policy.id} onClick={() => choose(policy)}>
            <span><strong>{policy.payer}</strong><small>{policy.program}</small></span>
            <span>{selectedPolicy.id === policy.id ? "선택됨" : "적용"}</span>
          </button>)}
        </div>
        <p className="coverage-policy-picker__scope">등록된 적응증의 비교 사례입니다. 각 나라의 모든 보험을 대표하지 않습니다.</p>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}

export function CoveragePolicySource({ policy, edited = false, children }) {
  return <section className="coverage-policy-source" aria-label="선택한 보험 기준">
    <div><h4>{policy.country} · {policy.payer}</h4><span>{policy.program}{edited ? " · 입력 수정됨" : ""}</span></div>
    <p>{policy.indication}</p>
    {policy.countryCode === "KR" ? <small>프로젝트에 등록된 검토용 기준입니다. 최신 공식 고시 확인이 필요합니다.</small> : <>
      <small>{policy.translation ? "Haiku 영어 번역본" : "공식 자료의 한국어 요약"} · 확인 {policy.checkedOn}{policy.version ? ` · ${policy.version}` : ""}</small>
      <div className="coverage-policy-source__links">{policy.sources.map(({ title, url }) => <a key={url} href={url} target="_blank" rel="noreferrer">{title} <span className="visually-hidden">(새 탭)</span></a>)}</div>
    </>}
    {children}
  </section>;
}
