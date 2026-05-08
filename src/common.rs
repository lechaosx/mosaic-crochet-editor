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
