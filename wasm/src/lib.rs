use glam::IVec2;
use mosaic_crochet_core::{common, export};
use ndarray::Array2;
use wasm_bindgen::prelude::*;

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
pub fn export_row_pattern(
    highlights: &[u8],
    width:      i32,
    height:     i32,
    alternate:  bool,
) -> String {
    let canvas_size = IVec2::new(width, height);
    let highlights  = to_array2(highlights, width, height);
    export::export_row_pattern(&highlights, canvas_size, alternate)
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
pub fn export_round_pattern(
    highlights:     &[u8],
    canvas_width:   i32,
    canvas_height:  i32,
    virtual_width:  i32,
    virtual_height: i32,
    offset_x:       i32,
    offset_y:       i32,
    rounds:         i32,
    alternate:      bool,
) -> String {
    let canvas_size  = IVec2::new(canvas_width,  canvas_height);
    let virtual_size = IVec2::new(virtual_width, virtual_height);
    let offset       = IVec2::new(offset_x,      offset_y);
    let highlights   = to_array2(highlights, canvas_width, canvas_height);
    export::export_round_pattern(&highlights, canvas_size, virtual_size, offset, rounds, alternate)
}
