//! Colour utilities and highlight computation.

use glam::IVec2;
use ndarray::Array2;

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

pub fn compute_row_highlights(
    size:       IVec2,
    pixels:     &Array2<u8>,
    highlights: &mut Array2<u8>,
) {
    for y in 0..size.y {
        let color_index = get_color_index(size.y - 1 - y);
        for x in 0..size.x {
            let [xi, yi] = [x as usize, y as usize];
            if color_index != pixels[[yi, xi]] {
                if y <= 0 || y >= size.y - 1 {
                    highlights[[yi, xi]] = HIGHLIGHT_INVALID;
                } else {
                    let inner_pixel    = pixels[[y as usize + 1, xi]];
                    let overlay_target = y as usize - 1;
                    if color_index == inner_pixel {
                        highlights[[yi, xi]] = HIGHLIGHT_INVALID;
                    } else if highlights[[overlay_target, xi]] != HIGHLIGHT_INVALID {
                        highlights[[overlay_target, xi]] = HIGHLIGHT_VALID_OVERLAY;
                    }
                }
            }
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

            if min_dist.x == min_dist.y || round_from_edge == 0 {
                highlights[[yi, xi]] = HIGHLIGHT_INVALID;
                continue;
            }

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

            let overlay_target  = physical_coord - step;
            let [otx, oty]      = [overlay_target.x as usize, overlay_target.y as usize];
            if is_seam || color_index != pixels[[neighbor.y as usize, neighbor.x as usize]] {
                if highlights[[oty, otx]] != HIGHLIGHT_INVALID {
                    highlights[[oty, otx]] = HIGHLIGHT_VALID_OVERLAY;
                }
            } else {
                highlights[[yi, xi]] = HIGHLIGHT_INVALID;
            }
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
    fn row_hl_bottom_edge_overlay_is_invalid() {
        let hl = run_row_hl(4, 4, &[(2, 3, COLOR_B)]);
        assert_eq!(hl[[3, 2]], I);
    }

    #[test]
    fn row_hl_valid_overlay_highlights_row_above() {
        // y=1: rowIndex=2 (even) → COLOR_A; flip to COLOR_B; inner y=2 → COLOR_B ≠ COLOR_A → VALID at y=0
        let hl = run_row_hl(4, 4, &[(2, 1, COLOR_B)]);
        assert_eq!(hl[[0, 2]], V);
        assert_eq!(hl[[1, 2]], 0);
    }

    #[test]
    fn row_hl_invalid_when_inner_pixel_matches_expected() {
        // H=3, y=1: colorIndex=COLOR_B; inner y=2 forced to COLOR_B → INVALID at (2,1)
        let hl = run_row_hl(4, 3, &[(2, 1, COLOR_A), (2, 2, COLOR_B)]);
        assert_eq!(hl[[1, 2]], I);
    }

    #[test]
    fn row_hl_each_column_is_independent() {
        let overrides: Vec<(usize, usize, u8)> = (0..6).map(|x| (x, 1, COLOR_B)).collect();
        let hl = run_row_hl(6, 4, &overrides);
        for x in 0..6usize {
            assert_eq!(hl[[0, x]], V, "col {x}: expected VALID at y=0");
        }
    }

    #[test]
    fn row_hl_adjacent_wrong_pixels_regression() {
        // y=1 → INVALID; y=2 must NOT be INVALID (old outer-pixel guard bug)
        let hl = run_row_hl(4, 5, &[(2, 1, COLOR_A), (2, 2, COLOR_B)]);
        assert_eq!(hl[[1, 2]], I, "y=1 must be INVALID");
        assert_ne!(hl[[2, 2]], I, "y=2 must not be INVALID (regression)");
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
        // (1,4): RFE=1 → COLOR_B; flip to COLOR_A; stepX=+1 → (2,4) RFE=2 → COLOR_A ≠ COLOR_B → VALID at (0,4)
        let (hl, _) = run_round_hl(9, 9, 9, 9, 0, 0, 3, &[(1, 4, COLOR_A)]);
        assert_eq!(hl[[4, 0]], V);
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
        // 9×3, vW=9 vH=6 offY=3; y=0 vy=3 minDistY=2, x=4 minDistX=4→stepY; vy*2≥vH→stepY=-1→OOB→seam→VALID at (4,1)
        let (hl, _) = run_round_hl(9, 3, 9, 6, 0, 3, 3, &[(4, 0, COLOR_B)]);
        assert_eq!(hl[[1, 4]], V);
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
        // x=2, y=4 (one ring from bottom seam): seam detected → VALID at (2,5)
        let (hl, _) = run_round_hl(6, 6, 12, 12, 0, 6, 3, &[(2, 4, COLOR_A)]);
        assert_eq!(hl[[5, 2]], V);
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
        // y=2, x=8: RFE=2, minDistY=2, stepY=+1→y=3 RFE=2≤2→seam→VALID at (8,1)
        let (hl, _) = run_round_hl(16, 6, 16, 6, 0, 0, 3, &[(8, 2, COLOR_B)]);
        assert_eq!(hl[[1, 8]], V);
    }

    #[test]
    fn round_hl_rect_outermost_top_row_invalid() {
        let (hl, _) = run_round_hl(16, 6, 16, 6, 0, 0, 3, &[(8, 0, COLOR_B)]);
        assert_eq!(hl[[0, 8]], I);
    }
}
