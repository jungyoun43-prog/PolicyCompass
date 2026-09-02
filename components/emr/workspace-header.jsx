"use client";

import { Tabs as TabsPrimitive } from "radix-ui";

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
 * A slim sticky bar on Radix Tabs: the tab list plus just enough identity to
 * know whose chart is open while scrolled. Arrow/Home/End keyboard handling
 * comes from the primitive; the full identity lives in the patient rail.
 */
export function WorkspaceHeader({ patient, onSelectTab }) {
  const tabListRef = useHorizontalScrollPosition();
  const chart = finalizedPatient(patient);
  const firstAllergy = chart.events.find((event) => event.type === "allergy");

  return (
    <div className="patient-workspace-navigation">
      <span className="workspace-tabs__context" aria-hidden="true">
        <b>{patient.name}</b>
        <span>{[patientAgeLabel(patient).replace(/^만\s*/, ""), SEX_LABELS[patient.sex]].filter(Boolean).join(" · ")}</span>
        {firstAllergy ? <em className="workspace-tabs__allergy">알레르기</em> : null}
      </span>
      <TabsPrimitive.List className="workspace-tabs" aria-label="선택 환자 화면" ref={tabListRef} loop>
        {TABS.map(([key, label]) => (
          <TabsPrimitive.Trigger key={key} value={key} id={`tab-${key}`} data-tab={key} onClick={() => onSelectTab?.(key)}>{label}</TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
    </div>
  );
}
