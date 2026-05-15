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

// Bottom-left anchored pixel preservation across a row-mode resize. Reads
// `old_pixels` (the previous canvas) and the freshly-natural `new_pixels`
// (the new canvas at its natural colours), blits painted cells from old onto
// new where they map. Row 1 (foundation) stays put vertically; column 0
// stays put horizontally. Adding rows grows upward, columns grow to the
// right; shrinking truncates from the same far edges. Holes are skipped on
// both sides — `new_pixels` already encodes its hole layout.
pub fn transfer_preserved_row(
    old_pixels: &[u8], old_width: i32, old_height: i32,
    new_pixels: &[u8], new_width: i32, new_height: i32,
) -> Vec<u8> {
    let mut result = new_pixels.to_vec();
    let dy = old_height - new_height;
    for new_py in 0..new_height {
        let old_py = new_py + dy;
        if old_py < 0 || old_py >= old_height { continue; }
        for new_px in 0..new_width {
            if new_px >= old_width { continue; }
            let v = old_pixels[(old_py * old_width + new_px) as usize];
            if v == COLOR_TRANSPARENT { continue; }
            let new_idx = (new_py * new_width + new_px) as usize;
            if result[new_idx] == COLOR_TRANSPARENT { continue; }
            result[new_idx] = v;
        }
    }
    result
}

// Bottom-left anchored pixel preservation across a round-mode resize. The
// pattern is partitioned in virtual coords into 4 corner blocks (each
// `rounds × rounds`, one per canvas corner) and 4 straight strips between
// them. Each region transfers independently:
//   • TL / TR / BL / BR corner blocks anchor to their own canvas corner.
//   • TOP / BOTTOM strips: vertically anchor to top/bottom respectively;
//     horizontally left-anchored within the strip.
//   • LEFT / RIGHT strips: horizontally anchor to left/right respectively;
//     vertically bottom-anchored within the strip (so detail near the
//     foundation stays put when inner height changes).
// When `rounds` also changes by Δr, every cell gets an additional inward
// shift of Δr (old ring N stays ring N, new outermost ring is freshly
// natural). The two shifts compose. Inner-hole cells are skipped. Strip
// cells whose middle-axis lands outside the new strip range (which would
// collide with the adjacent corner block) are dropped — that's where
// shrinking takes its losses, always from the side opposite the anchor.
pub fn transfer_preserved_round(
    old_pixels: &[u8],
    old_canvas_width: i32, old_canvas_height: i32,
    old_virtual_width: i32, old_virtual_height: i32,
    old_offset_x: i32, old_offset_y: i32, old_rounds: i32,
    new_pixels: &[u8],
    new_canvas_width: i32, new_canvas_height: i32,
    new_virtual_width: i32, new_virtual_height: i32,
    new_offset_x: i32, new_offset_y: i32, new_rounds: i32,
) -> Vec<u8> {
    let mut result = new_pixels.to_vec();
    let d_vw = new_virtual_width  - old_virtual_width;
    let d_vh = new_virtual_height - old_virtual_height;
    let d_r  = new_rounds          - old_rounds;

    for old_py in 0..old_canvas_height {
        let old_vy = old_py + old_offset_y;
        let on_top = old_vy < old_rounds;
        let on_bot = old_vy >= old_virtual_height - old_rounds;
        for old_px in 0..old_canvas_width {
            let old_vx  = old_px + old_offset_x;
            let on_left  = old_vx < old_rounds;
            let on_right = old_vx >= old_virtual_width - old_rounds;

            // Inner-hole cells (not in any corner or strip): skipped.
            if !on_top && !on_bot && !on_left && !on_right { continue; }

            // x: left-anchored. y: TOP-corner cells stay near the top (+Δr),
            // everything else (BOTTOM-corner OR LEFT/RIGHT strip) anchors to
            // the bottom (+ΔVH − Δr).
            let new_vx = if on_right { old_vx + d_vw - d_r } else { old_vx + d_r };
            let new_vy = if on_top   { old_vy + d_r       } else { old_vy + d_vh - d_r };

            let is_h_strip = (on_top  || on_bot)   && !on_left && !on_right;
            if is_h_strip && (new_vx < new_rounds || new_vx > new_virtual_width  - 1 - new_rounds) { continue; }
            let is_v_strip = (on_left || on_right) && !on_top  && !on_bot;
            if is_v_strip && (new_vy < new_rounds || new_vy > new_virtual_height - 1 - new_rounds) { continue; }

            let new_px = new_vx - new_offset_x;
            let new_py = new_vy - new_offset_y;
            if new_px < 0 || new_px >= new_canvas_width  { continue; }
            if new_py < 0 || new_py >= new_canvas_height { continue; }

            let v = old_pixels[(old_py * old_canvas_width + old_px) as usize];
            if v == COLOR_TRANSPARENT { continue; }
            let new_idx = (new_py * new_canvas_width + new_px) as usize;
            if result[new_idx] == COLOR_TRANSPARENT { continue; }
            result[new_idx] = v;
        }
    }
    result
}

// `selection` is a per-cell bitmask (1 = in selection, 0 = not). Empty slice
// = no selection — walker runs across the whole connected region. When
// non-empty the walker treats unselected cells as boundaries: BFS never
// crosses out of the selection, so a same-colour path running through
// unselected cells doesn't leak the fill into another selection island.
// The symmetric-orbit fill at the end is unaffected; TS-side clip-after
// handles mirror cells that land outside the selection.
pub fn flood_fill(
    pixels: &[u8], width: i32, height: i32,
    start_x: i32, start_y: i32, fill_color: u8, mask: u8,
    selection: &[u8],
) -> Vec<u8> {
    let mut result       = pixels.to_vec();
    let     target_color = result[(start_y * width + start_x) as usize];
    if target_color == fill_color || target_color == 0 { return result; }
    let use_sel = !selection.is_empty();

    let mut visited: HashSet<i32>          = HashSet::new();
    let mut queue:   VecDeque<(i32, i32)>  = VecDeque::new();
    let mut filled:  Vec<(i32, i32)>       = Vec::new();

    queue.push_back((start_x, start_y));

    while let Some((x, y)) = queue.pop_front() {
        if x < 0 || x >= width || y < 0 || y >= height { continue; }
        let idx = y * width + x;
        if visited.contains(&idx) || result[idx as usize] != target_color { continue; }
        if use_sel && selection[idx as usize] == 0 { continue; }
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

// Magic-wand selection: flood-fill the connected same-colour region starting
// at (start_x, start_y), combined with an existing selection per `mode`.
//   mode 0 = replace  — new selection is just the wand region.
//   mode 1 = add      — existing ∪ wand region.
//   mode 2 = remove   — existing ∖ wand region.
// Hole click is a no-op (returns existing or empty for replace). The walker
// uses 4-neighbour connectivity and stops at colour boundaries (no
// tolerance — pixel values are discrete A / B / hole). Returns the new
// selection bitset (1 byte per cell, 1 = selected).
pub fn wand_select(
    pixels: &[u8], width: i32, height: i32,
    start_x: i32, start_y: i32,
    mode: u8, existing: &[u8],
) -> Vec<u8> {
    let n = (width * height) as usize;
    let mut result: Vec<u8> = if mode == 0 {
        vec![0u8; n]                     // replace: start empty
    } else if existing.is_empty() {
        vec![0u8; n]                     // add / remove with no existing → empty start
    } else {
        existing.to_vec()                // add / remove: copy existing
    };

    // Hole or out-of-bounds click: nothing to flood — return the start state.
    if start_x < 0 || start_x >= width || start_y < 0 || start_y >= height { return result; }
    let start_idx = (start_y * width + start_x) as usize;
    let target_color = pixels[start_idx];
    if target_color == COLOR_TRANSPARENT { return result; }

    let mut visited: HashSet<i32>         = HashSet::new();
    let mut queue:   VecDeque<(i32, i32)> = VecDeque::new();
    queue.push_back((start_x, start_y));

    while let Some((x, y)) = queue.pop_front() {
        if x < 0 || x >= width || y < 0 || y >= height { continue; }
        let idx = y * width + x;
        if visited.contains(&idx) || pixels[idx as usize] != target_color { continue; }
        visited.insert(idx);
        result[idx as usize] = if mode == 2 { 0 } else { 1 };
        queue.push_back((x + 1, y));
        queue.push_back((x - 1, y));
        queue.push_back((x,     y + 1));
        queue.push_back((x,     y - 1));
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

    // ── transfer_preserved_row (BL-anchored) ─────────────────────────────────

    /// Mark cell `(x, y)` in a row grid with `marker` (used for tests; pick
    /// markers distinct from `COLOR_A`/`COLOR_B` so the assertion is loud
    /// even if the test reads from the wrong index).
    fn put(grid: &mut [u8], w: i32, x: i32, y: i32, marker: u8) {
        grid[(y * w + x) as usize] = marker;
    }
    fn get(grid: &[u8], w: i32, x: i32, y: i32) -> u8 {
        grid[(y * w + x) as usize]
    }

    #[test]
    fn transfer_row_widening_preserves_left_columns_at_same_x() {
        // Old 4×4, new 6×4 (widen). Mark old (0, 3) = foundation-left and
        // old (3, 0) = top-right. After widening, foundation-left stays at
        // new (0, 3); old top-right (vx=3 at old top) stays at new (3, 0).
        // The new right columns (vx=4, 5) and top row added cells appear
        // freshly natural.
        let mut old_g = row_grid(4, 4);
        put(&mut old_g, 4, 0, 3, COLOR_A);  // foundation-left (vx=0 row 3 → already A, just mark explicitly)
        put(&mut old_g, 4, 3, 0, COLOR_A);  // top-right cell
        let new_g = row_grid(6, 4);
        let out = transfer_preserved_row(&old_g, 4, 4, &new_g, 6, 4);
        assert_eq!(get(&out, 6, 0, 3), COLOR_A);
        assert_eq!(get(&out, 6, 3, 0), COLOR_A);
        // New right cells should still hold their natural value.
        assert_eq!(get(&out, 6, 5, 0), natural_color_row(4, 0));
    }

    #[test]
    fn transfer_row_heightening_grows_upward() {
        // Old 4×4, new 4×6 (heighten by 2). Foundation row (old vy=3) stays
        // at new vy=5. Old top row (vy=0) moves to new vy=2 (rows added at
        // the TOP).
        let mut old_g = row_grid(4, 4);
        put(&mut old_g, 4, 2, 0, COLOR_A);  // old top
        put(&mut old_g, 4, 1, 3, COLOR_B);  // old foundation
        let new_g = row_grid(4, 6);
        let out = transfer_preserved_row(&old_g, 4, 4, &new_g, 4, 6);
        assert_eq!(get(&out, 4, 2, 2), COLOR_A);  // old top → new vy=2
        assert_eq!(get(&out, 4, 1, 5), COLOR_B);  // old foundation → new vy=5
    }

    #[test]
    fn transfer_row_shrinking_truncates_top_and_right() {
        // Old 6×6, new 4×4 (shrink). Foundation-left stays. Cells at the
        // right side or top of old that fall outside new are lost.
        let mut old_g = row_grid(6, 6);
        put(&mut old_g, 6, 0, 5, COLOR_A);  // foundation-left → keeps
        put(&mut old_g, 6, 5, 5, COLOR_A);  // foundation-far-right → truncated (vx=5 >= new W=4)
        put(&mut old_g, 6, 0, 0, COLOR_A);  // top-left → truncated (vy=0 → new vy=-2)
        let new_g = row_grid(4, 4);
        let out = transfer_preserved_row(&old_g, 6, 6, &new_g, 4, 4);
        assert_eq!(get(&out, 4, 0, 3), COLOR_A);                    // foundation-left preserved
        // Right cell at vx=5 is outside the new canvas; new (3, 3) holds natural.
        assert_eq!(get(&out, 4, 3, 3), natural_color_row(4, 3));
    }

    // ── transfer_preserved_round (BL-anchored, corner/strip partition) ──────

    /// Round-grid with paint markers at specified virtual coords. Returns
    /// `(canvas grid, virtual_size, offset, rounds)` for assertions.
    fn round_grid_marked(
        cw: i32, ch: i32, vw: i32, vh: i32, ox: i32, oy: i32, rounds: i32,
        marks: &[(i32, i32, u8)],  // (vx, vy, marker)
    ) -> Vec<u8> {
        let mut g = round_grid(cw, ch, vw, vh, ox, oy, rounds);
        for &(vx, vy, marker) in marks {
            let px = vx - ox; let py = vy - oy;
            if px >= 0 && px < cw && py >= 0 && py < ch {
                g[(py * cw + px) as usize] = marker;
            }
        }
        g
    }

    #[test]
    fn transfer_round_inner_widen_corners_anchor_to_canvas_corners() {
        // 8×8 (inner 4, r=2) → 10×8 (inner 6, r=2). Mark all four canvas
        // corners; after the transfer they should sit at the new canvas
        // corners. Specifically the BL corner stays at canvas BL.
        let old = round_grid_marked(8, 8, 8, 8, 0, 0, 2,
            &[(0, 0, COLOR_A), (7, 0, COLOR_A), (0, 7, COLOR_A), (7, 7, COLOR_A)]);
        let new_init = round_grid(10, 8, 10, 8, 0, 0, 2);
        let out = transfer_preserved_round(
            &old, 8, 8, 8, 8, 0, 0, 2,
            &new_init, 10, 8, 10, 8, 0, 0, 2,
        );
        assert_eq!(get(&out, 10, 0, 0), COLOR_A);  // TL canvas corner
        assert_eq!(get(&out, 10, 9, 0), COLOR_A);  // TR canvas corner
        assert_eq!(get(&out, 10, 0, 7), COLOR_A);  // BL canvas corner
        assert_eq!(get(&out, 10, 9, 7), COLOR_A);  // BR canvas corner
    }

    #[test]
    fn transfer_round_top_strip_is_left_anchored() {
        // Inner-width widen 4→6 (8×8 → 10×8). Mark old TOP-strip cell at
        // vx=2 (leftmost strip cell, just past TL corner). After widening,
        // it should stay at vx=2 (left-anchored). The new strip cells at
        // vx=6, 7 (between old strip end and new TR corner) should be
        // freshly natural.
        let old = round_grid_marked(8, 8, 8, 8, 0, 0, 2, &[(2, 0, COLOR_A)]);
        let new_init = round_grid(10, 8, 10, 8, 0, 0, 2);
        let out = transfer_preserved_round(
            &old, 8, 8, 8, 8, 0, 0, 2,
            &new_init, 10, 8, 10, 8, 0, 0, 2,
        );
        assert_eq!(get(&out, 10, 2, 0), COLOR_A);
        // New TOP strip cells in the middle should hold natural colour.
        assert_eq!(get(&out, 10, 6, 0), natural_color_round(v(10, 8), v(0, 0), 2, v(6, 0)));
    }

    #[test]
    fn transfer_round_left_strip_is_bottom_anchored() {
        // Inner-height heighten 4→6 (8×8 → 8×10). Mark old LEFT-strip cell
        // at vy=5 (bottommost strip cell, just above BL corner). After
        // heightening, it should be bottom-anchored: it moves to new vy=7
        // (preserving distance to BL = 2). The top of the new LEFT strip
        // (vy=2, 3) gets freshly natural cells.
        let old = round_grid_marked(8, 8, 8, 8, 0, 0, 2, &[(0, 5, COLOR_A)]);
        let new_init = round_grid(8, 10, 8, 10, 0, 0, 2);
        let out = transfer_preserved_round(
            &old, 8, 8, 8, 8, 0, 0, 2,
            &new_init, 8, 10, 8, 10, 0, 0, 2,
        );
        assert_eq!(get(&out, 8, 0, 7), COLOR_A);  // moved down by ΔVH=2
        // New cell at top of LEFT strip should still be natural.
        assert_eq!(get(&out, 8, 0, 2), natural_color_round(v(8, 10), v(0, 0), 2, v(0, 2)));
    }

    #[test]
    fn transfer_round_shrink_horizontal_strip_drops_right_end() {
        // Inner-width shrink 6→4 (10×8 → 8×8). Mark old TOP-strip cells:
        // - vx=2 (left end) — preserved.
        // - vx=7 (right end) — would map to new vx=7, but new TOP strip
        //   only spans [2, 5]; cell is dropped to avoid colliding with new
        //   TR corner.
        let old = round_grid_marked(10, 8, 10, 8, 0, 0, 2, &[(2, 0, COLOR_A), (7, 0, COLOR_A)]);
        let new_init = round_grid(8, 8, 8, 8, 0, 0, 2);
        let out = transfer_preserved_round(
            &old, 10, 8, 10, 8, 0, 0, 2,
            &new_init, 8, 8, 8, 8, 0, 0, 2,
        );
        assert_eq!(get(&out, 8, 2, 0), COLOR_A);  // left end preserved
        // Right end was dropped; new (5, 0) is filled by old TR corner cell,
        // which we didn't mark — should be natural.
        let nat_50 = natural_color_round(v(8, 8), v(0, 0), 2, v(5, 0));
        assert_eq!(get(&out, 8, 5, 0), nat_50);
    }

    #[test]
    fn transfer_round_rounds_increase_shifts_existing_rings_inward() {
        // rounds 2→3, inner unchanged. Old outermost-TL corner (0, 0) was
        // ring 2 in old; it should stay ring 2 (= rfe=1) in new at TL,
        // i.e. new (1, 1). The new outermost ring (rfe=0) cells around the
        // edge get freshly natural.
        let old = round_grid_marked(8, 8, 8, 8, 0, 0, 2, &[(0, 0, COLOR_A)]);
        let new_init = round_grid(10, 10, 10, 10, 0, 0, 3);
        let out = transfer_preserved_round(
            &old, 8, 8, 8, 8, 0, 0, 2,
            &new_init, 10, 10, 10, 10, 0, 0, 3,
        );
        assert_eq!(get(&out, 10, 1, 1), COLOR_A);
        // New outermost-TL cell (0, 0) should be natural.
        assert_eq!(get(&out, 10, 0, 0), natural_color_round(v(10, 10), v(0, 0), 3, v(0, 0)));
    }

    #[test]
    fn transfer_round_rounds_decrease_drops_outermost_ring() {
        // rounds 3→2, inner unchanged (10×10 → 8×8). Old outermost (0, 0)
        // ring 3 should be dropped (new pattern has no ring 3). Old ring 2
        // (e.g. old (1, 1)) should become new ring 2 = new outermost at TL,
        // i.e. new (0, 0).
        let old = round_grid_marked(10, 10, 10, 10, 0, 0, 3,
            &[(0, 0, COLOR_A), (1, 1, COLOR_B)]);
        let new_init = round_grid(8, 8, 8, 8, 0, 0, 2);
        let out = transfer_preserved_round(
            &old, 10, 10, 10, 10, 0, 0, 3,
            &new_init, 8, 8, 8, 8, 0, 0, 2,
        );
        // Old ring 2 corner → new outermost-TL.
        assert_eq!(get(&out, 8, 0, 0), COLOR_B);
    }

    #[test]
    fn transfer_round_half_submode_preserves_pixels() {
        // Half-mode: offsetY = rounds. Inner-width widen 4→6.
        // Old: canvas 8×6, virtual 8×8, offset (0, 2), rounds 2.
        // New: canvas 10×6, virtual 10×8, offset (0, 2), rounds 2.
        // Mark old TL canvas corner (canvas (0, 0) = virtual (0, 2)).
        // After widening, it should remain at new (0, 0).
        let old = round_grid_marked(8, 6, 8, 8, 0, 2, 2, &[(0, 2, COLOR_A)]);
        let new_init = round_grid(10, 6, 10, 8, 0, 2, 2);
        let out = transfer_preserved_round(
            &old, 8, 6, 8, 8, 0, 2, 2,
            &new_init, 10, 6, 10, 8, 0, 2, 2,
        );
        assert_eq!(get(&out, 10, 0, 0), COLOR_A);
    }

    #[test]
    fn transfer_round_combined_inner_and_rounds_change() {
        // Both inner and rounds change: rounds 2→3, inner 4→6.
        // 8×8 → 12×12. Old TL corner cell (0, 0) was ring 2; in new it
        // should be ring 2 = rfe=1 at TL → new (1, 1). Old TR canvas corner
        // (7, 0) was ring 2; in new it should be ring 2 at TR → rfe=1, i.e.
        // new (newVW-2, 1) = (10, 1).
        let old = round_grid_marked(8, 8, 8, 8, 0, 0, 2,
            &[(0, 0, COLOR_A), (7, 0, COLOR_B)]);
        let new_init = round_grid(12, 12, 12, 12, 0, 0, 3);
        let out = transfer_preserved_round(
            &old, 8, 8, 8, 8, 0, 0, 2,
            &new_init, 12, 12, 12, 12, 0, 0, 3,
        );
        assert_eq!(get(&out, 12, 1, 1), COLOR_A);
        assert_eq!(get(&out, 12, 10, 1), COLOR_B);
    }

    #[test]
    fn transfer_round_skips_old_hole_cells() {
        // The old hole region (inner) is transparent. Even if we passed in
        // a buffer where those cells were COLOR_A (impossible in practice
        // but tests the guard), transfer should NOT overwrite the new hole
        // with that "value" — both sides skip transparent cells.
        let old = round_grid(9, 9, 9, 9, 0, 0, 3);
        let new_init = round_grid(9, 9, 9, 9, 0, 0, 3);
        let out = transfer_preserved_round(
            &old, 9, 9, 9, 9, 0, 0, 3,
            &new_init, 9, 9, 9, 9, 0, 0, 3,
        );
        // Inner-hole cell stays transparent.
        assert_eq!(get(&out, 9, 4, 4), COLOR_TRANSPARENT);
    }

    // ── flood_fill selection awareness ───────────────────────────────────────

    #[test]
    fn flood_fill_no_selection_fills_whole_connected_region() {
        // Empty selection slice = no selection clipping; behavior unchanged
        // from before the selection-aware refactor.
        let pixels = vec![COLOR_A; 5];
        let out = flood_fill(&pixels, 5, 1, 0, 0, COLOR_B, 0, &[]);
        assert_eq!(&out[..], &[COLOR_B, COLOR_B, COLOR_B, COLOR_B, COLOR_B]);
    }

    #[test]
    fn flood_fill_stops_at_unselected_cells() {
        // 5×1 grid all A. Selection covers cells 0–2; cells 3–4 unselected.
        // Fill from (0, 0) with B: walker should stop at the selection
        // boundary, leaving cells 3–4 at A.
        let pixels = vec![COLOR_A; 5];
        let selection: Vec<u8> = vec![1, 1, 1, 0, 0];
        let out = flood_fill(&pixels, 5, 1, 0, 0, COLOR_B, 0, &selection);
        assert_eq!(&out[..], &[COLOR_B, COLOR_B, COLOR_B, COLOR_A, COLOR_A]);
    }

    #[test]
    fn flood_fill_disconnected_selection_islands_isolated() {
        // 5×1 grid all A. Selection has two disconnected islands (cell 0 and
        // cell 4); cells 1–3 are unselected but match the target colour. A
        // naïve walker would cross through 1–3 and fill cell 4 too; the
        // selection-aware walker fills only the connected component
        // containing the click.
        let pixels = vec![COLOR_A; 5];
        let selection: Vec<u8> = vec![1, 0, 0, 0, 1];
        let out = flood_fill(&pixels, 5, 1, 0, 0, COLOR_B, 0, &selection);
        assert_eq!(&out[..], &[COLOR_B, COLOR_A, COLOR_A, COLOR_A, COLOR_A]);
    }

    // ── wand_select ──────────────────────────────────────────────────────────

    #[test]
    fn wand_replace_selects_connected_same_colour_region() {
        // 5×1 grid: A A B A A. Click at 0 → wand should select cells 0,1
        // (connected A region); cells 3,4 are A but disconnected from start.
        let pixels = vec![COLOR_A, COLOR_A, COLOR_B, COLOR_A, COLOR_A];
        let out = wand_select(&pixels, 5, 1, 0, 0, /*replace*/ 0, &[]);
        assert_eq!(&out[..], &[1, 1, 0, 0, 0]);
    }

    #[test]
    fn wand_replace_drops_existing_selection() {
        let pixels = vec![COLOR_A, COLOR_A, COLOR_B, COLOR_A, COLOR_A];
        let existing: Vec<u8> = vec![0, 0, 0, 1, 1];   // cells 3,4 selected
        let out = wand_select(&pixels, 5, 1, 0, 0, /*replace*/ 0, &existing);
        // Replace mode: existing 3,4 dropped, only the wand region remains.
        assert_eq!(&out[..], &[1, 1, 0, 0, 0]);
    }

    #[test]
    fn wand_add_unions_with_existing() {
        let pixels = vec![COLOR_A, COLOR_A, COLOR_B, COLOR_A, COLOR_A];
        let existing: Vec<u8> = vec![0, 0, 0, 1, 1];
        let out = wand_select(&pixels, 5, 1, 0, 0, /*add*/ 1, &existing);
        assert_eq!(&out[..], &[1, 1, 0, 1, 1]);
    }

    #[test]
    fn wand_remove_subtracts_region_from_existing() {
        let pixels = vec![COLOR_A, COLOR_A, COLOR_B, COLOR_A, COLOR_A];
        // Existing covers cells 0,1,3,4 (everything but the B). Click at 0
        // with remove mode: wand region {0,1} subtracted, leaves {3,4}.
        let existing: Vec<u8> = vec![1, 1, 0, 1, 1];
        let out = wand_select(&pixels, 5, 1, 0, 0, /*remove*/ 2, &existing);
        assert_eq!(&out[..], &[0, 0, 0, 1, 1]);
    }

    #[test]
    fn wand_hole_click_is_noop() {
        // 3×1 grid: A HOLE A. Click on the hole → no change, existing
        // selection returned untouched (for add / remove) or empty (replace).
        let pixels = vec![COLOR_A, COLOR_TRANSPARENT, COLOR_A];
        let existing: Vec<u8> = vec![1, 0, 1];
        let out_add     = wand_select(&pixels, 3, 1, 1, 0, /*add*/ 1, &existing);
        let out_replace = wand_select(&pixels, 3, 1, 1, 0, /*replace*/ 0, &existing);
        assert_eq!(&out_add[..],     &[1, 0, 1]);
        assert_eq!(&out_replace[..], &[0, 0, 0]);
    }
}
