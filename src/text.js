/**
 * The one place free-text input is trimmed, bounded and scrubbed. Every
 * module used to carry its own `cleanText`; they differed only in the maximum
 * length, the fallback for non-strings, whether runs of whitespace collapse,
 * and how control characters are handled. Those differences are options here,
 * and `textCleaner` fixes them once per module so call sites stay short.
 */

/** A global character class built from inclusive code-point ranges. */
function characterClass(...ranges) {
  const members = ranges
    .map(([from, to = from]) => `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`)
    .join("");
  return new RegExp(`[${members}]`, "g");
}

const CONTROL_PATTERNS = {
  none: null,
  /** C0 controls and DEL, minus tab, line feed and carriage return. */
  "keep-line-breaks": characterClass([0x00, 0x08], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f]),
  /** Every C0 control and DEL. */
  c0: characterClass([0x00, 0x1f], [0x7f]),
  /** C0 + C1 controls, zero-width space/joiners, word joiner and BOM. */
  invisible: characterClass([0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200d], [0x2060], [0xfeff]),
};

/**
 * @param {unknown} value
 * @param {object} [options]
 * @param {string} [options.fallback=""] Returned when `value` is not a string.
 * @param {number} [options.maxLength=Infinity] Characters kept after cleaning.
 * @param {boolean} [options.collapseWhitespace=false] Fold whitespace runs to one space.
 * @param {"none"|"keep-line-breaks"|"c0"|"invisible"} [options.stripControl="none"]
 * @param {string} [options.controlReplacement=" "] What a stripped control becomes.
 * @param {boolean} [options.normalizeUnicode=false] Apply NFKC before cleaning.
 */
export function cleanText(value, {
  fallback = "",
  maxLength = Infinity,
  collapseWhitespace = false,
  stripControl = "none",
  controlReplacement = " ",
  normalizeUnicode = false,
} = {}) {
  if (typeof value !== "string") return fallback;
  let text = normalizeUnicode ? value.normalize("NFKC") : value;
  const controlPattern = CONTROL_PATTERNS[stripControl];
  if (controlPattern) text = text.replace(controlPattern, controlReplacement);
  if (collapseWhitespace) text = text.replace(/\s+/g, " ");
  text = text.trim();
  return maxLength === Infinity ? text : text.slice(0, maxLength);
}

/**
 * Builds a module-local cleaner with fixed options. The returned function
 * takes `(value, maxLength)` so existing `cleanText(value, 240)` call sites
 * keep working; pass `fallbackSecond: true` for the `(value, fallback, maxLength)`
 * shape a few modules use.
 */
export function textCleaner({ fallbackSecond = false, ...defaults } = {}) {
  if (fallbackSecond) {
    return (value, fallback = defaults.fallback ?? "", maxLength = defaults.maxLength) =>
      cleanText(value, { ...defaults, fallback, maxLength });
  }
  return (value, maxLength = defaults.maxLength) => cleanText(value, { ...defaults, maxLength });
}
