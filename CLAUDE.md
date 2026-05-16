# Instructions for Claude

## Documentation roles

The three top-level docs each have a distinct job. Keep them in their lane — don't mix purposes.

- **`README.md`** — documentation **for users, devs, and visitors**. The "how do I use / build / run this" file. Prose, examples, screenshots if any. Lives in the present tense.
- **`FEATURES.md`** — **product decisions**. Terse log of what the app does and (briefly) why, attributed. Not a tutorial — describe the decision, not the usage. If you want to write "Click X to do Y", that belongs in README.
- **`ARCHITECTURE.md`** — **technical decisions**. Code structure, module boundaries, algorithm choices, library/runtime picks. Specific implementation detail (math formulas, function signatures, step-by-step algorithms) belongs in source code comments — not here. This file records *why* things are shaped the way they are.

In short: README answers "how do I", FEATURES answers "why does it behave this way", ARCHITECTURE answers "why is the code shaped this way".

## Keeping the docs up to date

The three docs are living and must stay in sync with the codebase. Never let them drift.

### When to update which

- User-visible behaviour changes (a tool added, a gesture changed, a shortcut added) → update **README.md** *and* add a one-line decision to **FEATURES.md**.
- Tech stack / dependency / module / non-trivial architectural change → add a one-line decision to **ARCHITECTURE.md**.
- Bug fix that changes documented behaviour → update the relevant file(s).

### How to attribute decisions

Every entry in FEATURES.md and ARCHITECTURE.md must be labelled:

- **your decision** — the user specified or requested this explicitly.
- **Claude's choice** — you proposed and implemented this without explicit instruction.
- **joint** — discussed together before deciding.

When in doubt, be honest. If you suggested something and the user accepted it without pushback, it is still **Claude's choice** unless they gave clear direction.

### Format

Follow the existing structure in each file. Add new entries under the appropriate section. Do not reorganise existing sections without being asked. Keep entries terse — these are decision logs, not tutorials.

### Priority

Keeping the docs accurate takes priority over keeping responses short. Always update them in the same response that makes the change — never defer documentation to a later turn.

## Keeping tests up to date

Tests live in three layers — all three must stay green and current with the code:

- **Rust** (`cargo test`) — geometry, paint primitives, exporter logic. Add a test for any new Rust function or any bug fix that's reproducible in Rust.
- **TS unit** (`bun run --cwd web test`, Vitest) — `web/tests/*.test.ts`. Covers `store`, `selection`, `paint`, `clipboard`, `symmetry`, `storage`, `history`, `pattern`, `types`. Add or update a test whenever you change behaviour in one of these modules. jsdom is per-file via `// @vitest-environment jsdom`.
- **E2E** (`bun run --cwd web test:e2e`, Playwright) — `web/e2e/*.spec.ts`. Covers full user flows (boot, tools, paint, selection, move, copy/cut/paste, symmetry, edit popover). Add a spec for any new user-visible flow or any bug fix that needed a manual UX verification.

### Rules

- **Red → green.** Write the failing test first, run it and confirm it fails for the *expected* reason, then implement until it passes. Applies to both bug fixes (the test reproduces the bug) and new features (the test pins the desired behaviour). A test that lands green on the first run is suspicious — verify it would have caught the regression.
- Pick the right layer: Rust for geometry, Vitest for module logic, Playwright for UX flows. A change touching more than one layer gets tests in each.
- Renaming / removing API: update the tests in the same response. Never leave tests referencing the old shape.
- Tests aren't optional. If a change can be tested, it should be. If it genuinely can't (e.g. visual render details), say so explicitly in the commit / PR rationale.
- `bun run test` at the root chains all three; run it before declaring work done.
