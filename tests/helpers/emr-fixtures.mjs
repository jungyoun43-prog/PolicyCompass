import { EncounterTab } from "../../components/emr/tabs/encounter-tab.jsx";
import { createDemoEmrState } from "../../src/emr-demo-state.js";
import { completeEncounter } from "../../src/emr-encounter.js";
import { renderComponent } from "./render.mjs";

const NOW = "2026-09-02T00:00:00.000Z";

/**
 * The encounter tab rendered for the demo's selected patient after their
 * current encounter is completed, with inert store/callback stubs. Effects do
 * not run under the server renderer, so portals (dialogs, visit context) are
 * absent and the markup is the tab's own.
 */
export function renderEncounterTab() {
  const state = createDemoEmrState(NOW);
  const patient = state.patients.find(({ id }) => id === state.selectedPatientId);
  const encounter = patient.events.find(({ id }) => id === state.selectedEncounterId);
  const completed = completeEncounter(state, patient.id, encounter.id, {}, "2026-09-02T09:00:00.000Z");
  const completedPatient = completed.patients.find(({ id }) => id === patient.id);
  return renderComponent(EncounterTab, {
    patient: completedPatient,
    encounter: completedPatient.events.find(({ id }) => id === encounter.id),
    preflightEvaluations: [],
    store: { applyMutation: async () => {}, setStatus: () => {} },
    viewedEncounterId: "",
    setViewedEncounterId: () => {},
    selectTab: () => {},
    dirtyGuardsRef: { current: {} },
    blockClinicalContextChange: () => false,
    visitSlot: null,
  });
}
