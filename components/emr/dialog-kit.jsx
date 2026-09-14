"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { Button } from "@/components/ui/button";
import { displayDate, INSURANCE_LABELS, patientAgeLabel } from "../../lib/emr/format.js";

export function encounterDialogContext(patient, encounter) {
  return [
    patient.name,
    patientAgeLabel(patient),
    INSURANCE_LABELS[patient.insuranceType] ?? INSURANCE_LABELS.unknown,
    `진료일 ${displayDate(encounter.date)}`,
  ].filter(Boolean).join(" · ");
}

/** Hovering peeks, clicking pins — the ⓘ notice and the review pipeline share it. */
export function HoverPopover({ hostClassName, trigger, triggerClassName, triggerId, panelId, panel, panelClassName, ariaLabel }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const hostRef = useRef(null);
  return (
    <span
      className={hostClassName}
      ref={hostRef}
      onMouseEnter={() => { if (!pinned) setOpen(true); }}
      onMouseLeave={() => { if (!pinned) setOpen(false); }}
      onBlur={(event) => { if (!pinned && !hostRef.current?.contains(event.relatedTarget)) setOpen(false); }}
    >
      <button className={triggerClassName} type="button" id={triggerId} aria-expanded={open} aria-controls={panelId} aria-label={ariaLabel}
        onClick={() => { const next = !pinned; setPinned(next); setOpen(next); }}>{trigger}</button>
      <span className={panelClassName} id={panelId} hidden={!open}>{panel}</span>
    </span>
  );
}

/**
 * The shared entry-dialog frame: a real <dialog>, a sticky header carrying the
 * title, its scope notice, any extra header actions, and the way out.
 */
export function RxDialog({ id, open, onClose, onEscapeKeyDown, embedded = false, eyebrow, title, titleId, context, notice, noticeId, headerExtra, children }) {
  const contentRef = useRef(null);
  const drag = useRef(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const reset = () => setOffset({ x: 0, y: 0 });
    window.addEventListener("resize", reset);
    return () => window.removeEventListener("resize", reset);
  }, []);
  const move = (dx, dy, origin, rect) => setOffset({
    x: origin.x + Math.max(8 - rect.left, Math.min(dx, window.innerWidth - rect.right - 8)),
    y: origin.y + Math.max(8 - rect.top, Math.min(dy, window.innerHeight - rect.bottom - 8)),
  });
  const startDrag = (event) => {
    if (embedded || event.button !== 0 || event.target.closest("button, a, input, select, textarea")) return;
    drag.current = { x: event.clientX, y: event.clientY, offset, rect: contentRef.current.getBoundingClientRect() };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogPrimitive.Portal>
        {!embedded ? <DialogPrimitive.Overlay className="rx-dialog-overlay" /> : null}
        <DialogPrimitive.Content ref={contentRef} onEscapeKeyDown={onEscapeKeyDown} style={{ translate: `${offset.x}px ${offset.y}px` }} className="rx-dialog" data-embedded={embedded || undefined} id={id} aria-labelledby={titleId} aria-describedby={undefined} data-radix-rx-dialog>
          <DialogPrimitive.Title className="visually-hidden">{title}</DialogPrimitive.Title>
          <div className="rx-dialog__panel">
            <header className="rx-dialog__header rx-dialog__drag-handle" tabIndex={0} aria-label={`${title} 창 이동`} title="드래그 또는 방향키로 이동 · 더블클릭으로 가운데 정렬"
              onPointerDown={startDrag}
              onPointerMove={(event) => { const start = drag.current; if (start) move(event.clientX - start.x, event.clientY - start.y, start.offset, start.rect); }}
              onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
              onLostPointerCapture={() => { drag.current = null; }}
              onDoubleClick={(event) => { if (!event.target.closest("button, a")) setOffset({ x: 0, y: 0 }); }}
              onKeyDown={(event) => {
                if (embedded || event.target !== event.currentTarget || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
                event.preventDefault();
                move(event.key === "ArrowLeft" ? -20 : event.key === "ArrowRight" ? 20 : 0, event.key === "ArrowUp" ? -20 : event.key === "ArrowDown" ? 20 : 0, offset, contentRef.current.getBoundingClientRect());
              }}>
              <span className="rx-dialog__heading">
                <span className="rail-eyebrow">{eyebrow}</span>
                <span className="rx-dialog__titleline">
                  <span className="rx-dialog__title" id={titleId} role="heading" aria-level={3}>{title}</span>
                  <HoverPopover hostClassName="rx-notice" trigger="i" triggerClassName="rx-notice__summary" triggerId={noticeId}
                    panelId={`${noticeId}Panel`} panelClassName="rx-notice__body rx-notice__body--start" ariaLabel="이 화면의 사용 범위 안내"
                    panel={notice} />
                </span>
                <span className="rx-dialog__context">{context}</span>
              </span>
              <span className="rx-dialog__header-actions">
                {headerExtra}
                <Button className="rx-dialog__close" onClick={onClose}>닫기</Button>
              </span>
            </header>
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function RxSearch({ id, label, placeholder, value, onChange, inputId }) {
  return (
    <form className="rx-search" id={id} role="search" noValidate autoComplete="off" spellCheck="false" onSubmit={(event) => event.preventDefault()}>
      <label className="rx-search__field" htmlFor={inputId}>{label}<input id={inputId} name="query" type="search" maxLength={120} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} /></label>
      <Button type="submit">검색</Button>
    </form>
  );
}
