//! Colour utilities and highlight computation.

use glam::IVec2;
use ndarray::Array2;

// Pixel values stored at runtime: 0 = inner hole (transparent sentinel),
// 1 = COLOR_A, 2 = COLOR_B. The transparent sentinel doubles as the universal
// "this cell is a hole, don't touch" guard across every tool (`!= 0`).
// On-disk storage uses a separate 1-bit-per-pixel packing and reconstructs the
// hole sentinel from geometry on load — see `storage.ts`.
pub const COLOR_TRANSPARENT: u8 = 0;
pub const COLOR_A: u8 = 1;
pub const COLOR_B: u8 = 2;
pub const HIGHLIGHT_VALID_OVERLAY: u8 = 3;
pub const HIGHLIGHT_INVALID: u8 = 4;

// Highlight plan: one byte per canvas cell, row-major. 0 means the cell is
// not wrong; otherwise the byte carries `PLAN_INVALID` when the overlay it
// would create is structurally invalid, and one `PLAN_<DIR>` bit for each
// side of the wrong cell the marker visually attaches to (two perpendicular
// bits for round-mode corners). The renderer translates direction → visual
// position and picks colour / glyph / opacity — those are presentation
// concerns, not geometry.
//
// Values below MUST match the `PlanCell` enum in `wasm/src/lib.rs` — that
// enum is the name TS sees.
pub const PLAN_INVALID: u8 = 1;
pub const PLAN_UP: u8 = 2;
pub const PLAN_DOWN: u8 = 4;
pub const PLAN_LEFT: u8 = 8;
pub const PLAN_RIGHT: u8 = 16;

// How far from a cell its plan byte reads pixels: its own and its inward
// neighbour's. An edit therefore changes plan bytes only within this
// distance of the edited cells.
pub const PLAN_REACH: i32 = 1;

fn plan_cell(highlight: u8, directions: u8) -> u8 {
    if highlight == HIGHLIGHT_INVALID {
        PLAN_INVALID | directions
    } else {
        directions
    }
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

pub fn natural_color_round(virtual_size: IVec2, offset: IVec2, rounds: i32, coord: IVec2) -> u8 {
    let rfe = get_round_from_edge(virtual_size, coord + offset);
    if rfe >= rounds {
        COLOR_TRANSPARENT
    } else {
        get_color_index(rounds - 1 - rfe)
    }
}

// Flip COLOR_A ↔ COLOR_B; passes the hole sentinel through unchanged.
pub fn opposite_color(c: u8) -> u8 {
    match c {
        COLOR_A => COLOR_B,
        COLOR_B => COLOR_A,
        _ => c,
    }
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
        if virtual_coord.x * 2 >= virtual_size.x {
            -1
        } else {
            1
        },
        if virtual_coord.y * 2 >= virtual_size.y {
            -1
        } else {
            1
        },
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

pub fn is_always_invalid_round(
    virtual_size: IVec2,
    offset: IVec2,
    rounds: i32,
    coord: IVec2,
) -> bool {
    let min_dist = min_dist_axes(virtual_size, coord + offset);
    if min_dist.x.min(min_dist.y) >= rounds {
        return false;
    }
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
    let v = coord + offset;
    let min_dist = min_dist_axes(virtual_size, v);
    let step = step_toward_center(virtual_size, v);
    if min_dist.x == min_dist.y {
        vec![
            IVec2::new(coord.x - step.x, coord.y),
            IVec2::new(coord.x, coord.y - step.y),
        ]
    } else if min_dist.x < min_dist.y {
        vec![IVec2::new(coord.x - step.x, coord.y)]
    } else {
        vec![IVec2::new(coord.x, coord.y - step.y)]
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

pub fn inward_cell_round(
    canvas_size: IVec2,
    virtual_size: IVec2,
    offset: IVec2,
    coord: IVec2,
) -> Option<IVec2> {
    let v = coord + offset;
    let min_dist = min_dist_axes(virtual_size, v);
    let in_canvas =
        coord.x >= 0 && coord.x < canvas_size.x && coord.y >= 0 && coord.y < canvas_size.y;
    if in_canvas && min_dist.x == min_dist.y {
        return None;
    }
    let step = step_toward_center(virtual_size, v);
    let inner = if min_dist.x < min_dist.y {
        IVec2::new(coord.x + step.x, coord.y)
    } else {
        IVec2::new(coord.x, coord.y + step.y)
    };
    let inner_in_canvas =
        inner.x >= 0 && inner.x < canvas_size.x && inner.y >= 0 && inner.y < canvas_size.y;
    inner_in_canvas.then_some(inner)
}

pub fn overlay_target_available_row(canvas_size: IVec2, coord: IVec2) -> bool {
    coord.x >= 0
        && coord.x < canvas_size.x
        && coord.y >= 0
        && coord.y < canvas_size.y
        && inward_cell_row(canvas_size, coord).is_some()
}

pub fn overlay_target_available_round(
    canvas_size: IVec2,
    virtual_size: IVec2,
    offset: IVec2,
    rounds: i32,
    coord: IVec2,
) -> bool {
    if coord.x < 0
        || coord.x >= canvas_size.x
        || coord.y < 0
        || coord.y >= canvas_size.y
        || natural_color_round(virtual_size, offset, rounds, coord) == COLOR_TRANSPARENT
    {
        return false;
    }
    inward_cell_round(canvas_size, virtual_size, offset, coord).is_some_and(|inner| {
        natural_color_round(virtual_size, offset, rounds, inner) != COLOR_TRANSPARENT
    })
}

// Highlight is stored at the *wrong cell* itself; the renderer is responsible
// for drawing it one step outward (= the overlay layer). Storing at the wrong
// cell unifies the logic: there's no special case for top row vs middle vs
// foundation — every wrong cell asks the same question ("is the overlay this
// would create structurally valid?") and writes V/I at its own position. The
// highlight plan's `PLAN_<DIR>` bits carry the visual displacement.
fn row_highlight(size: IVec2, pixel: impl Fn(IVec2) -> u8, coord: IVec2) -> u8 {
    let color_index = get_color_index(size.y - 1 - coord.y);
    let value = pixel(coord);
    if value == COLOR_TRANSPARENT || value == color_index {
        return 0;
    }
    if coord.y == 0 {
        // Top row: no row above to anchor an overlay against.
        HIGHLIGHT_INVALID
    } else if coord.y >= size.y - 1 {
        // Foundation: no inner row to clash with → valid overlay.
        HIGHLIGHT_VALID_OVERLAY
    } else if pixel(coord + IVec2::Y) == color_index {
        HIGHLIGHT_INVALID
    } else {
        HIGHLIGHT_VALID_OVERLAY
    }
}

fn round_highlight(
    canvas_size: IVec2,
    virtual_size: IVec2,
    offset: IVec2,
    rounds: i32,
    pixel: impl Fn(IVec2) -> u8,
    physical_coord: IVec2,
) -> u8 {
    let virtual_coord = physical_coord + offset;
    let min_dist = min_dist_axes(virtual_size, virtual_coord);
    let round_from_edge = min_dist.x.min(min_dist.y);
    if round_from_edge >= rounds {
        return 0;
    }

    let color_index = get_color_index(rounds - 1 - round_from_edge);
    let value = pixel(physical_coord);
    if value == COLOR_TRANSPARENT || value == color_index {
        return 0;
    }

    // Outermost ring or any diagonal corner: no well-defined outward
    // target. Force INVALID at the wrong cell — renderer handles the
    // visual position (gutter for outermost, two perpendicular
    // outwards for interior corners via `outward_cells_round`).
    if always_invalid_at(min_dist) {
        return HIGHLIGHT_INVALID;
    }
    // Mid-ring non-corner: one well-defined inward direction.
    let step_full = step_toward_center(virtual_size, virtual_coord);
    let step = if min_dist.x < min_dist.y {
        IVec2::new(step_full.x, 0)
    } else {
        IVec2::new(0, step_full.y)
    };

    let neighbor = physical_coord + step;
    let neighbor_in_bounds = neighbor.x >= 0
        && neighbor.x < canvas_size.x
        && neighbor.y >= 0
        && neighbor.y < canvas_size.y;

    let is_seam = !neighbor_in_bounds || {
        let neighbor_rfe = get_round_from_edge(virtual_size, neighbor + offset);
        neighbor_rfe <= round_from_edge
    };

    if is_seam || color_index != pixel(neighbor) {
        HIGHLIGHT_VALID_OVERLAY
    } else {
        HIGHLIGHT_INVALID
    }
}

// Reads canvas cells from `pixels`, which hold the canvas from `origin` on.
fn pixel_at(pixels: &Array2<u8>, origin: IVec2) -> impl Fn(IVec2) -> u8 {
    move |coord| pixels[[(coord.y - origin.y) as usize, (coord.x - origin.x) as usize]]
}

pub fn compute_row_highlights(size: IVec2, pixels: &Array2<u8>, highlights: &mut Array2<u8>) {
    for y in 0..size.y {
        for x in 0..size.x {
            highlights[[y as usize, x as usize]] =
                row_highlight(size, pixel_at(pixels, IVec2::ZERO), IVec2::new(x, y));
        }
    }
}

pub fn compute_round_highlights(
    canvas_size: IVec2,
    virtual_size: IVec2,
    offset: IVec2,
    rounds: i32,
    pixels: &Array2<u8>,
    highlights: &mut Array2<u8>,
) {
    for y in 0..canvas_size.y {
        for x in 0..canvas_size.x {
            highlights[[y as usize, x as usize]] = round_highlight(
                canvas_size,
                virtual_size,
                offset,
                rounds,
                pixel_at(pixels, IVec2::ZERO),
                IVec2::new(x, y),
            );
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Highlight plan builders: the highlights plus their outward directions, so the
// renderer doesn't need geometry: each plan cell fully describes what and
// where to draw, leaving only colour / glyph choice (presentation) to the
// caller.
pub fn highlight_plan_row(
    canvas_size: IVec2,
    pixels: &Array2<u8>,
    pixels_origin: IVec2,
    rect_min: IVec2,
    rect_size: IVec2,
) -> Vec<u8> {
    let pixel = pixel_at(pixels, pixels_origin);
    let mut plan = Vec::with_capacity((rect_size.x * rect_size.y) as usize);
    for y in rect_min.y..rect_min.y + rect_size.y {
        for x in rect_min.x..rect_min.x + rect_size.x {
            plan.push(match row_highlight(canvas_size, &pixel, IVec2::new(x, y)) {
                0 => 0,
                highlight => plan_cell(highlight, PLAN_UP),
            });
        }
    }
    plan
}

#[allow(clippy::too_many_arguments)]
pub fn highlight_plan_round(
    canvas_size: IVec2,
    virtual_size: IVec2,
    offset: IVec2,
    rounds: i32,
    pixels: &Array2<u8>,
    pixels_origin: IVec2,
    rect_min: IVec2,
    rect_size: IVec2,
) -> Vec<u8> {
    let pixel = pixel_at(pixels, pixels_origin);
    let mut plan = Vec::with_capacity((rect_size.x * rect_size.y) as usize);
    for y in rect_min.y..rect_min.y + rect_size.y {
        for x in rect_min.x..rect_min.x + rect_size.x {
            let coord = IVec2::new(x, y);
            let highlight =
                round_highlight(canvas_size, virtual_size, offset, rounds, &pixel, coord);
            plan.push(match highlight {
                0 => 0,
                highlight => plan_cell(highlight, round_directions(virtual_size, coord + offset)),
            });
        }
    }
    plan
}

// The plan cells carrying a glyph, and those of them whose glyph is a warning.
pub fn plan_counts(plan: &[u8]) -> (u32, u32) {
    plan.iter().fold((0, 0), |(marked, invalid), &cell| {
        (
            marked + u32::from(cell != 0),
            invalid + u32::from(cell & PLAN_INVALID),
        )
    })
}

// Outermost ring: outward direction is *outside* the canvas. It is still
// emitted — the renderer chooses what to do (typically draws in the gutter).
// Corners (min_dist.x == min_dist.y) carry two perpendicular directions.
fn round_directions(virtual_size: IVec2, virtual_coord: IVec2) -> u8 {
    let min_dist = min_dist_axes(virtual_size, virtual_coord);
    let step = step_toward_center(virtual_size, virtual_coord);
    let dir_x = if step.x == 1 { PLAN_LEFT } else { PLAN_RIGHT };
    let dir_y = if step.y == 1 { PLAN_UP } else { PLAN_DOWN };
    if min_dist.x == min_dist.y {
        dir_x | dir_y
    } else if min_dist.x < min_dist.y {
        dir_x
    } else {
        dir_y
    }
}

// ─────────────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    // ── helpers ──────────────────────────────────────────────────────────────

    fn v(x: i32, y: i32) -> IVec2 {
        IVec2::new(x, y)
    }

    /// Build a W×H pixel grid initialised to natural row colours.
    fn make_row_grid(w: i32, h: i32) -> Array2<u8> {
        let mut p = Array2::zeros((h as usize, w as usize));
        for y in 0..h {
            let ci = get_color_index(h - 1 - y);
            for x in 0..w {
                p[[y as usize, x as usize]] = ci;
            }
        }
        p
    }

    /// Run row-highlight computation with optional pixel overrides.
    /// Overrides: (x, y, colour).
    fn run_row_hl(w: i32, h: i32, overrides: &[(usize, usize, u8)]) -> Array2<u8> {
        let mut pixels = make_row_grid(w, h);
        for &(x, y, c) in overrides {
            pixels[[y, x]] = c;
        }
        let mut hl = Array2::zeros((h as usize, w as usize));
        compute_row_highlights(v(w, h), &pixels, &mut hl);
        hl
    }

    /// Build a W×H pixel grid initialised to the natural round colour pattern.
    fn make_round_grid(
        w: i32,
        h: i32,
        vw: i32,
        vh: i32,
        off_x: i32,
        off_y: i32,
        rounds: i32,
    ) -> Array2<u8> {
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
        w: i32,
        h: i32,
        vw: i32,
        vh: i32,
        off_x: i32,
        off_y: i32,
        rounds: i32,
        overrides: &[(usize, usize, u8)],
    ) -> (Array2<u8>, Array2<u8>) {
        let mut pixels = make_round_grid(w, h, vw, vh, off_x, off_y, rounds);
        for &(x, y, c) in overrides {
            pixels[[y, x]] = c;
        }
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
    fn row_index_top_maps_to_max() {
        assert_eq!(9 - 1 - 0, 8);
    }
    #[test]
    fn row_index_bottom_maps_to_zero() {
        assert_eq!(9 - 1 - 8, 0);
    }
    #[test]
    fn row_index_middle() {
        assert_eq!(9 - 1 - 4, 4);
    }

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
        assert_eq!(get_round_from_edge(v(16, 6), v(0, 0)), 0);
        assert_eq!(get_round_from_edge(v(16, 6), v(3, 0)), 0);
        assert_eq!(get_round_from_edge(v(16, 6), v(3, 1)), 1);
        assert_eq!(get_round_from_edge(v(16, 6), v(3, 2)), 2);
        assert_eq!(get_round_from_edge(v(16, 6), v(8, 2)), 2);
        assert_eq!(get_round_from_edge(v(16, 6), v(8, 3)), 2);
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
        assert_eq!(ri(0, 0), 2);
        assert_eq!(ri(8, 2), 0);
        assert_eq!(ri(8, 3), 0);
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
            assert_eq!(
                hl[[1, x]],
                V,
                "col {x}: expected VALID at the wrong cell y=1"
            );
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
        let overrides: Vec<_> = (3..=5)
            .flat_map(|y| (3..=5).map(move |x| (x, y, COLOR_A)))
            .collect();
        let (_, pixels) = run_round_hl(9, 9, 9, 9, 0, 0, 3, &overrides);
        for y in 3..=5usize {
            for x in 3..=5usize {
                assert_eq!(pixels[[y, x]], COLOR_TRANSPARENT);
            }
        }
    }

    #[test]
    fn round_hl_full_adjacent_wrong_pixels_regression() {
        let a = COLOR_A;
        let b = COLOR_B;
        let (hl, _) = run_round_hl(
            9,
            9,
            9,
            9,
            0,
            0,
            3,
            &[
                (0, 4, b),
                (1, 4, a),
                (8, 4, b),
                (7, 4, a),
                (4, 0, b),
                (4, 1, a),
                (4, 8, b),
                (4, 7, a),
            ],
        );
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
        for y in 0..3usize {
            for x in 3..6usize {
                assert_eq!(pixels[[y, x]], COLOR_TRANSPARENT);
            }
        }
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
        for y in 0..3usize {
            for x in 3..6usize {
                assert_eq!(pixels[[y, x]], COLOR_TRANSPARENT);
            }
        }
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

    // ── highlight_plan_* ─────────────────────────────────────────────────────

    fn whole_plan_row(size: IVec2, pixels: &Array2<u8>) -> Vec<u8> {
        highlight_plan_row(size, pixels, IVec2::ZERO, IVec2::ZERO, size)
    }

    fn whole_plan_round(
        size: IVec2,
        virtual_size: IVec2,
        offset: IVec2,
        rounds: i32,
        pixels: &Array2<u8>,
    ) -> Vec<u8> {
        highlight_plan_round(
            size,
            virtual_size,
            offset,
            rounds,
            pixels,
            IVec2::ZERO,
            IVec2::ZERO,
            size,
        )
    }

    /// The plan's marked cells as (x, y, cell).
    fn plan_marks(width: i32, plan: &[u8]) -> Vec<(i32, i32, u8)> {
        (0..plan.len() as i32)
            .filter(|&i| plan[i as usize] != 0)
            .map(|i| (i % width, i / width, plan[i as usize]))
            .collect()
    }

    #[test]
    fn plan_counts_cells_with_a_glyph_and_those_with_a_warning() {
        let plan = [
            0,
            PLAN_UP,
            PLAN_INVALID | PLAN_LEFT,
            PLAN_INVALID | PLAN_UP | PLAN_RIGHT,
        ];
        assert_eq!(plan_counts(&plan), (3, 2));
    }

    #[test]
    fn plan_row_empty_when_pattern_correct() {
        let pixels = make_row_grid(4, 4);
        let plan = whole_plan_row(v(4, 4), &pixels);
        assert_eq!(plan.len(), 16);
        assert!(plan_marks(4, &plan).is_empty());
    }

    #[test]
    fn plan_row_ignores_temporarily_absent_cells() {
        let pixels = Array2::zeros((4, 4));
        let plan = whole_plan_row(v(4, 4), &pixels);
        assert!(plan_marks(4, &plan).is_empty());
    }

    #[test]
    fn plan_row_top_edge_marks_invalid_with_up_dir() {
        // y=0 wrong → INVALID at (2, 0), direction always UP in row mode.
        let mut pixels = make_row_grid(4, 4);
        pixels[[0, 2]] = COLOR_A; // y=0 expects COLOR_B
        let plan = whole_plan_row(v(4, 4), &pixels);
        assert_eq!(plan_marks(4, &plan), vec![(2, 0, PLAN_INVALID | PLAN_UP)]);
    }

    #[test]
    fn plan_row_foundation_marks_valid_with_up_dir() {
        // y=H-1 wrong → VALID at (2, 3), still pointing UP (renderer draws
        // one row up; that's where the overlay would visually live).
        let mut pixels = make_row_grid(4, 4);
        pixels[[3, 2]] = COLOR_B; // y=3 expects COLOR_A
        let plan = whole_plan_row(v(4, 4), &pixels);
        assert_eq!(plan_marks(4, &plan), vec![(2, 3, PLAN_UP)]);
    }

    #[test]
    fn plan_round_non_corner_single_dir() {
        // 9×9 r=3 full. Wrong cell (1, 4) is on the left edge of the second
        // ring (rfe=1, min_dist.x < min_dist.y) → step toward centre is +x →
        // outward dir is LEFT.
        let mut pixels = make_round_grid(9, 9, 9, 9, 0, 0, 3);
        pixels[[4, 1]] = COLOR_A; // (1,4): rfe=1 expects COLOR_B
        let plan = whole_plan_round(v(9, 9), v(9, 9), v(0, 0), 3, &pixels);
        assert_eq!(plan_marks(9, &plan), vec![(1, 4, PLAN_LEFT)]);
    }

    #[test]
    fn plan_round_ignores_temporarily_absent_active_cells() {
        let pixels = Array2::zeros((9, 9));
        let plan = whole_plan_round(v(9, 9), v(9, 9), v(0, 0), 3, &pixels);
        assert!(plan_marks(9, &plan).is_empty());
    }

    #[test]
    fn plan_round_corner_marks_two_perpendicular_dirs() {
        // 9×9 r=3 full. Wrong cell (1, 1) is a diagonal corner (rfe=1,
        // dx == dy == 1). step.x=+1 (centre right), step.y=+1 (centre below)
        // → outward dirs LEFT and UP. Always-invalid → INVALID.
        let mut pixels = make_round_grid(9, 9, 9, 9, 0, 0, 3);
        pixels[[1, 1]] = COLOR_A; // (1,1): rfe=1 expects COLOR_B
        let plan = whole_plan_round(v(9, 9), v(9, 9), v(0, 0), 3, &pixels);
        assert_eq!(
            plan_marks(9, &plan),
            vec![(1, 1, PLAN_INVALID | PLAN_LEFT | PLAN_UP)]
        );
    }

    #[test]
    fn plan_round_points_each_side_and_corner_outward() {
        // 9×9 r=3 full: one wrong cell on the second ring per side and corner.
        let cases = [
            ((1, 4), PLAN_LEFT),
            ((7, 4), PLAN_RIGHT),
            ((4, 1), PLAN_UP),
            ((4, 7), PLAN_DOWN),
            ((1, 1), PLAN_INVALID | PLAN_LEFT | PLAN_UP),
            ((7, 1), PLAN_INVALID | PLAN_RIGHT | PLAN_UP),
            ((1, 7), PLAN_INVALID | PLAN_LEFT | PLAN_DOWN),
            ((7, 7), PLAN_INVALID | PLAN_RIGHT | PLAN_DOWN),
        ];
        for ((x, y), expected) in cases {
            let mut pixels = make_round_grid(9, 9, 9, 9, 0, 0, 3);
            pixels[[y, x]] = opposite_color(pixels[[y, x]]);
            let plan = whole_plan_round(v(9, 9), v(9, 9), v(0, 0), 3, &pixels);
            assert_eq!(
                plan_marks(9, &plan),
                vec![(x as i32, y as i32, expected)],
                "cell ({x}, {y})"
            );
        }
    }

    // ── highlight plan regions ───────────────────────────────────────────────

    /// Reproducible pseudo-random numbers in `0..n`.
    struct Lcg(u32);
    impl Lcg {
        fn below(&mut self, n: i32) -> i32 {
            self.0 = self.0.wrapping_mul(1_103_515_245).wrapping_add(12_345);
            (self.0 >> 8) as i32 % n
        }
    }

    enum Geometry {
        Row,
        Round {
            virtual_size: IVec2,
            offset: IVec2,
            rounds: i32,
        },
    }

    /// A small row or round chart of random cells, holes included.
    fn random_chart(rng: &mut Lcg, case: usize) -> (IVec2, Geometry, Array2<u8>) {
        let size = v(1 + rng.below(9), 1 + rng.below(9));
        let geometry = if case % 2 == 0 {
            Geometry::Row
        } else {
            let virtual_size = size + v(rng.below(4), rng.below(4));
            let offset = v(
                rng.below(virtual_size.x - size.x + 1),
                rng.below(virtual_size.y - size.y + 1),
            );
            Geometry::Round {
                virtual_size,
                offset,
                rounds: 1 + rng.below(6),
            }
        };
        let pixels =
            Array2::from_shape_fn((size.y as usize, size.x as usize), |_| rng.below(3) as u8);
        (size, geometry, pixels)
    }

    fn random_rect(rng: &mut Lcg, size: IVec2) -> (IVec2, IVec2) {
        let min = v(rng.below(size.x), rng.below(size.y));
        (
            min,
            v(1 + rng.below(size.x - min.x), 1 + rng.below(size.y - min.y)),
        )
    }

    fn region_plan(
        size: IVec2,
        geometry: &Geometry,
        pixels: &Array2<u8>,
        origin: IVec2,
        min: IVec2,
        rect_size: IVec2,
    ) -> Vec<u8> {
        match *geometry {
            Geometry::Row => highlight_plan_row(size, pixels, origin, min, rect_size),
            Geometry::Round {
                virtual_size,
                offset,
                rounds,
            } => highlight_plan_round(
                size,
                virtual_size,
                offset,
                rounds,
                pixels,
                origin,
                min,
                rect_size,
            ),
        }
    }

    #[test]
    fn plan_region_reads_only_its_cells_within_reach() {
        let mut rng = Lcg(1);
        for case in 0..4000 {
            let (size, geometry, pixels) = random_chart(&mut rng, case);
            let whole = region_plan(size, &geometry, &pixels, IVec2::ZERO, IVec2::ZERO, size);
            let (min, rect_size) = random_rect(&mut rng, size);
            let window_min = (min - IVec2::splat(PLAN_REACH)).max(IVec2::ZERO);
            let window_max = (min + rect_size + IVec2::splat(PLAN_REACH)).min(size);
            let window = pixels
                .slice(ndarray::s![
                    window_min.y as usize..window_max.y as usize,
                    window_min.x as usize..window_max.x as usize
                ])
                .to_owned();
            let region = region_plan(size, &geometry, &window, window_min, min, rect_size);
            for y in 0..rect_size.y {
                for x in 0..rect_size.x {
                    let c = min + v(x, y);
                    assert_eq!(
                        region[(y * rect_size.x + x) as usize],
                        whole[(c.y * size.x + c.x) as usize],
                        "case {case}: cell {c} of region {min} + {rect_size}",
                    );
                }
            }
        }
    }

    #[test]
    fn an_edit_changes_the_plan_only_within_reach() {
        let mut rng = Lcg(2);
        for case in 0..4000 {
            let (size, geometry, mut pixels) = random_chart(&mut rng, case);
            let before = region_plan(size, &geometry, &pixels, IVec2::ZERO, IVec2::ZERO, size);
            let (min, rect_size) = random_rect(&mut rng, size);
            for y in min.y..min.y + rect_size.y {
                for x in min.x..min.x + rect_size.x {
                    pixels[[y as usize, x as usize]] = rng.below(3) as u8;
                }
            }
            let after = region_plan(size, &geometry, &pixels, IVec2::ZERO, IVec2::ZERO, size);
            let reach_min = min - IVec2::splat(PLAN_REACH);
            let reach_max = min + rect_size + IVec2::splat(PLAN_REACH);
            for y in 0..size.y {
                for x in 0..size.x {
                    let c = v(x, y);
                    let within = c.cmpge(reach_min).all() && c.cmplt(reach_max).all();
                    assert!(
                        within
                            || before[(y * size.x + x) as usize]
                                == after[(y * size.x + x) as usize],
                        "case {case}: cell {c} changed outside the reach of edit {min} + {rect_size}",
                    );
                }
            }
        }
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
        assert_eq!(
            natural_color_round(v(9, 9), v(0, 0), 3, v(4, 4)),
            COLOR_TRANSPARENT
        );
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
        assert_eq!(
            outward_cells_round(v(9, 9), v(0, 0), v(1, 4)),
            vec![v(0, 4)]
        );
        // (4, 1): closer-to-y edge (top) → outward UP.
        assert_eq!(
            outward_cells_round(v(9, 9), v(0, 0), v(4, 1)),
            vec![v(4, 0)]
        );
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
        assert_eq!(
            inward_cell_round(v(9, 9), v(9, 9), v(0, 0), v(1, 4)),
            Some(v(2, 4))
        );
    }

    #[test]
    fn inward_cell_round_gutter_resolves_to_boundary() {
        // Gutter cell (-1, 4): the ! marker drawn there belongs to boundary
        // cell (0, 4). inward_cell_round returns (0, 4).
        assert_eq!(
            inward_cell_round(v(9, 9), v(9, 9), v(0, 0), v(-1, 4)),
            Some(v(0, 4))
        );
    }

    #[test]
    fn inward_cell_round_off_canvas_inner_is_none() {
        // For a hypothetical click far outside (e.g., (-5, 4)), the inner
        // step lands at (-4, 4), still out of canvas → None.
        assert_eq!(inward_cell_round(v(9, 9), v(9, 9), v(0, 0), v(-5, 4)), None);
    }

    #[test]
    fn overlay_target_available_row_requires_an_in_canvas_inward_cell() {
        assert!(overlay_target_available_row(v(4, 4), v(2, 1)));
        assert!(!overlay_target_available_row(v(4, 4), v(2, 3)));
        assert!(!overlay_target_available_row(v(4, 4), v(-1, 1)));
    }

    #[test]
    fn overlay_target_available_round_rejects_corners_and_hole_destinations() {
        assert!(overlay_target_available_round(
            v(9, 9),
            v(9, 9),
            v(0, 0),
            3,
            v(1, 4)
        ));
        assert!(!overlay_target_available_round(
            v(9, 9),
            v(9, 9),
            v(0, 0),
            3,
            v(1, 1)
        ));
        assert!(!overlay_target_available_round(
            v(9, 9),
            v(9, 9),
            v(0, 0),
            3,
            v(2, 4)
        ));
        assert!(!overlay_target_available_round(
            v(9, 9),
            v(9, 9),
            v(0, 0),
            3,
            v(4, 4)
        ));
    }
}
