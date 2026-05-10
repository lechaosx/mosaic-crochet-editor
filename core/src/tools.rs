use std::collections::{HashSet, VecDeque};
use crate::common;

// Symmetry mask bits: V=1, H=2, C=4, D1=8, D2=16

// Returns the natural (initialisation) color of a pixel — same formula used in
// initialize_row_pattern and initialize_round_pattern.
pub fn natural_color_row(height: i32, y: i32) -> u8 {
    common::get_color_index(height - 1 - y)
}

pub fn natural_color_round(virtual_size_x: i32, virtual_size_y: i32, rounds: i32, virtual_x: i32, virtual_y: i32) -> u8 {
    use glam::IVec2;
    let virtual_size  = IVec2::new(virtual_size_x, virtual_size_y);
    let virtual_coord = IVec2::new(virtual_x, virtual_y);
    let round_from_edge = common::get_round_from_edge(virtual_size, virtual_coord);
    if round_from_edge >= rounds {
        common::COLOR_TRANSPARENT
    } else {
        common::get_color_index(rounds - 1 - round_from_edge)
    }
}

pub fn erase_pixel_row(pixels: &[u8], width: i32, height: i32, x: i32, y: i32, mask: u8) -> Vec<u8> {
    let mut result = pixels.to_vec();
    for (sx, sy) in symmetric_orbit(x, y, width, height, mask) {
        let idx = (sy * width + sx) as usize;
        if result[idx] == common::COLOR_TRANSPARENT { continue; }
        result[idx] = natural_color_row(height, sy);
    }
    result
}

pub fn erase_pixel_round(pixels: &[u8], canvas_width: i32, canvas_height: i32, x: i32, y: i32,
                          virtual_size_x: i32, virtual_size_y: i32, offset_x: i32, offset_y: i32,
                          rounds: i32, mask: u8) -> Vec<u8> {
    let mut result = pixels.to_vec();
    for (sx, sy) in symmetric_orbit(x, y, canvas_width, canvas_height, mask) {
        if result[(sy * canvas_width + sx) as usize] == common::COLOR_TRANSPARENT { continue; }
        let vx = sx + offset_x;
        let vy = sy + offset_y;
        result[(sy * canvas_width + sx) as usize] = natural_color_round(virtual_size_x, virtual_size_y, rounds, vx, vy);
    }
    result
}

fn symmetric_orbit(x: i32, y: i32, width: i32, height: i32, mask: u8) -> Vec<(i32, i32)> {
    let d1_offset = (width - height).div_euclid(2);
    let d2_sum    = (width + height - 2) / 2;

    type Transform = Box<dyn Fn(i32, i32) -> (i32, i32)>;
    let mut transforms: Vec<Transform> = Vec::new();

    if mask &  1 != 0 { transforms.push(Box::new(move |px, py| (width  - 1 - px, py))); }
    if mask &  2 != 0 { transforms.push(Box::new(move |px, py| (px, height - 1 - py))); }
    if mask &  4 != 0 { transforms.push(Box::new(move |px, py| (width  - 1 - px, height - 1 - py))); }
    if mask &  8 != 0 { transforms.push(Box::new(move |px, py| (py + d1_offset, px - d1_offset))); }
    if mask & 16 != 0 { transforms.push(Box::new(move |px, py| (d2_sum - py, d2_sum - px))); }

    let mut visited: HashSet<(i32, i32)> = HashSet::new();
    let mut queue:   VecDeque<(i32, i32)> = VecDeque::new();
    visited.insert((x, y));
    queue.push_back((x, y));

    while let Some((cx, cy)) = queue.pop_front() {
        for transform in &transforms {
            let (nx, ny) = transform(cx, cy);
            if nx < 0 || nx >= width || ny < 0 || ny >= height { continue; }
            if visited.insert((nx, ny)) {
                queue.push_back((nx, ny));
            }
        }
    }

    visited.into_iter().collect()
}

pub fn paint_pixel(pixels: &[u8], width: i32, height: i32, x: i32, y: i32, color: u8, mask: u8) -> Vec<u8> {
    let mut result = pixels.to_vec();
    for (sx, sy) in symmetric_orbit(x, y, width, height, mask) {
        let idx = (sy * width + sx) as usize;
        if result[idx] != 0 {
            result[idx] = color;
        }
    }
    result
}

pub fn flood_fill(pixels: &[u8], width: i32, height: i32, start_x: i32, start_y: i32, fill_color: u8, mask: u8) -> Vec<u8> {
    let mut result      = pixels.to_vec();
    let     target_color = result[(start_y * width + start_x) as usize];
    if target_color == fill_color || target_color == 0 { return result; }

    let mut visited: HashSet<i32>          = HashSet::new();
    let mut queue:   VecDeque<(i32, i32)>  = VecDeque::new();
    let mut filled:  Vec<(i32, i32)>       = Vec::new();

    queue.push_back((start_x, start_y));

    while let Some((x, y)) = queue.pop_front() {
        if x < 0 || x >= width || y < 0 || y >= height { continue; }
        let idx = y * width + x;
        if visited.contains(&idx) || result[idx as usize] != target_color { continue; }
        visited.insert(idx);
        filled.push((x, y));
        queue.push_back((x + 1, y));
        queue.push_back((x - 1, y));
        queue.push_back((x,     y + 1));
        queue.push_back((x,     y - 1));
    }

    for (x, y) in filled {
        for (sx, sy) in symmetric_orbit(x, y, width, height, mask) {
            let idx = (sy * width + sx) as usize;
            if result[idx] != 0 {
                result[idx] = fill_color;
            }
        }
    }

    result
}
