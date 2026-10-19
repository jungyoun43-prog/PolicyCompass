# PolicyCompass physician clinical flow design

Status: approved by the user on 2026-10-19.
User choice: “진료 흐름 · 기록과 다음 조작에 집중 (추천)”.
Scope: this project's clinical workspace and prescription composer; independently designed from the other projects.

## Problem and resulting behavior

The captured 390×844 baseline put SOAP at y=1358px and prescription entry at y=2221px, after long onboarding and patient content. The prescription composer was 460px high and visually hid dose/route-related labels. The new layout puts the selected patient and current work first, makes diagnosis/prescription/order actions easy to reach, and uses the available mobile viewport for the prescription task.

## Approved composition

A narrow indigo clinical navigation rail, an orderly patient queue, a compact selected-patient/allergy context, and a broad light documentation worksheet form the desktop. SOAP reads in labelled vertical rows. “기록 · 진단 · 처방 · 검사 · 완료” provides free navigation to existing work; it does not impose a new state machine or mandatory order. Existing save, completion and signing behaviors remain explicit actions. Past records can be opened as supporting context without dominating the worksheet.

On phones, patient identification/allergies remain visible, the queue can be opened when needed, and optional onboarding is a compact help disclosure. The prescription composer fills the available height, visibly labels its existing fields, and reserves its action area without hiding the editable content.

## Visual system

Clinical-only indigo navigation, graphite text, white/cool gray worksheets, restrained separators and existing workhorse Korean typography. Normal-weight clinical body text, deliberate heading/action hierarchy, tabular counts, clear native inputs/selects and focus states. Do not import generated example identities, invented fields or controls from the image. The proposal is a layout/style reference, not a raster UI or a mandate to invent unavailable functionality.

## Data flow and errors

No changes to clinical storage, model requests, rule aggregation, patient transfer or clinical engines. Preserve all dirty guards and context ownership. Other medications' drafts and newer edits during asynchronous save survive. A failed save preserves inputs; repeated in-flight submissions remain blocked. A completed/reviewed/signed state can only come from the existing model.

## Accessibility and responsive behavior

Use semantic tab/navigation/disclosure controls with honest labels and focus behavior. No duplicate patient or field IDs. Hide/collapse supporting regions without discarding pending forms or losing focus. Important allergy/identity content must not disappear with the patient queue. Mobile primary targets remain at least 44px, fields remain legible with visible labels, and page/modal controls remain usable at 390px and desktop widths. Reduced motion is respected.

## Validation

Review actual desktop/mobile working states, not only a full-page thumbnail. Confirm patient selection, active Encounter editing, free section navigation, opening/closing past context, prescription empty/results states, visible labels, draft retention and save error handling. Use the meaningful existing component/store tests, lint and production build. Then perform one batched desktop/mobile verification and one bounded fix/confirmation if needed. Report actual-device/keyboard limitations separately.

## Preservation and delivery

The pre-change working files were copied and SHA-256 verified under the policy flow implementation artifact folder. Additional files must be backed up before modification. Preserve unrelated existing work and the previous stabilization fixes. Do not commit, push, deploy or change other products. At finish update only the clinical visual-system section of DESIGN.md while preserving its normative product/data boundaries, and record the implemented design tokens.
