# Product Model

This document records the durable user-facing decisions that define Mosaic Crochet Editor. It is a compact product map, not a usage guide or an inventory of every control. See [README.md](README.md) for current operation and [RELEASE_NOTES.md](RELEASE_NOTES.md) for changes over time.

An entry here is a product constraint, not a historical note. Changing or removing one requires explicit user approval before implementation.

**your decision** = decided by the user. **Agent's choice** = proposed and implemented without explicit instruction. **joint** = discussed and decided together.

## Purpose and scope

- The app turns an alternating-yarn mosaic crochet chart into both an editable visual design and a chart-derived work sequence. Design and Crochet are two views of the same project, not separate documents. — **your decision**
- Patterns support row construction and centre-out construction, including partial centre-out extents. Both modes use the same two-yarn chart language and overlay guidance. — **your decision**
- Full, Half, and Quarter are authored centre-out extents. They do not imply a transform or automatically generate the unauthored part of a design. — **your decision**
- Crochet instructions describe what can be derived from the chart. Technique choices that the chart does not encode, such as foundation and round-joining methods, remain with the crocheter. — **Agent's choice**

## Core workflow

The intended end-to-end story is:

1. Create or open a pattern and choose its construction, dimensions, and yarns.
2. Draw directly on the chart, using overlay guidance to keep the design crochetable.
3. Rework motifs with selection, movement, global symmetry, and reusable selection-based repeats.
4. Enter Crochet to follow the derived rows or rounds and see completed work accumulate on the same chart.
5. Save the authored project as an editable `.mcw` file; let browser recovery preserve in-progress workspace context between visits.

— **your decision**

## Editing model

- Pattern changes preview in place. Compatible geometry changes preserve authored cells where their meaning remains stable; changing between row and centre-out construction starts the new geometry. — **your decision**
- Editing is direct and tool-led. The chart remains the visual focus, while document commands, authoring tools, contextual inspectors, and navigation have distinct roles. — **your decision**
- Selection is a persistent movable layer rather than a temporary outline. It can be edited, duplicated, transformed, copied, cut, pasted, or committed without forcing the user into a separate document mode. — **your decision**
- Global Mirror and saved selections solve different use cases: mirror axes transform drawing across the whole chart, while an always-available current selection reproduces a motif through grids or whole-selection rotations and mirrors. Both apply while drawing and can be applied deliberately to existing content. — **your decision**
- Undo and redo cover authored changes as coherent user actions. Continuous gestures and related previews do not create a history entry for every intermediate frame. — **your decision**

## Guidance and validation

- The chart distinguishes the two yarns from overlay guidance. Valid overlay work, impossible placements, selections, and transform guides remain understandable without relying on yarn colour alone. — **your decision**
- Invalid overlay placements are explained and can be prevented during editing, but existing invalid work remains visible and correctable. They warn rather than block the Crochet workflow. — **your decision**
- Large or combinatorial operations have explicit safety limits and fail without partially modifying the project. — **joint**

## Crochet workflow

- Crochet mode is navigation-only: authored chart edits happen in Design, while Crochet presents generated rows or rounds, progress controls, direction guidance, and the chart state completed through the current instruction. — **your decision**
- Progress advances by whole rows or rounds, can jump directly to an instruction, and survives compatible stitch edits. It is personal local progress rather than portable project content. — **your decision**
- The complete compressed instruction sequence remains available for copying, while the primary workflow emphasizes the current instruction and its location on the chart. — **your decision**

## Projects, recovery, and ownership

- `.mcw` is the editable project format. It carries authored crochet content and reusable project transforms, but not transient tool state, a live selection, app-wide preferences, undo history, or Crochet progress. — **your decision**
- Browser recovery is automatic and separate from Save. It restores the local editing session but never implies that an external project file was updated. — **your decision**
- App-wide display preferences belong to the browser; project-specific visual choices travel with the project. Opening a project must not silently replace the user's global defaults. — **your decision**
- Invalid or unsupported files leave the active session unchanged and explain the failure without blocking the workspace. — **Agent's choice**

## Workspace principles

- Desktop, tablet, and phone present one recognizable workflow. Layout and density adapt to available space and input capabilities without changing the meaning or order of core tools. — **your decision**
- Mouse, touch, pen, and keyboard routes produce the same document outcomes. Gestures and shortcuts accelerate visible actions rather than becoming the only way to perform essential work. — **Agent's choice**
- The canvas remains visually stable across responsive recomposition, open inspectors, and the Design/Crochet transition. Navigation and contextual chrome adapt around it rather than changing the document view unexpectedly. — **your decision**
- Controls expose clear focus, selection, unavailable, warning, and error states with non-colour cues. Increased text size, browser zoom, reduced motion, high contrast, and touch-sized targets are supported as part of the main interface. — **Agent's choice**
