# Architecture

This document records the durable technical constraints that define the system. It stays intentionally small: implementation details belong near the code, operational instructions belong in [README.md](README.md), and product behaviour belongs in [FEATURES.md](FEATURES.md).

An entry here is a constraint, not a historical note. Changing or removing one requires explicit user approval before implementation.

**your decision** = decided by the user. **Agent's choice** = proposed and implemented without explicit instruction. **joint** = discussed and decided together.

## System shape

Mosaic Crochet Editor is a client-side browser application designed for static hosting. Editing, recovery, file conversion, and crochet-instruction generation do not depend on an application server. — **Agent's choice**

```text
web (DOM, canvas, browser I/O)
 ├── logic (browser-independent editor and document logic)
 └── wasm (thin interop boundary)
       └── core (Rust crochet and chart domain logic)
```

- Rust compiled to WebAssembly owns geometry-sensitive chart operations and crochet-instruction derivation. TypeScript owns editor state, interaction composition, and presentation. A domain rule has one authoritative implementation rather than parallel Rust and TypeScript versions. — **your decision**
- `core` is independent of WebAssembly and browser APIs. `wasm` adapts it for JavaScript without becoming a second domain layer. — **Agent's choice**
- `logic` is independent of the DOM, while `web` owns all browser effects and UI. The dependency direction is enforced by package boundaries and TypeScript configuration. — **joint**
- Domain layers return structured data; user-facing text and graphics are produced at the presentation boundary. This keeps crochet semantics usable independently of the current interface. — **your decision**

## Code design constraints

- Modules have cohesive responsibilities and focused interfaces rather than collecting unrelated implementations by technical role. Shared modules expose semantically coherent primitives; callers should not depend on a broad module to use one small, architecturally appropriate part. Application composition, including `main`, may coordinate modules and implement glue or small supporting operations. — **your decision**
- Module dependencies follow meaningful abstraction boundaries and remain one-way and acyclic. Pass functions at a boundary when a direct import would make an abstraction depend on a concrete implementation. Interfaces should make correct use straightforward and misuse difficult. — **your decision**
- Prefer data-oriented transformations with explicit inputs and outputs, pure functions, and algebraic data types where practical. Application wiring stays together at the composition boundary; effects are explicit and confined to modules that require them. — **your decision**
- Stateful objects are justified by an invariant they enforce or a resource lifetime they own. Otherwise, prefer free functions with explicit state and dependencies; do not hide mutable state in module singletons or factory closures. — **your decision**
- Violations of caller-owned preconditions are assertions in development and tests. Ordinary guards are reserved for documented runtime drops caused by legitimate user actions, such as off-canvas or structurally absent cells. — **your decision**

## State boundaries

State is classified by meaning, not by whichever storage mechanism currently holds it.

| Scope | Durable boundary | Attribution |
|---|---|---|
| Project document | Pattern geometry and cells, yarn definitions, pattern mirror centres and their selected types, saved repeat definitions, and project-specific display overrides travel in `.mcw`. | **your decision** |
| Editor workspace | Active tools, live selection, current repeat source, and other resume-editing context may be recovered locally but are not part of the portable project. | **your decision** |
| Undo and redo | Each project has its own browser-local history of reversible authored edits and relevant editing context, including yarns and project Danger/Accent overrides, kept across reloads; camera navigation, browser preferences, and crochet progress are excluded. The history marks the step that matches the last saved file, so undoing back to it leaves the project unmodified. | **your decision**; project-palette distinction: **Agent's choice** |
| Open projects | Each open project keeps its own document, undo history, live selection, repeat source, view, Design/Crochet mode, and Crochet progress; tools, preferences, and the clipboard are shared by all of them. The open projects, their titles, and the active one are recovered locally, while each project's view and mode are held in memory only. | **your decision** |
| Preferences | App-wide display defaults are browser-local and remain separate from both project documents and recovery snapshots. | **your decision** |
| Crochet progress | Progress is browser-local, keyed to compatible pattern geometry, and is neither project content nor an authored edit. | **your decision** |

File formats and browser records are versioned and validated before replacing live state. Supported older project data is migrated at the boundary rather than leaking compatibility cases through editor logic. — **joint**

Each open project's recovery record and undo history live in IndexedDB under the project's id, one record per undo snapshot so an edit writes only what it adds; a small localStorage index lists the open projects. The in-memory session is authoritative and records are written behind it, so a storage failure is reported but never limits editing or undo depth. — **Agent's choice**

Only the editing window writes or deletes browser records, and it reads them only after becoming the editor. A window that takes over reads every write the previous editor issued before the take-over; the previous editor stops writing as soon as it learns of the take-over and reloads its session from storage before editing again. Without Web Locks, every window edits. — **Agent's choice**

## Editor and presentation boundaries

- The UI uses ordinary DOM controls around a chart drawn by a WebGL2 layer, driven from TypeScript, under a Canvas 2D overlay. The GPU draws only the output of the Rust highlight plan and never decides which cells get ✕ or !. Without WebGL2 the chart area explains that the chart can't be shown; there is no fallback renderer. Design and Crochet share one persistent chart and view, while mode-specific controls and inspectors overlay the workspace without changing the chart's screen geometry. — **your decision**; the split of cells, grid and highlight glyphs on the GPU from selections, guides, seams and labels on the overlay: **Agent's choice**
- A single state owner governs committed editor state; derived render data comes only from that state, rebuilt or updated from the owner's change reports, and nothing else edits it. — **your decision**
- Pointer types share one interaction model. Mouse, touch, and pen may have different accelerators, but they do not have separate editing semantics. — **Agent's choice**
- A floating selection is an editor layer over the chart. Saving and instruction generation consume a composed snapshot without mutating that live editing state. — **your decision**
- Crochet instruction generation runs off the main thread; each Crochet session owns and terminates its workers, and only the session that requested a result applies it. — **joint**

## Safety and scale

Operations whose expansion depends on user-authored geometry are bounded and atomic: they either produce a complete valid result or leave the document unchanged. Persistent input is validated before allocation or session replacement. — **joint**
