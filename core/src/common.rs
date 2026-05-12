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

pub fn get_color_index(index: i32) -> u8 {
    if index % 2 == 0 { COLOR_A } else { COLOR_B }
}

pub fn get_round_from_edge(virtual_size: IVec2, virtual_coord: IVec2) -> i32 {
    let dist = virtual_coord.min(virtual_size - IVec2::ONE - virtual_coord);
    dist.x.min(dist.y)
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
            let min_dist        = virtual_coord.min(virtual_size - IVec2::ONE - virtual_coord);
            let round_from_edge = min_dist.x.min(min_dist.y);

            if round_from_edge >= rounds {
                continue;
            }

            let color_index = get_color_index(rounds - 1 - round_from_edge);
            let [xi, yi]    = [x as usize, y as usize];
            if color_index == pixels[[yi, xi]] {
                continue;
            }

            // Outermost ring or any diagonal corner: no well-defined outward
            // target. Force INVALID at the wrong cell — renderer handles the
            // visual position (gutter for outermost, the cell itself for
            // interior corners via the y-fallback in `outwardCell`).
            let result = if min_dist.x == min_dist.y || round_from_edge == 0 {
                HIGHLIGHT_INVALID
            } else {
                let step = if min_dist.x < min_dist.y {
                    IVec2::new(if virtual_coord.x * 2 >= virtual_size.x { -1 } else { 1 }, 0)
                } else {
                    IVec2::new(0, if virtual_coord.y * 2 >= virtual_size.y { -1 } else { 1 })
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
}
