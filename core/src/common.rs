//! Colour utilities and highlight computation.

use glam::IVec2;
use ndarray::Array2;

// Pixel values stored at runtime: 0 = inner hole (transparent sentinel),
// 1 = COLOR_A, 2 = COLOR_B. The transparent sentinel doubles as the universal
// "this cell is a hole, don't touch" guard across every tool (`!= 0`).
// On-disk storage uses a separate 1-bit-per-pixel packing and reconstructs the
// hole sentinel from geometry on load — see `storage.ts`.
pub const COLOR_TRANSPARENT:        u8 = 0;
pub const COLOR_A:                  u8 = 1;
pub const COLOR_B:                  u8 = 2;
pub const HIGHLIGHT_VALID_OVERLAY:  u8 = 3;
pub const HIGHLIGHT_INVALID:        u8 = 4;

// Highlight render plan. `build_highlight_plan_*` emits a flat sequence of
// stride-4 records: [type, direction, wrong_x, wrong_y, ...].
//   • `type` is which kind of marker (VALID overlay or INVALID placement).
//   • `direction` is which side of the wrong cell the marker visually
//      attaches to. Corners emit two records sharing the same wrong cell
//      with perpendicular directions.
//   • `wrong_x` / `wrong_y` is the wrong cell itself (always in-canvas).
// The renderer translates direction → visual position and picks colour /
// glyph / opacity — those are presentation concerns, not geometry.
//
// Values below MUST match the `PlanType` / `PlanDir` enums in
// `wasm/src/lib.rs` — those enums are the names TS sees.
pub const PLAN_STRIDE: usize = 4;

pub const PLAN_TYPE_VALID:   u8 = 0;
pub const PLAN_TYPE_INVALID: u8 = 1;

pub const PLAN_DIR_UP:    u8 = 0;
pub const PLAN_DIR_DOWN:  u8 = 1;
pub const PLAN_DIR_LEFT:  u8 = 2;
pub const PLAN_DIR_RIGHT: u8 = 3;

fn plan_type_for(highlight: u8) -> u8 {
    if highlight == HIGHLIGHT_VALID_OVERLAY { PLAN_TYPE_VALID } else { PLAN_TYPE_INVALID }
}

pub fn get_color_index(index: i32) -> u8 {
    if index % 2 == 0 { COLOR_A } else { COLOR_B }
}

// The "should-be" colour for a cell. `*_row` is just the alternating row
// pattern; `*_round` returns COLOR_TRANSPARENT for cells inside the inner
// hole (rfe ≥ rounds). Used by `initialize_*_pattern`, the overlay/eraser
// tools, and the Lock-invalid post-filter.
pub fn natural_color_row(height: i32, y: i32) -> u8 {
    get_color_index(height - 1 - y)
}

pub fn natural_color_round(
    virtual_size: IVec2, offset: IVec2, rounds: i32, coord: IVec2,
) -> u8 {
    let rfe = get_round_from_edge(virtual_size, coord + offset);
    if rfe >= rounds { COLOR_TRANSPARENT } else { get_color_index(rounds - 1 - rfe) }
}

// Flip COLOR_A ↔ COLOR_B; passes the hole sentinel through unchanged.
pub fn opposite_color(c: u8) -> u8 {
    match c { COLOR_A => COLOR_B, COLOR_B => COLOR_A, _ => c }
}

// Per-axis distance from `virtual_coord` to the closer of its two virtual
// edges. `min_dist.x` = closer-edge distance along x; `min_dist.y` similar.
// Round-from-edge (the scalar) is just `min(min_dist.x, min_dist.y)`.
pub fn min_dist_axes(virtual_size: IVec2, virtual_coord: IVec2) -> IVec2 {
    virtual_coord.min(virtual_size - IVec2::ONE - virtual_coord)
}

pub fn get_round_from_edge(virtual_size: IVec2, virtual_coord: IVec2) -> i32 {
    let d = min_dist_axes(virtual_size, virtual_coord);
    d.x.min(d.y)
}

// Single-step direction from `virtual_coord` toward the centre of the virtual
// canvas, per axis. Each component is -1 or +1 depending on which half of
// `virtual_size` the coord sits in. Callers pick which axis to step along
// based on min_dist (the closer-edge axis is the one to step along — see
// `outward_cells_round` / `inward_cell_round`).
pub fn step_toward_center(virtual_size: IVec2, virtual_coord: IVec2) -> IVec2 {
    IVec2::new(
        if virtual_coord.x * 2 >= virtual_size.x { -1 } else { 1 },
        if virtual_coord.y * 2 >= virtual_size.y { -1 } else { 1 },
    )
}

// True at a virtual coord where overlay can never be valid: a diagonal corner
// (both axes equally close to their edges) OR any outermost-ring cell (at
// least one axis is touching its edge). Takes pre-computed `min_dist` so
// callers in hot loops don't re-derive it.
fn always_invalid_at(min_dist: IVec2) -> bool {
    min_dist.x == min_dist.y || min_dist.x == 0 || min_dist.y == 0
}

// True if (x, y) is a cell where the overlay can never be valid:
//   row mode   — top row (y == 0).
//   round mode — outermost ring (rfe == 0) or any diagonal corner (dx == dy).
// `*_round` returns `false` for cells outside the active rounds (in the hole),
// since those carry no overlay semantics at all.
pub fn is_always_invalid_row(coord: IVec2) -> bool {
    coord.y == 0
}

pub fn is_always_invalid_round(virtual_size: IVec2, offset: IVec2, rounds: i32, coord: IVec2) -> bool {
    let min_dist = min_dist_axes(virtual_size, coord + offset);
    if min_dist.x.min(min_dist.y) >= rounds { return false; }
    always_invalid_at(min_dist)
}

// One or two cells *outward* from `coord` — where the highlight marker for a
// wrong cell at `coord` should visually appear. Returns a single cell for
// non-corners; for round-mode corners (`min_dist.x == min_dist.y`), returns
// two perpendicular outward cells (one along each axis). Out-of-canvas
// coordinates are returned as-is; the renderer clips/handles gutters itself.
pub fn outward_cells_row(coord: IVec2) -> Vec<IVec2> {
    vec![IVec2::new(coord.x, coord.y - 1)]
}

pub fn outward_cells_round(virtual_size: IVec2, offset: IVec2, coord: IVec2) -> Vec<IVec2> {
    let v        = coord + offset;
    let min_dist = min_dist_axes(virtual_size, v);
    let step     = step_toward_center(virtual_size, v);
    if min_dist.x == min_dist.y {
        vec![IVec2::new(coord.x - step.x, coord.y),
             IVec2::new(coord.x,          coord.y - step.y)]
    } else if min_dist.x < min_dist.y {
        vec![IVec2::new(coord.x - step.x, coord.y)]
    } else {
        vec![IVec2::new(coord.x,          coord.y - step.y)]
    }
}

// The one cell *inward* from `coord` — the cell that, when painted wrong,
// makes the highlight pass mark `coord` as the overlay target. Returns
// `None` when the inward direction is undefined (round-mode diagonal corner)
// or steps outside the physical canvas (innermost ring, off-canvas corners
// of the gutter).
pub fn inward_cell_row(canvas_size: IVec2, coord: IVec2) -> Option<IVec2> {
    let inner = IVec2::new(coord.x, coord.y + 1);
    (inner.y < canvas_size.y).then_some(inner)
}

pub fn inward_cell_round(canvas_size: IVec2, virtual_size: IVec2, offset: IVec2, coord: IVec2) -> Option<IVec2> {
    let v        = coord + offset;
    let min_dist = min_dist_axes(virtual_size, v);
    let in_canvas = coord.x >= 0 && coord.x < canvas_size.x
                 && coord.y >= 0 && coord.y < canvas_size.y;
    if in_canvas && min_dist.x == min_dist.y { return None; }
    let step  = step_toward_center(virtual_size, v);
    let inner = if min_dist.x < min_dist.y {
        IVec2::new(coord.x + step.x, coord.y)
    } else {
        IVec2::new(coord.x,          coord.y + step.y)
    };
    let inner_in_canvas = inner.x >= 0 && inner.x < canvas_size.x
                       && inner.y >= 0 && inner.y < canvas_size.y;
    inner_in_canvas.then_some(inner)
}

// Highlight is stored at the *wrong cell* itself; the renderer is responsible
// for drawing it one step outward (= the overlay layer). Storing at the wrong
// cell unifies the logic: there's no special case for top row vs middle vs
// foundation — every wrong cell asks the same question ("is the overlay this
// would create structurally valid?") and writes V/I at its own position. The
// renderer's `outwardCell` does the visual displacement.
pub fn compute_row_highlights(
    size:       IVec2,
    pixels:     &Array2<u8>,
    highlights: &mut Array2<u8>,
) {
    for y in 0..size.y {
        let color_index = get_color_index(size.y - 1 - y);
        for x in 0..size.x {
            let [xi, yi] = [x as usize, y as usize];
            if color_index == pixels[[yi, xi]] { continue; }

            let result = if y == 0 {
                // Top row: no row above to anchor an overlay against.
                HIGHLIGHT_INVALID
            } else if y >= size.y - 1 {
                // Foundation: no inner row to clash with → valid overlay.
                HIGHLIGHT_VALID_OVERLAY
            } else {
                let inner_pixel = pixels[[y as usize + 1, xi]];
                if color_index == inner_pixel { HIGHLIGHT_INVALID }
                else                          { HIGHLIGHT_VALID_OVERLAY }
            };
            highlights[[yi, xi]] = result;
        }
    }
}

pub fn compute_round_highlights(
    canvas_size:  IVec2,
    virtual_size: IVec2,
    offset:       IVec2,
    rounds:       i32,
    pixels:       &Array2<u8>,
    highlights:   &mut Array2<u8>,
) {
    for y in 0..canvas_size.y {
        for x in 0..canvas_size.x {
            let physical_coord  = IVec2::new(x, y);
            let virtual_coord   = physical_coord + offset;
            let min_dist        = min_dist_axes(virtual_size, virtual_coord);
            let round_from_edge = min_dist.x.min(min_dist.y);

            if round_from_edge >= rounds { continue; }

            let color_index = get_color_index(rounds - 1 - round_from_edge);
            let [xi, yi]    = [x as usize, y as usize];
            if color_index == pixels[[yi, xi]] { continue; }

            // Outermost ring or any diagonal corner: no well-defined outward
            // target. Force INVALID at the wrong cell — renderer handles the
            // visual position (gutter for outermost, two perpendicular
            // outwards for interior corners via `outward_cells_round`).
            let result = if always_invalid_at(min_dist) {
                HIGHLIGHT_INVALID
            } else {
                // Mid-ring non-corner: one well-defined inward direction.
                let step_full = step_toward_center(virtual_size, virtual_coord);
                let step = if min_dist.x < min_dist.y {
                    IVec2::new(step_full.x, 0)
                } else {
                    IVec2::new(0, step_full.y)
                };

                let neighbor           = physical_coord + step;
                let neighbor_in_bounds = neighbor.x >= 0 && neighbor.x < canvas_size.x
                                      && neighbor.y >= 0 && neighbor.y < canvas_size.y;

                let is_seam = !neighbor_in_bounds || {
                    let neighbor_rfe = get_round_from_edge(virtual_size, neighbor + offset);
                    neighbor_rfe <= round_from_edge
                };

                if is_seam || color_index != pixels[[neighbor.y as usize, neighbor.x as usize]] {
                    HIGHLIGHT_VALID_OVERLAY
                } else {
                    HIGHLIGHT_INVALID
                }
            };
            highlights[[yi, xi]] = result;
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Render plan builders. Combine `compute_*_highlights` + outward direction
// emission into a single pass so the renderer doesn't need geometry: each
// plan record fully describes what and where to draw, leaving only colour /
// glyph choice (presentation) to the caller.
fn push_entry(plan: &mut Vec<i16>, t: u8, d: u8, x: i32, y: i32) {
    plan.extend_from_slice(&[t as i16, d as i16, x as i16, y as i16]);
}

pub fn build_highlight_plan_row(canvas_size: IVec2, pixels: &Array2<u8>) -> Vec<i16> {
    let mut hl = Array2::zeros((canvas_size.y as usize, canvas_size.x as usize));
    compute_row_highlights(canvas_size, pixels, &mut hl);

    let mut plan = Vec::new();
    for y in 0..canvas_size.y {
        for x in 0..canvas_size.x {
            let v = hl[[y as usize, x as usize]];
            if v == 0 { continue; }
            push_entry(&mut plan, plan_type_for(v), PLAN_DIR_UP, x, y);
        }
    }
    plan
}

pub fn build_highlight_plan_round(
    canvas_size:  IVec2,
    virtual_size: IVec2,
    offset:       IVec2,
    rounds:       i32,
    pixels:       &Array2<u8>,
) -> Vec<i16> {
    let mut hl = Array2::zeros((canvas_size.y as usize, canvas_size.x as usize));
    compute_round_highlights(canvas_size, virtual_size, offset, rounds, pixels, &mut hl);

    let mut plan = Vec::new();
    for y in 0..canvas_size.y {
        for x in 0..canvas_size.x {
            let v = hl[[y as usize, x as usize]];
            if v == 0 { continue; }
            let type_id       = plan_type_for(v);
            let virtual_coord = IVec2::new(x, y) + offset;
            let min_dist      = min_dist_axes(virtual_size, virtual_coord);
            let step          = step_toward_center(virtual_size, virtual_coord);
            let dir_x         = if step.x == 1 { PLAN_DIR_LEFT } else { PLAN_DIR_RIGHT };
            let dir_y         = if step.y == 1 { PLAN_DIR_UP   } else { PLAN_DIR_DOWN  };

            // Outermost ring: outward direction is *outside* the canvas. We
            // still emit it — the renderer chooses what to do (typically
            // draws in the gutter). Corners (min_dist.x == min_dist.y) emit
            // two perpendicular records sharing the same wrong cell.
            if min_dist.x == min_dist.y {
                push_entry(&mut plan, type_id, dir_x, x, y);
                push_entry(&mut plan, type_id, dir_y, x, y);
            } else {
                let dir = if min_dist.x < min_dist.y { dir_x } else { dir_y };
                push_entry(&mut plan, type_id, dir, x, y);
            }
        }
    }
    plan
}

// ─────────────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    // ── helpers ──────────────────────────────────────────────────────────────

    fn v(x: i32, y: i32) -> IVec2 { IVec2::new(x, y) }

    /// Build a W×H pixel grid initialised to natural row colours.
    fn make_row_grid(w: i32, h: i32) -> Array2<u8> {
        let mut p = Array2::zeros((h as usize, w as usize));
        for y in 0..h {
            let ci = get_color_index(h - 1 - y);
            for x in 0..w { p[[y as usize, x as usize]] = ci; }
        }
        p
    }

    /// Run row-highlight computation with optional pixel overrides.
    /// Overrides: (x, y, colour).
    fn run_row_hl(w: i32, h: i32, overrides: &[(usize, usize, u8)]) -> Array2<u8> {
        let mut pixels = make_row_grid(w, h);
        for &(x, y, c) in overrides { pixels[[y, x]] = c; }
        let mut hl = Array2::zeros((h as usize, w as usize));
        compute_row_highlights(v(w, h), &pixels, &mut hl);
        hl
    }

    /// Build a W×H pixel grid initialised to the natural round colour pattern.
    fn make_round_grid(w: i32, h: i32, vw: i32, vh: i32, off_x: i32, off_y: i32, rounds: i32) -> Array2<u8> {
        let vs = v(vw, vh);
        let mut p = Array2::zeros((h as usize, w as usize));
        for y in 0..h {
            for x in 0..w {
                let rfe = get_round_from_edge(vs, v(x + off_x, y + off_y));
                p[[y as usize, x as usize]] = if rfe >= rounds {
                    COLOR_TRANSPARENT
                } else {
                    get_color_index(rounds - 1 - rfe)
                };
            }
        }
        p
    }

    /// Run round-highlight computation with optional overrides.
    /// Returns (highlights, pixels_after_hole_clear).
    fn run_round_hl(
        w: i32, h: i32, vw: i32, vh: i32, off_x: i32, off_y: i32,
        rounds: i32, overrides: &[(usize, usize, u8)],
    ) -> (Array2<u8>, Array2<u8>) {
        let mut pixels = make_round_grid(w, h, vw, vh, off_x, off_y, rounds);
        for &(x, y, c) in overrides { pixels[[y, x]] = c; }
        // Re-enforce inner hole (overrides may have set non-transparent on hole pixels)
        let vs = v(vw, vh);
        for y in 0..h {
            for x in 0..w {
                if get_round_from_edge(vs, v(x + off_x, y + off_y)) >= rounds {
                    pixels[[y as usize, x as usize]] = COLOR_TRANSPARENT;
                }
            }
        }
        let mut hl = Array2::zeros((h as usize, w as usize));
        compute_round_highlights(v(w, h), vs, v(off_x, off_y), rounds, &pixels, &mut hl);
        (hl, pixels)
    }

    const V: u8 = HIGHLIGHT_VALID_OVERLAY;
    const I: u8 = HIGHLIGHT_INVALID;

    // ── get_color_index ──────────────────────────────────────────────────────

    #[test]
    fn color_index_alternates() {
        assert_eq!(get_color_index(0), COLOR_A);
        assert_eq!(get_color_index(1), COLOR_B);
        assert_eq!(get_color_index(2), COLOR_A);
        assert_eq!(get_color_index(3), COLOR_B);
    }

    // ── row index (inline: h - 1 - y) ────────────────────────────────────────

    #[test]
    fn row_index_top_maps_to_max() { assert_eq!(9 - 1 - 0, 8); }
    #[test]
    fn row_index_bottom_maps_to_zero() { assert_eq!(9 - 1 - 8, 0); }
    #[test]
    fn row_index_middle() { assert_eq!(9 - 1 - 4, 4); }

    // ── get_round_from_edge ──────────────────────────────────────────────────

    #[test]
    fn rfe_zero_on_all_edges_and_corners() {
        assert_eq!(get_round_from_edge(v(9, 9), v(0, 0)), 0);
        assert_eq!(get_round_from_edge(v(9, 9), v(8, 0)), 0);
        assert_eq!(get_round_from_edge(v(9, 9), v(0, 8)), 0);
        assert_eq!(get_round_from_edge(v(9, 9), v(8, 8)), 0);
        assert_eq!(get_round_from_edge(v(9, 9), v(0, 4)), 0);
        assert_eq!(get_round_from_edge(v(9, 9), v(4, 0)), 0);
    }

    #[test]
    fn rfe_increases_toward_centre_square() {
        assert_eq!(get_round_from_edge(v(9, 9), v(1, 4)), 1);
        assert_eq!(get_round_from_edge(v(9, 9), v(2, 4)), 2);
        assert_eq!(get_round_from_edge(v(9, 9), v(1, 1)), 1);
        assert_eq!(get_round_from_edge(v(9, 9), v(2, 2)), 2);
        assert_eq!(get_round_from_edge(v(9, 9), v(3, 3)), 3);
        assert_eq!(get_round_from_edge(v(9, 9), v(4, 4)), 4);
    }

    #[test]
    fn rfe_limited_by_shorter_dim_rectangular() {
        assert_eq!(get_round_from_edge(v(16, 6), v(0,  0)), 0);
        assert_eq!(get_round_from_edge(v(16, 6), v(3,  0)), 0);
        assert_eq!(get_round_from_edge(v(16, 6), v(3,  1)), 1);
        assert_eq!(get_round_from_edge(v(16, 6), v(3,  2)), 2);
        assert_eq!(get_round_from_edge(v(16, 6), v(8,  2)), 2);
        assert_eq!(get_round_from_edge(v(16, 6), v(8,  3)), 2);
        assert_eq!(get_round_from_edge(v(16, 6), v(15, 5)), 0);
    }

    // ── round index (inline: rounds - 1 - rfe) ───────────────────────────────

    #[test]
    fn round_index_negative_for_inner_hole() {
        let ri = |x, y| 3 - 1 - get_round_from_edge(v(9, 9), v(x, y));
        assert_eq!(ri(3, 3), -1);
        assert_eq!(ri(4, 4), -2);
        assert!(ri(5, 4) < 0);
    }

    #[test]
    fn round_index_correct_9x9_r3() {
        let ri = |x, y| 3 - 1 - get_round_from_edge(v(9, 9), v(x, y));
        assert_eq!(ri(2, 4), 0);
        assert_eq!(ri(1, 4), 1);
        assert_eq!(ri(0, 4), 2);
        assert_eq!(ri(6, 4), 0);
        assert_eq!(ri(7, 4), 1);
        assert_eq!(ri(8, 4), 2);
    }

    #[test]
    fn round_index_no_inner_hole_16x6_r3() {
        // max rfe=2 < rounds=3 so every pixel is active (round_index >= 0)
        for y in 0..6i32 {
            for x in 0..16i32 {
                let ri = 3 - 1 - get_round_from_edge(v(16, 6), v(x, y));
                assert!(ri >= 0, "pixel ({x},{y}) should not be in hole");
            }
        }
    }

    #[test]
    fn round_index_values_16x6_r3() {
        let ri = |x, y| 3 - 1 - get_round_from_edge(v(16, 6), v(x, y));
        assert_eq!(ri(0,  0), 2);
        assert_eq!(ri(8,  2), 0);
        assert_eq!(ri(8,  3), 0);
        assert_eq!(ri(15, 5), 2);
    }

    #[test]
    fn rfe_same_on_both_sides_of_zero_dim_seam_16x6_r3() {
        for x in 0..16i32 {
            assert_eq!(
                get_round_from_edge(v(16, 6), v(x, 2)),
                get_round_from_edge(v(16, 6), v(x, 3)),
                "seam mismatch at x={x}",
            );
        }
    }

    // ── compute_row_highlights ───────────────────────────────────────────────

    #[test]
    fn row_hl_no_highlights_when_correct() {
        let hl = run_row_hl(4, 4, &[]);
        assert!(hl.iter().all(|&v| v == 0));
    }

    #[test]
    fn row_hl_top_edge_overlay_is_invalid() {
        // y=0: rowIndex=H-1=3 (odd) → COLOR_B; flip to COLOR_A → INVALID
        let hl = run_row_hl(4, 4, &[(2, 0, COLOR_A)]);
        assert_eq!(hl[[0, 2]], I);
    }

    #[test]
    fn row_hl_foundation_overlay_is_valid() {
        // y=H-1 (foundation) wrong → no inner row to clash with → VALID overlay
        // stored at the wrong cell (renderer draws it one row up).
        let hl = run_row_hl(4, 4, &[(2, 3, COLOR_B)]);
        assert_eq!(hl[[3, 2]], V);
    }

    #[test]
    fn row_hl_valid_overlay_highlights_row_above() {
        // y=1 wrong; inner y=2 differs → VALID at the wrong cell.
        let hl = run_row_hl(4, 4, &[(2, 1, COLOR_B)]);
        assert_eq!(hl[[1, 2]], V);
    }

    #[test]
    fn row_hl_invalid_when_inner_pixel_matches_expected() {
        // H=3. y=1 wrong (A instead of B); inner y=2 forced to B (matches
        // color_index) → INVALID at the wrong cell y=1. y=2 (foundation)
        // also wrong → VALID at its own cell.
        let hl = run_row_hl(4, 3, &[(2, 1, COLOR_A), (2, 2, COLOR_B)]);
        assert_eq!(hl[[1, 2]], I);
        assert_eq!(hl[[2, 2]], V);
    }

    #[test]
    fn row_hl_each_column_is_independent() {
        let overrides: Vec<(usize, usize, u8)> = (0..6).map(|x| (x, 1, COLOR_B)).collect();
        let hl = run_row_hl(6, 4, &overrides);
        for x in 0..6usize {
            assert_eq!(hl[[1, x]], V, "col {x}: expected VALID at the wrong cell y=1");
        }
    }

    #[test]
    fn row_hl_adjacent_wrong_pixels_regression() {
        // H=5. y=1 wrong (inner y=2 matches color_index) → INVALID at its own
        // cell. y=2 wrong (inner y=3 differs) → VALID at its own cell. Each
        // wrong cell holds exactly one marker; the renderer draws them on the
        // overlay layer above.
        let hl = run_row_hl(4, 5, &[(2, 1, COLOR_A), (2, 2, COLOR_B)]);
        assert_eq!(hl[[1, 2]], I, "INVALID at y=1 (inner matches color_index)");
        assert_eq!(hl[[2, 2]], V, "VALID at y=2 (inner differs)");
        assert_eq!(hl[[0, 2]], 0, "no marker at y=0");
    }

    // ── compute_round_highlights — full 9×9, r=3 ─────────────────────────────

    #[test]
    fn round_hl_full_no_highlights_when_correct() {
        let (hl, _) = run_round_hl(9, 9, 9, 9, 0, 0, 3, &[]);
        assert!(hl.iter().all(|&v| v == 0));
    }

    #[test]
    fn round_hl_full_top_edge_overlay_invalid() {
        let (hl, _) = run_round_hl(9, 9, 9, 9, 0, 0, 3, &[(4, 0, COLOR_B)]);
        assert_eq!(hl[[0, 4]], I);
    }

    #[test]
    fn round_hl_full_second_ring_overlay_valid() {
        // (1,4) rfe=1 wrong; inner (2,4) rfe=2 differs → VALID stored at the
        // wrong cell.
        let (hl, _) = run_round_hl(9, 9, 9, 9, 0, 0, 3, &[(1, 4, COLOR_A)]);
        assert_eq!(hl[[4, 1]], V);
    }

    #[test]
    fn round_hl_full_diagonal_corner_always_invalid() {
        let (hl, _) = run_round_hl(9, 9, 9, 9, 0, 0, 3, &[(0, 0, COLOR_B)]);
        assert_eq!(hl[[0, 0]], I);
    }

    #[test]
    fn round_hl_full_inner_hole_cleared() {
        let overrides: Vec<_> = (3..=5).flat_map(|y| (3..=5).map(move |x| (x, y, COLOR_A))).collect();
        let (_, pixels) = run_round_hl(9, 9, 9, 9, 0, 0, 3, &overrides);
        for y in 3..=5usize { for x in 3..=5usize { assert_eq!(pixels[[y, x]], COLOR_TRANSPARENT); } }
    }

    #[test]
    fn round_hl_full_adjacent_wrong_pixels_regression() {
        let a = COLOR_A; let b = COLOR_B;
        let (hl, _) = run_round_hl(9, 9, 9, 9, 0, 0, 3, &[
            (0,4,b),(1,4,a), (8,4,b),(7,4,a),
            (4,0,b),(4,1,a), (4,8,b),(4,7,a),
        ]);
        assert_eq!(hl[[4, 0]], I, "left outer INVALID");
        assert_ne!(hl[[4, 1]], I, "left inner not INVALID (regression)");
        assert_eq!(hl[[4, 8]], I, "right outer INVALID");
        assert_ne!(hl[[4, 7]], I, "right inner not INVALID (regression)");
        assert_eq!(hl[[0, 4]], I, "top outer INVALID");
        assert_ne!(hl[[1, 4]], I, "top inner not INVALID (regression)");
        assert_eq!(hl[[8, 4]], I, "bottom outer INVALID");
        assert_ne!(hl[[7, 4]], I, "bottom inner not INVALID (regression)");
    }

    // ── compute_round_highlights — half mode 9×6, r=3 ────────────────────────

    #[test]
    fn round_hl_half_no_highlights_when_correct() {
        let (hl, _) = run_round_hl(9, 6, 9, 12, 0, 6, 3, &[]);
        assert!(hl.iter().all(|&v| v == 0));
    }

    #[test]
    fn round_hl_half_odd_virtual_height_regression() {
        // Default vW=vH=13, offY=6 (floor not ceil), rounds=5: bottom row center should be COLOR_A
        let grid = make_round_grid(13, 7, 13, 13, 0, 6, 5);
        assert_eq!(grid[[6, 6]], COLOR_A);
    }

    #[test]
    fn round_hl_half_bottom_edge_invalid() {
        let (hl, _) = run_round_hl(9, 6, 9, 12, 0, 6, 3, &[(4, 5, COLOR_B)]);
        assert_eq!(hl[[5, 4]], I);
    }

    #[test]
    fn round_hl_half_virtual_seam_overlay_valid() {
        // 9×3 half mode (vH=6, offY=3): wrong cell (4, 0) sits on the virtual
        // seam; step points OOB → is_seam → VALID stored at the wrong cell.
        let (hl, _) = run_round_hl(9, 3, 9, 6, 0, 3, 3, &[(4, 0, COLOR_B)]);
        assert_eq!(hl[[0, 4]], V);
    }

    #[test]
    fn round_hl_half_inner_hole() {
        let (_, pixels) = run_round_hl(9, 6, 9, 12, 0, 6, 3, &[]);
        for y in 0..3usize { for x in 3..6usize { assert_eq!(pixels[[y, x]], COLOR_TRANSPARENT); } }
        assert_ne!(pixels[[0, 2]], COLOR_TRANSPARENT);
        assert_ne!(pixels[[3, 3]], COLOR_TRANSPARENT);
    }

    // ── compute_round_highlights — quarter mode 6×6, r=3 ─────────────────────

    #[test]
    fn round_hl_quarter_no_highlights_when_correct() {
        let (hl, _) = run_round_hl(6, 6, 12, 12, 0, 6, 3, &[]);
        assert!(hl.iter().all(|&v| v == 0));
    }

    #[test]
    fn round_hl_quarter_bottom_seam_valid() {
        // Quarter mode (offY=6), wrong (2, 4) rfe=1; inner differs → VALID
        // stored at the wrong cell.
        let (hl, _) = run_round_hl(6, 6, 12, 12, 0, 6, 3, &[(2, 4, COLOR_A)]);
        assert_eq!(hl[[4, 2]], V);
    }

    #[test]
    fn round_hl_quarter_inner_hole() {
        let (_, pixels) = run_round_hl(6, 6, 12, 12, 0, 6, 3, &[]);
        for y in 0..3usize { for x in 3..6usize { assert_eq!(pixels[[y, x]], COLOR_TRANSPARENT); } }
        assert_ne!(pixels[[0, 2]], COLOR_TRANSPARENT);
        assert_ne!(pixels[[3, 3]], COLOR_TRANSPARENT);
    }

    // ── compute_round_highlights — custom offset 5×5, vW=vH=9, r=3 ───────────

    #[test]
    fn round_hl_custom_offset_no_highlights_when_correct() {
        let (hl, _) = run_round_hl(5, 5, 9, 9, 2, 2, 3, &[]);
        assert!(hl.iter().all(|&v| v == 0));
    }

    #[test]
    fn round_hl_custom_offset_inner_hole() {
        let (_, pixels) = run_round_hl(5, 5, 9, 9, 2, 2, 3, &[]);
        assert_eq!(pixels[[2, 2]], COLOR_TRANSPARENT); // physical(2,2)→virtual(4,4): rfe=4≥3
        assert_ne!(pixels[[0, 0]], COLOR_TRANSPARENT); // physical(0,0)→virtual(2,2): rfe=2<3
    }

    // ── compute_round_highlights — rectangular full 16×6, r=3 ────────────────

    #[test]
    fn round_hl_rect_no_highlights_when_correct() {
        let (hl, _) = run_round_hl(16, 6, 16, 6, 0, 0, 3, &[]);
        assert!(hl.iter().all(|&v| v == 0));
    }

    #[test]
    fn round_hl_rect_zero_dim_seam_valid() {
        // Rectangular 16×6, wrong (8, 2) rfe=2; neighbor (8, 3) has rfe=2 →
        // zero-dim seam → VALID stored at the wrong cell.
        let (hl, _) = run_round_hl(16, 6, 16, 6, 0, 0, 3, &[(8, 2, COLOR_B)]);
        assert_eq!(hl[[2, 8]], V);
    }

    #[test]
    fn round_hl_rect_outermost_top_row_invalid() {
        let (hl, _) = run_round_hl(16, 6, 16, 6, 0, 0, 3, &[(8, 0, COLOR_B)]);
        assert_eq!(hl[[0, 8]], I);
    }

    // ── build_highlight_plan_* ───────────────────────────────────────────────

    /// Iterate a plan as (type, dir, wrong_x, wrong_y) tuples.
    fn plan_entries(plan: &[i16]) -> Vec<(u8, u8, i16, i16)> {
        plan.chunks_exact(PLAN_STRIDE).map(|c| (c[0] as u8, c[1] as u8, c[2], c[3])).collect()
    }

    #[test]
    fn plan_row_empty_when_pattern_correct() {
        let pixels = make_row_grid(4, 4);
        let plan = build_highlight_plan_row(v(4, 4), &pixels);
        assert!(plan.is_empty());
    }

    #[test]
    fn plan_row_top_edge_emits_invalid_with_up_dir() {
        // y=0 wrong → INVALID at (2, 0), direction always UP in row mode.
        let mut pixels = make_row_grid(4, 4);
        pixels[[0, 2]] = COLOR_A; // y=0 expects COLOR_B
        let plan = build_highlight_plan_row(v(4, 4), &pixels);
        let entries = plan_entries(&plan);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0], (PLAN_TYPE_INVALID, PLAN_DIR_UP, 2, 0));
    }

    #[test]
    fn plan_row_foundation_emits_valid_with_up_dir() {
        // y=H-1 wrong → VALID at (2, 3), still pointing UP (renderer draws
        // one row up; that's where the overlay would visually live).
        let mut pixels = make_row_grid(4, 4);
        pixels[[3, 2]] = COLOR_B; // y=3 expects COLOR_A
        let plan = build_highlight_plan_row(v(4, 4), &pixels);
        let entries = plan_entries(&plan);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0], (PLAN_TYPE_VALID, PLAN_DIR_UP, 2, 3));
    }

    #[test]
    fn plan_round_non_corner_single_entry_with_correct_dir() {
        // 9×9 r=3 full. Wrong cell (1, 4) is on the left edge of the second
        // ring (rfe=1, min_dist.x < min_dist.y) → step toward centre is +x →
        // outward dir is LEFT.
        let mut pixels = make_round_grid(9, 9, 9, 9, 0, 0, 3);
        pixels[[4, 1]] = COLOR_A; // (1,4): rfe=1 expects COLOR_B
        let plan = build_highlight_plan_round(v(9, 9), v(9, 9), v(0, 0), 3, &pixels);
        let entries = plan_entries(&plan);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0], (PLAN_TYPE_VALID, PLAN_DIR_LEFT, 1, 4));
    }

    #[test]
    fn plan_round_corner_emits_two_perpendicular_entries() {
        // 9×9 r=3 full. Wrong cell (1, 1) is a diagonal corner (rfe=1,
        // dx == dy == 1). step.x=+1 (centre right), step.y=+1 (centre below)
        // → outward dirs LEFT and UP. Always-invalid → both records are
        // INVALID type.
        let mut pixels = make_round_grid(9, 9, 9, 9, 0, 0, 3);
        pixels[[1, 1]] = COLOR_A; // (1,1): rfe=1 expects COLOR_B
        let plan = build_highlight_plan_round(v(9, 9), v(9, 9), v(0, 0), 3, &pixels);
        let mut entries = plan_entries(&plan);
        entries.sort_by_key(|&(_, d, _, _)| d);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0], (PLAN_TYPE_INVALID, PLAN_DIR_UP,   1, 1));
        assert_eq!(entries[1], (PLAN_TYPE_INVALID, PLAN_DIR_LEFT, 1, 1));
    }

    // ── colour helpers ───────────────────────────────────────────────────────

    #[test]
    fn opposite_color_swaps_a_and_b() {
        assert_eq!(opposite_color(COLOR_A), COLOR_B);
        assert_eq!(opposite_color(COLOR_B), COLOR_A);
    }

    #[test]
    fn opposite_color_passes_through_transparent() {
        assert_eq!(opposite_color(COLOR_TRANSPARENT), COLOR_TRANSPARENT);
    }

    #[test]
    fn natural_color_row_alternates_top_to_bottom() {
        // height=4: y=0 is COLOR_B (3 odd), y=1 is COLOR_A (2 even),
        // y=2 is COLOR_B (1 odd), y=3 is COLOR_A (0 even).
        assert_eq!(natural_color_row(4, 0), COLOR_B);
        assert_eq!(natural_color_row(4, 1), COLOR_A);
        assert_eq!(natural_color_row(4, 2), COLOR_B);
        assert_eq!(natural_color_row(4, 3), COLOR_A);
    }

    #[test]
    fn natural_color_round_transparent_in_hole() {
        // 9×9 r=3: centre (4, 4) has rfe=4 ≥ rounds=3 → transparent.
        assert_eq!(natural_color_round(v(9, 9), v(0, 0), 3, v(4, 4)), COLOR_TRANSPARENT);
    }

    #[test]
    fn natural_color_round_active_ring_uses_rfe() {
        // 9×9 r=3: (1, 4) has rfe=1, so colour = get_color_index(3-1-1) = B.
        // (0, 4) has rfe=0 → get_color_index(2) = A.
        assert_eq!(natural_color_round(v(9, 9), v(0, 0), 3, v(1, 4)), COLOR_B);
        assert_eq!(natural_color_round(v(9, 9), v(0, 0), 3, v(0, 4)), COLOR_A);
    }

    // ── is_always_invalid_* ──────────────────────────────────────────────────

    #[test]
    fn is_always_invalid_row_only_top_row() {
        for y in 0..5 {
            assert_eq!(is_always_invalid_row(v(0, y)), y == 0, "y={y}");
        }
    }

    #[test]
    fn is_always_invalid_round_flags_outermost_corners_and_diagonals() {
        // 9×9 r=3. Outermost ring (rfe=0): always invalid.
        assert!(is_always_invalid_round(v(9, 9), v(0, 0), 3, v(0, 4))); // edge
        assert!(is_always_invalid_round(v(9, 9), v(0, 0), 3, v(0, 0))); // corner outermost
        // Inner-ring diagonal (rfe>0, dx==dy): always invalid.
        assert!(is_always_invalid_round(v(9, 9), v(0, 0), 3, v(1, 1))); // r=1 corner
        assert!(is_always_invalid_round(v(9, 9), v(0, 0), 3, v(2, 2))); // r=2 corner (innermost)
        // Inner non-corner: NOT always invalid.
        assert!(!is_always_invalid_round(v(9, 9), v(0, 0), 3, v(1, 4)));
        assert!(!is_always_invalid_round(v(9, 9), v(0, 0), 3, v(2, 4)));
        // Inner hole (rfe ≥ rounds): NOT always invalid (no overlay semantics).
        assert!(!is_always_invalid_round(v(9, 9), v(0, 0), 3, v(4, 4)));
    }

    // ── outward_cells_* ──────────────────────────────────────────────────────

    #[test]
    fn outward_cells_row_is_just_above() {
        assert_eq!(outward_cells_row(v(2, 3)), vec![v(2, 2)]);
        // y=0 → off-canvas (-1) is intentional: renderer draws in the gutter.
        assert_eq!(outward_cells_row(v(2, 0)), vec![v(2, -1)]);
    }

    #[test]
    fn outward_cells_round_non_corner_returns_one() {
        // (1, 4) in 9×9: closer-to-x edge → outward LEFT.
        assert_eq!(outward_cells_round(v(9, 9), v(0, 0), v(1, 4)), vec![v(0, 4)]);
        // (4, 1): closer-to-y edge (top) → outward UP.
        assert_eq!(outward_cells_round(v(9, 9), v(0, 0), v(4, 1)), vec![v(4, 0)]);
    }

    #[test]
    fn outward_cells_round_corner_returns_two_perpendicular() {
        // (1, 1) is a diagonal corner → two outwards: LEFT (0, 1) and UP (1, 0).
        let cells = outward_cells_round(v(9, 9), v(0, 0), v(1, 1));
        assert_eq!(cells.len(), 2);
        assert!(cells.contains(&v(0, 1)));
        assert!(cells.contains(&v(1, 0)));
    }

    // ── inward_cell_* ────────────────────────────────────────────────────────

    #[test]
    fn inward_cell_row_returns_below_in_bounds() {
        assert_eq!(inward_cell_row(v(4, 4), v(2, 1)), Some(v(2, 2)));
        // y=H-1 → no row below → None.
        assert_eq!(inward_cell_row(v(4, 4), v(2, 3)), None);
    }

    #[test]
    fn inward_cell_round_corner_is_none() {
        // (1, 1) is a corner → no single inward direction.
        assert_eq!(inward_cell_round(v(9, 9), v(9, 9), v(0, 0), v(1, 1)), None);
    }

    #[test]
    fn inward_cell_round_non_corner_steps_toward_centre() {
        // (1, 4) → step +x (centre right of vx=1, vW=9) → inner is (2, 4).
        assert_eq!(inward_cell_round(v(9, 9), v(9, 9), v(0, 0), v(1, 4)), Some(v(2, 4)));
    }

    #[test]
    fn inward_cell_round_gutter_resolves_to_boundary() {
        // Gutter cell (-1, 4): the ! marker drawn there belongs to boundary
        // cell (0, 4). inward_cell_round returns (0, 4).
        assert_eq!(inward_cell_round(v(9, 9), v(9, 9), v(0, 0), v(-1, 4)), Some(v(0, 4)));
    }

    #[test]
    fn inward_cell_round_off_canvas_inner_is_none() {
        // For a hypothetical click far outside (e.g., (-5, 4)), the inner
        // step lands at (-4, 4), still out of canvas → None.
        assert_eq!(inward_cell_round(v(9, 9), v(9, 9), v(0, 0), v(-5, 4)), None);
    }
}
