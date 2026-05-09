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
            let parent_rfe = common::get_round_from_edge(virtual_size, virtual_parent);
            if parent_rfe >= rounds { Stitch::Sc } else { Stitch::Ch }
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
