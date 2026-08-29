/**
 * Pure read helpers over the EMR state. React components derive their views
 * through these, keeping the pre-React judgement rules word for word.
 */
import {
  buildClaimBoard,
  CLAIM_LANE_ORDER,
} from "../../src/claim-rules.js";
import {
  createClaimPreflightPatient,
  createFinalizedPatientView,
} from "../../src/emr-model.js";
import { getEncounter } from "../../src/emr-encounter.js";
import { isInternalExampleCoding, today } from "./format.js";

export function encounterQueueStatus(encounter) {
  if (!encounter) return "none";
  if (encounter.recordStatus === "final" && encounter.status === "finished") {
    if (encounter.signature?.status === "external") return "external";
    if (encounter.signature?.status === "legacy") return "legacy";
    return "signed";
  }
  if (encounter.status === "finished") return "completed";
  if (encounter.status === "in-progress") return "in-progress";
  if (encounter.status === "arrived") return "waiting";
  return "none";
}

export function unresolvedEncounterForPatient(patient) {
  return patient?.events
    ?.filter((event) => event.type === "encounter"
      && event.recordStatus === "draft"
      && event.source?.kind !== "import"
      && ["arrived", "in-progress", "finished"].includes(event.status))
    .sort((left, right) => {
      const priority = { "in-progress": 0, arrived: 1, finished: 2 };
      return (priority[left.status] ?? 9) - (priority[right.status] ?? 9)
        || String(right.arrivedAt).localeCompare(String(left.arrivedAt));
    })[0] ?? null;
}

export function todayEncounterForPatient(patient) {
  const unresolved = unresolvedEncounterForPatient(patient);
  if (unresolved) return unresolved;
  return patient?.events
    ?.filter((event) => event.type === "encounter"
      && event.date === today()
      && event.source?.kind !== "import"
      && event.recordStatus !== "entered-in-error")
    .sort((left, right) => String(right.arrivedAt).localeCompare(String(left.arrivedAt)))[0] ?? null;
}

export function currentEncounterFor(patient, { viewedEncounterId = "", selectedEncounterId = "" } = {}) {
  if (!patient) return null;
  const viewed = getEncounter(patient, viewedEncounterId);
  if (viewed && viewed.recordStatus !== "entered-in-error") return viewed;
  const unresolved = unresolvedEncounterForPatient(patient);
  if (unresolved) return unresolved;
  const explicitlySelected = getEncounter(patient, selectedEncounterId);
  if (explicitlySelected?.date === today()
    && explicitlySelected.source?.kind !== "import"
    && explicitlySelected.recordStatus !== "entered-in-error") return explicitlySelected;
  return patient.events
    .filter((event) => event.type === "encounter"
      && event.date === today()
      && event.source?.kind !== "import"
      && event.recordStatus !== "entered-in-error")
    .sort((left, right) => {
      const priority = { "in-progress": 0, arrived: 1, finished: 2 };
      return (priority[left.status] ?? 9) - (priority[right.status] ?? 9)
        || String(right.arrivedAt).localeCompare(String(left.arrivedAt));
    })[0] ?? null;
}

export function finalizedPatient(patient) {
  return patient ? createFinalizedPatientView(patient) : null;
}

export function claimEvaluationsFor(patient, rules, { includeCurrentDraft = false, encounterId = "", asOf = today() } = {}) {
  if (!patient) return [];
  const activeEncounter = getEncounter(patient, encounterId) ?? unresolvedEncounterForPatient(patient);
  const evaluationPatient = includeCurrentDraft && activeEncounter
    ? createClaimPreflightPatient(patient, activeEncounter.id)
    : createClaimPreflightPatient(patient);
  const board = buildClaimBoard([evaluationPatient], rules, asOf);
  return CLAIM_LANE_ORDER.flatMap((status) => board.lanes[status]).map((evaluation) => ({
    ...evaluation,
    preflight: includeCurrentDraft,
  }));
}

export function claimEvaluationsForState(stateInput, asOf = today()) {
  const board = buildClaimBoard(stateInput.patients, stateInput.rules, asOf);
  return CLAIM_LANE_ORDER.flatMap((status) => board.lanes[status]);
}

export function confirmedActiveConditions(patient) {
  const chart = finalizedPatient(patient);
  const seen = new Set();
  return (chart?.events ?? [])
    .filter((event) => (
      event.type === "condition"
      && event.recordStatus === "final"
      && event.status === "active"
      && event.certainty === "confirmed"
      && (!event.verificationStatus || event.verificationStatus === "confirmed")
      && !isInternalExampleCoding(event)
    ))
    .sort((left, right) => String(right.date).localeCompare(String(left.date))
      || Number(right.diagnosisRole === "primary") - Number(left.diagnosisRole === "primary"))
    .filter((event) => {
      const key = [event.system, event.code, event.label].filter(Boolean).join("|").toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
