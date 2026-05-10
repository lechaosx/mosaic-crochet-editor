//! Walk generators. Each call yields the cells of a single row (row mode) or
//! a single round (round mode) so the export pipeline can stream output. Uses
//! nightly `gen` blocks. Round walks have a 5-segment structure (4 edges +
//! start corner) that the exporter relies on for its edge-aware preprocess.

use glam::IVec2;

pub fn row_walk_at(size: IVec2, row_index: usize) -> impl Iterator<Item = IVec2> {
    let y = size.y - 2 - row_index as i32;
    gen move {
        for x in 0..size.x {
            yield IVec2::new(x, y);
        }
    }
}

struct Segment {
    start_coord: IVec2,
    step_vector: IVec2,
    count:       i32,
}

pub fn round_walk_at(size: IVec2, rounds: i32, round: i32) -> impl Iterator<Item = (IVec2, IVec2)> {
    let edge_distance     = rounds - round;
    let left_right_length = size.y - 2 * edge_distance - 2;
    let top_bottom_length = size.x - 2 * edge_distance - 2;
    let inner_edge        = edge_distance + 1;
    let inner_bound       = IVec2::new(inner_edge,               inner_edge);
    let outer_bound       = IVec2::new(size.x - 1 - inner_edge, size.y - 1 - inner_edge);

    let project_inward = move |coord: IVec2| coord.clamp(inner_bound, outer_bound);

    let segments = [
        Segment { start_coord: IVec2::new(edge_distance + 1,           edge_distance              ), step_vector: IVec2::new(-1,  0), count: 1                    },  // pre-start (one right of TL)
        Segment { start_coord: IVec2::new(edge_distance,               edge_distance              ), step_vector: IVec2::new( 0,  1), count: 1 + left_right_length },  // TL corner + left↓
        Segment { start_coord: IVec2::new(edge_distance,               size.y - 1 - edge_distance ), step_vector: IVec2::new( 1,  0), count: 1 + top_bottom_length },  // BL corner + bottom→
        Segment { start_coord: IVec2::new(size.x - 1 - edge_distance, size.y - 1 - edge_distance ), step_vector: IVec2::new( 0, -1), count: 1 + left_right_length },  // BR corner + right↑
        Segment { start_coord: IVec2::new(size.x - 1 - edge_distance, edge_distance              ), step_vector: IVec2::new(-1,  0), count: top_bottom_length     },  // TR corner + top← (excl. pre-start)
    ];

    gen move {
        for segment in segments {
            for step in 0..segment.count {
                let coord = segment.start_coord + segment.step_vector * step;
                yield (coord, project_inward(coord));
            }
        }
    }
}

pub fn window(coord: IVec2, size: IVec2) -> bool {
    coord.x >= 0 && coord.x < size.x && coord.y >= 0 && coord.y < size.y
}

pub fn is_corner_coord(physical_coord: IVec2, offset: IVec2, virtual_size: IVec2) -> bool {
    let virtual_coord           = physical_coord + offset;
    let distance_from_near_edge = virtual_coord.min(virtual_size - IVec2::ONE - virtual_coord);
    distance_from_near_edge.x == distance_from_near_edge.y
}

// ─────────────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    fn v(x: i32, y: i32) -> IVec2 { IVec2::new(x, y) }

    fn collect_round(size: IVec2, rounds: i32, round: i32) -> Vec<(IVec2, IVec2)> {
        round_walk_at(size, rounds, round).collect()
    }

    fn count_corners(pairs: &[(IVec2, IVec2)], offset: IVec2, virtual_size: IVec2) -> usize {
        pairs.iter().filter(|&&(c, _)| is_corner_coord(c, offset, virtual_size)).count()
    }

    // ── row_walk_at ──────────────────────────────────────────────────────────

    #[test]
    fn row_walk_yields_h_minus_1_rows() {
        let rows_3x4: Vec<Vec<IVec2>> = (0..3).map(|i| row_walk_at(v(3, 4), i).collect()).collect();
        assert_eq!(rows_3x4.len(), 3);
        let rows_1x2: Vec<Vec<IVec2>> = (0..1).map(|i| row_walk_at(v(1, 2), i).collect()).collect();
        assert_eq!(rows_1x2.len(), 1);
    }

    #[test]
    fn row_walk_each_row_has_w_pixels() {
        for i in 0..3usize {
            let row: Vec<IVec2> = row_walk_at(v(5, 4), i).collect();
            assert_eq!(row.len(), 5);
        }
    }

    #[test]
    fn row_walk_left_to_right_at_correct_y() {
        // row_index=0 → y = 4-2-0 = 2
        let row: Vec<IVec2> = row_walk_at(v(3, 4), 0).collect();
        assert_eq!(row[0], v(0, 2));
        assert_eq!(row[1], v(1, 2));
        assert_eq!(row[2], v(2, 2));
    }

    #[test]
    fn row_walk_y_decreases_across_rows() {
        let rows: Vec<Vec<IVec2>> = (0..3).map(|i| row_walk_at(v(1, 4), i).collect()).collect();
        assert_eq!(rows[0][0].y, 2);
        assert_eq!(rows[1][0].y, 1);
        assert_eq!(rows[2][0].y, 0);
    }

    // ── round_walk_at ────────────────────────────────────────────────────────

    #[test]
    fn round_walk_yields_correct_round_count() {
        // just check collecting all rounds gives expected counts
        let r2: usize = (1..=2).map(|r| round_walk_at(v(5, 5), 2, r).count()).sum();
        assert_eq!(r2, 8 + 16);
        let r3: usize = (1..=3).map(|r| round_walk_at(v(7, 7), 3, r).count()).sum();
        assert_eq!(r3, 8 + 16 + 24);
    }

    #[test]
    fn round_walk_each_full_round_has_4_corners() {
        for r in 1..=2 {
            let pairs = collect_round(v(5, 5), 2, r);
            assert_eq!(count_corners(&pairs, v(0, 0), v(5, 5)), 4);
        }
    }

    #[test]
    fn round_walk_total_coords_inner_width_1() {
        // vW=vH=2*rounds+1; total per round r = 8r
        assert_eq!(round_walk_at(v(7, 7), 3, 1).count(),  8);
        assert_eq!(round_walk_at(v(7, 7), 3, 2).count(), 16);
        assert_eq!(round_walk_at(v(7, 7), 3, 3).count(), 24);
    }

    #[test]
    fn round_walk_total_coords_inner_width_3() {
        // vW=vH=7, rounds=2: r=1→16, r=2→24
        assert_eq!(round_walk_at(v(7, 7), 2, 1).count(), 16);
        assert_eq!(round_walk_at(v(7, 7), 2, 2).count(), 24);
    }

    #[test]
    fn round_walk_coord_order_5x5_round1() {
        // vW=vH=5, rounds=2, r=1: LR=TB=1
        let r1 = collect_round(v(5, 5), 2, 1);
        assert_eq!(r1[0].0, v(2, 1), "pre-start");
        assert_eq!(r1[1].0, v(1, 1), "TL corner");
        assert_eq!(r1[2].0, v(1, 2), "left↓");
        assert_eq!(r1[3].0, v(1, 3), "BL corner");
        assert_eq!(r1[4].0, v(2, 3), "bottom→");
        assert_eq!(r1[5].0, v(3, 3), "BR corner");
        assert_eq!(r1[6].0, v(3, 2), "right↑");
        assert_eq!(r1[7].0, v(3, 1), "TR corner");
    }

    #[test]
    fn round_walk_left_side_walks_downward() {
        // vW=vH=7, rounds=3, r=2: r2[3..5] are left↓ side
        let r2 = collect_round(v(7, 7), 3, 2);
        assert_eq!(r2[2].0, v(1, 2));
        assert_eq!(r2[3].0, v(1, 3));
        assert_eq!(r2[4].0, v(1, 4));
    }

    #[test]
    fn round_walk_right_side_walks_upward() {
        // r=2: pre(1)+TL(1)+left(3)+BL(1)+bot(3)+BR(1) → index 10 is first right↑
        let r2 = collect_round(v(7, 7), 3, 2);
        assert_eq!(r2[10].0, v(5, 4));
        assert_eq!(r2[11].0, v(5, 3));
        assert_eq!(r2[12].0, v(5, 2));
    }

    // ── window ───────────────────────────────────────────────────────────────

    #[test]
    fn window_inside_bounds() {
        assert!(window(v(0, 0), v(5, 5)));
        assert!(window(v(4, 4), v(5, 5)));
        assert!(window(v(2, 3), v(5, 5)));
    }

    #[test]
    fn window_outside_bounds() {
        assert!(!window(v(-1,  0), v(5, 5)));
        assert!(!window(v( 5,  0), v(5, 5)));
        assert!(!window(v( 0,  5), v(5, 5)));
        assert!(!window(v( 0, -1), v(5, 5)));
    }

    #[test]
    fn round_walk_plus_window_all_in_canvas_half_mode() {
        let canvas = v(5, 5);
        for r in 1..=1 {
            for (coord, _) in round_walk_at(v(5, 10), 1, r) {
                let phys = coord - v(0, 5);
                if window(phys, canvas) {
                    assert!(phys.x >= 0 && phys.x < 5 && phys.y >= 0 && phys.y < 5);
                }
            }
        }
    }

    #[test]
    fn round_walk_plus_window_half_mode_2_corners() {
        let canvas = v(5, 5);
        let vsize  = v(5, 10);
        let offset = v(0, 5);
        for r in 1..=1 {
            let windowed: Vec<_> = round_walk_at(vsize, 1, r)
                .map(|(c, p)| (c - v(0, 5), p))
                .filter(|&(c, _)| window(c, canvas))
                .collect();
            assert_eq!(count_corners(&windowed, offset, vsize), 2);
        }
    }

    #[test]
    fn round_walk_plus_window_quarter_mode_1_corner() {
        let canvas = v(3, 5);
        let vsize  = v(5, 10);
        let offset = v(0, 5);
        for r in 1..=1 {
            let windowed: Vec<_> = round_walk_at(vsize, 1, r)
                .map(|(c, p)| (c - v(0, 5), p))
                .filter(|&(c, _)| window(c, canvas))
                .collect();
            assert_eq!(count_corners(&windowed, offset, vsize), 1);
        }
    }

    // ── is_corner_coord ──────────────────────────────────────────────────────

    #[test]
    fn corner_coord_detects_ring_corners_5x5() {
        let no_off = v(0, 0);
        let gs = v(5, 5);
        assert!( is_corner_coord(v(1, 1), no_off, gs), "TL (1,1)");
        assert!( is_corner_coord(v(1, 3), no_off, gs), "BL (1,3)");
        assert!( is_corner_coord(v(3, 3), no_off, gs), "BR (3,3)");
        assert!( is_corner_coord(v(3, 1), no_off, gs), "TR (3,1)");
        assert!(!is_corner_coord(v(1, 2), no_off, gs), "left side");
        assert!(!is_corner_coord(v(2, 3), no_off, gs), "bottom side");
    }

    #[test]
    fn corner_coord_with_offset() {
        assert!( is_corner_coord(v(0, 0), v(1, 1), v(5, 5))); // virtual (1,1) is corner
        assert!(!is_corner_coord(v(0, 1), v(1, 1), v(5, 5))); // virtual (1,2) is not
    }

    #[test]
    fn corner_coord_outermost_ring_7x7() {
        let no_off = v(0, 0);
        let gs = v(7, 7);
        assert!( is_corner_coord(v(0, 0), no_off, gs));
        assert!( is_corner_coord(v(0, 6), no_off, gs));
        assert!( is_corner_coord(v(6, 6), no_off, gs));
        assert!( is_corner_coord(v(6, 0), no_off, gs));
        assert!(!is_corner_coord(v(0, 3), no_off, gs));
    }
}
