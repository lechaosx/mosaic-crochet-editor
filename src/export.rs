use glam::IVec2;
use ndarray::Array2;
use crate::{common, pattern, walk};

fn stitch_from_highlight(highlights: &Array2<u8>, coord: IVec2) -> &'static str {
    if highlights[[coord.y as usize, coord.x as usize]] == common::HIGHLIGHT_VALID_OVERLAY {
        "oc"
    } else {
        "sc"
    }
}

pub fn export_row_pattern(
    highlights:  &Array2<u8>,
    canvas_size: IVec2,
    alternate:   bool,
) -> String {
    let mut memo  = pattern::CompressMemo::new();
    let mut lines = Vec::new();

    for (row_index, coord_iter) in walk::row_walk(canvas_size).enumerate() {
        let mut flat: Vec<String> = coord_iter
            .map(|coord| stitch_from_highlight(highlights, coord).to_string())
            .collect();

        if alternate && row_index % 2 == 1 {
            flat.reverse();
        }

        let compressed = pattern::compress(&flat, &mut memo);
        lines.push(format!("Row {}: {}", row_index + 1, pattern::to_string(&compressed)));
    }

    lines.join("\n")
}

pub fn export_round_pattern(
    highlights:   &Array2<u8>,
    canvas_size:  IVec2,
    virtual_size: IVec2,
    offset:       IVec2,
    rounds:       i32,
    alternate:    bool,
) -> String {
    let mut memo  = pattern::CompressMemo::new();
    let mut lines = Vec::new();

    for (round_index, pair_iter) in walk::round_walk(virtual_size, rounds).enumerate() {
        let mut groups: Vec<Vec<String>> = Vec::new();
        let mut current_group:  Vec<String>   = Vec::new();
        let mut current_parent: Option<IVec2> = None;

        for (virtual_coord, virtual_parent) in pair_iter {
            let physical_coord  = virtual_coord  - offset;
            let physical_parent = virtual_parent - offset;

            if !walk::window(physical_coord, canvas_size) {
                continue;
            }

            let stitch = if walk::is_corner_coord(physical_coord, offset, virtual_size) {
                let parent_round_from_edge = common::get_round_from_edge(virtual_size, virtual_parent);
                if parent_round_from_edge >= rounds { "sc" } else { "ch" }
            } else {
                stitch_from_highlight(highlights, physical_coord)
            };

            if Some(physical_parent) != current_parent {
                if !current_group.is_empty() {
                    groups.push(std::mem::take(&mut current_group));
                }
                current_parent = Some(physical_parent);
            }
            current_group.push(stitch.to_string());
        }
        if !current_group.is_empty() {
            groups.push(current_group);
        }

        let mut flat: Vec<String> = Vec::new();
        for group in &groups {
            if group.len() == 1 {
                flat.push(group[0].clone());
            } else {
                let compressed = pattern::compress(group, &mut memo);
                flat.push(format!("({})", pattern::to_string(&compressed)));
            }
        }

        if alternate && round_index % 2 == 1 {
            flat.reverse();
        }

        let compressed = pattern::compress(&flat, &mut memo);
        lines.push(format!("Round {}: {}", round_index + 1, pattern::to_string(&compressed)));
    }

    lines.join("\n")
}
