# Product Model

This document records the durable user-facing decisions that define Mosaic Crochet Editor. It is a compact product map, not a usage guide or an inventory of every control. See [README.md](README.md) for the product overview and contributor setup, and [RELEASE_NOTES.md](RELEASE_NOTES.md) for changes over time.

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
- Rectangle, Wand, Move, and Overlay expose remembered variants through the same visible menu, hold, and keyboard routes. Button and modifier accelerators execute temporary actions without changing the chosen variant or yarn. — **Agent's choice**
- While a pointer or movement key is held, the executing action uses the ordinary selected-tool state and its matching variant icon; releasing or cancelling restores the current chosen tool immediately. — **your decision**
- Selection is a persistent movable layer rather than a temporary outline. It can be edited, duplicated, transformed, copied, cut, pasted, or committed without forcing the user into a separate document mode. — **your decision**
- Global Mirror transforms drawing across the whole chart independently of saved selections. Each saved selection has one active None, Grid, Circle, or Mirror category and retains the other categories' settings, including independent Circle and Mirror centres. None keeps the editable source without local copies; Circle uses chosen quarter turns, and Mirror composes its chosen types around one centre. — **your decision**
- Drawing applies the tool once at the clicked source or generated instance and copies its resulting yarn state through active transforms. Transforms can also be stamped deliberately onto existing content. — **your decision**
- Each global mirror has a centre with independently chosen vertical, horizontal, diagonal, anti-diagonal, and point-symmetry (180°) types. Its centre is edited through the mirror context; guide lines show its geometry. Supported older global mirrors preserve their transformed output when opened. — **your decision**
- Undo and redo cover authored changes as coherent user actions. Continuous gestures and related previews do not create a history entry for every intermediate frame. — **your decision**

## Guidance and validation

- The chart distinguishes the two yarns from overlay guidance. Valid overlay work, impossible placements, selections, and transform guides remain understandable without relying on yarn colour alone. — **your decision**
- Invalid overlay placements are explained and can be prevented during editing, but existing invalid work remains visible and correctable. They warn rather than block the Crochet workflow. — **your decision**
- Large or combinatorial operations have explicit safety limits and fail without partially modifying the project. — **joint**

## Crochet workflow

- Crochet mode is navigation-only: authored chart edits happen in Design, while Crochet presents generated rows or rounds, progress controls, direction guidance, and the chart state completed through the current instruction. — **your decision**
- Progress advances by whole rows or rounds, can jump directly to an instruction, and survives compatible stitch edits. It is personal local progress rather than portable project content. — **your decision**
- Whole pattern follows the final instruction and shows the authored chart with all overlay warnings; navigation wraps through it in both directions. — **your decision**
- Whole pattern is a transient overview: it retains the last selected instruction's progress, and reopening Crochet resumes that instruction. — **Agent's choice**
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
