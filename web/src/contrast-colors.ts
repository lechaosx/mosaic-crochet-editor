const DANGER_CANDIDATES = [
    "#330000", "#8b0000", "#b71c1c", "#c62828", "#d32f2f", "#ff1744", "#ff6f00", "#fff0f0",
] as const;
const ACCENT_CANDIDATES = [
    "#001a33", "#003f5c", "#00695c", "#0072b2", "#00838f", "#6a5acd", "#8e44ad", "#e69f00", "#eefaff",
] as const;

function rgb(color: string): [number, number, number] {
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new TypeError("Expected a six-digit hex colour.");
    return [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16)) as [number, number, number];
}

function luminance(color: string): number {
    const channels = rgb(color).map(value => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
    const first = luminance(a), second = luminance(b);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function distance(a: string, b: string): number {
    const first = rgb(a), second = rgb(b);
    return Math.hypot(...first.map((value, index) => value - second[index]));
}

export function contrastingProjectColors(
    yarnA: string, yarnB: string,
): { danger: string; accent: string } {
    let best: { danger: string; accent: string; score: [number, number, number] } | null = null;
    for (const danger of DANGER_CANDIDATES) {
        const dangerContrast = Math.min(contrast(danger, yarnA), contrast(danger, yarnB));
        for (const accent of ACCENT_CANDIDATES) {
            const accentContrast = Math.min(contrast(accent, yarnA), contrast(accent, yarnB));
            const score: [number, number, number] = [
                Math.min(dangerContrast, accentContrast),
                dangerContrast + accentContrast,
                distance(danger, accent),
            ];
            if (!best
                || score[0] > best.score[0]
                || (score[0] === best.score[0] && score[1] > best.score[1])
                || (score[0] === best.score[0] && score[1] === best.score[1] && score[2] > best.score[2])) {
                best = { danger, accent, score };
            }
        }
    }
    return { danger: best!.danger, accent: best!.accent };
}
