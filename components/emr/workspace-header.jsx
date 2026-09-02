"use client";

import { Tabs as TabsPrimitive } from "radix-ui";

import { useHorizontalScrollPosition } from "./use-horizontal-scroll.js";

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
 * A slim sticky bar on Radix Tabs: the tab list fills the bar, with
 * Arrow/Home/End keyboard handling from the primitive. Patient identity
 * lives in the patient rail, so the bar carries no chip.
 */
export function WorkspaceHeader({ onSelectTab }) {
  const tabListRef = useHorizontalScrollPosition();

  return (
    <div className="patient-workspace-navigation">
      <TabsPrimitive.List className="workspace-tabs" aria-label="선택 환자 화면" ref={tabListRef} loop>
        {TABS.map(([key, label]) => (
          <TabsPrimitive.Trigger key={key} value={key} id={`tab-${key}`} data-tab={key} onClick={() => onSelectTab?.(key)}>{label}</TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
    </div>
  );
}
