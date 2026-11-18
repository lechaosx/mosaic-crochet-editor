// WebGL2 layer under the Canvas 2D overlay: background, cells, grid and the
// highlight plan's ✕ / ! glyphs, shaded per device pixel from the bytes of
// `packChartCells`. It keeps the latest frame it was given, to redraw it after
// a context restore, and a CPU copy of the cell texture, to upload only the
// rows that change.

import { CELL_CROSS, CELL_CROSS_B, CELL_WARNING } from "./chart-cells";

const VERTEX = `#version 300 es
void main() {
    vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

// Glyph-free charts use a program compiled without the glyph code: software
// rasterisers pay for every branch whether or not it is taken.
const fragment = (glyphs: boolean) => `#version 300 es
${glyphs ? "#define GLYPHS" : ""}
precision highp float;
precision highp int;
precision highp usampler2D;

uniform usampler2D uCells;     // packChartCells bytes, 4 per texel, rows of 1 << uRowShift texels
uniform int uRowShift;
uniform ivec2 uSize;           // pattern W, H
uniform ivec2 uOrigin;         // cell near the viewport the inverse transform is relative to
uniform vec3 uInverseX, uInverseY;  // device px -> pattern position - uOrigin
uniform mat2 uForward;         // pattern -> device px, linear part
uniform float uCellPx, uViewHeight, uOpacity;
uniform vec3 uYarnA, uYarnB, uBackground, uDanger;
out vec4 colour;

uint cellAt(ivec2 c) {
    if (any(lessThan(c, ivec2(-1))) || any(greaterThan(c, uSize))) return 0u;
    int byteIndex = (c.y + 1) * (uSize.x + 2) + c.x + 1, texel = byteIndex >> 2;
    uvec4 bytes = texelFetch(uCells, ivec2(texel & ((1 << uRowShift) - 1), texel >> uRowShift), 0);
    return bytes[byteIndex & 3];
}

// Box-filtered coverage of a band of half-width r at distance d (device px) from its axis.
float band(float d, float r) {
    return clamp(min(d + 0.5, r) - max(d - 0.5, -r), 0.0, 1.0);
}

float segment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}

void main() {
    vec2 device = vec2(gl_FragCoord.x, uViewHeight - gl_FragCoord.y);
    vec2 q = vec2(dot(uInverseX, vec3(device, 1.0)), dot(uInverseY, vec3(device, 1.0)));
    ivec2 c = uOrigin + ivec2(floor(q));
    vec2 f = fract(q);
    uint v = cellAt(c);
    uint yarn = v & 3u;
    vec3 col = yarn == 1u ? uYarnA : yarn == 2u ? uYarnB : uBackground;

    // Grid: 1 device px lines on every cell edge of the pattern rectangle.
    ivec2 line = c + ivec2(greaterThanEqual(f, vec2(0.5)));
    vec2 d = min(f, 1.0 - f) * uCellPx;
    float grid = 0.0;
    if (line.x >= 0 && line.x <= uSize.x && c.y >= 0 && c.y < uSize.y) grid = band(d.x, 0.5);
    if (line.y >= 0 && line.y <= uSize.y && c.x >= 0 && c.x < uSize.x) grid = max(grid, band(d.y, 0.5));
    col = mix(col, vec3(128.0 / 255.0), 0.18 * grid);

#ifdef GLYPHS
    // renderHighlightSymbols in render.ts draws these glyphs for the colour
    // preview; change both together.
    float stroke = 0.08 * uCellPx;
    if ((v & ${CELL_CROSS}u) != 0u) {
        // ✕ in pattern space, turning with the chart.
        float cross = min(segment(f, vec2(0.24), vec2(0.76)), segment(f, vec2(0.76, 0.24), vec2(0.24, 0.76)));
        col = mix(col, (v & ${CELL_CROSS_B}u) != 0u ? uYarnB : uYarnA, uOpacity * band(cross * uCellPx, stroke));
    }
    if ((v & ${CELL_WARNING}u) != 0u) {
        // ! upright on screen around the cell centre.
        vec2 s = uForward * (f - 0.5);
        float mark = max(band(segment(s, vec2(0.0, -0.28 * uCellPx), vec2(0.0, 0.08 * uCellPx)), stroke),
            band(length(s - vec2(0.0, 0.28 * uCellPx)), 0.09 * uCellPx));
        col = mix(col, uDanger, uOpacity * mark);
    }
#endif
    colour = vec4(col, 1.0);
}`;

const UNIFORMS = ["uCells", "uRowShift", "uSize", "uOrigin", "uInverseX", "uInverseY", "uForward",
    "uCellPx", "uViewHeight", "uOpacity", "uYarnA", "uYarnB", "uBackground", "uDanger"] as const;
type Uniforms = Record<typeof UNIFORMS[number], WebGLUniformLocation | null>;
interface Program { program: WebGLProgram; uniforms: Uniforms }

interface TextureLayout { rowShift: number; rows: number }

interface Resources {
    plain: Program;
    glyphs: Program;
    texture: WebGLTexture | null;
    layout: TextureLayout | null;
    // The texture's contents; `cells` is the array it was last updated from.
    uploaded: Uint8Array;
    cells: Uint8Array | null;
    // The frame on the canvas and the inputs it was drawn from.
    drawn: { frame: ChartFrame; inputs: unknown[] } | null;
}

export interface ChartLayer {
    readonly canvas: HTMLCanvasElement;
    readonly gl: WebGL2RenderingContext;
    readonly onAvailability: (available: boolean) => void;
    available: boolean;
    // Null while the context is lost.
    resources: Resources | null;
    frame: ChartFrame | null;
}

export interface ChartFrame {
    cells: Uint8Array;
    width: number;
    height: number;
    hasGlyphs: boolean;
    matrix: DOMMatrix;          // pattern -> device px
    colors: { a: string; b: string; background: string; danger: string };
    opacity: number;
}

// Null when the browser has no WebGL2 or can't build the chart's shaders.
// `onAvailability` reports when the chart can no longer be shown (a lost
// context, or cells beyond the device's texture limit) and when it can again.
export function createChartLayer(
    canvas: HTMLCanvasElement, onAvailability: (available: boolean) => void,
): ChartLayer | null {
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false });
    const resources = gl && createResources(gl);
    if (!gl || !resources) return null;
    const layer: ChartLayer = { canvas, gl, onAvailability, available: true, resources, frame: null };
    canvas.addEventListener("webglcontextlost", event => {
        event.preventDefault();
        layer.resources = null;
        setAvailable(layer, false);
    });
    canvas.addEventListener("webglcontextrestored", () => {
        layer.resources = createResources(gl);
        setAvailable(layer, layer.resources !== null);
        if (layer.frame) drawChartLayer(layer, layer.frame);
    });
    // E2E test hook: repaints a device-pixel region of the frame on the canvas,
    // so a read in the same task sees it after the browser has presented and
    // discarded the buffer. Only the region is painted, as a whole frame per
    // read is slow on software GPUs; the rest of a discarded buffer stays blank
    // until the chart next changes.
    (window as unknown as { __test_repaint_chart__?: (x: number, y: number, width: number, height: number) => void })
        .__test_repaint_chart__ = (x, y, width, height) => {
            if (!layer.resources?.drawn) return;
            gl.enable(gl.SCISSOR_TEST);
            gl.scissor(x, canvas.height - y - height, width, height);
            paint(layer, layer.resources, layer.resources.drawn.frame);
            gl.disable(gl.SCISSOR_TEST);
        };
    return layer;
}

function setAvailable(layer: ChartLayer, available: boolean) {
    if (layer.available === available) return;
    layer.available = available;
    layer.onAvailability(available);
}

function createResources(gl: WebGL2RenderingContext): Resources | null {
    gl.bindVertexArray(gl.createVertexArray());
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const plain = createProgram(gl, false), glyphs = createProgram(gl, true);
    return plain && glyphs && { plain, glyphs, texture: null, layout: null, uploaded: new Uint8Array(), cells: null, drawn: null };
}

// Null when the program fails to link in a live context.
function createProgram(gl: WebGL2RenderingContext, glyphs: boolean): Program | null {
    const program = gl.createProgram()!;
    for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, fragment(glyphs)]] as const) {
        const shader = gl.createShader(type)!;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
        console.error(`Chart shader failed to link: ${gl.getProgramInfoLog(program)}`);
        return null;
    }
    const uniforms = Object.fromEntries(UNIFORMS.map(name => [name, gl.getUniformLocation(program, name)])) as Uniforms;
    return { program, uniforms };
}

// Four cell bytes per texel, in rows of a power-of-two length so the shader
// can wrap the linear index with shifts. Null when the rows exceed the limit.
export function cellTextureLayout(bytes: number, maxTextureSize: number): TextureLayout | null {
    const rowShift = Math.floor(Math.log2(maxTextureSize));
    const rows = Math.ceil(Math.ceil(bytes / 4) / (1 << rowShift));
    return rows <= maxTextureSize ? { rowShift, rows } : null;
}

// Brings the texture up to `cells`, uploading only the rows that differ.
function uploadCells(
    gl: WebGL2RenderingContext, resources: Resources, cells: Uint8Array, layout: TextureLayout,
) {
    if (resources.cells === cells) return;
    resources.cells = cells;
    const { rowShift, rows } = layout;
    const rowBytes = 4 << rowShift;
    if (!resources.texture || resources.layout?.rowShift !== rowShift || resources.layout.rows !== rows) {
        if (resources.texture) gl.deleteTexture(resources.texture);
        resources.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, resources.texture);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8UI, 1 << rowShift, rows);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        resources.layout = layout;
        resources.uploaded = new Uint8Array(rowBytes * rows);
        resources.uploaded.set(cells);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1 << rowShift, rows, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, resources.uploaded);
        return;
    }
    const { uploaded } = resources;
    let first = 0, last = cells.length - 1;
    while (first < cells.length && cells[first] === uploaded[first]) first++;
    if (first === cells.length) return;
    while (cells[last] === uploaded[last]) last--;
    const firstRow = Math.floor(first / rowBytes), lastRow = Math.floor(last / rowBytes);
    uploaded.set(cells.subarray(firstRow * rowBytes, (lastRow + 1) * rowBytes), firstRow * rowBytes);
    gl.bindTexture(gl.TEXTURE_2D, resources.texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, firstRow, 1 << rowShift, lastRow - firstRow + 1,
        gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, uploaded, firstRow * rowBytes);
}

function rgb(hex: string): [number, number, number] {
    const value = parseInt(hex.slice(1), 16);
    return [(value >> 16) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

export function drawChartLayer(layer: ChartLayer, frame: ChartFrame) {
    layer.frame = frame;
    const { gl, canvas, resources } = layer;
    if (!resources) return;
    // Without GL calls the canvas keeps showing its last frame, so frames that
    // only move the overlay, such as marching ants, skip the chart.
    const { a, b, background, danger } = frame.colors;
    const inputs = [frame.cells, canvas.width, canvas.height, frame.hasGlyphs, frame.opacity,
        a, b, background, danger, ...frame.matrix.toFloat64Array()];
    if (resources.drawn?.inputs.every((value, index) => value === inputs[index])) return;
    const layout = cellTextureLayout(frame.cells.length, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
    setAvailable(layer, layout !== null);
    if (!layout) return;
    resources.drawn = { frame, inputs };
    uploadCells(gl, resources, frame.cells, layout);
    paint(layer, resources, frame);
}

function paint(layer: ChartLayer, resources: Resources, frame: ChartFrame) {
    const { gl, canvas } = layer;
    const { program, uniforms: u } = frame.hasGlyphs && frame.opacity > 0 ? resources.glyphs : resources.plain;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, resources.texture);
    gl.uniform1i(u.uCells, 0);
    gl.uniform1i(u.uRowShift, resources.layout!.rowShift);
    gl.uniform2i(u.uSize, frame.width, frame.height);

    // Float32 cannot place a pixel within a long pattern precisely, so the
    // shader works relative to the cell under the viewport centre.
    const { a, b, c, d } = frame.matrix;
    const inverse = frame.matrix.inverse();
    const centre = inverse.transformPoint({ x: canvas.width / 2, y: canvas.height / 2 });
    const originX = Math.floor(centre.x), originY = Math.floor(centre.y);
    gl.uniform2i(u.uOrigin, originX, originY);
    gl.uniform3f(u.uInverseX, inverse.a, inverse.c, inverse.e - originX);
    gl.uniform3f(u.uInverseY, inverse.b, inverse.d, inverse.f - originY);
    gl.uniformMatrix2fv(u.uForward, false, [a, b, c, d]);
    gl.uniform1f(u.uCellPx, Math.hypot(a, b));
    gl.uniform1f(u.uViewHeight, canvas.height);
    gl.uniform1f(u.uOpacity, frame.opacity);
    gl.uniform3fv(u.uYarnA, rgb(frame.colors.a));
    gl.uniform3fv(u.uYarnB, rgb(frame.colors.b));
    gl.uniform3fv(u.uBackground, rgb(frame.colors.background));
    gl.uniform3fv(u.uDanger, rgb(frame.colors.danger));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
}
