"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { createClinicalBodyAtlas } from "../../../src/emr-model.js";
import { displayDate, prescriptionSummary } from "../../../lib/emr/format.js";

const BODY_AREA_TONES = Object.freeze({
  neuro: "violet", mental: "violet", sensory: "amber", cardio: "coral",
  respiratory: "cyan", digestive: "coral", endocrine: "amber", renal: "cyan",
  pelvic: "violet", musculoskeletal: "lime", rheumatology: "lime", dermatology: "amber",
});

const BODY_AREAS = [
  ["neuro", "뇌·신경", "신경과", "hotspot-neuro"],
  ["mental", "마음·수면", "정신건강의학과", "hotspot-mental"],
  ["sensory", "눈·귀·코", "안과·이비인후과", "hotspot-sensory"],
  ["cardio", "심장·혈관", "순환기내과", "hotspot-cardio"],
  ["respiratory", "폐·호흡", "호흡기내과", "hotspot-respiratory"],
  ["digestive", "위·장·간", "소화기내과", "hotspot-digestive"],
  ["endocrine", "대사·호르몬", "내분비내과", "hotspot-endocrine"],
  ["renal", "신장·수분", "신장내과", "hotspot-renal"],
  ["pelvic", "골반·비뇨", "산부인과·비뇨의학과", "hotspot-pelvic"],
  ["musculoskeletal", "뼈·관절", "정형외과·재활의학과", "hotspot-musculoskeletal"],
  ["rheumatology", "면역·관절", "류마티스내과", "hotspot-rheumatology"],
  ["dermatology", "피부·알레르기", "피부과·알레르기내과", "hotspot-dermatology"],
];

function bodyAreaRecordCount(area) {
  return area.visits.length + area.medications.length + area.conditions.length;
}

function bodyAreaStatus(area) {
  const parts = [];
  if (area.declaredVisitCount) parts.push(`진료과 확인 진료 ${area.declaredVisitCount}건`);
  if (area.declaredMedicationCount) parts.push(`확인 진료 처방 ${area.declaredMedicationCount}건`);
  if (area.classifiedVisitCount) parts.push(`진료명 분류 후보 ${area.classifiedVisitCount}건`);
  if (area.classifiedMedicationCount) parts.push(`후보 진료 연결 처방 ${area.classifiedMedicationCount}건`);
  if (area.conditions.length) parts.push(`질환 기반 탐색 신호 ${area.conditions.length}개`);
  if (area.signalOnly) parts.push("진료 이력 없음");
  return parts.join(" · ") || "연결 기록 없음";
}

function bodySourceSummary(record = {}) {
  const source = record.source ?? {};
  return `출처 · ${[source.label || "출처 정보 없음", source.resourceId || ""].filter(Boolean).join(" · ")}`;
}

function areaControlClass(base, area, isCurrent) {
  const tone = BODY_AREA_TONES[area.id] || "cyan";
  const classes = [base];
  if (area.active) classes.push("is-active", `tone-${tone}`);
  if (area.careActive) classes.push("is-care-record");
  if (area.candidateActive) classes.push("is-classification-candidate");
  if (area.candidateOnly) classes.push("is-candidate-only");
  if (area.signalActive) classes.push("is-condition-signal");
  if (area.signalOnly) classes.push("is-signal-only");
  if (isCurrent) classes.push("is-current", `tone-${tone}`);
  return classes.join(" ");
}

function BodyRecord({ record, statusText, meta, association, onOpenChart }) {
  return (
    <li className="clinical-body-record">
      <div className="clinical-body-record__top">
        <b>{record.label}</b>
        <span className="clinical-body-record__status" data-lifecycle={record.lifecycle || undefined}>{statusText}</span>
      </div>
      <p>{meta}</p>
      <small>{association}</small>
      <small className="clinical-body-record__source">{bodySourceSummary(record)}</small>
      <button className="clinical-body-record__action" type="button" aria-label={`${record.label} 차트 기록으로 이동`} onClick={() => onOpenChart(record.id)}>차트 기록으로 이동</button>
    </li>
  );
}

export function BodyTab({ patient, selectTab, active }) {
  const atlas = useMemo(() => createClinicalBodyAtlas(patient), [patient]);
  const [selectedAreaId, setSelectedAreaId] = useState("");
  const stageRef = useRef(null);
  const initializedRef = useRef(false);

  const preferred = atlas.areas.find((area) => area.visits.some(({ lifecycle }) => lifecycle === "draft"))
    || atlas.areas.find((area) => area.visits.length)
    || atlas.areas.find(({ active: isActive }) => isActive)
    || atlas.areas[0];
  const area = atlas.areas.find(({ id }) => id === selectedAreaId) || preferred;

  useEffect(() => { setSelectedAreaId(""); }, [patient.id]);

  // The 3D controller is framework-agnostic; mount it once when the tab first
  // shows, after the bundled model-viewer runtime registers its element.
  useEffect(() => {
    if (!active || initializedRef.current || !stageRef.current) return;
    initializedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        await import("@google/model-viewer");
      } catch {
        // The controller falls back to the 2D atlas when the runtime is missing.
      }
      if (cancelled) return;
      const { initBody3d } = await import("../../../src/body-3d.js");
      initBody3d(stageRef.current);
    })();
    return () => { cancelled = true; };
  }, [active]);

  const onOpenChart = (eventId) => {
    selectTab("chart");
    requestAnimationFrame(() => {
      const row = document.querySelector(`[data-event-id="${CSS.escape(eventId)}"]`);
      row?.scrollIntoView({ block: "center" });
      row?.focus();
    });
  };

  const unassignedNotice = [
    atlas.totals.unassignedVisits ? `진료과를 확인할 수 없는 진료 ${atlas.totals.unassignedVisits}건` : "",
    atlas.totals.unassignedMedications ? `진료과를 확인할 수 없는 약물 ${atlas.totals.unassignedMedications}건` : "",
  ].filter(Boolean);
  const candidateNotice = atlas.totals.classifiedVisits
    ? ` 진료명 기반 분류 후보 ${atlas.totals.classifiedVisits}건과 연결 처방 ${atlas.totals.classifiedMedications}건은 ${atlas.totals.candidateAreas}개 영역에 이중 윤곽으로 표시하고 확인된 진료과 이력에서 제외했습니다.`
    : "";
  const exclusions = [
    atlas.totals.unassignedVisits ? `진료과가 모호하거나 확인되지 않은 진료 ${atlas.totals.unassignedVisits}건` : "",
    atlas.totals.unassignedMedications ? `진료과 연결 정보가 없는 약물 ${atlas.totals.unassignedMedications}건` : "",
  ].filter(Boolean);

  const visitGroups = [
    { kind: "declared", label: "진료과 필드로 확인", associationText: "Encounter 진료과 필드에 단일 진료과로 명시" },
    { kind: "classified", label: "진료명 기반 분류 후보 · 진료과 이력 확정 아님", associationText: "Encounter 진료명에서 분류한 탐색 후보 · 실제 진료과 배정 아님" },
  ];

  return (
    <section className="clinical-card clinical-body-workspace" aria-labelledby="clinicalBodyTitle">
      <div className="card-heading">
        <div><p className="rail-eyebrow">CARE BY DEPARTMENT</p><h3 id="clinicalBodyTitle">신체·진료과 기록 지도</h3></div>
        <span className="source-badge">확인·후보 분리</span>
      </div>
      <p className="clinical-body-guidance">전신 3D 모형을 드래그해 돌려 보고 진료과 표식을 선택하면, 진료과 필드로 확인된 진료와 해당 처방을 봅니다. 진료명 기반 분류 후보와 질환 기반 탐색 신호는 별도 윤곽으로 구분하며, 확인된 진료 이력이나 의뢰 판단으로 보지 않습니다.</p>

      <div className="clinical-body-overview" aria-label="신체·진료과 지도 요약">
        <div><span>진료 연결 영역</span><strong id="bodyAreaCount">{atlas.totals.careAreas}개</strong></div>
        <div><span>지도 표시 진료</span><strong id="bodyVisitCount">{atlas.totals.visits}건</strong></div>
        <div><span>지도 표시 처방</span><strong id="bodyMedicationCount">{atlas.totals.medications}건</strong></div>
        <div><span>질환 기반 탐색 영역</span><strong id="bodySignalAreaCount">{atlas.totals.signalAreas}개</strong></div>
        <div><span>진료과 미지정 약물</span><strong id="bodyUnassignedMedicationCount">{atlas.totals.unassignedMedications}건</strong></div>
      </div>

      <p className="clinical-body-boundary" id="bodyProjectionNotice" role="status" aria-live="polite">
        {atlas.totals.careAreas
          ? `진료과 필드로 확인된 진료 ${atlas.totals.declaredVisits}건을 ${atlas.totals.careAreas}개 영역에 표시하고, 진료 ID로 연결된 처방 ${atlas.totals.declaredMedications}건을 함께 보여 줍니다.${candidateNotice} 질환 기반 탐색 영역 ${atlas.totals.signalAreas}개는 진료 이력과 분리했습니다.${unassignedNotice.length ? ` ${unassignedNotice.join("과 ")}은 별도로 남겼습니다.` : ""}`
          : `진료과 필드로 확인된 진료는 없습니다.${candidateNotice} 질환 기반 탐색 영역 ${atlas.totals.signalAreas}개는 진료 이력이 아닌 별도 신호로 표시합니다.${unassignedNotice.length ? ` ${unassignedNotice.join("과 ")}은 임의로 배정하지 않았습니다.` : ""}`}
      </p>

      <div className="clinical-body-layout">
        <div className="clinical-body-map">
          <div className="body-stage clinical-body-stage" ref={stageRef}
            aria-describedby="bodyMapInstructions bodyProjectionNotice"
            data-body-3d=""
            data-body-model="/assets/body-atlas-3d-v4.glb"
            data-body-context="emr"
            data-body-alt="회색 신체 외피와 내부 장기를 함께 확인하는 회전 가능한 3D 진료과 기록 지도">
            <p className="visually-hidden" id="bodyMapInstructions">전신 위 표식이나 아래 진료과 목록을 선택하면 해당 진료와 처방 상세가 표시됩니다.</p>
            <div className="human-figure" aria-label="진료과별 신체 기록 지도">
              <img className="human-figure__image" src="/assets/body-atlas-v5.webp" width={1024} height={1536} alt="" aria-hidden="true" decoding="async" />
              {BODY_AREAS.map(([areaId, , department, hotspotClass]) => {
                const areaData = atlas.areas.find(({ id }) => id === areaId);
                return (
                  <button
                    key={areaId}
                    className={areaData ? areaControlClass(`body-hotspot ${hotspotClass}`, areaData, areaData.id === area?.id) : `body-hotspot ${hotspotClass}`}
                    data-body-area={areaId}
                    type="button"
                    aria-pressed={areaData ? areaData.id === area?.id : false}
                    title={areaData ? `${areaData.department} · ${bodyAreaStatus(areaData)}` : undefined}
                    onClick={() => setSelectedAreaId(areaId)}>
                    <span className="body-hotspot__core" aria-hidden="true"></span>
                    <span className="visually-hidden">{department} 기록 보기</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="department-index clinical-department-index" aria-label="진료과별 기록 상태">
            {BODY_AREAS.map(([areaId, title, department]) => {
              const areaData = atlas.areas.find(({ id }) => id === areaId);
              return (
                <button
                  key={areaId}
                  className={areaData ? areaControlClass("body-caption", areaData, areaData.id === area?.id) : "body-caption"}
                  data-body-area={areaId}
                  type="button"
                  aria-pressed={areaData ? areaData.id === area?.id : false}
                  aria-label={areaData ? `${areaData.department}: ${bodyAreaStatus(areaData)}${areaData.id === area?.id ? ". 현재 선택됨" : ". 상세 보기"}` : undefined}
                  title={areaData ? `${areaData.department} · ${bodyAreaStatus(areaData)}` : undefined}
                  onClick={() => setSelectedAreaId(areaId)}>
                  <span className="body-caption__title">{title}</span>
                  <span className="body-caption__department">{department}</span>
                  <span className="body-caption__status">{areaData ? bodyAreaStatus(areaData) : "기록 확인 중"}</span>
                </button>
              );
            })}
          </div>

          <div className="body-key clinical-body-key" aria-label="지도 표기">
            <span className="body-key__legend"><i className="body-key__dot body-key__dot--active" aria-hidden="true"></i>진료 기록 연결</span>
            <span className="body-key__legend"><i className="body-key__dot clinical-body-key__dot--candidate" aria-hidden="true"></i>진료명 기반 분류 후보</span>
            <span className="body-key__legend"><i className="body-key__dot clinical-body-key__dot--signal" aria-hidden="true"></i>질환 기반 탐색 영역 · 진료 이력 아님</span>
            <span className="body-key__legend"><i className="body-key__dot" aria-hidden="true"></i>연결 기록 없음</span>
            <span className="body-key__legend"><span className="clinical-body-key__selected" aria-hidden="true">✓</span>현재 선택</span>
          </div>
        </div>

        <aside className="clinical-body-detail" aria-labelledby="bodyDetailTitle" aria-live="polite">
          <header className="clinical-body-detail__header">
            <div>
              <p className="rail-eyebrow">SELECTED DEPARTMENT</p>
              <h4 id="bodyDetailTitle">{area ? area.title : "진료과를 선택하세요"}</h4>
              <p id="bodyDetailDepartment">{area ? area.department : "전신 표식이나 진료과 목록을 누르면 기록을 확인할 수 있습니다."}</p>
            </div>
            <span className="source-badge" id="bodyDetailCount">{area ? bodyAreaRecordCount(area) : 0}건</span>
          </header>

          {area ? (
            <>
              <section className="clinical-body-detail__section" aria-labelledby="bodyVisitTitle">
                <div className="clinical-body-detail__heading"><h5 id="bodyVisitTitle">진료·분류 후보</h5><span>진료과 필드 확인 / 진료명 후보</span></div>
                <ol id="bodyVisitList" className="clinical-body-record-list">
                  {area.visits.length === 0 ? <li className="clinical-body-empty">이 영역에 진료과가 확인되거나 분류 후보로 제시된 진료 기록이 없습니다.</li> : visitGroups.flatMap((group) => {
                    const visits = area.visits.filter(({ association }) => association.kind === group.kind);
                    if (!visits.length) return [];
                    return [
                      <li className="clinical-body-list-group-label" key={`label-${group.kind}`}>{group.label}</li>,
                      ...visits.map((visit) => (
                        <BodyRecord key={visit.id} record={visit} statusText={visit.lifecycleLabel}
                          meta={[displayDate(visit.date), visit.department || (visit.association.kind === "classified" ? "진료과 필드 없음" : area.department), visit.clinician, visit.room].filter(Boolean).join(" · ")}
                          association={group.associationText} onOpenChart={onOpenChart} />
                      )),
                    ];
                  })}
                </ol>
              </section>

              <section className="clinical-body-detail__section" aria-labelledby="bodyMedicationTitle">
                <div className="clinical-body-detail__heading"><h5 id="bodyMedicationTitle">이 진료의 처방 약물</h5><span>진료 ID로 연결</span></div>
                <ol id="bodyMedicationList" className="clinical-body-record-list">
                  {area.medications.length === 0 ? <li className="clinical-body-empty">이 진료과의 진료 ID에 연결된 처방 약물이 없습니다.</li> : area.medications.map((medication) => (
                    <BodyRecord key={medication.id} record={medication} statusText={medication.lifecycleLabel}
                      meta={prescriptionSummary(medication.prescription) || [medication.code, displayDate(medication.date)].filter(Boolean).join(" · ") || "처방 상세 없음"}
                      association={medication.association.encounterAreaKind === "declared"
                        ? `Encounter ID ${medication.encounterId}에 직접 연결 · 진료과 필드 확인`
                        : `Encounter ID ${medication.encounterId}에 직접 연결 · 진료명 기반 진료과 분류 후보 · 진료과 이력 확정 아님`}
                      onOpenChart={onOpenChart} />
                  ))}
                </ol>
              </section>

              <section className="clinical-body-detail__section" aria-labelledby="bodyConditionTitle">
                <div className="clinical-body-detail__heading"><h5 id="bodyConditionTitle">관련 활성 문제</h5><span>탐색용 분류</span></div>
                <ol id="bodyConditionList" className="clinical-body-record-list">
                  {area.conditions.length === 0 ? <li className="clinical-body-empty">이 영역에 분류된 확정 활성 문제는 없습니다.</li> : area.conditions.map((condition) => (
                    <BodyRecord key={condition.id} record={condition} statusText="확정 활성 문제"
                      meta={[condition.code || "코드 없음", displayDate(condition.date)].join(" · ")}
                      association="확정 active 진단의 코드·표시명 기반 탐색 분류 · 진료과 배정 또는 의뢰 판단 아님"
                      onOpenChart={onOpenChart} />
                  ))}
                </ol>
              </section>
            </>
          ) : null}

          <p className="clinical-body-detail__boundary" id="bodyDetailBoundary">
            {exclusions.length ? `${exclusions.join("과 ")}은 임의로 배정하지 않아 이 목록에서 제외했습니다. ` : ""}약물은 같은 진료 ID가 있을 때만 해당 영역에 표시합니다. 진료명 기반 후보는 확인된 진료과 이력으로 집계하지 않으며, 질환 기반 탐색 신호는 진료과 배정·의뢰 또는 진료 이력이 아닙니다.
          </p>
        </aside>
      </div>
    </section>
  );
}
