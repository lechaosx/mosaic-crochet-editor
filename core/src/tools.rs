use std::collections::{HashSet, VecDeque};

// Symmetry mask bits: V=1, H=2, C=4, D1=8, D2=16

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
