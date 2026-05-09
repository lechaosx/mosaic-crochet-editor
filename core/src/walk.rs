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
