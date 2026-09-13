# Chart dialect contract

This contract defines the chart information that Mosaic Crochet Editor can turn into Instructions. The editor models an alternating-yarn mosaic chart with derived overlay positions; it does not prescribe a complete crochet technique.

## Terms and scope

- **Rows** and **Centre-out** are the two pattern geometries. A Rows pattern contains worked **rows**; a Centre-out pattern contains worked **rounds**.
- `sc` means single crochet, `ch` means chain, and `oc` means the chart requires an overlay operation at that position. The user chooses how to make an `oc`; every generated legend must define the abbreviation without assigning it a stitch recipe.
- Foundations, centre setup, turning, cutting, carrying, joining, finishing, and yarn transitions are outside the generated sequence.
- A **worked coordinate** is where a stitch contributes to the visible chart. Its **supporting coordinate** or **parent coordinate** identifies the inward position from which that contribution is derived.

## Work identity and yarn phase

| Geometry | Work outside Instructions | First generated unit | Yarn phase |
|---|---|---|---|
| Rows | Bottom foundation edge | Row 1, immediately above the foundation | Foundation Yarn A; Row 1 Yarn B; later rows alternate |
| Centre-out | Centre setup or foundation | Round 1, the innermost visible band | Round 1 Yarn A; later rounds alternate outward |

Row and round identities survive clipping to an authored extent. Instructions identify each unit's logical Yarn A/B slot without prescribing how yarns change between units.

## Stitch derivation

- An ordinary worked position emits `sc` unless the chart derives a visible overlay there, in which case it emits `oc` and retains the inward supporting coordinate.
- A diagonal Centre-out corner pixel emits `ch`. The two adjacent worked positions share its inward parent, forming the complete `(sc, ch, sc)` corner group when all three positions are in the authored extent.
- A corner pixel cannot itself emit `oc`. Neighbouring positions keep normal overlay behavior, including beside a compressed corner group.
- Compression groups repeated tokens and arbitrary repeated subsequences. A group has no implied domain meaning such as a side, motif, or authored repeat.

## Authored extent

- **Full** stores the complete Centre-out chart.
- **Half** stores its canonical bottom half.
- **Quarter** stores its canonical bottom-left quarter.
- **As authored** Instructions traverse only stored positions while retaining their original round identities. These extents imply no mirror, rotation, repeat, or larger crochet output.

Any future composition is a separate, explicit output operation. It must not reinterpret the authored extent.

## Traversal

The first structured sequence preserves the current text export order:

- Rows traverse left-to-right. **Alternate direction** reverses every even-numbered row.
- Centre-out traverses each complete round from the top-left corner group, counter-clockwise through the left, bottom, right, and top sides. Half and Quarter retain the positions encountered by that complete-round walk. **Alternate direction** reverses the existing group order on every even-numbered round.

The current Centre-out alternate behavior is a compatibility profile, not a semantic-origin control. After the structured path exists, explicit traversal will add:

- Rows: left or right origin, with the same or alternating direction.
- Centre-out: a corner or side-midpoint origin, clockwise or counter-clockwise, with the same or alternating direction on successive rounds. One semantic origin maps across all rounds; an even-length side offers both central cells.

Traversal settings order chart work. They do not alter the chart, prescribe transitions, or derive from handedness. Placement of Live controls for left- or right-handed use remains a separate local preference.

## Derivability and validation

- A **Blocker** means the selected result cannot produce an unambiguous `sc`/`ch`/`oc` sequence matching the chart. This includes required support outside the output, unavailable traversal origins, and lossy or ambiguous composition.
- A **Warning** identifies a deterministic result worth reviewing, such as yarn colours that are difficult to distinguish.
- Unusual but deterministic crochet is not invalid merely because it differs from a common convention.

Overview remains inspectable when blockers exist and links them to chart positions. Live cannot start. Text may remain available only as an explicit draft that marks every unresolved position instead of silently substituting `sc`.

Draft Text uses `?` when unresolved work occupies a generated row/round step and appends a coordinate-bearing unresolved line for every blocker, including work outside the generated path.

## Representative fixtures

Coordinates below use the authored canvas with `(0, 0)` at its top-left.

### Rows fixture

A 3 × 3 canvas has its foundation at `y = 2`, Row 1 at `y = 1`, and Row 2 at `y = 0`.

| Unit | Yarn | Flat work from the default left origin | Compact text |
|---|---|---|---|
| Foundation | A | Excluded | Excluded |
| Row 1 | B | `sc@(0,1)`, `oc@(1,1)` supported by `(1,2)`, `sc@(2,1)` | `Row 1: sc, oc, sc` |
| Row 2 | A | `oc@(0,0)` supported by `(0,1)`, `sc@(1,0)`, `sc@(2,0)` | `Row 2: oc, sc × 2` |

This fixture fixes the foundation boundary, unit identity, yarn phase, visible-overlay ownership, coordinates, and compression boundary.

### Centre-out fixture

A Full 7 × 7 Centre-out canvas with three rounds uses Yarn A/B/A from Round 1 through Round 3. At the start of Round 3, the default walk produces:

| Worked coordinate | Parent coordinate | Kind |
|---|---|---|
| `(1,0)` | `(1,1)` | `sc` |
| `(0,0)` | `(1,1)` | `ch` |
| `(0,1)` | `(1,1)` | `sc` |
| `(0,2)` | `(1,2)` | `oc` |

The compact prefix is `Round 3: (sc, ch, sc), oc`. This fixes the three-position corner group and confirms that its neighbouring position may still be an overlay.

Executable acceptance anchors live in the Rust tests for `export_row_at`, `export_round_at`, `row_walk_at`, `round_walk_at`, corner detection, and natural yarn colour. They cover foundation omission, visible-overlay ownership, Full/Half/Quarter clipping, corner grouping, traversal order, and Yarn A/B phase.
