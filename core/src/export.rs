//! One-row-at-a-time export pipeline.
//!
//! `export_row_at` / `export_round_at` each produce a single line of pattern
//! text per call, in four stages: virtual→physical coordinate mapping,
//! windowing, classification (`Sc` vs `Oc` from the highlights buffer),
//! grouping by parent (compound stitches). Stitches flow through as typed
//! `pattern::Stitch` and `SequenceItem` values; strings only appear at the
//! final emit.

use glam::IVec2;
use ndarray::Array2;
use crate::{common, pattern, walk};
use crate::pattern::{SequenceItem, Stitch};

fn stitch_from_highlight(highlights: &Array2<u8>, coord: IVec2) -> Stitch {
    if highlights[[coord.y as usize, coord.x as usize]] == common::HIGHLIGHT_VALID_OVERLAY {
        Stitch::Oc
    } else {
        Stitch::Sc
    }
}

pub fn export_row_at(
    highlights:  &Array2<u8>,
    canvas_size: IVec2,
    alternate:   bool,
    row_index:   usize,
) -> String {
    let mut flat: Vec<SequenceItem> = walk::row_walk_at(canvas_size, row_index)
        .map(|coord| SequenceItem::Stitch(stitch_from_highlight(highlights, coord)))
        .collect();
    if alternate && row_index % 2 == 1 { flat.reverse(); }
    let compressed = pattern::compress(&flat);
    format!("Row {}: {}", row_index + 1, pattern::to_string(&compressed))
}

pub fn export_round_at(
    highlights:   &Array2<u8>,
    canvas_size:  IVec2,
    virtual_size: IVec2,
    offset:       IVec2,
    rounds:       i32,
    alternate:    bool,
    round_index:  usize,
) -> String {
    let round = round_index as i32 + 1;

    let mut groups: Vec<Vec<Stitch>> = Vec::new();
    let mut current_group:  Vec<Stitch>    = Vec::new();
    let mut current_parent: Option<IVec2>  = None;

    for (virtual_coord, virtual_parent) in walk::round_walk_at(virtual_size, rounds, round) {
        let physical_coord  = virtual_coord  - offset;
        let physical_parent = virtual_parent - offset;
        if !walk::window(physical_coord, canvas_size) { continue; }

        let stitch = if walk::is_corner_coord(physical_coord, offset, virtual_size) {
            Stitch::Ch
        } else {
            stitch_from_highlight(highlights, physical_coord)
        };

        if Some(physical_parent) != current_parent {
            if !current_group.is_empty() { groups.push(std::mem::take(&mut current_group)); }
            current_parent = Some(physical_parent);
        }
        current_group.push(stitch);
    }
    if !current_group.is_empty() { groups.push(current_group); }

    let mut flat: Vec<SequenceItem> = groups.iter().map(|group| {
        if group.len() == 1 {
            SequenceItem::Stitch(group[0])
        } else {
            let inner: Vec<SequenceItem> = group.iter().map(|&s| SequenceItem::Stitch(s)).collect();
            SequenceItem::group(pattern::compress(&inner))
        }
    }).collect();

    if alternate && round_index % 2 == 1 { flat.reverse(); }
    let compressed = pattern::compress(&flat);
    format!("Round {}: {}", round_index + 1, pattern::to_string(&compressed))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(x: i32, y: i32) -> IVec2 { IVec2::new(x, y) }

    /// Natural (unmodified) pixel grid for a round pattern — no highlights set.
    fn no_highlights(w: i32, h: i32) -> Array2<u8> {
        Array2::zeros((h as usize, w as usize))
    }

    // ── Round export ─────────────────────────────────────────────────────────

    // innerW=1, innerH=1, rounds=2 → virtual 5×5, canvas 5×5, offset (0,0).
    // Round 1 (innermost, round_index=0): 8 stitches, all sharing the same
    // parent point (2,2) which lies inside the inner hole.
    //   Walk order: non-corner sc, corner ch, non-corner sc, corner ch, ...
    //   Pattern = [sc, ch] × 4 → wrapped as one group → ([sc, ch] × 4).
    #[test]
    fn round_1_inner_1x1_hole() {
        let hl = no_highlights(5, 5);
        let result = export_round_at(&hl, v(5,5), v(5,5), v(0,0), 2, false, 0);
        assert_eq!(result, "Round 1: ([sc, ch] × 4)");
    }

    // Zero inner hole (innerW=0, innerH=0, rounds=1) → virtual 2×2, canvas 2×2.
    // All 4 pixels are corners → (ch × 4).  Replace with 4 sc into a magic ring.
    #[test]
    fn round_1_zero_inner_hole() {
        let hl = no_highlights(2, 2);
        let result = export_round_at(&hl, v(2,2), v(2,2), v(0,0), 1, false, 0);
        assert_eq!(result, "Round 1: (ch × 4)");
    }
}
