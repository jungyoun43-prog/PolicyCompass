const MAX_QUERY_LENGTH = 240;
const MAX_INDEX_TEXT_LENGTH = 4_000;
const MAX_RESULTS = 50;
const MAX_ENTRY_ID_LENGTH = 720;
const MAX_TARGET_TEXT_LENGTH = 720;

const DOMAIN_PRIORITY = new Map([
  ["claim", 0],
  ["workflow", 0],
  ["adjudication", 1],
  ["quality", 2],
  ["rule", 3],
]);

const titleCollator = new Intl.Collator("ko", {
  numeric: true,
  sensitivity: "base",
  usage: "sort",
});

function cleanString(value, maxLength) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength);
}

/**
 * Produces the shared comparison form used by the claims search UI.
 * NFKC makes full-width codes searchable without changing the displayed data.
 */
export function normalizeClaimSearchText(value) {
  const text = cleanString(value, MAX_INDEX_TEXT_LENGTH);
  if (!text) return "";

  try {
    return text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
  } catch {
    return text.toLowerCase().replace(/\s+/gu, " ").trim();
  }
}

function sanitizeTargetValue(value, depth = 0) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return cleanString(value, MAX_TARGET_TEXT_LENGTH);
  if (depth >= 2) return null;

  if (Array.isArray(value)) {
    return value
      .slice(0, 16)
      .map((item) => sanitizeTargetValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }

  if (!value || typeof value !== "object") return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;

  const sanitized = {};
  Object.entries(value).slice(0, 24).forEach(([key, item]) => {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(key)) return;
    if (["__proto__", "prototype", "constructor"].includes(key)) return;
    const safeValue = sanitizeTargetValue(item, depth + 1);
    if (safeValue !== undefined) sanitized[key] = safeValue;
  });
  return sanitized;
}

/**
 * Creates a display-safe, immutable-by-convention search record. Invalid rows
 * return null so callers can pass mixed API data without leaking it into UI.
 */
export function createClaimSearchEntry(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  const id = cleanString(input.id, MAX_ENTRY_ID_LENGTH);
  const kind = cleanString(input.kind, 64);
  const domain = cleanString(input.domain, 64).toLowerCase();
  const title = cleanString(input.title, 240);
  if (!id || !kind || !domain || !title) return null;

  const targetCandidate = input.target
    && typeof input.target === "object"
    && !Array.isArray(input.target)
    ? sanitizeTargetValue(input.target)
    : {};

  return {
    id,
    kind,
    domain,
    title,
    subtitle: cleanString(input.subtitle, 500),
    searchText: cleanString(input.searchText, MAX_INDEX_TEXT_LENGTH),
    target: targetCandidate && typeof targetCandidate === "object" && !Array.isArray(targetCandidate)
      ? targetCandidate
      : {},
  };
}

function punctuationFold(value) {
  return value.replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/gu, " ").trim();
}

function compactFold(value) {
  return value.replace(/[\s\p{P}\p{S}]+/gu, "");
}

function entryMatches(entry, query) {
  const fields = [entry.title, entry.subtitle, entry.searchText, entry.id]
    .map(normalizeClaimSearchText)
    .filter(Boolean);
  const joined = fields.join(" ");
  const folded = punctuationFold(joined);
  const compact = compactFold(joined);
  const queryFolded = punctuationFold(query);
  const queryCompact = compactFold(query);

  if (joined.includes(query)) return true;
  if (queryFolded && folded.includes(queryFolded)) return true;
  if (queryCompact && compact.includes(queryCompact)) return true;

  const tokens = queryFolded.split(" ").filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => folded.includes(token));
}

function priorityFor(entry) {
  return DOMAIN_PRIORITY.get(entry.domain) ?? DOMAIN_PRIORITY.get(entry.kind) ?? 4;
}

function compareEntries(left, right) {
  const priorityDifference = priorityFor(left) - priorityFor(right);
  if (priorityDifference) return priorityDifference;

  const titleDifference = titleCollator.compare(left.title, right.title);
  if (titleDifference) return titleDifference;

  const domainDifference = left.domain.localeCompare(right.domain, "en");
  if (domainDifference) return domainDifference;
  return left.id.localeCompare(right.id, "en", { numeric: true });
}

/**
 * Searches a mixed claim/workflow/adjudication/quality/rule index without
 * mutating it. Domain ordering is intentionally stronger than relevance so
 * operators always see actionable claim work before reference material.
 */
export function searchClaimIndex(entries, query, limit = 12) {
  const normalizedQuery = normalizeClaimSearchText(query).slice(0, MAX_QUERY_LENGTH);
  if (!normalizedQuery || !Array.isArray(entries)) return [];

  const requestedLimit = Number.isFinite(limit) ? Math.trunc(limit) : 12;
  if (requestedLimit <= 0) return [];
  const safeLimit = Math.min(requestedLimit, MAX_RESULTS);

  const seenIds = new Set();
  return entries
    .map(createClaimSearchEntry)
    .filter(Boolean)
    .filter((entry) => entryMatches(entry, normalizedQuery))
    .sort(compareEntries)
    .filter((entry) => {
      if (seenIds.has(entry.id)) return false;
      seenIds.add(entry.id);
      return true;
    })
    .slice(0, safeLimit);
}
