# Product backlog

This file contains unresolved product gates and possible future work. It is not a specification or a promise to implement every item. Shipped behaviour belongs in [README.md](README.md); durable product and technical constraints belong in [FEATURES.md](FEATURES.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

Items remain here until they are implemented, rejected, or deliberately promoted into a durable decision. Completed work is recorded in [RELEASE_NOTES.md](RELEASE_NOTES.md) and Git history rather than retained as checked-off backlog.

## Delivery rules

- Validate uncertain value before building the larger solution.
- Start behavioural work with a failing test at the appropriate Rust, Vitest, or Playwright layer.
- Keep refactoring in a separate commit from functional changes.
- Update README and RELEASE_NOTES for user-visible changes. Update FEATURES or ARCHITECTURE only when the change establishes or revises a durable decision.
- Run the smallest relevant checks during development and `npm run test` before completing a change.
- Stop after each independently valuable slice and reassess the remaining work.

## Open product gates

### Crochet in real use

Use the [Crochet validation protocol](doc/instructions-validation.md) and its editable fixtures.

- [ ] Observe the current whole-row/whole-round Crochet workflow in real sessions.
  - Determine whether Back and Forward are sufficiently low-friction.
  - Record where users lose their place and whether the chart, current instruction, start arrow, or physical work helps them recover.
  - Consider compression-tree tracking only when users retain the correct row or round but repeatedly lose their place inside its compressed instruction.
- [ ] Validate traversal terminology and controls with crocheters.
  - Test left/right row origins, clockwise/counter-clockwise rounds, corner and side-midpoint origins, and same/alternating schedules.
  - Do not infer traversal or technique from handedness.

### Pattern history

- [ ] Decide whether **Clear drawing** should join the current coalesced Pattern history state or remain its own undo boundary.

## Work conditional on the Crochet gates

- [ ] If traversal terminology validates, expose and persist explicit traversal.
  - The chart, visible instruction list, copied text, and direction arrows must use the same ordered walk.
  - Incompatible semantic origins must require adjustment rather than silently moving.
  - Traversal affects generated output, so version `.mcw`, recovery, and history deliberately.
- [ ] If the whole-unit workflow validates, add boundary-level **Start here** and **Crochet again**.
  - Starting later treats the preceding row/round prefix as complete in one reversible progress boundary.
  - Restarting clears only local Crochet progress after confirmation.
- [ ] Add finer progress only if observed failures justify it.
  - Candidate work includes optional compression-tree expansion, confirmed and preview cursors, mark-through/rewind actions, and reconciliation after completed work changes.
  - Keep row/round boundaries as the default; do not introduce stitch-by-stitch tapping without evidence.

## Candidate backlog

These are independent candidates. Their presence does not establish ordering or product commitment.

### Editing and project workflow

- Exact pre-contact outcome previews for Pencil, Eraser, Invert, Overlay, and transformed destinations.
- Fill and Wand region previews, including cancelable touch retargeting before release.
- Direct Pattern resize handles with explicit preservation anchors and exact added/removed-cell feedback.
- A persistent app-local clipboard, **Paste at view**, and an explicit way to discard a fully off-pattern selection.
- Editable project names, clearer browser-recovery versus project-file freshness, and browser-dependent file association without implying that a downloaded file stays connected.
- Optional Yarn A/B labels and a local non-colour yarn-differentiation view that never changes stored yarn colours.
- Clear progress or replacement safeguards when New/Open would discard unrecovered authored work or unfinished local Crochet progress.

### Transforms and output composition

- Continue evaluating the pure transform model for mask-packed grids, staggered offsets, alternating mirrored instances, exact quarter turns, collision reporting, and source mapping.
- Explore inverse editing through generated instances only if one source cell can map back unambiguously and the complete destination set remains atomic.
- Explore explicit output composition separately from authored Full/Half/Quarter extents.
  - Candidate presets are **As authored**, geometry-compatible **Mirror to full**, and **Rotate to full**.
  - Output must retain an exact output-to-source map and report geometry, seam, overlap, yarn-phase, and overlay-support conflicts without choosing a silent winner.
- Consider a richer spatial validation surface only when current local feedback and Crochet warning summaries stop being sufficient.

### Crochet and derived output

- Optional Focus mode and screen-wake support, active only while the page is eligible and never restored unexpectedly.
- Better reconciliation when edits affect already completed work: identify the first changed instruction and offer rewind, keep-place, or reset outcomes.
- A finished-reference view distinct from the chart-derived current-work surface.
- Selectable or downloadable formatted instruction text if Copy alone proves insufficient.
- Print layouts derived from the same structured plan, with chart tiling, repeated page context, yarn differentiation, and the same validation as Crochet.

### Workspace and accessibility

- Local System/Light/Dark themes and further visual-token polish without coupling interface state to yarn colours.
- A resizable pinned inspector on wide layouts and multi-detent non-modal sheets on constrained layouts, preserving canvas focus and uncommitted state through recomposition.
- Browser Back/Escape unwinding of transient interface state without mapping either to project Undo or Crochet Back.
- Contextual Help, gesture diagrams, and resettable coach marks after concrete discoverability failures are observed.
- Semantic zoom and an optional overview navigator for very large or locally zoomed charts.
- Pen-specific accelerators such as barrel actions and eraser hardware while retaining visible non-pen alternatives.
- More explicit long-running-work presentation: retain the last complete result, label updates, supersede stale computation, and expose cancellation only when work lasts long enough to matter.

## Ideas that require revisiting the durable product model

These ideas conflict with or substantially reshape current decisions. Do not begin them without explicit user approval and a corresponding FEATURES or ARCHITECTURE discussion.

- Persistent **Colour Design** and **Stitch Placement** strategy modes instead of the current tool-led workflow.
- An explicit Pattern Apply/Cancel transaction instead of the current modeless, immediately undoable preview model.
- Replacing separate Global Mirror and saved-repeat concepts with one staged transform recipe.
- Splitting the unified Crochet workflow into separate Overview, Live, and Text workspaces.
- Treating composed output as project state rather than a separate derived operation.

## Existing exploratory foundations

The repository already contains pure, non-UI foundations that may support later gated work:

- `logic/src/transform-evaluator.ts` for exact saved-repeat geometry and collision reporting;
- `logic/src/output-composition.ts` for quarter-to-full composition experiments; and
- traversal prototypes beside the Rust row and round walkers.

Their existence is not approval to expose UI, add persistence, or migrate current project semantics. Reassess value and compatibility before promoting them.
