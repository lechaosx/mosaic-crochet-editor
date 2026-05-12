//! Drawing tools.
//!
//! Each tool walks the *symmetric orbit* of the click point under the active
//! symmetry mask (`symmetric_orbit`, BFS over up to five reflections) and
//! writes per-orbit-cell. The orbit walker is also exported through wasm so
//! the TS-side Invert tool can reuse it for per-stroke deduping.

use std::collections::{HashSet, VecDeque};
use glam::IVec2;
use crate::common::{COLOR_TRANSPARENT, natural_color_row, natural_color_round, opposite_color, inward_cell_row, inward_cell_round, is_always_invalid_row, is_always_invalid_round};

// Symmetry mask bits: V=1, H=2, C=4, D1=8, D2=16

pub fn symmetric_orbit(x: i32, y: i32, width: i32, height: i32, mask: u8) -> Vec<(i32, i32)> {
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

// Overlay tools. Two semantic actions; TS picks which one to call.
//
// `paint_overlay_*` — make a ✕ visually appear at the clicked cell. Each cell
//   in the click's symmetric orbit has its inward neighbour painted with the
//   *opposite* of its natural colour; the highlight pass then renders a
//   valid-overlay marker at the original click cell. Skips holes, corners
//   (no single inward axis), and innermost-ring cells (no inward neighbour)
//   — `inward_cell_*` returns None in those cases. No-op on gutter clicks
//   (there's no cell there to paint at).
//
// `clear_overlay_*` — remove a marker that's already there.
//   • In-canvas: restore inward neighbours of the orbit back to natural.
//   • Gutter: the boundary cell whose ! renders in the gutter is the inward
//     neighbour of the gutter cell; restore its full symmetric orbit. This
//     is how the user clears boundary-row/ring ! markers they can see
//     hovering outside the pattern.

// Paint each non-hole cell in the click's symmetric orbit to its natural
// baseline (the alternating row / round colour at that cell's position).
// `invert = true` paints the *opposite* of natural instead — used by the
// eraser tool's secondary action to deliberately wrong out cells. Each
// orbit cell uses its OWN natural colour, not the click point's, so
// mirrored writes don't smear the click row across the whole orbit.

pub fn paint_natural_row(
    pixels: &[u8], width: i32, height: i32,
    x: i32, y: i32, mask: u8, invert: bool,
) -> Vec<u8> {
    let mut result = pixels.to_vec();
    for (sx, sy) in symmetric_orbit(x, y, width, height, mask) {
        let idx = (sy * width + sx) as usize;
        if result[idx] == COLOR_TRANSPARENT { continue; }
        let nat = natural_color_row(height, sy);
        result[idx] = if invert { opposite_color(nat) } else { nat };
    }
    result
}

pub fn paint_natural_round(
    pixels: &[u8],
    canvas_width: i32, canvas_height: i32,
    virtual_width: i32, virtual_height: i32,
    offset_x: i32, offset_y: i32, rounds: i32,
    x: i32, y: i32, mask: u8, invert: bool,
) -> Vec<u8> {
    let virtual_size = IVec2::new(virtual_width, virtual_height);
    let offset       = IVec2::new(offset_x,      offset_y);
    let mut result   = pixels.to_vec();
    for (sx, sy) in symmetric_orbit(x, y, canvas_width, canvas_height, mask) {
        let idx = (sy * canvas_width + sx) as usize;
        if result[idx] == COLOR_TRANSPARENT { continue; }
        let nat = natural_color_round(virtual_size, offset, rounds, IVec2::new(sx, sy));
        result[idx] = if invert { opposite_color(nat) } else { nat };
    }
    result
}

pub fn paint_overlay_row(pixels: &[u8], width: i32, height: i32, x: i32, y: i32, mask: u8) -> Vec<u8> {
    let canvas_size = IVec2::new(width, height);
    if x < 0 || x >= width || y < 0 || y >= height { return pixels.to_vec(); }
    let mut result = pixels.to_vec();
    for (sx, sy) in symmetric_orbit(x, y, width, height, mask) {
        let Some(inner) = inward_cell_row(canvas_size, IVec2::new(sx, sy)) else { continue };
        let ti = (inner.y * width + inner.x) as usize;
        if result[ti] == COLOR_TRANSPARENT { continue; }
        result[ti] = opposite_color(natural_color_row(height, inner.y));
    }
    result
}

pub fn clear_overlay_row(pixels: &[u8], width: i32, height: i32, x: i32, y: i32, mask: u8) -> Vec<u8> {
    let canvas_size = IVec2::new(width, height);
    let in_canvas   = x >= 0 && x < width && y >= 0 && y < height;
    let mut result  = pixels.to_vec();

    if in_canvas {
        for (sx, sy) in symmetric_orbit(x, y, width, height, mask) {
            let Some(inner) = inward_cell_row(canvas_size, IVec2::new(sx, sy)) else { continue };
            let ti = (inner.y * width + inner.x) as usize;
            if result[ti] == COLOR_TRANSPARENT { continue; }
            result[ti] = natural_color_row(height, inner.y);
        }
    } else {
        let Some(inner) = inward_cell_row(canvas_size, IVec2::new(x, y)) else { return result };
        for (sx, sy) in symmetric_orbit(inner.x, inner.y, width, height, mask) {
            let idx = (sy * width + sx) as usize;
            if result[idx] == COLOR_TRANSPARENT { continue; }
            result[idx] = natural_color_row(height, sy);
        }
    }
    result
}

pub fn paint_overlay_round(
    pixels: &[u8],
    canvas_width: i32, canvas_height: i32,
    virtual_width: i32, virtual_height: i32,
    offset_x: i32, offset_y: i32, rounds: i32,
    x: i32, y: i32, mask: u8,
) -> Vec<u8> {
    let canvas_size  = IVec2::new(canvas_width,  canvas_height);
    let virtual_size = IVec2::new(virtual_width, virtual_height);
    let offset       = IVec2::new(offset_x,      offset_y);
    if x < 0 || x >= canvas_width || y < 0 || y >= canvas_height { return pixels.to_vec(); }
    let mut result = pixels.to_vec();
    for (sx, sy) in symmetric_orbit(x, y, canvas_width, canvas_height, mask) {
        let Some(inner) = inward_cell_round(canvas_size, virtual_size, offset, IVec2::new(sx, sy)) else { continue };
        let ti = (inner.y * canvas_width + inner.x) as usize;
        if result[ti] == COLOR_TRANSPARENT { continue; }
        result[ti] = opposite_color(natural_color_round(virtual_size, offset, rounds, inner));
    }
    result
}

pub fn clear_overlay_round(
    pixels: &[u8],
    canvas_width: i32, canvas_height: i32,
    virtual_width: i32, virtual_height: i32,
    offset_x: i32, offset_y: i32, rounds: i32,
    x: i32, y: i32, mask: u8,
) -> Vec<u8> {
    let canvas_size  = IVec2::new(canvas_width,  canvas_height);
    let virtual_size = IVec2::new(virtual_width, virtual_height);
    let offset       = IVec2::new(offset_x,      offset_y);
    let in_canvas    = x >= 0 && x < canvas_width && y >= 0 && y < canvas_height;
    let mut result   = pixels.to_vec();

    if in_canvas {
        for (sx, sy) in symmetric_orbit(x, y, canvas_width, canvas_height, mask) {
            let Some(inner) = inward_cell_round(canvas_size, virtual_size, offset, IVec2::new(sx, sy)) else { continue };
            let ti = (inner.y * canvas_width + inner.x) as usize;
            if result[ti] == COLOR_TRANSPARENT { continue; }
            result[ti] = natural_color_round(virtual_size, offset, rounds, inner);
        }
    } else {
        let Some(inner) = inward_cell_round(canvas_size, virtual_size, offset, IVec2::new(x, y)) else { return result };
        for (sx, sy) in symmetric_orbit(inner.x, inner.y, canvas_width, canvas_height, mask) {
            let idx = (sy * canvas_width + sx) as usize;
            if result[idx] == COLOR_TRANSPARENT { continue; }
            result[idx] = natural_color_round(virtual_size, offset, rounds, IVec2::new(sx, sy));
        }
    }
    result
}

// Lock-invalid post-filter. After a tool runs, revert any always-invalid
// cell (top row in row mode; outermost ring or diagonal corner in round
// mode) that the tool moved away from its natural colour — but ONLY if the
// cell was already correct before the tool ran. Wrong-coloured cells can
// still be repainted (so the user can fix them), and writes that happened
// to leave the cell at its natural colour are passed through.
pub fn lock_invalid_row(before: &[u8], after: &[u8], width: i32, height: i32) -> Vec<u8> {
    let mut result = after.to_vec();
    for y in 0..height {
        if !is_always_invalid_row(IVec2::new(0, y)) { continue; }
        for x in 0..width {
            let i   = (y * width + x) as usize;
            let nat = natural_color_row(height, y);
            if before[i] == nat && result[i] != nat { result[i] = before[i]; }
        }
    }
    result
}

pub fn lock_invalid_round(
    before: &[u8], after: &[u8],
    canvas_width: i32, canvas_height: i32,
    virtual_width: i32, virtual_height: i32,
    offset_x: i32, offset_y: i32, rounds: i32,
) -> Vec<u8> {
    let canvas_size  = IVec2::new(canvas_width,  canvas_height);
    let virtual_size = IVec2::new(virtual_width, virtual_height);
    let offset       = IVec2::new(offset_x,      offset_y);
    let mut result   = after.to_vec();
    for y in 0..canvas_size.y {
        for x in 0..canvas_size.x {
            let coord = IVec2::new(x, y);
            if !is_always_invalid_round(virtual_size, offset, rounds, coord) { continue; }
            let i   = (y * canvas_width + x) as usize;
            let nat = natural_color_round(virtual_size, offset, rounds, coord);
            if before[i] == nat && result[i] != nat { result[i] = before[i]; }
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

// ─────────────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::{COLOR_A, COLOR_B, get_color_index, get_round_from_edge};

    fn v(x: i32, y: i32) -> IVec2 { IVec2::new(x, y) }

    /// Natural alternating row grid of width × height.
    fn row_grid(w: i32, h: i32) -> Vec<u8> {
        let mut g = vec![0u8; (w * h) as usize];
        for y in 0..h { for x in 0..w {
            g[(y * w + x) as usize] = get_color_index(h - 1 - y);
        }}
        g
    }

    /// Natural round grid (with hole cleared) for the given geometry.
    fn round_grid(w: i32, h: i32, vw: i32, vh: i32, ox: i32, oy: i32, rounds: i32) -> Vec<u8> {
        let mut g = vec![0u8; (w * h) as usize];
        for y in 0..h { for x in 0..w {
            let rfe = get_round_from_edge(v(vw, vh), v(x + ox, y + oy));
            g[(y * w + x) as usize] = if rfe >= rounds {
                COLOR_TRANSPARENT
            } else {
                get_color_index(rounds - 1 - rfe)
            };
        }}
        g
    }

    // ── paint_natural_row ────────────────────────────────────────────────────

    #[test]
    fn paint_natural_row_restores_wrong_cell() {
        let mut pixels = row_grid(4, 4);
        pixels[1 * 4 + 2] = opposite_color(natural_color_row(4, 1)); // wrong it
        let out = paint_natural_row(&pixels, 4, 4, 2, 1, 0, false);
        assert_eq!(out[1 * 4 + 2], natural_color_row(4, 1));
    }

    #[test]
    fn paint_natural_row_invert_wrongs_correct_cell() {
        let pixels = row_grid(4, 4);
        let out = paint_natural_row(&pixels, 4, 4, 2, 1, 0, true);
        assert_eq!(out[1 * 4 + 2], opposite_color(natural_color_row(4, 1)));
    }

    #[test]
    fn paint_natural_row_uses_per_orbit_natural() {
        // Regression target: the old erase tool used the CLICK's natural
        // colour for every orbit cell, smearing the click row's value
        // across the whole orbit. With H-mirror (mask=2), click (2, 1)
        // mirrors to (2, 2) — a different row, different natural. Both
        // cells should restore to *their own* row's natural.
        let mut pixels = row_grid(4, 4);
        pixels[1 * 4 + 2] = opposite_color(natural_color_row(4, 1));
        pixels[2 * 4 + 2] = opposite_color(natural_color_row(4, 2));
        let out = paint_natural_row(&pixels, 4, 4, 2, 1, 2, false);
        assert_eq!(out[1 * 4 + 2], natural_color_row(4, 1));
        assert_eq!(out[2 * 4 + 2], natural_color_row(4, 2));
    }

    // ── paint_natural_round ──────────────────────────────────────────────────

    #[test]
    fn paint_natural_round_restores_and_skips_hole() {
        // 9×9 r=3 full. (1,4) is ring rfe=1 (natural=B). Wrong it to A.
        // (4,4) is in the inner hole (rfe=4 ≥ rounds=3) → transparent. Make
        // sure paint_natural doesn't touch it.
        let mut pixels = round_grid(9, 9, 9, 9, 0, 0, 3);
        pixels[4 * 9 + 1] = COLOR_A;
        // hole cell should already be 0; verify passthrough.
        assert_eq!(pixels[4 * 9 + 4], COLOR_TRANSPARENT);
        let out = paint_natural_round(&pixels, 9, 9, 9, 9, 0, 0, 3, 1, 4, 0, false);
        assert_eq!(out[4 * 9 + 1], COLOR_B);
        assert_eq!(out[4 * 9 + 4], COLOR_TRANSPARENT);
    }

    #[test]
    fn paint_natural_round_invert_mode() {
        let pixels = round_grid(9, 9, 9, 9, 0, 0, 3);
        // (1,4) natural is B; invert paints A.
        let out = paint_natural_round(&pixels, 9, 9, 9, 9, 0, 0, 3, 1, 4, 0, true);
        assert_eq!(out[4 * 9 + 1], COLOR_A);
    }

    // ── paint_overlay_row ────────────────────────────────────────────────────

    #[test]
    fn paint_overlay_row_inverts_inward_neighbour() {
        // Click at (2, 1) → inward (2, 2) is painted opposite-of-natural.
        let pixels = row_grid(4, 4);
        let out = paint_overlay_row(&pixels, 4, 4, 2, 1, 0);
        assert_eq!(out[2 * 4 + 2], opposite_color(natural_color_row(4, 2)));
        // Click cell itself unchanged.
        assert_eq!(out[1 * 4 + 2], pixels[1 * 4 + 2]);
    }

    #[test]
    fn paint_overlay_row_innermost_click_is_noop() {
        // Click at the foundation row (y=H-1) has no inward (y+1 ≥ H).
        let pixels = row_grid(4, 4);
        let out = paint_overlay_row(&pixels, 4, 4, 2, 3, 0);
        assert_eq!(out, pixels);
    }

    #[test]
    fn paint_overlay_row_gutter_click_is_noop() {
        // Gutter click (y < 0): paint mode can't operate, no-op.
        let pixels = row_grid(4, 4);
        let out = paint_overlay_row(&pixels, 4, 4, 2, -1, 0);
        assert_eq!(out, pixels);
    }

    // ── paint_overlay_round ──────────────────────────────────────────────────

    #[test]
    fn paint_overlay_round_corner_click_is_noop() {
        // (1, 1) is a diagonal corner — no single inward axis. inward_cell
        // returns None → paint_overlay is a no-op there.
        let pixels = round_grid(9, 9, 9, 9, 0, 0, 3);
        let out = paint_overlay_round(&pixels, 9, 9, 9, 9, 0, 0, 3, 1, 1, 0);
        assert_eq!(out, pixels);
    }

    #[test]
    fn paint_overlay_round_non_corner_click_paints_inward() {
        // (1, 4): rfe=1, non-corner. Inward is (2, 4) (step toward centre).
        // Paint should make (2, 4) opposite-of-natural.
        let pixels = round_grid(9, 9, 9, 9, 0, 0, 3);
        let out = paint_overlay_round(&pixels, 9, 9, 9, 9, 0, 0, 3, 1, 4, 0);
        let nat_24 = natural_color_round(v(9, 9), v(0, 0), 3, v(2, 4));
        assert_eq!(out[4 * 9 + 2], opposite_color(nat_24));
    }

    // ── clear_overlay_row ────────────────────────────────────────────────────

    #[test]
    fn clear_overlay_row_in_canvas_restores_inward() {
        // Pre-paint inward (2, 2) wrong; clear at click (2, 1) restores it.
        let mut pixels = row_grid(4, 4);
        pixels[2 * 4 + 2] = opposite_color(natural_color_row(4, 2));
        let out = clear_overlay_row(&pixels, 4, 4, 2, 1, 0);
        assert_eq!(out[2 * 4 + 2], natural_color_row(4, 2));
    }

    #[test]
    fn clear_overlay_row_gutter_restores_boundary_cells_orbit() {
        // Gutter click at (2, -1): inner is (2, 0), the boundary cell. Its
        // orbit (no symmetry → just itself) should be restored to natural.
        let mut pixels = row_grid(4, 4);
        pixels[0 * 4 + 2] = opposite_color(natural_color_row(4, 0));
        let out = clear_overlay_row(&pixels, 4, 4, 2, -1, 0);
        assert_eq!(out[0 * 4 + 2], natural_color_row(4, 0));
    }

    // ── clear_overlay_round ─────────────────────────────────────────────────

    #[test]
    fn clear_overlay_round_in_canvas_restores_inward_of_orbit() {
        // (1, 4) inward is (2, 4). Wrong (2, 4); clear-click at (1, 4) restores.
        let mut pixels = round_grid(9, 9, 9, 9, 0, 0, 3);
        let nat_24 = natural_color_round(v(9, 9), v(0, 0), 3, v(2, 4));
        pixels[4 * 9 + 2] = opposite_color(nat_24);
        let out = clear_overlay_round(&pixels, 9, 9, 9, 9, 0, 0, 3, 1, 4, 0);
        assert_eq!(out[4 * 9 + 2], nat_24);
    }

    // ── lock_invalid_row ─────────────────────────────────────────────────────

    #[test]
    fn lock_invalid_row_reverts_top_row_write() {
        // before: top row natural; after: top row wronged. Lock should revert.
        let before = row_grid(4, 4);
        let mut after = before.clone();
        after[0 * 4 + 2] = opposite_color(natural_color_row(4, 0));
        let out = lock_invalid_row(&before, &after, 4, 4);
        assert_eq!(out[0 * 4 + 2], before[0 * 4 + 2]);
    }

    #[test]
    fn lock_invalid_row_passes_through_mid_row_writes() {
        // Writes to y=1 (not always-invalid) should be left alone.
        let before = row_grid(4, 4);
        let mut after = before.clone();
        after[1 * 4 + 2] = opposite_color(natural_color_row(4, 1));
        let out = lock_invalid_row(&before, &after, 4, 4);
        assert_eq!(out[1 * 4 + 2], after[1 * 4 + 2]);
    }

    #[test]
    fn lock_invalid_row_allows_fixing_already_wrong_cell() {
        // before: top row already wrong; after: top row corrected. Lock
        // should NOT revert (the user is fixing it).
        let mut before = row_grid(4, 4);
        before[0 * 4 + 2] = opposite_color(natural_color_row(4, 0));
        let after = row_grid(4, 4); // back to natural
        let out = lock_invalid_row(&before, &after, 4, 4);
        assert_eq!(out[0 * 4 + 2], natural_color_row(4, 0));
    }

    // ── lock_invalid_round ──────────────────────────────────────────────────

    #[test]
    fn lock_invalid_round_reverts_corner_and_outermost_writes() {
        // 9×9 r=3 full. Corner (1, 1) and outermost (4, 0) are both
        // always-invalid. Both wrongs should get reverted.
        let before = round_grid(9, 9, 9, 9, 0, 0, 3);
        let mut after = before.clone();
        after[1 * 9 + 1] = opposite_color(before[1 * 9 + 1]); // corner
        after[0 * 9 + 4] = opposite_color(before[0 * 9 + 4]); // outermost
        let out = lock_invalid_round(&before, &after, 9, 9, 9, 9, 0, 0, 3);
        assert_eq!(out[1 * 9 + 1], before[1 * 9 + 1]);
        assert_eq!(out[0 * 9 + 4], before[0 * 9 + 4]);
    }

    #[test]
    fn lock_invalid_round_passes_through_inner_ring_writes() {
        // (1, 4) is non-corner mid-ring → not always-invalid; write should pass.
        let before = round_grid(9, 9, 9, 9, 0, 0, 3);
        let mut after = before.clone();
        after[4 * 9 + 1] = opposite_color(before[4 * 9 + 1]);
        let out = lock_invalid_round(&before, &after, 9, 9, 9, 9, 0, 0, 3);
        assert_eq!(out[4 * 9 + 1], after[4 * 9 + 1]);
    }

    #[test]
    fn lock_invalid_round_allows_fixing_already_wrong_corner() {
        let mut before = round_grid(9, 9, 9, 9, 0, 0, 3);
        before[1 * 9 + 1] = opposite_color(before[1 * 9 + 1]);
        let after = round_grid(9, 9, 9, 9, 0, 0, 3); // back to natural
        let out = lock_invalid_round(&before, &after, 9, 9, 9, 9, 0, 0, 3);
        assert_eq!(out[1 * 9 + 1], after[1 * 9 + 1]);
    }

}
