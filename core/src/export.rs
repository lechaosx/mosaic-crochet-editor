//! One-row-at-a-time export pipeline.
//!
//! `export_row_at` / `export_round_at` each produce a single line of pattern
//! text per call. Geometry and classification first produce flat `WorkStep`
//! values; parent grouping and compression then produce `SequenceItem`
//! values. Strings only appear at the final emit.

use crate::pattern::{SequenceItem, Stitch};
use crate::{common, pattern, walk};
use glam::IVec2;
use ndarray::Array2;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WorkUnitId {
    Row(u32),
    Round(u32),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum YarnSlot {
    A,
    B,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WorkStep {
    pub unit: WorkUnitId,
    pub yarn: YarnSlot,
    pub worked_coord: IVec2,
    pub parent_coord: IVec2,
    pub kind: Stitch,
}

fn stitch_from_highlight(highlights: &Array2<u8>, coord: IVec2) -> Stitch {
    if highlights[[coord.y as usize, coord.x as usize]] == common::HIGHLIGHT_VALID_OVERLAY {
        Stitch::Oc
    } else {
        Stitch::Sc
    }
}

pub fn row_work_at(
    highlights: &Array2<u8>,
    canvas_size: IVec2,
    alternate: bool,
    row_index: usize,
) -> Vec<WorkStep> {
    let unit = WorkUnitId::Row(row_index as u32 + 1);
    let yarn = if row_index % 2 == 0 {
        YarnSlot::B
    } else {
        YarnSlot::A
    };
    let mut steps: Vec<WorkStep> = walk::row_walk_at(canvas_size, row_index)
        .map(|worked_coord| {
            let parent_coord = worked_coord + IVec2::Y;
            WorkStep {
                unit,
                yarn,
                worked_coord,
                parent_coord,
                kind: stitch_from_highlight(highlights, parent_coord),
            }
        })
        .collect();
    if alternate && row_index % 2 == 1 {
        steps.reverse();
    }
    steps
}

pub fn export_row_at(
    highlights: &Array2<u8>,
    canvas_size: IVec2,
    alternate: bool,
    row_index: usize,
) -> String {
    let flat: Vec<SequenceItem> = row_work_at(highlights, canvas_size, alternate, row_index)
        .into_iter()
        .map(|step| SequenceItem::Stitch(step.kind))
        .collect();
    let compressed = pattern::compress(&flat);
    format!("Row {}: {}", row_index + 1, pattern::to_string(&compressed))
}

pub fn round_work_at(
    highlights: &Array2<u8>,
    canvas_size: IVec2,
    virtual_size: IVec2,
    offset: IVec2,
    rounds: i32,
    alternate: bool,
    round_index: usize,
) -> Vec<WorkStep> {
    let round = round_index as i32 + 1;
    let unit = WorkUnitId::Round(round_index as u32 + 1);
    let yarn = if round_index % 2 == 0 {
        YarnSlot::A
    } else {
        YarnSlot::B
    };
    let mut groups: Vec<Vec<WorkStep>> = Vec::new();

    for (virtual_coord, virtual_parent) in walk::round_walk_at(virtual_size, rounds, round) {
        let worked_coord = virtual_coord - offset;
        let parent_coord = virtual_parent - offset;
        if !walk::window(worked_coord, canvas_size) {
            continue;
        }

        let kind = if walk::is_corner_coord(worked_coord, offset, virtual_size) {
            Stitch::Ch
        } else if walk::window(parent_coord, canvas_size) {
            stitch_from_highlight(highlights, parent_coord)
        } else {
            Stitch::Sc
        };
        let step = WorkStep {
            unit,
            yarn,
            worked_coord,
            parent_coord,
            kind,
        };

        if groups
            .last()
            .and_then(|group| group.first())
            .map(|first| first.parent_coord)
            == Some(parent_coord)
        {
            groups.last_mut().expect("group exists").push(step);
        } else {
            groups.push(vec![step]);
        }
    }

    if alternate && round_index % 2 == 1 {
        groups.reverse();
    }
    groups.into_iter().flatten().collect()
}

pub fn export_round_at(
    highlights: &Array2<u8>,
    canvas_size: IVec2,
    virtual_size: IVec2,
    offset: IVec2,
    rounds: i32,
    alternate: bool,
    round_index: usize,
) -> String {
    let mut groups: Vec<Vec<Stitch>> = Vec::new();
    let mut current_group: Vec<Stitch> = Vec::new();
    let mut current_parent: Option<IVec2> = None;

    for step in round_work_at(
        highlights,
        canvas_size,
        virtual_size,
        offset,
        rounds,
        alternate,
        round_index,
    ) {
        if Some(step.parent_coord) != current_parent {
            if !current_group.is_empty() {
                groups.push(std::mem::take(&mut current_group));
            }
            current_parent = Some(step.parent_coord);
        }
        current_group.push(step.kind);
    }
    if !current_group.is_empty() {
        groups.push(current_group);
    }

    let flat: Vec<SequenceItem> = groups
        .iter()
        .map(|group| {
            if group.len() == 1 {
                SequenceItem::Stitch(group[0])
            } else {
                let inner: Vec<SequenceItem> =
                    group.iter().map(|&s| SequenceItem::Stitch(s)).collect();
                SequenceItem::group(pattern::compress(&inner))
            }
        })
        .collect();

    let compressed = pattern::compress(&flat);
    format!(
        "Round {}: {}",
        round_index + 1,
        pattern::to_string(&compressed)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(x: i32, y: i32) -> IVec2 {
        IVec2::new(x, y)
    }

    /// Natural (unmodified) pixel grid for a round pattern — no highlights set.
    fn no_highlights(w: i32, h: i32) -> Array2<u8> {
        Array2::zeros((h as usize, w as usize))
    }

    // ── Row export ───────────────────────────────────────────────────────────

    #[test]
    fn row_overlay_belongs_to_the_row_worked_above_its_support() {
        let mut hl = no_highlights(1, 3);
        hl[[2, 0]] = common::HIGHLIGHT_VALID_OVERLAY;

        assert_eq!(export_row_at(&hl, v(1, 3), false, 0), "Row 1: oc");
        assert_eq!(export_row_at(&hl, v(1, 3), false, 1), "Row 2: sc");
    }

    #[test]
    fn row_work_fixture_exposes_identity_yarn_coordinates_and_stitches() {
        let mut hl = no_highlights(3, 3);
        hl[[2, 1]] = common::HIGHLIGHT_VALID_OVERLAY;
        hl[[1, 0]] = common::HIGHLIGHT_VALID_OVERLAY;

        let row_1 = row_work_at(&hl, v(3, 3), false, 0);
        assert_eq!(
            row_1.iter().map(|step| step.kind).collect::<Vec<_>>(),
            [Stitch::Sc, Stitch::Oc, Stitch::Sc,]
        );
        assert!(row_1.iter().all(|step| step.unit == WorkUnitId::Row(1)));
        assert!(row_1.iter().all(|step| step.yarn == YarnSlot::B));
        assert_eq!(row_1[1].worked_coord, v(1, 1));
        assert_eq!(row_1[1].parent_coord, v(1, 2));
        assert_eq!(export_row_at(&hl, v(3, 3), false, 0), "Row 1: sc, oc, sc");

        let row_2 = row_work_at(&hl, v(3, 3), true, 1);
        assert_eq!(
            row_2
                .iter()
                .map(|step| step.worked_coord)
                .collect::<Vec<_>>(),
            [v(2, 0), v(1, 0), v(0, 0),]
        );
        assert!(row_2.iter().all(|step| step.unit == WorkUnitId::Row(2)));
        assert!(row_2.iter().all(|step| step.yarn == YarnSlot::A));
        assert_eq!(row_2[2].kind, Stitch::Oc);
        assert_eq!(row_2[2].parent_coord, v(0, 1));
        assert_eq!(export_row_at(&hl, v(3, 3), false, 1), "Row 2: oc, sc × 2");
        assert_eq!(export_row_at(&hl, v(3, 3), true, 1), "Row 2: sc × 2, oc");
    }

    // ── Round export ─────────────────────────────────────────────────────────

    #[test]
    fn round_overlay_belongs_to_the_round_worked_outside_its_support() {
        let mut hl = no_highlights(7, 7);
        hl[[3, 2]] = common::HIGHLIGHT_VALID_OVERLAY;

        let round_1 = export_round_at(&hl, v(7, 7), v(7, 7), v(0, 0), 3, false, 0);
        let round_2 = export_round_at(&hl, v(7, 7), v(7, 7), v(0, 0), 3, false, 1);

        assert!(!round_1.contains("oc"));
        assert!(round_2.contains("oc"));
    }

    #[test]
    fn neighbouring_pixel_can_emit_overlay_beside_a_corner_group() {
        let mut hl = no_highlights(7, 7);
        hl[[2, 1]] = common::HIGHLIGHT_VALID_OVERLAY;

        let round_3 = export_round_at(&hl, v(7, 7), v(7, 7), v(0, 0), 3, false, 2);

        assert!(round_3.contains("(sc, ch, sc), oc"));
    }

    #[test]
    fn centre_out_work_fixture_exposes_corner_parent_and_adjacent_overlay() {
        let mut hl = no_highlights(7, 7);
        hl[[2, 1]] = common::HIGHLIGHT_VALID_OVERLAY;

        let round_3 = round_work_at(&hl, v(7, 7), v(7, 7), v(0, 0), 3, false, 2);
        assert!(round_3.iter().all(|step| step.unit == WorkUnitId::Round(3)));
        assert!(round_3.iter().all(|step| step.yarn == YarnSlot::A));
        assert_eq!(
            round_3[..4]
                .iter()
                .map(|step| (step.worked_coord, step.parent_coord, step.kind,))
                .collect::<Vec<_>>(),
            [
                (v(1, 0), v(1, 1), Stitch::Sc),
                (v(0, 0), v(1, 1), Stitch::Ch),
                (v(0, 1), v(1, 1), Stitch::Sc),
                (v(0, 2), v(1, 2), Stitch::Oc),
            ]
        );
    }

    #[test]
    fn centre_out_alternate_direction_preserves_parent_group_order() {
        let hl = no_highlights(7, 7);

        assert_eq!(
            export_round_at(&hl, v(7, 7), v(7, 7), v(0, 0), 3, false, 1),
            "Round 2: [(sc, ch, sc), sc] × 4",
        );
        assert_eq!(
            export_round_at(&hl, v(7, 7), v(7, 7), v(0, 0), 3, true, 1),
            "Round 2: [sc, (sc, ch, sc)] × 4",
        );
    }

    // innerW=1, innerH=1, rounds=2 → virtual 5×5, canvas 5×5, offset (0,0).
    // Round 1 (innermost, round_index=0): 8 stitches, all sharing the same
    // parent point (2,2) which lies inside the inner hole.
    //   Walk order: non-corner sc, corner ch, non-corner sc, corner ch, ...
    //   Pattern = [sc, ch] × 4 → wrapped as one group → ([sc, ch] × 4).
    #[test]
    fn round_1_inner_1x1_hole() {
        let hl = no_highlights(5, 5);
        let result = export_round_at(&hl, v(5, 5), v(5, 5), v(0, 0), 2, false, 0);
        assert_eq!(result, "Round 1: ([sc, ch] × 4)");
    }

    // Zero inner hole (innerW=0, innerH=0, rounds=1) → virtual 2×2, canvas 2×2.
    // All 4 pixels are corners → (ch × 4).  Replace with 4 sc into a magic ring.
    #[test]
    fn round_1_zero_inner_hole() {
        let hl = no_highlights(2, 2);
        let result = export_round_at(&hl, v(2, 2), v(2, 2), v(0, 0), 1, false, 0);
        assert_eq!(result, "Round 1: (ch × 4)");
    }
}
