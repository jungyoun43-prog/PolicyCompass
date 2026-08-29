"use client";

import { useEffect, useRef, useState } from "react";

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
export function RxDialog({ id, open, onClose, eyebrow, title, titleId, context, notice, noticeId, headerExtra, children }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog className="rx-dialog" id={id} aria-labelledby={titleId} ref={dialogRef} onClose={onClose} onCancel={onClose}>
      {open ? (
        <div className="rx-dialog__panel">
          <header className="rx-dialog__header">
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
              <button className="clinical-button rx-dialog__close" type="button" onClick={onClose}>닫기</button>
            </span>
          </header>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}

export function RxSearch({ id, label, placeholder, value, onChange, inputId }) {
  return (
    <form className="rx-search" id={id} role="search" noValidate autoComplete="off" spellCheck="false" onSubmit={(event) => event.preventDefault()}>
      <label className="rx-search__field" htmlFor={inputId}>{label}<input id={inputId} name="query" type="search" maxLength={120} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} /></label>
      <button className="clinical-button" type="submit">검색</button>
    </form>
  );
}
