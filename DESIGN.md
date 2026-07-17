# VitaGraph Design System

## 1. Atmosphere & Identity

VitaGraph feels like a bright clinical atlas rather than a hospital portal. The signature is a white full-body field threaded into a vivid health graph, so body regions and related conditions feel like one explorable system. The product communicates possibility and clarity while avoiding diagnostic certainty.

## 2. Color

### Palette

| Role | Token | Value | Usage |
|---|---|---|---|
| Surface/primary | `--surface` | `#FFFFFF` | Page background |
| Surface/soft | `--surface-soft` | `#F6F7FB` | Input and graph canvases |
| Surface/raised | `--surface-raised` | `#FFFFFF` | Main panels |
| Text/primary | `--ink` | `#15141A` | Headlines and body |
| Text/secondary | `--muted` | `#6C6974` | Guidance and metadata |
| Border/subtle | `--line` | `#E7E5EC` | Controls and dividers |
| Interactive | `--accent` | `#F05A47` | Primary actions and focus |
| Data/cyan | `--data-cyan` | `#18B8C9` | Respiratory and monitoring nodes |
| Data/lime | `--data-lime` | `#A7C934` | Nutrition and lifestyle nodes |
| Data/violet | `--data-violet` | `#8B72E8` | Neurologic and mental-health nodes |
| Data/amber | `--data-amber` | `#F0A72E` | Metabolic caution nodes |
| Status/urgent | `--urgent` | `#C93838` | Emergency guidance only |

Coral is the sole interaction accent. Cyan, lime, violet, and amber are reserved for semantic graph encoding. No color may be used to claim a diagnosis.

## 3. Typography

### Scale

| Level | Size | Weight | Line Height | Usage |
|---|---|---|---|---|
| Display | `clamp(2.25rem, 4vw, 4.5rem)` | 760 | 1.02 | Product statement |
| H1 | `2rem` | 740 | 1.15 | Panel headline |
| H2 | `1.375rem` | 700 | 1.25 | Section title |
| H3 | `1rem` | 680 | 1.4 | Card title |
| Body/lg | `1.0625rem` | 480 | 1.65 | Introductory copy |
| Body | `0.9375rem` | 450 | 1.6 | Default content |
| Body/sm | `0.8125rem` | 500 | 1.5 | Supporting detail |
| Caption | `0.75rem` | 650 | 1.4 | Labels and metadata |

Primary stack: `Pretendard Variable, Noto Sans KR, ui-sans-serif, system-ui, sans-serif`. Noto Sans KR is loaded with `font-display: swap` so Korean labels remain legible in minimal Linux and cloud environments as well as on local devices.
Mono stack: `ui-monospace, SFMono-Regular, Consolas, monospace`.

## 4. Spacing & Layout

Base unit is 4px. Tokens: `--space-1` 4px, `--space-2` 8px, `--space-3` 12px, `--space-4` 16px, `--space-5` 20px, `--space-6` 24px, `--space-8` 32px, `--space-10` 40px, `--space-12` 48px.

Desktop uses a 12-column grid within 1480px. The data input takes 3 columns, body map 4 columns, and relationship graph 5 columns. Tablet collapses to 6 columns; mobile stacks all regions in reading order with 16px gutters.

## 5. Components

### Surface panel
- Structure: semantic section with title, optional controls, and content.
- Radius: 24px. Padding: 24px.
- States: default, focus-within, loading, empty, error.
- Accessibility: visible headings, landmark labels, no color-only status.

### Signal chip
- Structure: native button with `aria-pressed`.
- Radius: full pill. Padding: 8px 12px.
- States: default, hover, pressed, focus, disabled.

### Graph node
- Structure: an SVG group with a circular semantic orb and persistent labels below.
- Geometry: collision bounds include both the orb and its text footprint; branches use a smaller dashed orb.
- Layout: position is computed from relationship forces rather than rows, columns, or cards.
- States: default, related, selected, dragged, and keyboard focus.
- Accessibility: each group is keyboard selectable and every selection is mirrored in the detail rail.

### Explorer scene
- Structure: a dedicated full-viewport graph page with a floating toolbar, semantic SVG scene, and persistent detail rail.
- Layout: deterministic force-directed placement balances center gravity, node repulsion, relationship springs, and collision radii.
- Interaction: select to expand one-hop care branches, drag to pin a node, reset to recompute the scene, and return to the overview without losing the session map.
- Responsive: desktop uses scene plus detail rail; mobile stacks a minimum 560px scene above the detail rail.
- Accessibility: graph groups are keyboard selectable, visible focus is mandatory, and every selection is mirrored in text.

### FHIR import box
- Structure: compact local-file picker above manual entry, with format tag, privacy promise, and parse result.
- Scope: FHIR R4 Condition and Observation subset; unsupported records remain visible as a count and never become inferred diagnoses.
- States: idle, parsing, success, error. File size is capped at 2 MB.

### Evidence card
- Structure: connected condition, relationship category, plain-language rationale, and an external authoritative source.
- Language: describes why two topics are viewed together, never causality or a personalized medical conclusion.

### Journey timeline
- Structure: local snapshots on a vertical rail, followed by added/steady/removed comparison columns.
- Persistence: only explicit saves use browser local storage; each record can be removed and the entire history can be cleared.


### Application shell
- All routes use the same white atlas background: restrained coral light at the upper right and cyan light at the lower left; page-specific backgrounds are not allowed.
- Header: one 1480px content rail, 80px height, brand at left and explicit Main, Health Map, Connections, AI Insights, Journey navigation. Every route uses the identical `app-header → app-header__inner → app-brand + app-nav + app-header__action` contract; only the active navigation state changes. On compact layouts, the brand and action stay in the first row while the same five navigation links scroll in a dedicated second row.
- Page hero: each route begins on the same 1480px rail with 40px top and 48px bottom breathing room. A mono eyebrow, display heading, and bounded supporting copy create a shared start line.
- Primary workspace: Health Map has a balanced two-column input/body row. Full-width relationship and detail surfaces follow below; no empty third column is permitted.
- Landing density: the product landing pairs its statement with a live-looking graph vignette, a four-part capability rail, and a concrete workflow preview before supporting detail.

## 6. Motion & Interaction

Micro feedback uses 140ms ease-out. Panel transitions use 260ms ease-in-out. Emphasis entry uses 480ms cubic-bezier(0.16, 1, 0.3, 1). Only transform, opacity, and filter animate. Reduced-motion mode removes nonessential entry and floating effects. Analysis loading uses opacity only.

## 7. Depth & Surface

Strategy: shadows. Raised panels use a cool tinted shadow and white surface. Inner grouping relies on spacing and subtle tonal shifts. Borders are limited to interactive controls and data lines, not used as the primary panel-depth mechanism.
