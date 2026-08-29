"use client";

import { useHorizontalScrollPosition } from "./use-horizontal-scroll.js";
import { patientAgeLabel, SEX_LABELS } from "../../lib/emr/format.js";
import { finalizedPatient } from "../../lib/emr/selectors.js";

const TABS = [
  ["encounter", "오늘 진료"],
  ["overview", "환자 요약"],
  ["chart", "과거 기록"],
  ["graph", "신체 지도"],
  ["claims", "급여 보드"],
  ["journey", "Journey"],
  ["data", "감사·데이터"],
];

/**
 * A slim sticky bar: the tab list plus just enough identity to know whose
 * chart is open while scrolled. The full identity and safety context lives
 * in the patient rail's summary card.
 */
export function WorkspaceHeader({ patient, activeTab, onSelectTab }) {
  const tabListRef = useHorizontalScrollPosition();
  const chart = finalizedPatient(patient);
  const firstAllergy = chart.events.find((event) => event.type === "allergy");

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
    <div className="patient-workspace-navigation">
      <span className="workspace-tabs__context" aria-hidden="true">
        <b>{patient.name}</b>
        <span>{[patientAgeLabel(patient), SEX_LABELS[patient.sex]].filter(Boolean).join(" · ")}</span>
        {firstAllergy ? <em className="workspace-tabs__allergy">알레르기</em> : null}
      </span>
      <div className="workspace-tabs" role="tablist" aria-label="선택 환자 화면" aria-orientation="horizontal" onKeyDown={onTabKeyDown} ref={tabListRef}>
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
