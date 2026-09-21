// wasm-bindgen exposes function arguments directly to TypeScript; keep the
// boundary flat instead of adding Rust-only wrapper types.
#![allow(clippy::too_many_arguments)]

use glam::IVec2;
use mosaic_crochet_core::{common, export, pattern, tools, walk};
use ndarray::Array2;
use wasm_bindgen::prelude::*;

// ─── Plan record format ───────────────────────────────────────────────────────
// `build_highlight_plan_*` returns a flat `Int16Array` with stride 4:
//   [type, dir, wrong_x, wrong_y, ...]
// `type` is one of `PlanType`; `dir` is one of `PlanDir`. The discriminants
// below MUST match the `PLAN_TYPE_*` / `PLAN_DIR_*` i16 constants in
// `core/src/common.rs` — enforced at compile time by the static asserts
// further down. TS reads the values directly: `plan[i] === PlanType.Valid`
// etc.

#[wasm_bindgen]
pub enum PlanType {
    Valid = 0,
    Invalid = 1,
}

#[wasm_bindgen]
pub enum PlanDir {
    Up = 0,
    Down = 1,
    Left = 2,
    Right = 3,
}

#[wasm_bindgen]
#[derive(Clone, Copy)]
pub enum TransformApplicationStatus {
    Unchanged = 0,
    Applied = 1,
    Conflict = 2,
    OrbitLimit = 3,
}

#[wasm_bindgen]
pub struct TransformApplication {
    status: TransformApplicationStatus,
    pixels: Vec<u8>,
}

#[wasm_bindgen]
impl TransformApplication {
    pub fn status(&self) -> TransformApplicationStatus {
        self.status
    }

    pub fn pixels(&self) -> Vec<u8> {
        self.pixels.clone()
    }
}

// Compile-time guarantee that the wasm-exposed enum discriminants stay in
// lockstep with the core constants used to build the plan.
const _: () = {
    assert!(PlanType::Valid as u8 == common::PLAN_TYPE_VALID);
    assert!(PlanType::Invalid as u8 == common::PLAN_TYPE_INVALID);
    assert!(PlanDir::Up as u8 == common::PLAN_DIR_UP);
    assert!(PlanDir::Down as u8 == common::PLAN_DIR_DOWN);
    assert!(PlanDir::Left as u8 == common::PLAN_DIR_LEFT);
    assert!(PlanDir::Right as u8 == common::PLAN_DIR_RIGHT);
};

enum InstructionMode {
    Row {
        canvas_size: IVec2,
    },
    Round {
        canvas_size: IVec2,
        virtual_size: IVec2,
        offset: IVec2,
        rounds: i32,
    },
}

#[wasm_bindgen]
#[derive(Clone, Copy)]
pub enum InstructionUnitKind {
    Row = 0,
    Round = 1,
}

#[wasm_bindgen]
#[derive(Clone, Copy)]
pub enum InstructionYarn {
    A = 0,
    B = 1,
}

#[wasm_bindgen]
pub struct InstructionUnit {
    kind: InstructionUnitKind,
    number: u32,
    yarn: InstructionYarn,
    sequence: export::WorkSequence,
    invalid_worked_coords: Vec<i32>,
}

#[wasm_bindgen]
pub struct InstructionSignature {
    kind: InstructionUnitKind,
    number: u32,
    yarn: InstructionYarn,
    content_key: String,
    invalid_worked_coords: Vec<i32>,
    start_direction: Vec<i32>,
    reversed_start_direction: Vec<i32>,
}

#[wasm_bindgen]
impl InstructionSignature {
    pub fn kind(&self) -> InstructionUnitKind { self.kind }
    pub fn number(&self) -> u32 { self.number }
    pub fn yarn(&self) -> InstructionYarn { self.yarn }
    pub fn content_key(&self) -> String { self.content_key.clone() }
    pub fn invalid_worked_coords(&self) -> Vec<i32> { self.invalid_worked_coords.clone() }
    pub fn start_direction(&self) -> Vec<i32> { self.start_direction.clone() }
    pub fn reversed_start_direction(&self) -> Vec<i32> { self.reversed_start_direction.clone() }
}

#[wasm_bindgen]
impl InstructionUnit {
    pub fn kind(&self) -> InstructionUnitKind {
        self.kind
    }

    pub fn number(&self) -> u32 {
        self.number
    }

    pub fn yarn(&self) -> InstructionYarn {
        self.yarn
    }

    pub fn text(&self) -> String {
        let label = match self.kind {
            InstructionUnitKind::Row => "Row",
            InstructionUnitKind::Round => "Round",
        };
        format!(
            "{label} {}: {}",
            self.number,
            pattern::to_string(&self.sequence.compression),
        )
    }

    pub fn worked_coords(&self) -> Vec<i32> {
        self.sequence
            .steps
            .iter()
            .flat_map(|step| [step.worked_coord.x, step.worked_coord.y])
            .collect()
    }

    pub fn reversed_text(&self) -> String {
        let label = match self.kind {
            InstructionUnitKind::Row => "Row",
            InstructionUnitKind::Round => "Round",
        };
        format!(
            "{label} {}: {}",
            self.number,
            pattern::to_string(&self.sequence.reversed().compression),
        )
    }

    pub fn reversed_worked_coords(&self) -> Vec<i32> {
        self.sequence
            .reversed()
            .steps
            .iter()
            .flat_map(|step| [step.worked_coord.x, step.worked_coord.y])
            .collect()
    }

    pub fn invalid_worked_coords(&self) -> Vec<i32> {
        self.invalid_worked_coords.clone()
    }
}

#[wasm_bindgen]
pub struct InstructionSession {
    highlights: Array2<u8>,
    mode: InstructionMode,
    index: usize,
    total: usize,
}

impl InstructionSession {
    fn identity_at(&self, index: usize) -> (InstructionUnitKind, u32, InstructionYarn) {
        let kind = match &self.mode {
            InstructionMode::Row { .. } => InstructionUnitKind::Row,
            InstructionMode::Round { .. } => InstructionUnitKind::Round,
        };
        let yarn = if index % 2 == 0 { InstructionYarn::A } else { InstructionYarn::B };
        (kind, index as u32 + 1, yarn)
    }

    fn sequence_at(&self, index: usize) -> export::WorkSequence {
        match &self.mode {
            InstructionMode::Row { canvas_size } => {
                export::row_work_sequence_at(&self.highlights, *canvas_size, false, index)
            }
            InstructionMode::Round {
                canvas_size,
                virtual_size,
                offset,
                rounds,
            } => export::round_work_sequence_at(
                &self.highlights,
                *canvas_size,
                *virtual_size,
                *offset,
                *rounds,
                false,
                index,
            ),
        }
    }

    fn steps_at(&self, index: usize) -> Vec<export::WorkStep> {
        match &self.mode {
            InstructionMode::Row { canvas_size } => {
                export::row_work_at(&self.highlights, *canvas_size, false, index)
            }
            InstructionMode::Round {
                canvas_size,
                virtual_size,
                offset,
                rounds,
            } => export::round_work_at(
                &self.highlights,
                *canvas_size,
                *virtual_size,
                *offset,
                *rounds,
                false,
                index,
            ),
        }
    }

    fn invalid_worked_coords(&self, steps: &[export::WorkStep]) -> Vec<i32> {
        steps
            .iter()
            .filter(|step| step.kind == pattern::Stitch::Oc
                && step.parent_coord.x >= 0
                && step.parent_coord.y >= 0
                && step.parent_coord.x < self.highlights.ncols() as i32
                && step.parent_coord.y < self.highlights.nrows() as i32
                && self.highlights[[step.parent_coord.y as usize, step.parent_coord.x as usize]]
                    == common::HIGHLIGHT_INVALID)
            .flat_map(|step| [step.worked_coord.x, step.worked_coord.y])
            .collect()
    }

    fn start_direction(&self, index: usize, steps: &[export::WorkStep], reversed: bool) -> Vec<i32> {
        let ordered = if reversed {
            export::WorkSequence { steps: steps.to_vec(), compression: Vec::new() }.reversed().steps
        } else {
            steps.to_vec()
        };
        let Some(first) = ordered.first() else { return Vec::new(); };
        let next = ordered.get(1).map(|step| step.worked_coord).or_else(|| match &self.mode {
            InstructionMode::Row { .. } => Some(first.worked_coord + IVec2::new(if reversed { -1 } else { 1 }, 0)),
            InstructionMode::Round { virtual_size, offset, rounds, .. } => {
                let virtual_coords: Vec<_> = walk::round_walk_at(*virtual_size, *rounds, index as i32 + 1)
                    .map(|(coord, _)| coord)
                    .collect();
                let current = first.worked_coord + *offset;
                let position = virtual_coords.iter().position(|coord| *coord == current)?;
                let step = if reversed { virtual_coords.len() - 1 } else { 1 };
                let neighbor = virtual_coords.get((position + step) % virtual_coords.len())?;
                Some(*neighbor - *offset)
            }
        });
        next.map(|next| vec![first.worked_coord.x, first.worked_coord.y, next.x, next.y])
            .unwrap_or_default()
    }
}

#[wasm_bindgen]
impl InstructionSession {
    pub fn total(&self) -> usize {
        self.total
    }

    pub fn signature_at(&self, index: usize) -> Option<InstructionSignature> {
        if index >= self.total { return None; }
        let steps = self.steps_at(index);
        let (kind, number, yarn) = self.identity_at(index);
        let content_key = steps.iter().map(|step| {
            format!("{:?}:{}:{}:{}:{}", step.kind, step.parent_coord.x, step.parent_coord.y, step.worked_coord.x, step.worked_coord.y)
        }).collect::<Vec<_>>().join("|");
        Some(InstructionSignature {
            kind,
            number,
            yarn,
            content_key,
            invalid_worked_coords: self.invalid_worked_coords(&steps),
            start_direction: self.start_direction(index, &steps, false),
            reversed_start_direction: self.start_direction(index, &steps, true),
        })
    }

    pub fn unit_at(&self, index: usize) -> Option<InstructionUnit> {
        if index >= self.total { return None; }
        let sequence = self.sequence_at(index);
        let (kind, number, yarn) = self.identity_at(index);
        Some(InstructionUnit {
            kind,
            number,
            yarn,
            invalid_worked_coords: self.invalid_worked_coords(&sequence.steps),
            sequence,
        })
    }

    #[allow(clippy::should_implement_trait)]
    pub fn next(&mut self) -> Option<InstructionUnit> {
        if self.index >= self.total { return None; }
        let unit = self.unit_at(self.index)?;
        self.index += 1;
        Some(unit)
    }
}

fn to_array2(flat: &[u8], width: i32, height: i32) -> Array2<u8> {
    Array2::from_shape_vec((height as usize, width as usize), flat.to_vec())
        .expect("pixel buffer size mismatch")
}

// Compute highlights once from pixels (used by both render-plan and export
// paths — they each need it but TS never sees the raw per-cell array).
fn highlights_row(pixels: &[u8], width: i32, height: i32) -> Array2<u8> {
    let pattern = to_array2(pixels, width, height);
    let mut hl = Array2::zeros((height as usize, width as usize));
    common::compute_row_highlights(IVec2::new(width, height), &pattern, &mut hl);
    hl
}

fn highlights_round(
    pixels: &[u8],
    canvas_size: IVec2,
    virtual_size: IVec2,
    offset: IVec2,
    rounds: i32,
) -> Array2<u8> {
    let pattern = to_array2(pixels, canvas_size.x, canvas_size.y);
    let mut hl = Array2::zeros((canvas_size.y as usize, canvas_size.x as usize));
    common::compute_round_highlights(canvas_size, virtual_size, offset, rounds, &pattern, &mut hl);
    hl
}

#[wasm_bindgen]
pub fn build_highlight_plan_row(pixels: &[u8], width: i32, height: i32) -> Vec<i16> {
    let pattern = to_array2(pixels, width, height);
    common::build_highlight_plan_row(IVec2::new(width, height), &pattern)
}

#[wasm_bindgen]
pub fn build_highlight_plan_round(
    pixels: &[u8],
    canvas_width: i32,
    canvas_height: i32,
    virtual_width: i32,
    virtual_height: i32,
    offset_x: i32,
    offset_y: i32,
    rounds: i32,
) -> Vec<i16> {
    let pattern = to_array2(pixels, canvas_width, canvas_height);
    common::build_highlight_plan_round(
        IVec2::new(canvas_width, canvas_height),
        IVec2::new(virtual_width, virtual_height),
        IVec2::new(offset_x, offset_y),
        rounds,
        &pattern,
    )
}

#[wasm_bindgen]
pub fn instruction_start_row(pixels: &[u8], width: i32, height: i32) -> InstructionSession {
    InstructionSession {
        highlights: highlights_row(pixels, width, height),
        mode: InstructionMode::Row {
            canvas_size: IVec2::new(width, height),
        },
        index: 0,
        total: height.max(0) as usize,
    }
}

#[wasm_bindgen]
pub fn instruction_start_round(
    pixels: &[u8],
    canvas_width: i32,
    canvas_height: i32,
    virtual_width: i32,
    virtual_height: i32,
    offset_x: i32,
    offset_y: i32,
    rounds: i32,
) -> InstructionSession {
    let canvas_size = IVec2::new(canvas_width, canvas_height);
    let virtual_size = IVec2::new(virtual_width, virtual_height);
    let offset = IVec2::new(offset_x, offset_y);
    InstructionSession {
        highlights: highlights_round(pixels, canvas_size, virtual_size, offset, rounds),
        mode: InstructionMode::Round {
            canvas_size,
            virtual_size,
            offset,
            rounds,
        },
        index: 0,
        total: rounds as usize,
    }
}

#[wasm_bindgen]
pub fn instruction_wip_row(
    pixels: &[u8],
    width: i32,
    height: i32,
    completed_units: usize,
) -> Vec<u8> {
    export::row_wip_pixels(
        &to_array2(pixels, width, height),
        IVec2::new(width, height),
        completed_units,
    )
    .iter()
    .copied()
    .collect()
}

#[wasm_bindgen]
pub fn instruction_wip_round(
    pixels: &[u8],
    canvas_width: i32,
    canvas_height: i32,
    virtual_width: i32,
    virtual_height: i32,
    offset_x: i32,
    offset_y: i32,
    rounds: i32,
    completed_units: usize,
) -> Vec<u8> {
    export::round_wip_pixels(
        &to_array2(pixels, canvas_width, canvas_height),
        IVec2::new(canvas_width, canvas_height),
        IVec2::new(virtual_width, virtual_height),
        IVec2::new(offset_x, offset_y),
        rounds,
        completed_units,
    )
    .iter()
    .copied()
    .collect()
}

#[cfg(test)]
mod instruction_session_tests {
    use super::*;

    #[test]
    fn row_session_exposes_unit_metadata_text_and_worked_path() {
        let mut pixels = initialize_row_pattern(3, 3);
        pixels[2 * 3] = common::opposite_color(pixels[2 * 3]);
        let mut session = instruction_start_row(&pixels, 3, 3);

        assert_eq!(session.total(), 3);
        let foundation = session.next().expect("foundation row");
        assert_eq!(foundation.kind() as u8, InstructionUnitKind::Row as u8);
        assert_eq!(foundation.number(), 1);
        assert_eq!(foundation.yarn() as u8, InstructionYarn::A as u8);
        assert_eq!(foundation.text(), "Row 1: sc × 3");
        assert_eq!(foundation.worked_coords(), vec![0, 2, 1, 2, 2, 2]);

        let row_2 = session.next().expect("second row");
        assert_eq!(row_2.number(), 2);
        assert_eq!(row_2.yarn() as u8, InstructionYarn::B as u8);
        assert_eq!(row_2.text(), "Row 2: oc, sc × 2");
        assert_eq!(row_2.worked_coords(), vec![0, 1, 1, 1, 2, 1]);
        assert_eq!(row_2.reversed_text(), "Row 2: sc × 2, oc");
        assert_eq!(row_2.reversed_worked_coords(), vec![2, 1, 1, 1, 0, 1]);
    }

    #[test]
    fn signature_tracks_work_semantics_and_invalid_metadata_without_compression() {
        let mut highlights = Array2::zeros((3, 3));
        highlights[[1, 0]] = common::HIGHLIGHT_INVALID;
        let session = InstructionSession {
            highlights,
            mode: InstructionMode::Row { canvas_size: IVec2::new(3, 3) },
            index: 0,
            total: 3,
        };

        let signature = session.signature_at(2).expect("signature");
        assert_eq!(signature.kind() as u8, InstructionUnitKind::Row as u8);
        assert_eq!(signature.number(), 3);
        assert!(signature.content_key().contains("Oc:0:1:0:0"));
        assert_eq!(signature.invalid_worked_coords(), vec![0, 0]);
        assert_eq!(session.unit_at(2).expect("unit").invalid_worked_coords(), vec![0, 0]);
    }

    #[test]
    fn round_session_keeps_empty_units_and_single_stitch_directions() {
        let empty = instruction_start_round(&[0], 1, 1, 3, 3, 1, 1, 1);
        let empty_signature = empty.signature_at(0).expect("empty round signature");
        assert_eq!(empty_signature.kind() as u8, InstructionUnitKind::Round as u8);
        assert_eq!(empty_signature.number(), 1);
        assert_eq!(empty.unit_at(0).expect("empty round unit").worked_coords(), Vec::<i32>::new());
        assert!(empty.signature_at(1).is_none());
        assert!(empty.unit_at(1).is_none());

        let one_cell = instruction_start_round(&[0], 1, 1, 3, 3, 0, 2, 1);
        let signature = one_cell.signature_at(0).expect("one-cell round signature");
        assert_eq!(signature.start_direction(), vec![0, 0, 1, 0]);
        assert_eq!(signature.reversed_start_direction(), vec![0, 0, 0, -1]);

        let first_virtual = instruction_start_round(&[0], 1, 1, 3, 3, 1, 0, 1);
        let signature = first_virtual.signature_at(0).expect("first virtual signature");
        assert_eq!(signature.reversed_start_direction(), vec![0, 0, 1, 0]);
    }

    #[test]
    fn round_session_exposes_the_visible_worked_path() {
        let pixels = initialize_round_pattern(7, 7, 7, 7, 0, 0, 3);
        let mut session = instruction_start_round(&pixels, 7, 7, 7, 7, 0, 0, 3);

        assert_eq!(session.total(), 3);
        let unit = session.next().expect("first round");
        assert_eq!(unit.kind() as u8, InstructionUnitKind::Round as u8);
        assert_eq!(unit.number(), 1);
        assert_eq!(unit.yarn() as u8, InstructionYarn::A as u8);
        assert!(unit.text().starts_with("Round 1:"));
        assert_eq!(unit.worked_coords().len() % 2, 0);
        assert!(!unit.worked_coords().is_empty());
        assert!(!unit.reversed_text().is_empty());
        assert_eq!(
            unit.reversed_worked_coords().len(),
            unit.worked_coords().len()
        );
    }

    #[test]
    fn row_wip_binding_returns_the_completed_prefix() {
        let mut pixels = initialize_row_pattern(3, 3);
        pixels[2 * 3 + 1] = common::opposite_color(pixels[2 * 3 + 1]);

        assert_eq!(
            instruction_wip_row(&pixels, 3, 3, 1),
            vec![0, 0, 0, 0, 0, 0, 1, 1, 1],
        );
        assert_eq!(
            instruction_wip_row(&pixels, 3, 3, 2),
            vec![0, 0, 0, 2, 2, 2, 1, 2, 1],
        );
    }

    #[test]
    fn round_wip_binding_returns_no_authored_cells_before_round_one() {
        let pixels = initialize_round_pattern(7, 7, 7, 7, 0, 0, 3);

        assert!(instruction_wip_round(&pixels, 7, 7, 7, 7, 0, 0, 3, 0)
            .iter()
            .all(|pixel| *pixel == common::COLOR_TRANSPARENT));
    }
}

#[cfg(test)]
mod overlay_preview_tests {
    use super::*;

    #[test]
    fn row_support_exists_for_overlay_but_not_foundation() {
        assert_eq!(overlay_inward_cell_row(9, 9, 2, 1), vec![2, 2]);
        assert!(overlay_inward_cell_row(9, 9, 2, 8).is_empty());
    }

    #[test]
    fn round_support_follows_the_nearest_side_and_rejects_diagonal_corners() {
        assert_eq!(overlay_inward_cell_round(9, 9, 9, 9, 0, 0, 0, 2), vec![1, 2]);
        assert!(overlay_inward_cell_round(9, 9, 9, 9, 0, 0, 1, 1).is_empty());
    }
}

#[wasm_bindgen]
pub fn initialize_row_pattern(width: i32, height: i32) -> Vec<u8> {
    let mut grid = vec![0u8; (width * height) as usize];
    for y in 0..height {
        let color = common::natural_color_row(height, y);
        for x in 0..width {
            grid[(y * width + x) as usize] = color;
        }
    }
    grid
}

#[wasm_bindgen]
pub fn initialize_round_pattern(
    canvas_width: i32,
    canvas_height: i32,
    virtual_width: i32,
    virtual_height: i32,
    offset_x: i32,
    offset_y: i32,
    rounds: i32,
) -> Vec<u8> {
    let virtual_size = IVec2::new(virtual_width, virtual_height);
    let offset = IVec2::new(offset_x, offset_y);
    let mut grid = vec![0u8; (canvas_width * canvas_height) as usize];
    for y in 0..canvas_height {
        for x in 0..canvas_width {
            grid[(y * canvas_width + x) as usize] =
                common::natural_color_round(virtual_size, offset, rounds, IVec2::new(x, y));
        }
    }
    grid
}

// Selection parameters on paint functions are `Option<Vec<u8>>` rather than
// `&[u8]` so JS callers can pass `null` / `undefined` for "no selection"
// instead of an empty typed array. The core functions take `&[u8]`; the
// binding unwraps to an empty slice for the None case.

#[wasm_bindgen]
pub fn paint_pixel(
    pixels: &[u8],
    width: i32,
    height: i32,
    x: i32,
    y: i32,
    color: u8,
    axes: Option<Vec<f64>>,
    selection: Option<Vec<u8>>,
) -> Vec<u8> {
    tools::paint_pixel(
        pixels,
        width,
        height,
        x,
        y,
        color,
        axes.as_deref().unwrap_or(&[]),
        selection.as_deref().unwrap_or(&[]),
    )
}

#[wasm_bindgen]
pub fn flood_fill(
    pixels: &[u8],
    width: i32,
    height: i32,
    start_x: i32,
    start_y: i32,
    fill_color: u8,
    axes: Option<Vec<f64>>,
    selection: Option<Vec<u8>>,
) -> Vec<u8> {
    tools::flood_fill(
        pixels,
        width,
        height,
        start_x,
        start_y,
        fill_color,
        axes.as_deref().unwrap_or(&[]),
        selection.as_deref().unwrap_or(&[]),
    )
}

#[wasm_bindgen]
pub fn wand_select(
    pixels: &[u8],
    width: i32,
    height: i32,
    start_x: i32,
    start_y: i32,
    mode: u8,
    existing: &[u8],
) -> Vec<u8> {
    tools::wand_select(pixels, width, height, start_x, start_y, mode, existing)
}

#[wasm_bindgen]
pub fn transfer_preserved_row(
    old_pixels: &[u8],
    old_width: i32,
    old_height: i32,
    new_pixels: &[u8],
    new_width: i32,
    new_height: i32,
) -> Vec<u8> {
    tools::transfer_preserved_row(
        old_pixels, old_width, old_height, new_pixels, new_width, new_height,
    )
}

#[wasm_bindgen]
pub fn transfer_preserved_round(
    old_pixels: &[u8],
    old_canvas_width: i32,
    old_canvas_height: i32,
    old_virtual_width: i32,
    old_virtual_height: i32,
    old_offset_x: i32,
    old_offset_y: i32,
    old_rounds: i32,
    new_pixels: &[u8],
    new_canvas_width: i32,
    new_canvas_height: i32,
    new_virtual_width: i32,
    new_virtual_height: i32,
    new_offset_x: i32,
    new_offset_y: i32,
    new_rounds: i32,
) -> Vec<u8> {
    tools::transfer_preserved_round(
        old_pixels,
        old_canvas_width,
        old_canvas_height,
        old_virtual_width,
        old_virtual_height,
        old_offset_x,
        old_offset_y,
        old_rounds,
        new_pixels,
        new_canvas_width,
        new_canvas_height,
        new_virtual_width,
        new_virtual_height,
        new_offset_x,
        new_offset_y,
        new_rounds,
    )
}

#[wasm_bindgen]
pub fn lock_invalid_row(before: &[u8], after: &[u8], width: i32, height: i32) -> Vec<u8> {
    tools::lock_invalid_row(before, after, width, height)
}

#[wasm_bindgen]
pub fn lock_invalid_round(
    before: &[u8],
    after: &[u8],
    canvas_width: i32,
    canvas_height: i32,
    virtual_width: i32,
    virtual_height: i32,
    offset_x: i32,
    offset_y: i32,
    rounds: i32,
) -> Vec<u8> {
    tools::lock_invalid_round(
        before,
        after,
        canvas_width,
        canvas_height,
        virtual_width,
        virtual_height,
        offset_x,
        offset_y,
        rounds,
    )
}

#[wasm_bindgen]
pub fn paint_natural_row(
    pixels: &[u8],
    width: i32,
    height: i32,
    x: i32,
    y: i32,
    axes: Option<Vec<f64>>,
    invert: bool,
    selection: Option<Vec<u8>>,
) -> Vec<u8> {
    tools::paint_natural_row(
        pixels,
        width,
        height,
        x,
        y,
        axes.as_deref().unwrap_or(&[]),
        invert,
        selection.as_deref().unwrap_or(&[]),
    )
}

#[wasm_bindgen]
pub fn paint_natural_round(
    pixels: &[u8],
    canvas_width: i32,
    canvas_height: i32,
    virtual_width: i32,
    virtual_height: i32,
    offset_x: i32,
    offset_y: i32,
    rounds: i32,
    x: i32,
    y: i32,
    axes: Option<Vec<f64>>,
    invert: bool,
    selection: Option<Vec<u8>>,
) -> Vec<u8> {
    tools::paint_natural_round(
        pixels,
        canvas_width,
        canvas_height,
        virtual_width,
        virtual_height,
        offset_x,
        offset_y,
        rounds,
        x,
        y,
        axes.as_deref().unwrap_or(&[]),
        invert,
        selection.as_deref().unwrap_or(&[]),
    )
}

#[wasm_bindgen]
pub fn paint_overlay_row(
    pixels: &[u8],
    width: i32,
    height: i32,
    x: i32,
    y: i32,
    axes: Option<Vec<f64>>,
) -> Vec<u8> {
    tools::paint_overlay_row(pixels, width, height, x, y, axes.as_deref().unwrap_or(&[]))
}

#[wasm_bindgen]
pub fn overlay_target_available_row(width: i32, height: i32, x: i32, y: i32) -> bool {
    common::overlay_target_available_row(IVec2::new(width, height), IVec2::new(x, y))
}

#[wasm_bindgen]
pub fn overlay_inward_cell_row(width: i32, height: i32, x: i32, y: i32) -> Vec<i32> {
    common::inward_cell_row(IVec2::new(width, height), IVec2::new(x, y))
        .map_or_else(Vec::new, |cell| vec![cell.x, cell.y])
}

#[wasm_bindgen]
pub fn clear_overlay_row(
    pixels: &[u8],
    width: i32,
    height: i32,
    x: i32,
    y: i32,
    axes: Option<Vec<f64>>,
) -> Vec<u8> {
    tools::clear_overlay_row(pixels, width, height, x, y, axes.as_deref().unwrap_or(&[]))
}

#[wasm_bindgen]
pub fn paint_overlay_round(
    pixels: &[u8],
    canvas_width: i32,
    canvas_height: i32,
    virtual_width: i32,
    virtual_height: i32,
    offset_x: i32,
    offset_y: i32,
    rounds: i32,
    x: i32,
    y: i32,
    axes: Option<Vec<f64>>,
) -> Vec<u8> {
    tools::paint_overlay_round(
        pixels,
        canvas_width,
        canvas_height,
        virtual_width,
        virtual_height,
        offset_x,
        offset_y,
        rounds,
        x,
        y,
        axes.as_deref().unwrap_or(&[]),
    )
}

#[wasm_bindgen]
pub fn overlay_target_available_round(
    canvas_width: i32,
    canvas_height: i32,
    virtual_width: i32,
    virtual_height: i32,
    offset_x: i32,
    offset_y: i32,
    rounds: i32,
    x: i32,
    y: i32,
) -> bool {
    common::overlay_target_available_round(
        IVec2::new(canvas_width, canvas_height),
        IVec2::new(virtual_width, virtual_height),
        IVec2::new(offset_x, offset_y),
        rounds,
        IVec2::new(x, y),
    )
}

#[wasm_bindgen]
pub fn overlay_inward_cell_round(
    canvas_width: i32,
    canvas_height: i32,
    virtual_width: i32,
    virtual_height: i32,
    offset_x: i32,
    offset_y: i32,
    x: i32,
    y: i32,
) -> Vec<i32> {
    common::inward_cell_round(
        IVec2::new(canvas_width, canvas_height),
        IVec2::new(virtual_width, virtual_height),
        IVec2::new(offset_x, offset_y),
        IVec2::new(x, y),
    )
    .map_or_else(Vec::new, |cell| vec![cell.x, cell.y])
}

#[wasm_bindgen]
pub fn clear_overlay_round(
    pixels: &[u8],
    canvas_width: i32,
    canvas_height: i32,
    virtual_width: i32,
    virtual_height: i32,
    offset_x: i32,
    offset_y: i32,
    rounds: i32,
    x: i32,
    y: i32,
    axes: Option<Vec<f64>>,
) -> Vec<u8> {
    tools::clear_overlay_round(
        pixels,
        canvas_width,
        canvas_height,
        virtual_width,
        virtual_height,
        offset_x,
        offset_y,
        rounds,
        x,
        y,
        axes.as_deref().unwrap_or(&[]),
    )
}

#[wasm_bindgen]
pub fn cut_to_natural_row(pixels: &[u8], width: i32, height: i32, selection: &[u8]) -> Vec<u8> {
    tools::cut_to_natural_row(pixels, width, height, selection)
}

#[wasm_bindgen]
pub fn cut_to_natural_round(
    pixels: &[u8],
    canvas_width: i32,
    canvas_height: i32,
    virtual_width: i32,
    virtual_height: i32,
    offset_x: i32,
    offset_y: i32,
    rounds: i32,
    selection: &[u8],
) -> Vec<u8> {
    tools::cut_to_natural_round(
        pixels,
        canvas_width,
        canvas_height,
        virtual_width,
        virtual_height,
        offset_x,
        offset_y,
        rounds,
        selection,
    )
}

#[wasm_bindgen]
pub fn transformed_target_indices(
    canvas_width: i32,
    canvas_height: i32,
    x: i32,
    y: i32,
    transforms: Option<Vec<f64>>,
) -> Vec<u32> {
    tools::transformed_targets(
        x,
        y,
        canvas_width,
        canvas_height,
        transforms.as_deref().unwrap_or(&[]),
    )
    .into_iter()
    .map(|(sx, sy)| (sy * canvas_width + sx) as u32)
    .collect()
}

#[wasm_bindgen]
pub fn apply_transforms_to_selection(
    pixels: &[u8],
    canvas_width: i32,
    canvas_height: i32,
    sources: &[u8],
    transforms: Option<Vec<f64>>,
) -> TransformApplication {
    let applied = tools::apply_transforms_to_selection(
        pixels,
        canvas_width,
        canvas_height,
        sources,
        transforms.as_deref().unwrap_or(&[]),
    );
    let status = match applied.status {
        tools::TransformApplicationStatus::Unchanged => TransformApplicationStatus::Unchanged,
        tools::TransformApplicationStatus::Applied => TransformApplicationStatus::Applied,
        tools::TransformApplicationStatus::Conflict => TransformApplicationStatus::Conflict,
        tools::TransformApplicationStatus::OrbitLimit => TransformApplicationStatus::OrbitLimit,
    };
    TransformApplication {
        status,
        pixels: applied.pixels,
    }
}
