/** The connected-life-signals motif every page carries in its lead heading. */
export function SignalKicker({ className = "", label }) {
  return (
    <p className={`${className} signal-kicker`.trim()}>
      <span className="signal-thread" aria-hidden="true">
        <svg viewBox="0 0 76 22" focusable="false">
          <path className="signal-thread__line" d="M5 15 C18 15 20 6 33 6 S49 16 70 11" />
          <path className="signal-thread__line signal-thread__line--inferred" d="M33 6 C43 3 54 4 70 11" />
          <circle className="signal-thread__node signal-thread__node--recorded" cx="5" cy="15" r="3" />
          <circle className="signal-thread__node signal-thread__node--recorded" cx="33" cy="6" r="3" />
          <circle className="signal-thread__node signal-thread__node--inferred" cx="70" cy="11" r="3" />
        </svg>
      </span>
      <span className="signal-kicker__label">{label}</span>
    </p>
  );
}
