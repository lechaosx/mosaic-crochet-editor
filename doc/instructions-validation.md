# Crochet validation protocol

Status: ready for formative sessions. No product gate has passed until observations are recorded below.

## Decisions this protocol supports

Run the two gates independently:

1. **Crochet tracking gate** — whether chart-derived WIP plus selectable whole-row/whole-round progress is useful during real crochet, or whether users need finer compressed-instruction tracking.
2. **Traversal gate** — whether crocheters can choose and understand row or round start, direction, and direction schedule without the editor implying a technique.

Chart-derived WIP is the Crochet baseline. Evidence for finer tracking must identify failures inside a row or round rather than general preference.

## Recruitment

Begin with three formative sessions. After the last interface or wording change, run at least three further confirmation sessions.

Across the confirmation sessions, include:

- crocheters who regularly follow overlay mosaic charts in rows;
- crocheters who have worked centre-out mosaic squares;
- both left- and right-handed crocheters where recruitment permits;
- at least two sessions on a touch tablet;
- at least one session on a desktop or laptop.

Record a participant's existing practice rather than treating it as the expected app behavior: chart direction, whether work is turned, how yarn changes, and how rounds are joined or carried.

## Test material

Use the two editable fixtures below and prepare the yarn needed to work them:

- [Rows fixture](validation-fixtures/rows-live.mcw): five worked rows after the foundation, 11 positions wide, with ordinary `sc`, isolated `oc`, repeated sequences, and an asymmetric motif so a reversed row is visible.
- [Centre-out fixture](validation-fixtures/centre-out-live.mcw): four complete rounds on an even 10 × 10 chart, with ordinary corners, overlays adjacent to corners, and two distinguishable middle positions on every side.

Use strong yarn contrast and label the physical yarns A and B. Do not teach a foundation, overlay stitch recipe, yarn-change method, join, or finishing method; participants use their own.

## Session setup

Allow 35–50 minutes. Ask permission before recording the screen, hands, or audio. Record the app version or commit, viewport, input method, and whether the participant has seen the app before.

Before opening Crochet, ask the participant to describe how they normally:

- find the start of a chart row or round;
- remember the current position within a long row or round;
- recover after an interruption or mistake;
- describe the two middle stitches of an even-length side.

Do not introduce the app's proposed traversal terms during this baseline.

## Basic Crochet tasks

Use neutral prompts and allow silence. Explain only that `oc` marks an overlay operation whose physical method is the participant's choice.

### Rows

1. Open the Rows fixture and ask: “Use the app to continue this pattern for three rows.”
2. After the participant completes part of the second row, interrupt for two minutes with an unrelated question. Ask them to resume without pointing at the screen.
3. After they advance to the next row, say: “Suppose you advanced too early. Show what you would do.”
4. Ask them to check the finished work against the chart and identify the next row and yarn.

### Centre-out

Repeat the same task for three rounds. Do not resolve the participant's starting corner, join, yarn-carry, or rotation choices unless the app itself makes the requested work impossible.

### Observe

For every row or round, record:

- whether work began at the intended chart position;
- whether Forward was used only after completing the boundary;
- whether Back recovered the intended boundary;
- number of app actions between boundaries;
- whether the participant lost the current row/round, chart position, compressed-instruction position, yarn, or physical stitch position;
- whether they used the highlighted instruction, WIP chart, compressed text, or physical work to recover;
- any point where the finished chart implied that not-yet-worked overlay was already physically present;
- facilitator intervention and the exact reason it was needed.

After each geometry, ask:

- “What did the highlighted instruction line mean to you?”
- “What did you expect Forward and Back to change?”
- “What information was missing when you resumed?”
- “Would showing partly completed crochet have changed your decision, or only made the picture look more familiar?”

## Traversal terminology tasks

Run these after the Crochet tasks so proposed labels cannot prime the baseline observation.

Use small chart diagrams with a start marker and arrow. Show the diagram without a label first, ask the participant to describe it, then test the candidate label. A participant must demonstrate the result on the diagram; agreement with wording alone is insufficient.

### Rows

Test these independently:

- `Start at left edge` and `Start at right edge`;
- `Work left to right` and `Work right to left`;
- `Same direction each row` and `Alternate direction each row`.

Ask whether any label implies turning, fastening off, handedness, or a yarn-change method. Record the participant's own preferred wording.

### Centre-out

On an upright square, test:

- each named corner as a start marker;
- `Clockwise` and `Counter-clockwise` with visible arrows;
- each side midpoint;
- both central positions on an even-length side, first as markers A/B and then as `nearer [adjacent corner]` labels;
- `Same direction each round` and `Alternate direction each round`.

Ask the participant to point to the first three worked positions on two differently sized rounds. This checks that one semantic origin maps across rounds instead of merely naming one absolute cell.

Ask whether `start` means the first chart position, the yarn join, the corner group, or something else in their practice. Keep those concepts separate in the evidence.

## Evidence log

Copy one row per session. Link detailed notes or recordings rather than embedding personal information here.

| Session | Experience and handedness | Device/input | Geometry | Current unit | Boundary errors | Resume result | Lost-place category | Technique assumption exposed | Notes |
|---|---|---|---|---:|---:|---|---|---|---|
| — | — | — | — | — | — | — | — | — | — |

Record terminology results separately:

| Session | Stimulus | Participant's words before label | Candidate label understood? | Demonstrated order correct? | Unwanted implication |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

## Gate criteria

### Basic Crochet

Pass Rows and Centre-out separately. A geometry passes only when confirmation sessions show all of the following:

- participants advance and reverse whole-unit progress without facilitator instruction;
- interruption recovery succeeds from the shipped chart, focused path, text, and physical work;
- no repeated error comes from treating finished-chart overlays as already crocheted;
- Forward and Back are not the dominant source of interaction or attention;
- participants can identify the next unit and its yarn colour after returning to Design and reopening Crochet.

If only one geometry passes, extend only that geometry. A failed gate remains a reason to improve or remove the affected Crochet path, not a reason to add more progress controls.

### Traversal

Pass only when participants can demonstrate the chosen start and the first three positions across differently sized units. A label that needs an arrow or marker should ship with that visual rather than relying on prose.

Do not pass a centre-out midpoint choice if participants consistently understand the marker but disagree about its name. Keep the visual-first control and test revised wording. Do not infer direction from handedness.

### Compression-tree tracking

Consider it only when participants repeatedly retain the correct row/round but lose their place inside compressed work. Do not use row/round confusion, chart-scale problems, or physical-stitch uncertainty as evidence for nested stepping.

### Chart-derived WIP

Confirm that participants understand the canvas as finished work through the highlighted current line, distinguish it from future work, and never see a future overlay affect the visible surface. Record the exact cells whenever the rendered state is misleading.

## Research constraints behind the prompts

- The [Craft Yarn Council abbreviation list](https://www.craftyarncouncil.com/standards/crochet-abbreviations) standardizes `sc`, `ch`, `rnd`, `BLO`, and `FLO`, but not the editor's `oc`; every tested view must keep defining `oc`.
- Row-overlay tutorials commonly describe all-right-side work in one direction, often right-to-left for right-handed crocheters and left-to-right for left-handed crocheters. The editor therefore tests origin and direction directly instead of deriving them from handedness. See [Interweave's overview](https://www.interweave.com/article/crochet/learn-mosaic-crochet-colorwork/) and [HanJan Crochet's chart guide](https://www.hanjancrochet.com/mosaic-crochet-chart/).
- Centre-out tutorials commonly use corners for increases, markers, joins, and yarn changes, and they document both ordinary and overlay corner constructions. Those practices make a corner familiar but do not establish universal names for arbitrary side-midpoint starts. See [Ashlee Brotzell's centre-out tutorial](https://ashleeslint.com/wp-content/uploads/2022/04/AshleeBrotzellCenterOutOverlayMosaicCrochetTutorial.pdf) and [Concrete Gems' centre-out guide](https://concretegems.co.uk/mosaic-crochet-center-out/).
