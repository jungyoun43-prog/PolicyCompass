"use client";

import { useEffect, useRef } from "react";

/**
 * Mirrors the horizontal-scroll affordance from the previous EMR controller:
 * the container advertises where it is scrolled (none/start/middle/end) so the
 * stylesheet can draw edge fades, and it keeps the value fresh on scroll,
 * resize, and content changes.
 */
export function updateHorizontalScrollPosition(container) {
  if (!container) return;
  const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);
  const position = maxScroll <= 1
    ? "none"
    : container.scrollLeft <= 1
      ? "start"
      : container.scrollLeft >= maxScroll - 1
        ? "end"
        : "middle";
  container.dataset.scrollPosition = position;
}

export function useHorizontalScrollPosition() {
  const ref = useRef(null);
  useEffect(() => {
    const container = ref.current;
    if (!container) return undefined;
    const update = () => updateHorizontalScrollPosition(container);
    update();
    container.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => {
      container.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);
  return ref;
}

/** Scrolls the selected patient card to the center of a horizontal list. */
export function centerSelectedPatientCard(list, patientId, behavior = "smooth") {
  if (!list || !patientId) return;
  const button = list.querySelector(`[data-patient-id="${CSS.escape(patientId)}"]`);
  const item = button?.closest("li");
  const maxScroll = Math.max(0, list.scrollWidth - list.clientWidth);
  if (!item || maxScroll <= 1) return;
  const centered = item.offsetLeft - ((list.clientWidth - item.offsetWidth) / 2);
  list.scrollTo({
    left: Math.max(0, Math.min(maxScroll, centered)),
    behavior,
  });
}
