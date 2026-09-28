# Chart dialect contract

This contract defines the chart information that Mosaic Crochet Editor can turn into its Crochet work sequence. The editor models an alternating-yarn mosaic chart with derived overlay positions; it does not prescribe a complete crochet technique.

## Terms and scope

- **Rows** and **Centre-out** are the two pattern geometries. A Rows pattern contains worked **rows**; a Centre-out pattern contains worked **rounds**.
- `sc` means single crochet, `ch` means chain, and `oc` means the chart requires an overlay operation at that position. The user chooses how to make an `oc`; the abbreviation does not assign it a stitch recipe.
- Foundation and centre-setup methods, turning, cutting, carrying, joining, finishing, and yarn transitions are not prescribed by the generated sequence.
- A **worked coordinate** is where a stitch contributes to the visible chart. Its **supporting coordinate** or **parent coordinate** identifies the inward position from which that contribution is derived.

## Work identity and yarn phase

| Geometry | Work outside Crochet | First generated unit | Yarn phase |
|---|---|---|---|
| Rows | Physical foundation method | Row 1, the bottom chart row | Row 1 Yarn A; later rows alternate upward |
| Centre-out | Centre setup or foundation | Round 1, the innermost visible band | Round 1 Yarn A; later rounds alternate outward |

Row and round identities survive clipping to an authored extent. Crochet identifies each unit's logical Yarn A/B slot without prescribing how yarns change between units.

## Stitch derivation

- An ordinary worked position emits `sc` unless the chart derives a visible overlay there, in which case it emits `oc` and retains the inward supporting coordinate.
- A diagonal Centre-out corner pixel emits `ch`. The two adjacent worked positions share its inward parent, forming the complete `(sc, ch, sc)` corner group when all three positions are in the authored extent.
- A corner pixel cannot itself emit `oc`. Neighbouring positions keep normal overlay behavior, including beside a compressed corner group.
- Compression groups repeated tokens and arbitrary repeated subsequences. A group has no implied domain meaning such as a side, motif, or authored repeat.

## Authored extent

- **Full** stores the complete Centre-out chart.
- **Half** stores its canonical bottom half.
- **Quarter** stores its canonical bottom-left quarter.
- Crochet traverses only stored positions while retaining their original round identities. These extents imply no mirror, rotation, repeat, or larger crochet output.

Any future composition is a separate, explicit output operation. It must not reinterpret the authored extent.

## Traversal

The first structured sequence preserves the current text export order:

- Rows traverse left-to-right. **Alternate direction** reverses every even-numbered row.
- Centre-out traverses each complete round from the top-left corner group, counter-clockwise through the left, bottom, right, and top sides. Half and Quarter retain the positions encountered by that complete-round walk. **Alternate direction** reverses the existing group order on every even-numbered round.

The current Centre-out alternate behavior is a compatibility profile, not a semantic-origin control. Explicit origins and direction schedules remain validation-gated backlog work. Traversal orders chart work; it does not alter the chart, prescribe transitions, or derive from handedness.

## Invalid overlay guidance

- Impossible overlay placements remain visible as warnings and do not block Crochet progress.
- A generated unit affected by an invalid placement still emits `oc`; warnings that do not map to a generated unit remain in the overall error count.
- Unusual but deterministic crochet is not invalid merely because it differs from a common convention.

## Representative fixtures

Coordinates below use the authored canvas with `(0, 0)` at its top-left.

### Rows fixture

A 3 × 3 canvas has Row 1 at `y = 2`, Row 2 at `y = 1`, and Row 3 at `y = 0`.

| Unit | Yarn | Flat work from the default left origin | Compact text |
|---|---|---|---|
| Row 1 | A | `sc@(0,2)`, `sc@(1,2)`, `sc@(2,2)` | `Row 1: sc × 3` |
| Row 2 | B | `sc@(0,1)`, `oc@(1,1)` supported by `(1,2)`, `sc@(2,1)` | `Row 2: sc, oc, sc` |
| Row 3 | A | `oc@(0,0)` supported by `(0,1)`, `sc@(1,0)`, `sc@(2,0)` | `Row 3: oc, sc × 2` |

This fixture fixes the bottom-row boundary, unit identity, yarn phase, visible-overlay ownership, coordinates, and compression boundary.

### Centre-out fixture

A Full 7 × 7 Centre-out canvas with three rounds uses Yarn A/B/A from Round 1 through Round 3. At the start of Round 3, the default walk produces:

| Worked coordinate | Parent coordinate | Kind |
|---|---|---|
| `(1,0)` | `(1,1)` | `sc` |
| `(0,0)` | `(1,1)` | `ch` |
| `(0,1)` | `(1,1)` | `sc` |
| `(0,2)` | `(1,2)` | `oc` |

The compact prefix is `Round 3: (sc, ch, sc), oc`. This fixes the three-position corner group and confirms that its neighbouring position may still be an overlay.

Executable acceptance anchors live in the Rust tests for `export_row_at`, `export_round_at`, `row_walk_at`, `round_walk_at`, corner detection, and natural yarn colour. They cover bottom-row handling, visible-overlay ownership, Full/Half/Quarter clipping, corner grouping, traversal order, and Yarn A/B phase.
