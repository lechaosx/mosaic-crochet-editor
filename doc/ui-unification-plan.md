# UI unification implementation plan

Status: approved; execution started on 3 October 2026. Local-transform compatibility remains subject to the explicit migration policy below. Deployment is outside this execution.

## Intended result

One recognizable interface language across Pattern, Settings, tools, selections, movement, mirrors, and Crochet. Repeated controls share appearance, terminology, interaction contracts, and implementation where their meaning is the same. Canvas editing remains fast, and the code stays explicit enough for an agent to change without reconstructing hidden conventions.

The plan preserves the boundaries in [FEATURES.md](../FEATURES.md), [ARCHITECTURE.md](../ARCHITECTURE.md), and the [chart dialect](chart-dialect.md). It changes control presentation, editor interactions, transform definitions, and local Crochet navigation; crochet traversal and stitch derivation retain their existing meaning.

## Requirements and proposed defaults

### Requirements

- Keep the app as lightweight and fast as practical. A dependency must remove enough complexity to justify its runtime, integration, and maintenance cost.
- Keep one authoritative editor state, one persistent canvas, and the existing browser-independent logic / browser UI / Rust domain boundaries.
- Preserve the existing structure while steering changes through the focused interfaces and one-way dependency rules in ARCHITECTURE. Deliver coherent end-to-end changes; `main` may coordinate modules and implement glue or small supporting operations. Extract only boundaries justified by the work, not a layer containing every controller or a mandatory owner per feature.
- Prefer concrete code and a few reusable constructs over a generic UI framework built inside the app.
- Use consistent wording, icons, spacing, control placement, focus, selection, unavailable states, and error feedback.
- Mouse, touch, pen, and keyboard produce the same authored outcomes. Alternative buttons and modifiers accelerate actions available through visible controls.
- Keep undo coherent: authored changes are reversible, continuous edits produce one action, and cancellation restores the starting state.
- Keep supported project files, recovery, and history compatible, with the approved local-selection conversion below. Pattern stitches, geometry, and colours remain unchanged during migration. Rejected operations leave the active session intact.
- Additional inconsistencies discovered within these workflows are in scope when they can be reproduced and fixed without introducing a new product capability.

### Defaults proposed for approval

| Topic | Proposed behavior |
|---|---|
| UI implementation | Keep native DOM, CSS, and TypeScript. Extract small shared controls and coherent panel code from the current controller. Reconsider a library only with a concrete demonstration that it reduces total complexity and preserves the performance and interaction contracts. |
| Tool order and names | Keep Pencil, Eraser, Invert, Spill visible in that order. Spill retains the current connected-region fill behavior. Use consistent names in labels, accessible names, tooltips, and feedback. |
| Tool variants | Rectangle selection and Wand each offer Replace / Add / Subtract; Move offers Move content / Duplicate / Move area; Overlay offers Place / Clear / Invert. Each group remembers its chosen variant. |
| Variant discovery | Normal click activates the displayed variant. Hold, a visible clickable menu affordance, and keyboard access open the same labelled menu. Opening or dismissing the menu does not change the chosen variant. No hover-only opening. |
| Local transformations | Each saved selection has one active choice: None, Grid, Circle, or Mirror. Switching categories retains that selection's settings for later reuse; only the chosen category executes. None retains the selection and disables its local transform. Global mirrors remain independent. |
| Local Mirror | Use the same center and independent types as global mirrors: vertical, horizontal, both diagonals, and point symmetry (180°). Scope reflection composition to the saved source. Apply the approved legacy-selection conversion below. |
| Circle | Exact 90°, 180°, and 270° copies around a draggable center. Arbitrary-angle resampling is outside this change. |
| Grid anchors | Two handles edit column and row step vectors, including the existing gap and offset parameters. Source placement remains a Move operation. Repeat counts and alternating reflection settings remain available in the inspector. |
| Whole pattern | An extra final Crochet entry displays the authored project and outward warnings. Selecting it retains the last instruction progress; selecting a real instruction updates progress using the existing convention. The overview is transient: reopening Crochet resumes the stored instruction. It does not add a generated instruction or mark work completed. |
| Copy placement actions | Use “Stamp copies” for local transformation stamping and global mirror stamping. Their tooltips identify the destination scope. |
| Project colors | Yarn, Danger, and Accent edits, resets, swaps, and contrast suggestions participate in authored undo. Browser preferences and view navigation remain outside authored history. |

The tool-variant proposal replaces the earlier layout with three permanently visible buttons per selection or move family. All three actions remain visible in the variant menu; the Selection inspector no longer contains Replace / Add / Subtract, and the separate three-button Move inspector is removed.

### Mouse accelerators proposed for approval

| Family | Left button | Right button | Middle button |
|---|---|---|---|
| Color | Chosen tool, selected yarn | Existing alternative behavior: other yarn for Pencil/Spill, opposite natural yarn at the clicked stitch for Eraser, existing Invert behavior | Temporary color Invert |
| Overlay | Chosen action | Opposite Place/Clear action; Invert remains Invert | Temporary overlay Invert |
| Rectangle / Wand | Chosen variant | Temporary Add | Temporary Subtract |
| Move | Chosen variant | Temporary Duplicate | Temporary Move area |
| Navigate / Crochet canvas | Pan | No authored edit | Pan |

Space-drag, the visible Navigate control, and touch pan/zoom remain navigation routes. In authoring families, middle-click changes from pan to the action above. For selection, Shift means Add and takes precedence over Ctrl/Cmd Subtract. For movement, Alt means Move area and takes precedence over Ctrl/Cmd Duplicate. Resolve an explicit modifier before the button accelerator, then the chosen variant; apply the same rule to pointer and keyboard commands. Pin these combinations with tests. A temporary action never changes the remembered variant or selected yarn.

### Approved local-transform compatibility policy

Current saved transformation selections can contain both quarter-turn copies and horizontal/vertical reflection copies. They use explicitly selected copies rather than the closure of reflection axes. A replacement with exclusive Circle/Mirror categories and composed reflections therefore cannot be assumed to preserve all existing definitions.

For example, a source cell at `(3, 3)` around center `(2, 2)` with horizontal and vertical copies currently produces `(3, 3)`, `(1, 3)`, and `(3, 1)`. Composing both reflections also produces `(1, 1)`. Even a reflection-only selection can change behavior; the issue is not limited to mixed rotation/reflection definitions.

The user approved changed selection behavior while preserving the pattern on 3 October 2026. Keep None / Grid / Circle / Mirror and convert legacy definitions as follows:

| Legacy definition | Active category after conversion |
|---|---|
| Grid, including alternating reflections | Grid; centered settings remain dormant. |
| Rotation with any quarter-turn copies, including mixed reflections | Circle; reflection settings remain dormant. |
| Rotation with reflections but no quarter turns | Mirror; selected mirrors compose. |
| Rotation with no copies | Circle; do not infer None from an empty definition. |

Retain dormant settings, selection identity, source bounds, and source membership. Legacy `mirrorHorizontal` reflects X and maps to the vertical mirror type; `mirrorVertical` reflects Y and maps to the horizontal type. Conversion must not change authored cells, pattern geometry, yarns, or palette overrides. It may change subsequent live drawing, generated instances, and stamping from old selections; show a clear notice when an import or recovered session changes those behaviors.

Fixtures must cover rotation-only, single/combined reflection-only, mixed rotation/reflection, empty definitions, and dormant settings through project files, recovery, and history. Verify unchanged pattern content and source membership, the documented destination changes, inverse source mapping, live drawing, stamping, and output composition. Do not materialize copies, invent a hidden legacy mode, or split selections to simulate old behavior. Global axes retain the independent lossless migration requirement in chunk 5.

## Shared language and contracts

### Repeated UI constructs

| Construct | Contract and uses |
|---|---|
| Action button | Shared icon geometry, padding, hit targets, focus, unavailable state, and destructive treatment. Icon-only actions have accessible names and useful tooltips. |
| Choice group / tool group | Shared selected state and keyboard navigation. Exclusive choices and independent toggles remain semantically distinct. Tool groups also expose chosen versus temporarily executing variants. |
| List row | Common alignment, separators, selection marker, secondary information, and trailing actions for selections, mirrors, and instructions. A row's identity remains stable during updates so focus survives. |
| Property field | Consistent label/value/action placement, validation feedback, preview and commit behavior, and precision editing. |
| Status message | Consistent presentation for unavailable operations, invalid placements, operation failures, and recovery feedback. Messages sit near their cause and describe an outcome or useful next action. |
| Canvas handle | Common hover, focus, drag, snapping, cancellation, and single-gesture undo behavior. Numeric editing provides equivalent precision and keyboard access. |

Use native semantics where they fit. Share implementations only for stable behavior repeated across callers; a common list appearance does not couple Crochet progress to saved-selection activation. Do not introduce an application-wide component registry, configuration language, second state store, or a parallel domain implementation.

Selected, executing, focused, unavailable, and invalid are separate states. Use non-color cues, and keep destructive intent distinct from a warning on an otherwise usable command. Keep unavailable controls in stable positions; disable execution consistently and retain explanatory feedback through the nearby status or tooltip.

### Terminology

- Pattern, Yarn A, Yarn B, Selection, Mirror, and Instructions are the primary user-facing nouns.
- Rows and Centre-out name construction; row and round name generated work. Keep Full / Half / Quarter as authored extents.
- Use Move content, Duplicate, Move area, Stamp copies, Whole pattern, and invalid placement consistently.
- Pattern color labels are Yarn A, Yarn B, Danger, and Accent. Project scope belongs in appropriate context or tooltips instead of repeated label prefixes.
- Keep internal terms such as recipe, float, bitmask, and mask out of product controls and feedback. Retain those terms where they precisely describe internal code.
- Keep the existing British-English convention for colour and centre. Tooltips carry shortcuts and non-obvious scope rather than repeating the visible label alone.

## Orchestrated execution protocol

The top-level agent remains the orchestrator and owns acceptance, scope, cross-chunk consistency, and the execution ledger below. For each implementation chunk:

1. Assign a fresh implementer with the approved contracts, relevant files, acceptance criteria, and test obligations.
2. The implementer reads applicable repository instructions, writes behavioral tests first, and confirms failure for the expected reason before changing behavior. Preserve a concise red/green verification record.
3. Update the affected canonical documentation in the same chunk, then run the focused tests, build/type checks, and applicable visual or performance checks. Use Nix tooling when programs or browser dependencies are unavailable.
4. Assign a fresh reviewer who independently inspects the change, tests, documentation, compatibility, accessibility, and performance consequences.
5. The orchestrator evaluates findings and sends necessary corrections to the same implementer. The same reviewer reviews corrections until accepted.
6. Run `npm run test` at the root before accepting and committing the chunk. Any later code or documentation corrections return to the same reviewer before acceptance. Commit only its verified changes, with factual messages and no agent attribution.
7. Mark the ledger, record evidence, then use fresh implementer and reviewer agents for the next chunk.

Refactoring and behavior changes are separate work phases and commits. Complete, verify, review, and commit a structural change before beginning the dependent functional change; do not implement both and separate them only during staging. If inseparable, explain why and obtain direction before proceeding.

The orchestrator may batch independent read-only work. Implementers must not concurrently modify shared UI/state/persistence files. Every accepted chunk leaves the app coherent and deployable. Additional defects enter the ledger with a reproduction and acceptance criteria; unrelated feature work goes to the backlog.

The user reviews this plan before any implementation. Later escalation is for a material product decision, incompatibility, loss of supported data, a change to a documented constraint beyond the approved plan, or a dependency/framework migration whose measured tradeoffs require new direction. Routine implementation choices stay with the team.

## Implementation chunks

### 0. Establish the baseline and resolve execution gates

Scope: read-only verification after plan approval, before edits.

- Record the starting revision, worktree state, complete test result, production JS/CSS compressed sizes, and the number of runtime dependencies.
- Measure startup-to-usable-chart and representative drawing, transformed drawing, panel editing, and Crochet navigation at fixed desktop and touch viewports. Use repeatable input and the same environment for comparison; record timing distributions and DOM churn instead of asserting arbitrary hardware-independent limits.
- Capture representative current views and accessibility/focus behavior for later comparison. Record existing failures separately from new regressions.
- Record the approved defaults, pointer precedence, and Whole pattern progress contract; resolve only remaining execution gates. Do not request renewed permission for choices already approved or turn a baseline check into unrelated repair work.

Acceptance: repeatable baseline evidence and a clear list of prerequisites for each dependent chunk. Baseline failures are explained before using them to judge a later change.

### 1. Reshape presentation boundaries without changing behavior

Scope: `web/src/ui.ts`, `web/src/dom.ts`, `web/index.html`, and directly affected UI tests and imports.

- Split coherent panel and toolbar responsibilities into small presentation modules with explicit inputs and callbacks. Keep authoritative state in the existing owner.
- Establish concrete shared code for controls that already repeat: list rows, choice state, action affordances, and property interaction where reuse is real. Preserve existing visuals and behavior in this phase.
- Preserve the canvas element and view, focused controls, responsive recomposition, and browser-independent package boundaries.
- Remove only code superseded by this refactor; keep domain and pointer semantics unchanged.

Verification: existing UI/unit/E2E behavior, type checks, production build, and complete suite. No contrived source-text tests. Compare baseline canvas identity, focus, and performance.

Acceptance: independently verified structural commit, ready for functional changes without adding a new framework or runtime dependency.

### 2. Make commands, edit history, and failed operations coherent

Scope: browser command routing and gesture completion, clipboard transactions, history serialization and migrations, and the corresponding tests.

- Route buttons and shortcuts through the same commands and availability checks. Undo/Redo in Crochet work through either route and return to Design when an authored change executes.
- Opening a different project, New, and Example reset rotation and fit the chart to the available workspace. Identical Open remains a no-op; failed or cancelled imports preserve the current view. Geometry edits retain their existing preview-fitting behavior and preserve rotation.
- Prevent document shortcuts behind About or another modal. Escape dismisses the topmost transient UI before reaching the editor; retaining Settings beneath About must not change that priority.
- Make keyboard Move respect the selected outcome. Verify repeated arrow movement records the final position for Undo/Redo, including Duplicate and Move area.
- Make failed Paste atomic. Validate a usable destination before committing an existing selection or changing tools. Give useful feedback for empty clipboard or unusable destination; successful Paste remains one authored action.
- Apply the approved project-color undo contract to edits, resets, swaps, and Find Contrast. Preserve browser preferences and view state outside authored history; migrate older history snapshots deliberately. Missing Danger/Accent fields in old snapshots mean unknown historical values, not explicit defaults: undoing those snapshots must preserve current overrides. Test missing fields separately from explicit null/default values in new snapshots.
- Reproduce cancellation and focus-loss defects before fixing them. Restore previewed content and clear temporary state on pointer cancellation, lost capture, Escape cancellation where applicable, or window blur. Never leave a half-applied edit or a stuck temporary mode.

Verification: Vitest logic tests for clipboard atomicity; web history and migration tests; Playwright for modal scope, keyboard/button equivalence, repeated gestures, focus loss, and failed-operation feedback. Every behavioral fix must be observed red before green.

Acceptance: shared command semantics, atomic failures, recoverable history, and no loss of existing selection content.

### 3. Apply the shared visual and wording language

Scope: shared styling and controls, Pattern, Settings, list presentation, and status wording.

- Apply the common action, choice, list, field, and status treatments across all panels. Use one icon stroke/size system, consistent spacing and placement, and recognizable focus, selected, unavailable, and invalid states.
- Keep Copy/Cut/Paste and selection actions spatially stable. Lists retain identity and focus while activation, deletion, position edits, and undo update their content.
- Replace raw transform checkboxes with consistent independent-toggle controls. Use icons and arrangement when understandable; retain short labels where an icon would hide meaning.
- Resolve effective project Danger/Accent colors once for chart and UI consumers. Derive their subtle surfaces from those colors; keep readable neutral command text even when a chosen semantic color contrasts poorly with the interface background.
- Remove the mirror button's live pink fill and dot. Active canvas guides and drawing previews communicate mirror activity. Use a neutral border/check treatment for the selected yarn.
- Opening About overlays Settings; closing About returns to the originating control with Settings intact.
- Simplify Pattern color labels. Find Contrast and Clear Design become accessible icon actions, with actions positioned beside the properties they affect. Clear Design's tooltip states that drawing, selections, repeats, and mirrors are cleared; preserve its existing undo boundary.
- Give every Pattern geometry/extent preview the same cell size at the same available width. Use a straightforward non-corner invalid-overlay example in round previews; preserve real crochet geometry.
- Place the Crochet invalid-placement count with related controls, use ordinary navigation treatment for Back to Design, and remove whole-row dimming that dulls yarn blocks and numbers. Selected/invalid markers remain visible beside the yarn column without an extra full-row error border.

Verification: behavior E2E for icon actions, About return, availability, project-color propagation, and preserved focus. Rendering checks for equal preview cell scale and valid/invalid sample semantics. Inspect subjective spacing, icon balance, and colors visually at desktop, tablet, phone, enlarged text, reduced motion, and high contrast; do not encode aesthetic tuning as source-text assertions.

Acceptance: the same constructs read and behave consistently across existing workflows, with no panel-specific alternate design system.

### 4. Introduce grouped tools and temporary actions

Scope: authoring dock, tool-group control, browser gesture input, active-action feedback, and workspace recovery.

- Implement the approved Rectangle, Wand, Move, and Overlay variant groups using the same control. Use distinct variant icons, a discoverable menu indicator, compact labelled menus, and retained chosen variants.
- Support click, hold, menu-affordance activation, keyboard navigation, selection, Escape dismissal, outside dismissal, and touch scrolling without accidental tool changes.
- Remove Replace/Add/Subtract from the Selection inspector and remove the dedicated Move inspector. Selecting a selection variant opens the selection inspector as before; choosing Move activates its outcome directly.
- Keep Pencil, Eraser, Invert, and Spill visible in the approved order.
- Apply the approved pointer/modifier mapping. Show the actually executing tool/variant and yarn throughout a held gesture; provide a brief indication for clicks. Respect reduced motion and restore chosen state on every completion/cancellation path.
- Make alternative mouse buttons explicit gesture inputs rather than inferring the button from which yarn was passed. Keep one gesture engine and one document operation per family.
- Preserve ordinary browser-local recovery of chosen tools and variants without adding them to `.mcw` or authored undo. Temporary executing state is never saved. Handle older recovery records.

Verification: Playwright tool, selection, modifier, touch, navigation, and accessibility tests; meaningful unit tests for deterministic input resolution if introduced. Cover no selection, held buttons, release outside canvas, cancellation, different yarns, transformed drawing, and return after navigation. Confirm no tool switch occurs just from opening/dismissing a group menu.

Acceptance: visible chosen variants, reliable temporary feedback, equivalent input outcomes, and no separate settings menu for movement modes.

### 5. Introduce center-based global mirrors

Prerequisite: global-axis conversion demonstrated lossless with fixtures. The separate local-selection compatibility decision does not block this chunk.

Scope: global mirror representation, evaluator adaptation, browser guides/inspector, `.mcw`, recovery, history, and validation.

- Represent each global mirror as a stable identity, center position, enabled state, and independently chosen types: vertical, horizontal, both diagonals, and existing point symmetry (180°). Keep point symmetry's meaning explicit.
- Derive all axes from the center and chosen types using the existing authoritative transform operations. Preserve composition, collision handling, off-pattern clipping, source-result replication, and safety limits.
- Convert legacy separate axes losslessly, including independently disabled axes and repeated kinds. Only consolidate records when geometry, enabled state, and behavior are equivalent; do not infer missing coordinate relationships that move a mirror line.
- Use the shared row language for adding, selecting, enabling/disabling, and deleting mirror centers. Show type toggles and precision coordinates consistently.
- Drag a global mirror only by its center handle when mirror editing is active. Axis lines are guides. Validate and snap centers according to their selected types, including diagonal integer/half-integer parity, odd/even dimensions, and partial extents. Reject an incompatible type toggle with actionable feedback rather than silently repositioning existing axes; handle drags snap to legal positions for all enabled types.
- Use Stamp copies for the existing-content action. Keep live drawing and explicit stamping consistent in resulting yarn states.
- Update persistent boundary versions and migrate project, recovery, and undo records. Preserve failed-import atomicity and composed-save/instruction behavior.

Verification: logic symmetry and persistence fixtures; Rust tests if domain operations change; web history/storage tests; Playwright for list actions, center-only drag, numeric/drag equivalence, cancellation, undo, live drawing, stamping, save/open, and recovery. Compare legacy and new transformed destinations and authored outcomes directly.

Acceptance: one understandable mirror center per row, lossless supported-file behavior, and no dragging by axis lines.

### 6. Introduce exclusive selection transforms and canvas anchors

Prerequisite: chunk 5. The local-transform migration policy above is approved, including combined reflections and mixed rotation/reflection copies.

Scope: saved selection definitions and activation, local transform evaluation, inspector and guides, project/recovery/history boundaries.

- Implement None / Grid / Circle / Mirror with one active category per selection. None leaves the selection usable for painting, copying, and movement. Grid's alternating reflections remain grid properties rather than a second active category. Mirror uses the global center/type controls and the approved composition policy, scoped to its saved source; keep global and local activation independent.
- Keep saved selections as persistent movable sources. Preserve source identity and source/result mapping when editing a generated instance, moving a source, stamping, saving, and generating instructions.
- Apply the approved conversion for existing selections and dormant settings; preserve pattern content and verify round trips through project files, recovery, and history.
- Use the shared list and property treatments, consistent independent mirror toggles, and Stamp copies.
- Add Grid's two step handles, Circle's center point, and Mirror's center point. Grid handles apply the same gap/offset changes and alternate-spacing synchronization as the corresponding fields; they do not collapse alternating reflections or change repeat counts. Display the relevant alternate layout as guides, and clamp/snap drags to the existing valid parameter domain. Local handles are visible and interactive only with Rectangle or Wand selection tools active. Passive guides may remain available to show the scope of subsequent painting.
- Provide precision fields for all handles. Screen-sized hit targets, overlapping-handle disambiguation, rotated views, snapping, and touch input must preserve geometry. Global mirror handles are editable through the mirror context; local handles use the selection context.
- Make repeated-selection outlines readily visible on both yarn colours and across zoom levels, with a clear distinction between the editable source and generated instances rather than relying on very dim copies.
- Preview property changes and handle drags in place. Match Pattern's coalesced edit behavior; category/toggle actions remain deliberate undo actions. A rejected setting or overlapping/unsafe transform retains the last valid result and exposes useful feedback.
- Keep authored Full/Half/Quarter extents independent from selection and mirror transformations.

Verification: logic selection, repeat evaluator, paint, source mapping, and serialization tests; relevant Rust tests; web repeat-render/history/migration tests; Playwright for every category, None, fields/handles, tool-dependent visibility, source movement, inverse instance editing, conflicts, cancel, Undo/Redo, stamping, composed save, and instruction generation.

Acceptance: exactly one active local transformation, understandable editable anchors, consistent history, unchanged migrated pattern content, and disclosed selection-behavior changes.

### 7. Add Whole pattern navigation and finish the consistency audit

Scope: Crochet view/progress composition, remaining cross-workflow defects, documentation, and performance acceptance.

- Add a final Whole pattern list entry distinct from real rows/rounds. The final real instruction retains its focused guidance. Whole pattern shows the authored project, all relevant invalid placements, and danger treatment when warnings lie outside the generated sequence.
- Wrap Forward from Whole pattern to the first instruction and Back from the first instruction to Whole pattern. Apply the approved view-only progress contract, including reopening Crochet, regeneration, compatible edits, and restoration of existing progress records.
- Keep Whole pattern out of copied generated instructions, yarn alternation, row/round numbering, and instruction totals. Preserve direct row/round navigation and the existing chart dialect.
- Remove the separate leading chevron column from Crochet instructions. Preserve current-step, focus, and invalid-placement cues without reserving a column; hover text identifies the row/round and yarn rather than saying “Go to”.
- Verify semantic states and wording across Pattern, Settings, tool groups, selection lists, mirror lists, and Crochet. Reproduce and fix remaining in-scope edge cases through tests; report broader product proposals separately.
- Compare final compressed bundle sizes, startup, drawing/gesture performance, transformed drawing, DOM update churn, and Crochet navigation against chunk 0. Investigate unexplained regressions and report feature-related costs with evidence; avoid flaky absolute timing assertions in CI.
- Run the full suite, production build, representative accessibility/visual checks, and round-trip persistence fixtures.

Verification: web progress/state tests and Playwright for wrapping, final-row guidance, outward warnings, save/open/reload behavior, copy text, compatible edits, empty/generating states, keyboard navigation, and focus. Real generated unit counts remain unchanged.

Acceptance: every requirement below has evidence, final performance is explained, and the repository has current documentation and passing checks.

## Documentation responsibilities

- Apply these rules within every chunk that changes the relevant behavior or constraint. Chunk 7 audits accuracy; it is not the first documentation update.
- Add terse user-outcome entries to RELEASE_NOTES under the actual implementation date. Group related changes into one to four bullets per date and keep entries valid for the About dialog.
- Update README only where its capability summary or contributor instructions become inaccurate, such as describing global mirror centers instead of separate axes.
- Update FEATURES for durable approved changes to grouped tool access, local transformation categories, mirror centers, and Whole pattern's progress meaning when they pass the admission test. Attribute explicit requirements to “your decision”; proposed defaults approved without further direction remain “Agent's choice”.
- Update ARCHITECTURE where the persistent project boundary or authored-color history contract changes. The current constraint excluding view-only state from authored history needs an explicit distinction for approved project-palette edits; preserve camera/view navigation outside history.
- Keep crochet semantics in the chart dialect. Update it only if the affected warning/overview description would otherwise be inaccurate; do not change traversal or stitch policy through this UI work.
- Update relevant TODO entries only when this work actually resolves or promotes them. Other product gates, including traversal and finer crochet tracking, remain independent.
- Record evidence and status here during execution. Do not duplicate durable specifications in this temporary plan after they acquire a canonical home.

## Final acceptance matrix

| Area | Evidence required |
|---|---|
| Shared language | Controls, lists, fields, statuses, tooltips, accessible names, and canvas handles follow the same approved vocabulary and state treatments. |
| Settings / Pattern | About returns to Settings; preview cell scales match; round sample has a clear invalid example; color and clear actions have concise labels, useful scope, and stable placement. |
| Tools / Move | Correct tool order; discoverable variant groups; no duplicate selection-mode or Move inspector; chosen and executing states remain distinct; all input routes honor the same outcomes. |
| Selections / Mirrors | Exclusive local category with None; center-based global mirrors; appropriate anchors; center-only mirror dragging; coherent stamping and edit history. |
| Crochet | Readable errors using project Danger; undimmed yarn/number blocks; visible selected/error markers; ordinary Back to Design; focused last instruction plus explicit Whole pattern; wrapping without unintended progress reset. |
| Edge cases | Modal shortcuts, empty/unusable Paste, held-key Undo/Redo, focus restoration, cancellation, lost capture, blur, geometry changes, and overlapping handles have behavioral coverage. |
| Compatibility | Supported `.mcw`, recovery, and history migrations preserve pattern content, global transforms, source membership, colors, and relevant workspace/progress state. Local definitions follow the approved conversion. Invalid operations/imports are atomic. |
| Accessibility | Keyboard, touch, pen, screen-reader semantics, enlarged text, browser zoom, reduced motion, and high contrast remain usable with adequate hit targets and non-color cues. |
| Performance / maintainability | Measured comparison with baseline; no unexplained regressions; modest shared code, explicit state/commands, stable DOM updates, and no redundant domain implementation. |
| Delivery | Focused red/green evidence, independent reviewer acceptance per chunk, separate structural/functional commits, complete root suite passing, and canonical docs updated. |

## Execution ledger

| Chunk | Status | Commit / verification / remaining decisions |
|---|---|---|
| Plan review | Approved | Native implementation, variant/pointer mappings, and Whole pattern progress approved. Sol implements and reviews; Luna handles scoped supporting checks. |
| 0. Baseline / gates | Accepted | Baseline committed in `a9d3bf2`; local-selection conversion approved. |
| 1. Presentation refactor | Accepted | `bbef2fb`; six concrete panel mounts and a type-only UI facade. Independent review, full root suite, and comparison pass. |
| 2. Commands / history / atomic failures | Accepted | `112cba8`; independent review and full root suite pass; command, cancellation, palette-history, project replacement, and clipboard regressions reproduced before fixes. |
| 3. Visual and wording language | Accepted | `a760d37`; independent review and full root suite pass; shared controls, stable lists, project-colour feedback, consistent samples, and responsive focus verified. |
| 4. Tool groups / temporary actions | Accepted | `7f5c323`; independent review and full root suite pass; grouped controls, captured temporary actions, recovery, and gesture/command boundaries verified. |
| 5. Global mirror centers | Accepted | Independent review and full root suite pass; lossless legacy conversion, centre/type editing, centre-only dragging, and persistent migrations verified. Commit pending. |
| 6. Selection transforms / anchors | Not started | Selection conversion approved; pattern content must remain unchanged. |
| 7. Crochet / final acceptance | Not started | |

### Starting evidence

- Revision: `86ce62f89406aa88ba278f4e1a40cadef664d1f5`; only this plan was untracked. The installed development dependencies were incomplete and older than the lockfile; `npm ci --cache /tmp/mosaic-npm-cache --no-audit --no-fund` restored the locked environment without tracked changes.
- Fresh `npm run test` passed on 3 October 2026, including tooling, production build, Rust formatting/Clippy/tests, logic/web unit tests, and 273 Playwright tests. Core Rust has 204 tests and tooling has 12. Browser/server tests require sandbox escalation in this environment.
- Production assets, gzip `-9`: JavaScript 41,981 bytes (145,945 raw), CSS 5,142 bytes (23,236 raw). External browser runtime dependencies: zero; two internal workspace packages.
- Comparison harness: `/tmp/mosaic-baseline.mjs`; frozen results: `/tmp/mosaic-crochet-baseline.json`; screenshots: `/tmp/mosaic-crochet-baseline-*.png`. Future harness runs default to `/tmp/mosaic-crochet-comparison`; pass an optional output prefix as argument 2. Chromium 153.0.8010.12, desktop 1440 × 960, touch 390 × 844 at DPR 3. These are temporary execution artifacts, not a permanent benchmark suite.
- Desktop median / p90 milliseconds: initial canvas frame 44.06 / 46.56 (10 samples); drawing 29.21 / 38.58 (15); mirrored drawing 31.07 / 32.87 (15); width edits 63.06 / 80.04 (10); Crochet stepping 77.42 / 93.58 (16). Touch drawing: 40.59 / 48.14 (10 samples). Timings include automation and two animation frames; canvas startup stops before dismissing About, so it is not time-to-usable-editor. Crochet initial generation is a single 306.87 ms sample; cached close-and-reopen median is 133.19 ms (6 samples). Touch timings cover drawing only.
- The drawing samples use the app's 9 × 9 chart and include both yarn-changing clicks and clicks that leave the existing yarn unchanged. They are a small interaction baseline, not a large-chart benchmark. Mutation counts include UI updates outside the renderer. Opening Settings focused `#hl-opacity` (“Guidance opacity”); desktop and touch sessions reported no page errors. Existing Playwright coverage checks shared canvas identity and viewport preservation through Crochet plus focus on Crochet entry and return (`web/e2e/instructions.spec.ts`).
- MutationObserver medians per operation: drawing 48 records, mirrored drawing 47, width edits 153, Crochet stepping 10. Whole-body observation includes UI updates and animation; compare like-for-like rather than interpreting these as isolated renderer costs.
- Global-axis migration fixtures reproduce identical orbits with disabled/repeated axes and odd/even and single-row/column canvases. Legacy local-transform fixtures demonstrate changed destinations, live painting, inverse edits, stamping, and persisted output under strict category conversion. Evidence: `/tmp/mosaic-compatibility-audit.test.ts` and `/tmp/mosaic-compatibility-audit.config.mjs`; four production-evaluator tests pass. This proves the chunk 6 policy gate is necessary; chunk 5 can proceed losslessly.

### Chunk 1 verification

- Existing behavior is covered without new source-structure assertions: `npm run test` passes 12 tooling, 204 core Rust, 8 WASM, 350 logic, 88 web unit, and 273 browser tests, including production build, formatting, and Clippy.
- `/tmp/mosaic-crochet-refactor.json` and screenshots preserve the baseline separately. Settings focus remains `hl-opacity`; browser errors remain empty. DOM mutation distributions match the baseline for drawing, transformed drawing, width edits, Crochet stepping, and touch drawing. Timing results vary across flows; one comparison run does not establish a timing regression.
- JavaScript: 145,882 raw / 42,126 gzip `-9` bytes; compressed delta +145 bytes (0.35%). CSS is unchanged. No runtime dependencies added. No durable document claim or release note changes are needed for this behavior-preserving refactor.

### Chunk 2 verification

- Full `npm run test` passes: 12 tooling, 204 core Rust, 8 WASM, 353 logic, 89 web unit, and 316 browser tests, with production build, formatting, and Clippy. Independent review found no outstanding functional defects.
- Correct failures preceded fixes for Crochet/modal command scope, final held-key move history and modifier precedence, atomic Paste, project-palette history, gesture cancellation, and partially or wholly off-canvas Move area behavior. Cancellation includes pointer cancellation, lost capture, blur, and Escape.
- Review regressions were also observed before correction: cancellation reverting unrelated view/tool changes; rejected, cancelled, or identical Open exiting Crochet; New/Example retaining the old Crochet preview; and separate authored actions or accepted Paste interleaving with an unfinished keyboard move. Failed Paste retains the cancellable gesture; successful subsequent edits retain distinct history boundaries.
- Different project replacement, New, and Example reset stored and rendered rotation before fitting. Identical Open and failed imports preserve the current session and view. Camera navigation remains outside authored Undo/Redo. History version 6 records project Danger/Accent overrides; legacy absent values preserve the current override.

### Chunk 3 verification

- Full `npm run test` passes: 12 tooling, 204 core Rust, 8 WASM, 353 logic, 92 web unit, and 327 browser tests, including production build, formatting, and Clippy. Independent review accepted the implementation and the updated navigation-icon assertion without losing rotation/reset coverage.
- Expected failures preceded fixes for stable clipboard availability, saved-selection and mirror row focus, Crochet direction regeneration, semantic-colour propagation, equal sample cell scale, and non-corner invalid placements. Review additionally reproduced focus loss after deleting an earlier row and stale mirror coordinate controls after opening a different kind with the same ID.
- Responsive regressions were reproduced before correction: enlarged-text toolbar overlap, focus loss while an open compact menu recomposed, and chart movement when the Crochet command label changed. Desktop, tablet, phone, enlarged text, reduced motion, and forced-colour checks cover the shared presentation; no browser page errors were reported.
- Isolated comparison artifacts: `/tmp/mosaic-crochet-ui-language-idle.json` and screenshots. Initial canvas frame median / p90 is 45.73 / 54.05 ms versus baseline 44.06 / 46.56; cached Crochet reopen is 133.28 / 149.99 versus 133.19 / 150.36. Drawing is 40.24 / 43.23, mirrored drawing 26.91 / 42.71, width edits 60.57 / 62.68, Crochet stepping 61.54 / 78.05, and touch drawing 43.02 / 44.92. Automation and animation-frame variation prevent interpreting these small samples as speed claims. An earlier concurrent run's startup increase was not reproduced in isolation.
- Mutation medians are 49 drawing, 48 mirrored drawing, 168 width edits, and 10 Crochet stepping. Added presentation attributes and responsive measurement account for the small increases; stepping is unchanged. Production assets, gzip `-9`: JavaScript 43,532 bytes (+1,551 / 3.69% from baseline), CSS 5,399 (+257 / 5.00%). No runtime dependency was added.

### Chunk 4 verification

- Full `npm run test` passes: 12 tooling, 204 core Rust, 8 WASM, 363 logic, 97 web unit, and 361 browser tests, including production build, formatting, and Clippy. Independent review accepted the corrected implementation and canonical documentation.
- Expected failures preceded fixes for middle-button inversion, right-button Add, held tool/yarn snapshots, explicit opposite-natural Eraser dispatch, remembered independent variants, and recovery migration. Recovery version 7 stores chosen variants; project files and authored history exclude them, and temporary execution feedback is never persisted.
- Native hold/release and touch scrolling exposed premature popover dismissal and retargeted release clicks. Tests cover cancellation, scrolling, keyboard navigation, outside dismissal, enlarged text, and chosen-versus-executing feedback. Updated existing flows retain their authored selection and movement assertions.
- Independent diagnostics reproduced hidden action feedback after yarn shortcuts or click release, stale menu coordinates after resize/scroll, and accepted commands overwritten by later held-pointer cancellation. Corrections settle successful authored commands before their own transaction while failed Paste and rejected Stamp retain cancellable input. Follow-up regressions cover mirror shortcuts, Stamp's settled source, and Move area's settled selection mask. Evidence: `/tmp/mosaic-review-tool-groups.mjs`.
- The wider dock exposed fitted wide-chart cells beneath yarn controls. A failing 50-column drawing test preceded symmetric Fit clearance; first/last cells remain editable with and without an inspector, and the chart stays horizontally centred. Opening panels, switching modes, and responsive recomposition still preserve the camera. The original long-instruction fixture passes without a navigation workaround.
- Isolated comparison: `/tmp/mosaic-crochet-tool-groups-idle.json` and screenshots, with no browser page errors and unchanged Settings focus. Median / p90 milliseconds: initial canvas 46.92 / 76.06, drawing 28.83 / 30.04, mirrored drawing 29.81 / 38.72, width edits 46.76 / 62.85, cached Crochet reopen 100.59 / 130.72, Crochet stepping 62.77 / 65.39, and touch drawing 44.31 / 47.45. These automation/animation-frame samples do not establish speed improvements; the initial-frame tail varies while its median remains close to baseline. Mutation medians are 45 drawing, 45 mirrored drawing, 135 width edits, and 10 Crochet stepping.
- Production gzip `-9`: JavaScript 45,384 bytes (157,854 raw), CSS 5,559 (25,617 raw), respectively +1,852 and +160 from chunk 3. No runtime dependencies were added. Desktop, phone, enlarged-text, and forced-colour screenshots were inspected.

### Chunk 5 verification

- Full `npm run test` passes: 12 tooling, 204 core Rust, 8 WASM, 346 logic, 104 web unit, and 379 browser tests, including production build, formatting, and Clippy. Obsolete axis-authoring tests were replaced by centre coverage; existing painting, source mapping, stamping, safety, and selection assertions remain. The first complete run found a stale recovery-version assertion; updating 7 to 8 retained its variant/reload/history checks, and the complete rerun passed.
- Expected assertion failures preceded centre composition, diagonal parity, narrow-chart snapping, empty-centre creation, resize, and persistence fixes. Supported project versions 3/4, recovery 4–7, and history unversioned/5/6 convert individual global axes losslessly, including disabled/repeated types, sparse sources, floats, yarns, and project overrides. New project/recovery/history versions are 5/8/7. Local-selection conversion remains deferred to chunk 6.
- Gesture regressions were reproduced before correction: mirror hits preparing Duplicate or Move area content, chart-sized hit tolerances at low zoom, accepted row actions overwritten by held-pointer cancellation, and inspector dismissal leaving a moved centre. Centre-only handles now preserve chosen tools and authored selection content, remain screen-sized in rotated views, and cancel or settle at the appropriate action boundary.
- Precision coordinates commit as a pair through Apply or Enter so intersecting diagonals can move between valid half-grid positions. Invalid pairs retain the previous centre; unconstrained coordinates stay reachable on the chart. Independent diagnostics cover all 32 type combinations on narrow charts, legal diagonal intercepts, overlapping handles, disabled centres, last-type removal, deletion focus, and phone row reachability.
- Independent review also reproduced failed-Open error presentation moving the rotated chart. A minimal alert overlay preserves the canvas rectangle and absolute chart position when shown or dismissed on desktop and phone; malformed files retain document/recovery/history, and long Save errors remain readable. Evidence: `/tmp/mosaic-mirror-centers-evidence.md`, `/tmp/mosaic-review-mirror-browser.mjs`, `/tmp/mosaic-review-mirror-snap.test.ts`, and `/tmp/mosaic-chunk5-full.log`.
- Isolated comparison: `/tmp/mosaic-crochet-mirror-centers-idle.json` and screenshots. The harness now creates the equivalent vertical mirror through Add mirror and its type toggle; measured drawing workloads and the frozen baseline are unchanged. Median / p90 milliseconds: initial canvas 49.54 / 64.55, drawing 27.35 / 29.44, mirrored drawing 27.83 / 35.98, width edits 61.00 / 62.11, cached Crochet reopen 132.97 / 133.60, Crochet stepping 61.96 / 64.47, and touch drawing 43.90 / 45.44. Small automation/animation-frame samples vary and do not establish speed improvements. No page errors; Settings focus remains unchanged.
- Mutation medians are 45 drawing, 45 mirrored drawing, 151 width edits, and 10 Crochet stepping. The expanded centre row adds coordinate/type presentation updates during width edits; drawing and stepping remain unchanged from chunk 4. Production gzip `-9`: JavaScript 46,097 bytes (160,470 raw), CSS 5,596 (25,698 raw), +713 and +37 from chunk 4. No runtime dependencies were added. Desktop, phone, enlarged-text, reduced-motion, and forced-colour views were inspected.
