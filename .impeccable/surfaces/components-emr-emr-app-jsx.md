---
version: 1
slug: "components-emr-emr-app-jsx"
primary_target: "components/emr/emr-app.jsx"
related_targets: ["components/emr/tabs/encounter-tab.jsx","components/emr/patient-rail.jsx","components/emr/prescription-dialog.jsx","src/clinical-ui.css","src/emr-dialog-responsive.css"]
---

## Direction contract

THESIS: This physician screen owns today's clinical documentation and the next explicit action. It removes the large onboarding-first opening and the cramped mobile prescription task.

OWN-WORLD: A committed indigo clinical navigation rail, graphite text and cool white worksheets. Normal-weight Korean UI text, clear labelled native inputs, restrained separators and consistent button states. The patient companion and other projects retain their own design context.

STORY: The clinician identifies the selected patient and allergies, edits the active Encounter, freely moves to diagnosis/prescription/orders, checks supporting history and explicitly saves or completes. Errors and pending input remain visible rather than becoming success.

FIRST VIEWPORT: Desktop has a slim primary navigation rail, a separate patient queue, a compact selected-patient/allergy strip and a broad vertically labelled SOAP worksheet; supporting history is collapsible and next actions have a consistent visible area. On 390px mobile, queue/help do not precede a long wall of content; the selected patient and current task lead. Prescription uses the available viewport with visible labels and a reserved action region.

FORM: User-pinned “진료 흐름 · 기록과 다음 조작에 집중”, chosen from the project's own proposals. Code-led Operate build. Seed df7a1dfa assigned index 3, but the script explicitly states a user-pinned choice outranks the roll. Do not reopen the choice or apply a foreign navigation metaphor. Proposal-flow.png is a composition/style critique reference, not an exact raster or content contract.

SIGNATURE: A “현재 진료” section-navigation strip ties record, diagnosis, prescriptions, orders and completion context to the actual work without imposing new stage gates; keyboard/focus returns make each move predictable.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Verified finish — 2026-10-19

The existing independent QA role confirmed F1–F4 resolved for build `WSSz97PI1uLMTemtL51UE`: bounded verdict ship. All 144 source hashes and eight actual capture hashes match the integration evidence. Full unit 667/667 and browser/draft/focus checks passed. DESIGN.md and its machine-readable sidecar document the implemented clinical scope; no new raster ships with the product. Chrome synthetic-demo verification does not certify real devices, software keyboards, assistive devices, real persistence or the whole application. No deployment was performed.
