// @vitest-environment jsdom

import { expect, test } from "vitest";
import { faviconImage } from "../src/render";

const A = [0x11, 0x22, 0x33, 255], B = [0xaa, 0xbb, 0xcc, 255], EMPTY = [0, 0, 0, 0];
const colors = [null, "#112233", "#aabbcc"];
const iconPixel = (image: Uint8ClampedArray, x: number, y: number) => Array.from(image.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4));

test("icon pixels show their cells' yarns and leave holes transparent", () => {
    // 64 × 64 cells: each icon pixel covers 2 × 2 cells.
    const pixels = new Uint8Array(64 * 64).fill(1);
    for (const [x, y, value] of [[2, 0, 2], [3, 0, 2], [2, 1, 2], [3, 1, 2], [4, 0, 0], [5, 0, 0], [4, 1, 0], [5, 1, 0]]) pixels[y * 64 + x] = value;
    const image = faviconImage(64, 64, pixels, colors);
    expect(iconPixel(image, 0, 0)).toEqual(A);
    expect(iconPixel(image, 1, 0)).toEqual(B);
    expect(iconPixel(image, 2, 0)).toEqual(EMPTY);
});

test("a small chart draws each cell as a square of icon pixels", () => {
    // 16 × 16 cells: each cell covers 2 × 2 icon pixels.
    const pixels = new Uint8Array(16 * 16).fill(1);
    pixels[1] = 2;
    pixels[2] = 0;
    const image = faviconImage(16, 16, pixels, colors);
    for (const [x, y] of [[0, 0], [1, 1]]) expect(iconPixel(image, x, y)).toEqual(A);
    for (const [x, y] of [[2, 0], [3, 1]]) expect(iconPixel(image, x, y)).toEqual(B);
    for (const [x, y] of [[4, 0], [5, 1]]) expect(iconPixel(image, x, y)).toEqual(EMPTY);
});
