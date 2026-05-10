use glam::IVec2;
use mosaic_crochet_core::{common, export, tools};
use ndarray::Array2;
use wasm_bindgen::prelude::*;

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

fn from_array2(grid: Array2<u8>) -> Vec<u8> {
    grid.into_raw_vec_and_offset().0
}

#[wasm_bindgen]
pub fn compute_row_highlights(
    pixels: &[u8],
    width:  i32,
    height: i32,
) -> Vec<u8> {
    let canvas_size = IVec2::new(width, height);
    let pattern     = to_array2(pixels, width, height);
    let mut highlights = Array2::zeros((height as usize, width as usize));

    common::compute_row_highlights(canvas_size, &pattern, &mut highlights);

    from_array2(highlights)
}

#[wasm_bindgen]
pub fn compute_round_highlights(
    pixels:         &[u8],
    canvas_width:   i32,
    canvas_height:  i32,
    virtual_width:  i32,
    virtual_height: i32,
    offset_x:       i32,
    offset_y:       i32,
    rounds:         i32,
) -> Vec<u8> {
    let canvas_size  = IVec2::new(canvas_width,  canvas_height);
    let virtual_size = IVec2::new(virtual_width, virtual_height);
    let offset       = IVec2::new(offset_x,      offset_y);
    let pattern      = to_array2(pixels, canvas_width, canvas_height);
    let mut highlights = Array2::zeros((canvas_height as usize, canvas_width as usize));

    common::compute_round_highlights(canvas_size, virtual_size, offset, rounds, &pattern, &mut highlights);

    from_array2(highlights)
}

#[wasm_bindgen]
pub fn export_start_row(highlights: &[u8], width: i32, height: i32, alternate: bool) -> ExportSession {
    ExportSession {
        highlights:  to_array2(highlights, width, height),
        mode:        ExportMode::Row { canvas_size: IVec2::new(width, height), alternate },
        index:       0,
        total:       (height - 1).max(0) as usize,
    }
}

#[wasm_bindgen]
pub fn initialize_row_pattern(width: i32, height: i32) -> Vec<u8> {
    let mut grid = Array2::zeros((height as usize, width as usize));
    for y in 0..height {
        let color = common::get_color_index(height - 1 - y);
        for x in 0..width {
            grid[[y as usize, x as usize]] = color;
        }
    }
    from_array2(grid)
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
    let canvas_size  = IVec2::new(canvas_width,  canvas_height);
    let virtual_size = IVec2::new(virtual_width, virtual_height);
    let offset       = IVec2::new(offset_x,      offset_y);
    let mut grid     = Array2::zeros((canvas_height as usize, canvas_width as usize));

    for y in 0..canvas_size.y {
        for x in 0..canvas_size.x {
            let virtual_coord     = IVec2::new(x, y) + offset;
            let round_from_edge   = common::get_round_from_edge(virtual_size, virtual_coord);
            let color = if round_from_edge >= rounds {
                common::COLOR_TRANSPARENT
            } else {
                common::get_color_index(rounds - 1 - round_from_edge)
            };
            grid[[y as usize, x as usize]] = color;
        }
    }
    from_array2(grid)
}

#[wasm_bindgen]
pub fn export_start_round(
    highlights:     &[u8],
    canvas_width:   i32,
    canvas_height:  i32,
    virtual_width:  i32,
    virtual_height: i32,
    offset_x:       i32,
    offset_y:       i32,
    rounds:         i32,
    alternate:      bool,
) -> ExportSession {
    ExportSession {
        highlights:  to_array2(highlights, canvas_width, canvas_height),
        mode:        ExportMode::Round {
            canvas_size:  IVec2::new(canvas_width,  canvas_height),
            virtual_size: IVec2::new(virtual_width, virtual_height),
            offset:       IVec2::new(offset_x,      offset_y),
            rounds, alternate,
        },
        index: 0,
        total: rounds as usize,
    }
}

#[wasm_bindgen]
pub fn paint_pixel(pixels: &[u8], width: i32, height: i32, x: i32, y: i32, color: u8, symmetry_mask: u8) -> Vec<u8> {
    tools::paint_pixel(pixels, width, height, x, y, color, symmetry_mask)
}

#[wasm_bindgen]
pub fn flood_fill(pixels: &[u8], width: i32, height: i32, start_x: i32, start_y: i32, fill_color: u8, symmetry_mask: u8) -> Vec<u8> {
    tools::flood_fill(pixels, width, height, start_x, start_y, fill_color, symmetry_mask)
}

#[wasm_bindgen]
pub fn erase_pixel_row(pixels: &[u8], width: i32, height: i32, x: i32, y: i32, symmetry_mask: u8) -> Vec<u8> {
    tools::erase_pixel_row(pixels, width, height, x, y, symmetry_mask)
}

#[wasm_bindgen]
pub fn erase_pixel_round(pixels: &[u8], canvas_width: i32, canvas_height: i32, x: i32, y: i32,
                          virtual_size_x: i32, virtual_size_y: i32, offset_x: i32, offset_y: i32,
                          rounds: i32, symmetry_mask: u8) -> Vec<u8> {
    tools::erase_pixel_round(pixels, canvas_width, canvas_height, x, y,
                              virtual_size_x, virtual_size_y, offset_x, offset_y, rounds, symmetry_mask)
}

#[wasm_bindgen]
pub fn symmetric_orbit_indices(canvas_width: i32, canvas_height: i32, x: i32, y: i32, symmetry_mask: u8) -> Vec<u32> {
    tools::symmetric_orbit(x, y, canvas_width, canvas_height, symmetry_mask)
        .into_iter()
        .map(|(sx, sy)| (sy * canvas_width + sx) as u32)
        .collect()
}
