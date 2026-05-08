# Instructions for Claude

## Keeping documentation up to date

`FEATURES.md` and `ARCHITECTURE.md` are living documents that must be kept in sync with the codebase at all times. This is a hard requirement — do not let them drift.

### When to update

Update the relevant file whenever you:
- Add, remove, or significantly change a user-facing feature → update `FEATURES.md`
- Change the tech stack, add/remove a dependency, restructure a module, or make a non-trivial architectural decision → update `ARCHITECTURE.md`
- Fix a bug that changes documented behaviour → update the relevant file

### How to attribute decisions

Every entry must be labelled with who made the decision:
- **your decision** — the user specified or requested this explicitly
- **Claude's choice** — you proposed and implemented this without explicit instruction
- **joint** — discussed together before deciding

When in doubt, be honest. If you suggested something and the user accepted it without pushback, it is still **Claude's choice** unless they gave clear direction.

### Format

Follow the existing structure in each file. Add new entries under the appropriate section. Do not reorganise existing sections without being asked.

### Priority

Keeping these files accurate takes priority over keeping responses short. Always update them as part of the same response in which you make the change — do not defer documentation to a later turn.
