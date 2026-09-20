# User stories

This map covers the workflows represented by the current interface. The linked end-to-end specs are the executable acceptance criteria; unit tests cover the underlying calculations and persistence formats.

## Start and return

- As a new designer, I can start a row pattern or a centre-out pattern, open an editable `.mcw`, or explore a representative example without first understanding the editor. ([fresh-start.spec.ts](../web/e2e/fresh-start.spec.ts))
- As a returning designer, I resume the last recoverable browser session and can distinguish that recovery from an explicitly saved `.mcw` file. ([persistence.spec.ts](../web/e2e/persistence.spec.ts))
- As a designer opening external work, I keep my active session when a file is unreadable, invalid, or from an unsupported future version. ([symmetry-and-edit.spec.ts](../web/e2e/symmetry-and-edit.spec.ts))

## Design

- As a designer, I can preview Pattern resize consequences, close and reopen the modeless panel without changing history, and undo or redo all uninterrupted Pattern adjustments as one exact before-and-after state. ([interactions.spec.ts](../web/e2e/interactions.spec.ts))
- As a designer, I can draw finished-square colours, restore natural colours, invert cells, fill regions, and use either yarn without the chart confusing colour with stitch technique. ([paint.spec.ts](../web/e2e/paint.spec.ts), [paint-preview.spec.ts](../web/e2e/paint-preview.spec.ts))
- As a designer, I can place or remove overlay guidance and understand unavailable or protected placements before or after acting. ([guidance-and-prevention.spec.ts](../web/e2e/guidance-and-prevention.spec.ts), [canvas-feedback.spec.ts](../web/e2e/canvas-feedback.spec.ts))
- As a designer, I can select by rectangle or connected region, visibly add to or subtract from that selection, and move, duplicate, mask-move, copy, cut, paste, or deselect it. ([selection.spec.ts](../web/e2e/selection.spec.ts), [wand-modifiers.spec.ts](../web/e2e/wand-modifiers.spec.ts), [clipboard.spec.ts](../web/e2e/clipboard.spec.ts))
- As a designer, I can configure mirrors and a repeat grid, apply them while drawing or stamp an existing selection, preview exact destinations, and resolve conflicts without partial edits. ([symmetry-and-edit.spec.ts](../web/e2e/symmetry-and-edit.spec.ts))
- As a designer, I can select, edit, and swap Yarn A and Yarn B without relying on colour alone. ([accessibility.spec.ts](../web/e2e/accessibility.spec.ts), [touch.spec.ts](../web/e2e/touch.spec.ts))
- As a designer, I can undo or redo document and tool-recipe changes, recover local work after reload, and save an editable file without destroying an active selection. ([paint.spec.ts](../web/e2e/paint.spec.ts), [persistence.spec.ts](../web/e2e/persistence.spec.ts), [interactions.spec.ts](../web/e2e/interactions.spec.ts))
- As a designer inspecting a large chart, I can fit, zoom, pan, and rotate the canvas without editing it or changing its logical coordinate frame. ([navigation.spec.ts](../web/e2e/navigation.spec.ts), [rotation.spec.ts](../web/e2e/rotation.spec.ts))

## Crochet

- As a crocheter, I can switch from Design to Crochet without moving or replacing the chart, and I see instruction controls rather than authoring controls around it. ([instructions.spec.ts](../web/e2e/instructions.spec.ts))
- As a crocheter, I can always see where I am in the complete row or round sequence and see the chart as it should look through the end of the highlighted line, without future work leaking into the preview. ([instructions.spec.ts](../web/e2e/instructions.spec.ts))
- As a crocheter, I can choose any instruction, move back or forward by a whole row or round, retain my place across stitch edits, and recognize the progress limits. ([instructions.spec.ts](../web/e2e/instructions.spec.ts))
- As a crocheter, I can switch alternating direction immediately and copy the complete compressed instruction dump with visible success or failure feedback. ([instructions.spec.ts](../web/e2e/instructions.spec.ts))
- As a crocheter, I can locate unresolved chart positions and cannot record misleading progress until those blockers are fixed. ([instructions.spec.ts](../web/e2e/instructions.spec.ts))

## Access and adaptation

- As a mouse, touch, pen, or keyboard user, I can reach the same document outcomes through controls appropriate to my input method. ([touch.spec.ts](../web/e2e/touch.spec.ts), [keyboard-cursor.spec.ts](../web/e2e/keyboard-cursor.spec.ts), [accessibility.spec.ts](../web/e2e/accessibility.spec.ts))
- As a phone, tablet, enlarged-text, reduced-motion, or forced-colour user, I retain operable targets, readable controls, and a usable canvas without horizontal command scrolling. ([responsive-toolbar.spec.ts](../web/e2e/responsive-toolbar.spec.ts), [accessibility.spec.ts](../web/e2e/accessibility.spec.ts))

## Control ownership

Every visible control must serve one of the stories above in its current workspace.

| Surface | Design | Crochet |
|---|---|---|
| Document bar | Identical global mode, Pattern, Load, Save, Undo, Redo, recovery, and Settings controls | Identical; Pattern and Settings stay in Crochet until a Pattern canvas change, while document mutations return to Design |
| Mode panel | Colour, Overlay, Arrange, and Yarn controls | Direction, copy, errors, selectable work sequence, Back, and Forward |
| Canvas controls | Navigate, Fit, zoom, and rotation | Fit, zoom, and rotation; direct canvas gestures already navigate |
| Canvas status | Tool, yarn, coordinates, selection, overlay, and transform context | Omitted; current-line and progress context live in the Crochet panel |
| Inspector | Pattern, Selection, Mirror & Repeat, and Settings | Pattern and Settings open without leaving Crochet |
