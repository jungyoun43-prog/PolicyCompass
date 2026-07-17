# VitaGraph frontend design state

## Objective

Turn the current health-graph prototype into a credible paid-beta MVP whose concrete outcome is a printable appointment-preparation brief.

## Locked decisions

- Audience: Korean-speaking adult managing several chronic topics for self or a parent.
- Job: organize scattered symptoms, measurements, and known conditions into one appointment page in about ten minutes.
- Primary outcome: Visit Brief; body map and connections are supporting views.
- Honest beta: local browser processing and storage only. No account, cloud sync, checkout, compliance certification, or live AI claims.
- Visual direction: Apple-style focal restraint + PicnicHealth human/record orbit + Parsley clinical warmth, expressed with VitaGraph’s own palette.
- Generated images provide atmosphere only. All facts, values, controls, and product proof remain native UI.
- Sample and private input are separate. Sample data is never persisted to Journey.

## Reference evidence

- 24 Lazyweb results across three health-dashboard queries; five screens inspected.
- Eight adjacent paid products reviewed: Function Health, Superpower, InsideTracker, Mito Health, Guava, Heads Up Health, Oura, Exist.
- Pricing hypothesis: KRW 6,900/month once hosted paid capabilities are real; present local beta cannot accept money honestly.

## Verification ledger

- Baseline: `npm test` 37/37 passed before changes.
- Baseline desktop screenshots: landing, map, connections, insights, journey.
- Baseline mobile screenshot: landing.
- Final checks pending: build/tests, all routes, 390/768/1280 layouts, keyboard/focus, reduced motion, print output, asset response headers.

## Deliberate debt

- Payment, identity, encrypted sync, recovery, legal policies, refund/support operations, and jurisdiction-specific medical/privacy review require product-owner decisions and external services.
- A real AI layer is intentionally excluded until its model, evidence, validation, monitoring, and privacy contract can be made truthful.
