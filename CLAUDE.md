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
