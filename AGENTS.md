# Instructions for Agent

## Integrated results

Prefer an end state that looks as though the requested capability or constraint had been considered from the beginning. Optimize for coherence within the requested scope, not for the smallest textual diff or for preserving accidental structure.

Refactoring code or documentation is appropriate when it earns its keep by making the result materially simpler, clearer, more internally consistent, or easier to maintain. In particular:

- reshape an existing boundary, data flow, or document structure when merely appending the change would leave duplication, contradictory concepts, obsolete paths, or visible implementation seams;
- remove superseded code and prose instead of preserving the history of how the result evolved;
- make the finished artifact explain itself without relying on the task, conversation, or a trail of corrective additions; and
- keep the refactoring proportional to the durable benefit and verify preserved behaviour.

This is not permission for unrelated cleanup, speculative abstraction, aesthetic rewrites, or broad behaviour changes. Every changed line must still serve the requested outcome. If a substantially larger refactor is needed to produce the coherent result, explain the tradeoff before proceeding.

When work requires both refactoring and a functional change, put them in separate commits and verify each commit independently. The same applies to restructuring documentation while changing its substantive policy or meaning. Put the refactoring commit first when it creates a stable shape in which the change becomes local and obvious; put it afterwards when the right structure only becomes clear once the change exists. Each commit must be coherent and leave the repository in a valid state. Do not hide behaviour or policy changes inside moves, renames, formatting, or structural rewrites. If the changes genuinely cannot be separated, explain why before proceeding.

## Documentation roles

The four top-level docs each have a distinct job. Keep them in their lane — don't mix purposes.

- **`README.md`** — a **skimmable landing page for users, contributors, and visitors**. It explains what the app is, shows its main capabilities, links to the live app and deeper project documents, and gives only the essential build, run, and test commands. It is not a control reference or user manual.
- **`FEATURES.md`** — the **durable product model**. It records the app's defining user stories, workflows, use cases, and user-facing constraints. It is neither a tutorial nor an exhaustive feature list.
- **`ARCHITECTURE.md`** — the **durable technical model**. It records high-level boundaries and the few non-obvious code-design or implementation decisions that are expected to constrain future work.
- **`RELEASE_NOTES.md`** — terse, dated summaries of meaningful user-visible changes deployed continuously from `master`. No release versions or semantic versioning. Its complete entries are also shown in the About dialog.

In short: README answers "what is this and how do I work on it", FEATURES answers "what product are we building", ARCHITECTURE answers "what technical shape must we preserve", and RELEASE_NOTES answers "what changed for users".

Before planning work that may affect the product model or a technical boundary, read the relevant FEATURES or ARCHITECTURE entries. Read both when a change crosses that boundary.

## Keeping the docs up to date

The four docs are living and must stay in sync with the codebase, but FEATURES and ARCHITECTURE are deliberately low-traffic. They describe the stable shape of the product and system, not the history of every decision.

### Documentation hygiene

- Keep one canonical home for each fact. Link to that source when another document needs context instead of copying the details.
- Prefer removing obsolete or low-value prose over appending corrections. A document should read as a coherent current description, not as a history of additions.
- Keep the README easy to scan. Its user-facing content is limited to the product purpose, a concise capability overview, representative media, and links. Its contributor content is limited to the commands needed to start, test, and build the project.
- Do not put exhaustive control descriptions, shortcut tables, edge cases, safety limits, file-format field lists, or responsive-layout rules in the README. Behaviour that is clear from labels, tooltips, feedback, or ordinary use belongs in the app rather than in a parallel manual.
- Put a non-obvious crochet-semantic contract in the chart dialect, and a validation procedure in its dedicated protocol. Keep implementation detail close to the code unless it qualifies as a durable architecture constraint.
- Treat release notes as summaries, not specifications. Group related changes by user outcome, omit implementation details and minor polish, and default to one to four one-sentence bullets per date. Exceed that only when additional independently meaningful changes cannot be combined clearly.
- A code change does not automatically require every document to change. Update only the canonical documents whose current claims or durable constraints are affected.

### Admission test for durable decisions

Add or retain an entry in FEATURES or ARCHITECTURE only when it:

- describes a durable direction or constraint rather than the current implementation snapshot;
- is difficult to recover reliably by reading the code or using the app;
- is specific enough to verify, but broad enough to permit multiple compliant implementations;
- would be costly, risky, or product-defining to reverse;
- will guide more than one future change; and
- would warrant explicit user approval before a future maintainer violates it.

High-level decisions should dominate. A lower-level code-design or implementation decision may be included when it passes the same test and earns the maintenance cost. Module inventories, function signatures, algorithm walkthroughs, dependency versions, control-by-control behaviour, temporary limitations, and one-off bug rationales normally do not belong.

Treat every recorded entry as a constraint. Before implementing work that would change, remove, or contradict one, identify the affected entry, explain the reason and tradeoff to the user, and obtain explicit approval. Do not silently rewrite the document to match an implementation.

### When to update which

- Meaningful user-visible behaviour changes → add a terse entry under the current date in **RELEASE_NOTES.md**. Update **README.md** only when its product summary, capability overview, media, links, or contributor instructions would otherwise become inaccurate.
- Update **FEATURES.md** only when the durable product model changes, not for every feature or interaction change.
- Update **ARCHITECTURE.md** only when a durable technical constraint changes or a newly established decision passes the admission test, not for routine dependency, module, algorithm, or implementation changes.
- Bug fix that changes documented behaviour → update the relevant file(s).

### How to attribute decisions

Every entry in FEATURES.md and ARCHITECTURE.md must be labelled:

- **your decision** — the user specified or requested this explicitly.
- **Agent's choice** — you proposed and implemented this without explicit instruction.
- **joint** — discussed together before deciding.

When in doubt, be honest. If you suggested something and the user accepted it without pushback, it is still **Agent's choice** unless they gave clear direction.

### Format

Follow the existing structure in each file. Add new entries under the appropriate section. Do not reorganise existing sections without being asked. Keep entries terse and independently understandable. Release-note headings use dates, not release numbers, and related changes should share a single outcome-focused bullet.

### Priority

Keeping the docs accurate takes priority over keeping responses short. Always update them in the same response that makes the change — never defer documentation to a later turn.

## Keeping tests up to date

Tests live in three layers — all three must stay green and current with the code:

- **Rust** (`cargo test`) — geometry, paint primitives, exporter logic. Add a test for any new Rust function or any bug fix that's reproducible in Rust.
- **TS unit** (`bun run --cwd web test`, Vitest) — `web/tests/*.test.ts`. Covers `store`, `selection`, `paint`, `clipboard`, `symmetry`, `storage`, `history`, `pattern`, `types`. Add or update a test whenever you change behaviour in one of these modules. jsdom is per-file via `// @vitest-environment jsdom`.
- **E2E** (`bun run --cwd web test:e2e`, Playwright) — `web/e2e/*.spec.ts`. Covers full user flows (boot, tools, paint, selection, move, copy/cut/paste, symmetry, edit popover). Add a spec for any new user-visible flow or any bug fix that needed a manual UX verification.

### Rules

- **Red → green. No exceptions.** Write the failing test first, run it and confirm it fails for the *expected* reason, then implement until it passes. Applies to both bug fixes (the test reproduces the bug) and new features (the test pins the desired behaviour). A test that lands green on the first run is suspicious — verify it would have caught the regression. Knowing what is broken from reading the code is not a valid reason to skip writing the test first — a test that passes vacuously (correct assertion, wrong reason) is worse than no test at all.
- Pick the right layer: Rust for geometry, Vitest for module logic, Playwright for UX flows. A change touching more than one layer gets tests in each.
- Renaming / removing API: update the tests in the same response. Never leave tests referencing the old shape.
- Tests aren't optional. If a change can be tested, it should be. If it genuinely can't (e.g. visual render details), say so explicitly in the commit / PR rationale.
- `bun run test` at the root chains all three; run it before declaring work done.
