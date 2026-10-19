# PolicyCompass physician flow implementation plan

This is a concrete local plan following the user's approved design. The optional writing-plans skill was searched for in the installed skill roots and is unavailable; this plan is authored directly.

## Ownership

The existing PolicyCompass frontend agent is the single writer for runtime UI files and any directly related tests. The coordinator owns PRODUCT.md, planning documents, final design documentation and integration verification. Reuse the existing QA role for a focused independent review. No new agents or dependencies.

## 1. Preserve and pin

- Record user selection and mark proposal-flow as the chosen direction.
- Back up current UI/design files with matching SHA-256 before editing.
- Capture product truth in PRODUCT.md.
- Run the required Impeccable direction seed with the user's already-pinned flow direction; the roll cannot replace their choice.
- Record a code-led surface direction contract and inspect it before implementation.

## 2. Build the committed flow

- Make clinical navigation a deliberate indigo rail on desktop and usable compact navigation on phone.
- Reduce first-use help to an accessible disclosure without losing the example review entry.
- Put selected-patient identity/allergies alongside the current work; make the patient queue responsive without remounting or discarding forms.
- Restructure the Encounter as a broad vertical SOAP worksheet with clear existing diagnosis/prescription/order entry and supporting history disclosure.
- Keep section navigation free; never auto-complete, auto-sign, add new persisted clinical states or change draft ownership.
- Expand the mobile prescription composer to the available viewport, expose field labels and keep action/content regions readable.
- Remove overridden/orphaned UI rules introduced by this change where practical, not unrelated cleanup.

## 3. Verify semantics and state

Use existing relevant render/component tests and the existing synthetic prescription regression where available. Add only checks that meaningfully cover changed navigation/disclosure behavior or state preservation. Run scoped lint and diff checks. Update assertions only where the old visual contract intentionally changed; preserve safety/ownership assertions.

## 4. Integrate and review

The coordinator runs production build, full lint and full unit suite once after the frontend changes settle. Browser verification uses synthetic /emr?demo=1, a new headless profile and no real model/API calls. Batch desktop and 390px mobile captures for the actual layout, section navigation and prescription states. Record geometry, visible labels, touch control size, overflow, console exceptions and cleanup ownership.

Pass the actual screenshots, approved flow reference, contract and source diff to the existing QA role. Apply material findings as one batch, rebuild only as necessary, then perform one confirmation over the affected states. Avoid endless cosmetic passes.

## 5. Finish

Verify original backup hashes, current tested hashes and changed file list. Update the clinical DESIGN.md section and machine-readable design tokens from the built result while preserving the personal companion and two-app product boundary. Leave a concise evidence report and before/after screenshots. Stop owned helpers. No deployment, commit or push.

## Completion — 2026-10-19

Implemented and independently reviewed. Fresh build `WSSz97PI1uLMTemtL51UE` matches 144 recorded source hashes. Full unit suite 667/667 (skip 0), build/lint/diff exit 0, actual-app checks 32/32, mobile scroll checks 12/12, isolated prescription regression 12/12 and context-menu focus checks 2/2 passed. Eight actual desktop/mobile captures and the last-medication scroll capture were inspected.

The first review's F1–F4 were corrected as one batch; the independent confirmation verdict is ship, all four resolved. This is limited to the tested synthetic-data Chrome build. Real devices, software keyboards, assistive devices and real persistence remain outside the verification scope. All 23 backup checks passed, the normative two-app architecture text is identical, and owned server/browser readback found no remaining helper. Evidence and the QA report are in the external `policy/flow-implementation` artifact folder for this dated UI round. No commit, push or deployment.
