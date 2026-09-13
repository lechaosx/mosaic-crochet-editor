# UX plan audit

Status: reviewed proposal, 2026-09-13. This document records risks and planning corrections; it does not describe shipped behavior.

## Verdict

The UX brainstorming contains useful principles, but it is too broad and internally dependent to implement as one redesign. The previous phase outline combines correctness fixes, domain-model changes, new persistence boundaries, responsive layout, transform algebra, output composition, and Live progress into large epics. Those ideas remain an exploration inventory; the audited sequence in `TODO.md` is the implementation authority.

## Conflicts resolved by the staged plan

- The brainstorm treated accepted ideas as implementation-ready decisions. They are now design inventory; only the staged roadmap is authoritative.
- The old phases began with a new shell while gesture cancellation, persistence frequency, undo grouping, accessibility, and chart/export identity were still unstable. Correctness and existing-workspace usability now come first.
- Mirror & Repeat was described both as an extension of today's multiple axes and as a replacement based on one rotational centre. Existing semantics remain until a lossless migration is justified.
- Transform drafts accumulated requested, effective, paused, and suspended states. The initial contract is one valid committed recipe plus an uncommitted local draft.
- Live was coupled to composition, recursive compression, stitch-level stepping, and physical-WIP reconstruction. Its first prototype is independent and advances by row or round.
- The adaptive shell specified both direct canvas gestures and canvas-tap sheet dismissal. The first shell uses an explicit open/closed inspector; gesture-rich detents remain deferred.
- The proposed onboarding implied a nullable project, despite the app's current always-present pattern. A welcome treatment must work over the existing session model first.

## Cost and value

| Work | Expected value | Cost/risk | Planning outcome |
|---|---|---|---|
| Cancellation, undo grouping, persistence boundaries | High: protects authored work | Low–medium | Stage 0 |
| Keyboard semantics and adaptive 36/44 CSS-pixel controls | High: removes immediate access barriers | Low–medium | Stages 0–1 |
| Visible selection actions, yarn state, blocked-action feedback | High: improves current workflows | Medium | Stage 1 |
| Pure codecs and explicit state ownership | High enabling value | Medium | Stage 2, before new persisted features |
| Pattern Apply/Cancel and simple adaptive shell | High | Medium | Stage 2, narrow vertical slices |
| Typed chart sequence and Text workspace | High: enables trustworthy Instructions and Live | Medium–high | Stage 3 after dialect gate |
| Row/round Live prototype | Potentially high | Medium | Stage 4 validation prototype |
| Exact previews on current transforms | High | Medium | First transform prototype |
| New transform algebra and inverse editing | Uncertain incremental value | High | Pure prototype; no migration yet |
| Physical-WIP reconstruction and recursive stepping | Unproven | Very high | Defer |
| Three-detent sheets, semantic zoom, navigator, extensive Help | Useful polish after core proof | High cumulative cost | Defer |

## Product contract

- The editor models chart information, not the user's complete crochet technique.
- Generated output is a chart-derived work sequence and companion to the chart, not a standalone crochet pattern.
- The user supplies foundations, turning, cutting, carrying, joining, finishing, and the method used to make an overlay.
- `sc` means single crochet, `ch` means chain, and the app-specific `oc` means that the chart requires overlay crochet at that position. Every generated representation must define `oc`; it must not imply a particular overlay stitch recipe.
- In row patterns, the bottom edge is an unnumbered foundation outside the generated work sequence. The first worked row above it is Row 1, and a visible overlay belongs to the row in which it is worked rather than to its internal supporting-cell representation.
- In centre-out patterns, the innermost visible band is Round 1 and successive bands are numbered outward. Centre setup or foundation is outside the generated sequence, and a visible overlay belongs to the round in which it is worked rather than to its internal supporting-cell representation.
- A diagonal centre-out corner pixel emits the complete `(sc, ch, sc)` group and cannot itself be an overlay. Neighbouring pixels retain normal Overlay behavior, including when their instructions are grouped beside a corner.
- Yarn phase is fixed: the row foundation is Yarn A, Row 1 is Yarn B, and later rows alternate; centre-out Round 1 is Yarn A and later rounds alternate outward. Yarn A/B are logical chart slots whose colours can be changed or swapped. Generated output names each row's or round's yarn without prescribing the transition.
- Full, Half, and Quarter are authored extents only: the complete centre-out chart, its canonical bottom half, or its canonical bottom-left quarter. They imply no transform. `As authored` output covers exactly the stored extent and retains round identities; a larger result must use an explicit future composition.
- Instruction traversal is configured directly rather than inferred from handedness. Rows select a left/right origin and same/alternating direction; centre-out work selects a corner or side midpoint, clockwise/counter-clockwise direction, and same/alternating direction. One semantic origin maps across all rounds, with both central cells offered on even-length sides. These controls order chart work without changing chart appearance or prescribing transitions.
- Handed placement of Live controls is a local interface preference, not chart data.
- Validation severity follows derivability rather than convention. A Blocker means the selected output cannot produce an unambiguous `sc`/`ch`/`oc` sequence matching the chart, including overlays beyond the output extent, lossy or ambiguous composition, and unavailable traversal origins. A Warning identifies a deterministic result worth reviewing, such as difficult-to-distinguish yarn colours. Unusual valid work is not itself a warning.
- Instructions Overview remains available with blockers and links them spatially. Live cannot start, while compressed Text remains available as a labelled draft whose unresolved positions are explicit rather than silently replaced with `sc`.
- The product remains Mosaic Crochet Editor; its pattern geometries are Rows and Centre-out. The model is described as an alternating-yarn mosaic chart with derived overlay positions, without claiming complete compatibility with every named inset or overlay technique. Overlay remains the tool and `oc` the app-defined operation whose physical method the user supplies.

## Crochet-convention cautions

Conventions vary by designer, so the UI must distinguish common expectations from the app's own chart dialect.

- Right-side-only overlay mosaic is commonly worked from the same edge, with one colour per row and X-marked dropped stitches. See [Interweave's mosaic crochet overview](https://www.interweave.com/article/crochet/learn-mosaic-crochet-colorwork/).
- Inset mosaic commonly uses paired `a` and `b` rows, turns the work, and changes colour after a pair. See [HanJan Crochet's comparison](https://www.hanjancrochet.com/mosaic-crochet-tutorial/) and [chart guide](https://www.hanjancrochet.com/mosaic-crochet-chart/).
- Centre-out overlay squares have explicit corner constructions, including overlay corner variants; corners are not universally chain-only or incapable of overlays. See [Ashlee Brotzell's centre-out tutorial](https://ashleeslint.com/overlay-mosaic-crochet-tutorial-center-out/).
- `oc` is an application term rather than a broadly standardized crochet abbreviation. The legend must define it. The [Craft Yarn Council abbreviations](https://www.craftyarncouncil.com/standards/crochet-abbreviations) include `sc`, `dc`, `BLO`, and `FLO`, but not `oc`.
- Corner starts are familiar for centre-out squares. The agreed side-midpoint starts and alternating successive round directions are not established cross-designer defaults, so they require user testing after structured traversal exists.
- A finished colour chart with a current-row guide is the familiar progress baseline. Reconstructed physical-WIP rendering and recursive compressor navigation are hypotheses to prototype, not MVP requirements.

## Preserve as design principles

- One conceptual interaction model with adaptive placement across desktop, tablet, and phone.
- Essential operations available without hover, long-press, modifiers, or pen-only hardware.
- Yarn-independent interface state and non-colour accessibility cues.
- Explicit, reversible Pattern editing rather than implicit destructive dismissal.
- Clear separation among browser recovery, `.mcw` project files, generated work sequences, editor undo, and Live progress.
- Spatial previews and actionable explanations for blocked operations.
- Read-only derived output that maps visibly back to editable source cells.
- Blockers only when a trustworthy requested result cannot be derived; unusual but deterministic charts remain warnings or valid work.

## Prototype before committing product state

- Colour Design and Stitch Placement as persistent global strategies. The current tools already have distinct semantics, while the proposed strategy-dependent behavior is undefined.
- A new mask-packed, staggered, mirrored, quarter-turn transform algebra and inverse editing through generated instances.
- Replacing multiple existing central-symmetry axes with one rotational centre.
- Output composition, shared-corner semantics, and Half/Quarter physical-output behavior.
- Traversal origin, handedness, side-midpoint starts, and alternating round direction.
- Live progress beyond row/round Done and Back.
- Physical-WIP reconstruction, recursive compression-tree tracking, two progress cursors, and reconciliation after edits.
- Three-detent sheets, automatic occlusion panning, focal-cell rotation, semantic zoom, and the overview navigator.

## Defer while preserving room

- Persistent app clipboard and provenance.
- Resizable pinned-inspector preferences and a full browser-Back unwind stack.
- Exhaustive Help diagrams, coach-mark management, pen hardware specialization, Wake Lock, Print, and visual token polish.
- Source-less transform recipes retained across New/Open.
- Custom composition arrangements and advanced grid orientation/offset modes.

## Simplifications that do not close future options

- Start mobile with one open/closed inspector drawer; make inspector content independent of placement so detents can be added later.
- Retain current transform semantics while adding preview and direct guide controls. Prototype new geometry in a pure evaluator before migration.
- Keep multiple central axes until a lossless migration and demonstrated rotational-repeat need exist.
- Begin Instructions with exact Text and a simple structured row/round list.
- Begin Live with one confirmed row/round boundary, Done, Back, and exact recovery.
- Keep the existing non-null pattern session initially; suppress persistence of an untouched provisional start instead of introducing a nullable document architecture.
- Retain current rotation pivot while improving names and controls; test focal-cell rotation separately.
- Use an open issue list before adding filters, aggregation, correction-return history, or provisional issue classes.

## Release discipline

Every behavioral commit starts with a failing test at the appropriate Rust, Vitest, or Playwright layer and ends with the smallest relevant checks plus `bun run test` before the stage is declared complete. README and FEATURES change with user-visible behavior; ARCHITECTURE changes with state, serialization, or module-boundary decisions. Each commit must leave all existing editing workflows usable.
