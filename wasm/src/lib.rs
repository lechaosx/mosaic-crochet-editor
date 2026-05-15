use glam::IVec2;
use mosaic_crochet_core::{common, export, tools};
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
pub enum PlanType { Valid = 0, Invalid = 1 }

#[wasm_bindgen]
pub enum PlanDir { Up = 0, Down = 1, Left = 2, Right = 3 }

// Compile-time guarantee that the wasm-exposed enum discriminants stay in
// lockstep with the core constants used to build the plan.
const _: () = {
    assert!(PlanType::Valid   as u8 == common::PLAN_TYPE_VALID);
    assert!(PlanType::Invalid as u8 == common::PLAN_TYPE_INVALID);
    assert!(PlanDir::Up       as u8 == common::PLAN_DIR_UP);
    assert!(PlanDir::Down     as u8 == common::PLAN_DIR_DOWN);
    assert!(PlanDir::Left     as u8 == common::PLAN_DIR_LEFT);
    assert!(PlanDir::Right    as u8 == common::PLAN_DIR_RIGHT);
};

enum ExportMode {
    Row { canvas_size: IVec2, alternate: bool },
    Round { canvas_size: IVec2, virtual_size: IVec2, offset: IVec2, rounds: i32, alternate: bool },
}

#[wasm_bindgen]
pub struct ExportSession {
    highlights: Array2<u8>,
    mode:       ExportMode,
    index:      usize,
    total:      usize,
}

#[wasm_bindgen]
impl ExportSession {
    pub fn total(&self) -> usize { self.total }

    pub fn next(&mut self) -> Option<String> {
        if self.index >= self.total { return None; }
        let i = self.index;
        self.index += 1;
        Some(match &self.mode {
            ExportMode::Row { canvas_size, alternate } =>
                export::export_row_at(&self.highlights, *canvas_size, *alternate, i),
            ExportMode::Round { canvas_size, virtual_size, offset, rounds, alternate } =>
                export::export_round_at(&self.highlights, *canvas_size, *virtual_size, *offset, *rounds, *alternate, i),
        })
    }
}

#[wasm_bindgen(start)]
fn init() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

fn to_array2(flat: &[u8], width: i32, height: i32) -> Array2<u8> {
    Array2::from_shape_vec(
        (height as usize, width as usize),
        flat.to_vec(),
    ).expect("pixel buffer size mismatch")
}

// Compute highlights once from pixels (used by both render-plan and export
// paths — they each need it but TS never sees the raw per-cell array).
fn highlights_row(pixels: &[u8], width: i32, height: i32) -> Array2<u8> {
    let pattern = to_array2(pixels, width, height);
    let mut hl  = Array2::zeros((height as usize, width as usize));
    common::compute_row_highlights(IVec2::new(width, height), &pattern, &mut hl);
    hl
}

fn highlights_round(
    pixels: &[u8],
    canvas_size: IVec2, virtual_size: IVec2, offset: IVec2, rounds: i32,
) -> Array2<u8> {
    let pattern = to_array2(pixels, canvas_size.x, canvas_size.y);
    let mut hl  = Array2::zeros((canvas_size.y as usize, canvas_size.x as usize));
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
    pixels:         &[u8],
    canvas_width:   i32, canvas_height:  i32,
    virtual_width:  i32, virtual_height: i32,
    offset_x:       i32, offset_y:       i32,
    rounds:         i32,
) -> Vec<i16> {
    let pattern = to_array2(pixels, canvas_width, canvas_height);
    common::build_highlight_plan_round(
        IVec2::new(canvas_width,  canvas_height),
        IVec2::new(virtual_width, virtual_height),
        IVec2::new(offset_x,      offset_y),
        rounds,
        &pattern,
    )
}

#[wasm_bindgen]
pub fn export_start_row(pixels: &[u8], width: i32, height: i32, alternate: bool) -> ExportSession {
    ExportSession {
        highlights:  highlights_row(pixels, width, height),
        mode:        ExportMode::Row { canvas_size: IVec2::new(width, height), alternate },
        index:       0,
        total:       (height - 1).max(0) as usize,
    }
}

#[wasm_bindgen]
pub fn export_start_round(
    pixels:         &[u8],
    canvas_width:   i32, canvas_height:  i32,
    virtual_width:  i32, virtual_height: i32,
    offset_x:       i32, offset_y:       i32,
    rounds:         i32,
    alternate:      bool,
) -> ExportSession {
    let canvas_size  = IVec2::new(canvas_width,  canvas_height);
    let virtual_size = IVec2::new(virtual_width, virtual_height);
    let offset       = IVec2::new(offset_x,      offset_y);
    ExportSession {
        highlights:  highlights_round(pixels, canvas_size, virtual_size, offset, rounds),
        mode:        ExportMode::Round { canvas_size, virtual_size, offset, rounds, alternate },
        index: 0,
        total: rounds as usize,
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
    canvas_width:   i32,
    canvas_height:  i32,
    virtual_width:  i32,
    virtual_height: i32,
    offset_x:       i32,
    offset_y:       i32,
    rounds:         i32,
) -> Vec<u8> {
    let virtual_size = IVec2::new(virtual_width, virtual_height);
    let offset       = IVec2::new(offset_x,      offset_y);
    let mut grid     = vec![0u8; (canvas_width * canvas_height) as usize];
    for y in 0..canvas_height {
        for x in 0..canvas_width {
            grid[(y * canvas_width + x) as usize] =
                common::natural_color_round(virtual_size, offset, rounds, IVec2::new(x, y));
        }
    }
    grid
}

#[wasm_bindgen]
pub fn paint_pixel(pixels: &[u8], width: i32, height: i32, x: i32, y: i32, color: u8, symmetry_mask: u8) -> Vec<u8> {
    tools::paint_pixel(pixels, width, height, x, y, color, symmetry_mask)
}

#[wasm_bindgen]
pub fn flood_fill(
    pixels: &[u8], width: i32, height: i32,
    start_x: i32, start_y: i32, fill_color: u8, symmetry_mask: u8,
    selection: &[u8],
) -> Vec<u8> {
    tools::flood_fill(pixels, width, height, start_x, start_y, fill_color, symmetry_mask, selection)
}

#[wasm_bindgen]
pub fn wand_select(
    pixels: &[u8], width: i32, height: i32,
    start_x: i32, start_y: i32,
    mode: u8, existing: &[u8],
) -> Vec<u8> {
    tools::wand_select(pixels, width, height, start_x, start_y, mode, existing)
}

#[wasm_bindgen]
pub fn transfer_preserved_row(
    old_pixels: &[u8], old_width: i32, old_height: i32,
    new_pixels: &[u8], new_width: i32, new_height: i32,
) -> Vec<u8> {
    tools::transfer_preserved_row(old_pixels, old_width, old_height, new_pixels, new_width, new_height)
}

#[wasm_bindgen]
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
    tools::transfer_preserved_round(
        old_pixels,
        old_canvas_width, old_canvas_height,
        old_virtual_width, old_virtual_height,
        old_offset_x, old_offset_y, old_rounds,
        new_pixels,
        new_canvas_width, new_canvas_height,
        new_virtual_width, new_virtual_height,
        new_offset_x, new_offset_y, new_rounds,
    )
}

#[wasm_bindgen]
pub fn lock_invalid_row(before: &[u8], after: &[u8], width: i32, height: i32) -> Vec<u8> {
    tools::lock_invalid_row(before, after, width, height)
}

#[wasm_bindgen]
pub fn lock_invalid_round(
    before: &[u8], after: &[u8],
    canvas_width: i32, canvas_height: i32,
    virtual_width: i32, virtual_height: i32,
    offset_x: i32, offset_y: i32, rounds: i32,
) -> Vec<u8> {
    tools::lock_invalid_round(
        before, after, canvas_width, canvas_height,
        virtual_width, virtual_height, offset_x, offset_y, rounds,
    )
}

#[wasm_bindgen]
pub fn paint_natural_row(
    pixels: &[u8], width: i32, height: i32,
    x: i32, y: i32, symmetry_mask: u8, invert: bool,
) -> Vec<u8> {
    tools::paint_natural_row(pixels, width, height, x, y, symmetry_mask, invert)
}

#[wasm_bindgen]
pub fn paint_natural_round(
    pixels: &[u8],
    canvas_width: i32, canvas_height: i32,
    virtual_width: i32, virtual_height: i32,
    offset_x: i32, offset_y: i32, rounds: i32,
    x: i32, y: i32, symmetry_mask: u8, invert: bool,
) -> Vec<u8> {
    tools::paint_natural_round(
        pixels, canvas_width, canvas_height,
        virtual_width, virtual_height, offset_x, offset_y, rounds,
        x, y, symmetry_mask, invert,
    )
}

#[wasm_bindgen]
pub fn paint_overlay_row(pixels: &[u8], width: i32, height: i32, x: i32, y: i32, symmetry_mask: u8) -> Vec<u8> {
    tools::paint_overlay_row(pixels, width, height, x, y, symmetry_mask)
}

#[wasm_bindgen]
pub fn clear_overlay_row(pixels: &[u8], width: i32, height: i32, x: i32, y: i32, symmetry_mask: u8) -> Vec<u8> {
    tools::clear_overlay_row(pixels, width, height, x, y, symmetry_mask)
}

#[wasm_bindgen]
pub fn paint_overlay_round(
    pixels: &[u8],
    canvas_width: i32, canvas_height: i32,
    virtual_width: i32, virtual_height: i32,
    offset_x: i32, offset_y: i32, rounds: i32,
    x: i32, y: i32, symmetry_mask: u8,
) -> Vec<u8> {
    tools::paint_overlay_round(
        pixels, canvas_width, canvas_height,
        virtual_width, virtual_height, offset_x, offset_y, rounds,
        x, y, symmetry_mask,
    )
}

#[wasm_bindgen]
pub fn clear_overlay_round(
    pixels: &[u8],
    canvas_width: i32, canvas_height: i32,
    virtual_width: i32, virtual_height: i32,
    offset_x: i32, offset_y: i32, rounds: i32,
    x: i32, y: i32, symmetry_mask: u8,
) -> Vec<u8> {
    tools::clear_overlay_round(
        pixels, canvas_width, canvas_height,
        virtual_width, virtual_height, offset_x, offset_y, rounds,
        x, y, symmetry_mask,
    )
}

#[wasm_bindgen]
pub fn cut_to_natural_row(
    pixels: &[u8], width: i32, height: i32, selection: &[u8],
) -> Vec<u8> {
    tools::cut_to_natural_row(pixels, width, height, selection)
}

#[wasm_bindgen]
pub fn cut_to_natural_round(
    pixels: &[u8],
    canvas_width: i32, canvas_height: i32,
    virtual_width: i32, virtual_height: i32,
    offset_x: i32, offset_y: i32, rounds: i32,
    selection: &[u8],
) -> Vec<u8> {
    tools::cut_to_natural_round(
        pixels, canvas_width, canvas_height,
        virtual_width, virtual_height, offset_x, offset_y, rounds,
        selection,
    )
}

#[wasm_bindgen]
pub fn symmetric_orbit_indices(canvas_width: i32, canvas_height: i32, x: i32, y: i32, symmetry_mask: u8) -> Vec<u32> {
    tools::symmetric_orbit(x, y, canvas_width, canvas_height, symmetry_mask)
        .into_iter()
        .map(|(sx, sy)| (sy * canvas_width + sx) as u32)
        .collect()
}
