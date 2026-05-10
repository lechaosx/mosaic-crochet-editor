#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq)]
pub enum Stitch {
    Sc,
    Oc,
    Ch,
}

impl Stitch {
    pub fn as_str(self) -> &'static str {
        match self {
            Stitch::Sc => "sc",
            Stitch::Oc => "oc",
            Stitch::Ch => "ch",
        }
    }
}

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct RepeatData {
    pub items: Vec<SequenceItem>,
    pub count: usize,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub enum SequenceItem {
    Stitch(Stitch),
    /// Stitches worked into the same parent (rendered with parentheses).
    Group(Box<[SequenceItem]>),
    RepeatGroup(Box<RepeatData>),
}

impl SequenceItem {
    pub fn group(items: Vec<SequenceItem>) -> Self {
        SequenceItem::Group(items.into_boxed_slice())
    }

    pub fn repeat(items: Vec<SequenceItem>, count: usize) -> Self {
        SequenceItem::RepeatGroup(Box::new(RepeatData { items, count }))
    }
}

#[derive(Clone, Copy)]
enum Decision {
    Literal,
    Split  { k: u32 },
    Repeat { period: u32 },
}

/// LCE table: `lce[i * n + j]` (for `i < j`) is the length of the longest
/// shared prefix between the suffixes `items[i..]` and `items[j..]`. Built
/// in O(n²) via the recurrence
///   lce(i,j) = if items[i] == items[j] then 1 + lce(i+1, j+1) else 0.
/// With this table, periodicity is one read: `items[s..s+len]` is
/// `period`-periodic iff `len % period == 0 && lce(s, s+period) >= len-period`.
fn build_lce(items: &[SequenceItem]) -> Vec<u32> {
    let n = items.len();
    let mut lce = vec![0u32; n * n];
    for i in (0..n).rev() {
        for j in ((i + 1)..n).rev() {
            if items[i] == items[j] {
                let next = if i + 1 < n && j + 1 < n {
                    lce[(i + 1) * n + (j + 1)]
                } else { 0 };
                lce[i * n + j] = next + 1;
            }
        }
    }
    lce
}

/// Bottom-up DP filling `cost` and `dec` tables in increasing-length order.
/// Each cell `(start, len)` reads only cells with strictly smaller `len`,
/// so a single forward pass suffices.
///
/// Per cell, work is ordered most-promising-first and aggressively pruned:
/// - Periods iterate 1..=len/2. The first valid period in iteration order is
///   the fundamental period `q` of the slice; by Fine–Wilf any other valid
///   period is a multiple `kq` of it, and `cost[start, kq] = cost[start, q]`,
///   so we `break` after the first hit — larger valid periods can't improve
///   the inner cost.
/// - If `best_cost == 1` after the period (or before) we're at the floor;
///   any non-empty slice has cost ≥ 1.
/// - Splits run second only if `best_cost > 2` — a split is two non-empty
///   children each with cost ≥ 1, so total ≥ 2; if `best_cost <= 2` no
///   split can beat it, skip the loop entirely.
/// - Within the split loop, branch-and-bound is tightened from the naive
///   `left >= best_cost` to `left + 1 >= best_cost`. The `+1` is the floor
///   on `cost(right)`, letting us prune one step earlier (e.g. when
///   `best_cost == 3` we can drop splits with `left == 2` immediately).
fn solve(
    n:      usize,
    lce:    &[u32],
    stride: usize,
) -> (Vec<u32>, Vec<Decision>) {
    let table_size = stride * stride;
    let mut cost = vec![0u32;             table_size];
    let mut dec  = vec![Decision::Literal; table_size];

    for start in 0..n {
        cost[start * stride + 1] = 1;
    }

    for len in 2..=n {
        for start in 0..=(n - len) {
            let cell = start * stride + len;
            let mut best_cost = len as u32;
            let mut best_dec  = Decision::Literal;

            let need_base = len as u32;
            for period in 1..=(len / 2) {
                if len % period != 0 { continue; }
                let need = need_base - period as u32;
                if lce[start * n + (start + period)] < need { continue; }
                let inner_cost = cost[start * stride + period];
                if inner_cost < best_cost {
                    best_cost = inner_cost;
                    best_dec  = Decision::Repeat { period: period as u32 };
                }
                break;
            }

            if best_cost > 2 {
                for k in 1..len {
                    let left = cost[start * stride + k];
                    if left + 1 >= best_cost { continue; }
                    let right = cost[(start + k) * stride + (len - k)];
                    let total = left + right;
                    if total < best_cost {
                        best_cost = total;
                        best_dec  = Decision::Split { k: k as u32 };
                    }
                }
            }

            cost[cell] = best_cost;
            dec [cell] = best_dec;
        }
    }

    (cost, dec)
}

fn reconstruct(
    items:  &[SequenceItem],
    start:  usize,
    len:    usize,
    dec:    &[Decision],
    stride: usize,
) -> Vec<SequenceItem> {
    if len == 0 { return Vec::new(); }

    match dec[start * stride + len] {
        Decision::Literal => items[start..start + len].to_vec(),
        Decision::Split { k } => {
            let k = k as usize;
            let mut out = reconstruct(items, start, k, dec, stride);
            out.extend(reconstruct(items, start + k, len - k, dec, stride));
            out
        }
        Decision::Repeat { period } => {
            let period = period as usize;
            vec![SequenceItem::repeat(
                reconstruct(items, start, period, dec, stride),
                len / period,
            )]
        }
    }
}

/// Maximum-compression DP. Iterative bottom-up over `(start, len)` cells.
/// Periods are O(1) per check (LCE table); splits prune via branch-and-bound
/// against the current best. Overall O(n³) with a tight constant.
pub fn compress(items: &[SequenceItem]) -> Vec<SequenceItem> {
    let n = items.len();
    if n == 0 { return Vec::new(); }
    let stride = n + 1;
    let lce = build_lce(items);
    let (_, dec) = solve(n, &lce, stride);
    reconstruct(items, 0, n, &dec, stride)
}

/// Renders an item as one syntactic token: a bare stitch ("sc") or a
/// parenthesized parent group ("(sc, oc)"). Used to decide whether a
/// `RepeatGroup` containing exactly one item needs `[]` brackets.
fn is_atomic(item: &SequenceItem) -> bool {
    matches!(item, SequenceItem::Stitch(_) | SequenceItem::Group(_))
}

/// Human-readable serialization.
/// Single-stitch repeats: "sc × 3". Multi-stitch groups: "[sc, dc] × 4".
pub fn to_string(seq: &[SequenceItem]) -> String {
    seq.iter().map(|item| match item {
        SequenceItem::Stitch(s) => s.as_str().to_string(),
        SequenceItem::Group(items) => format!("({})", to_string(items)),
        SequenceItem::RepeatGroup(data) => {
            let RepeatData { items, count } = data.as_ref();
            if items.len() == 1 && is_atomic(&items[0]) {
                format!("{} × {count}", to_string(items))
            } else {
                format!("[{}] × {count}", to_string(items))
            }
        }
    })
    .collect::<Vec<_>>()
    .join(", ")
}

// ─────────────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    // ── helpers ──────────────────────────────────────────────────────────────

    fn sc()  -> SequenceItem { SequenceItem::Stitch(Stitch::Sc) }
    fn oc()  -> SequenceItem { SequenceItem::Stitch(Stitch::Oc) }
    fn rep(items: Vec<SequenceItem>, count: usize) -> SequenceItem {
        SequenceItem::repeat(items, count)
    }

    /// Expand a compressed sequence back to a flat list (mirrors Lua `flatten`).
    fn flatten(seq: &[SequenceItem]) -> Vec<SequenceItem> {
        let mut r = Vec::new();
        for item in seq {
            match item {
                SequenceItem::Stitch(_) | SequenceItem::Group(_) => r.push(item.clone()),
                SequenceItem::RepeatGroup(data) => {
                    let inner = flatten(&data.items);
                    for _ in 0..data.count { r.extend_from_slice(&inner); }
                }
            }
        }
        r
    }

    fn eq(got: &[SequenceItem], expected: &[SequenceItem]) {
        assert_eq!(
            to_string(got), to_string(expected),
            "\n  got:      {}\n  expected: {}",
            to_string(got), to_string(expected),
        );
    }

    // ── compress: basics ─────────────────────────────────────────────────────

    #[test]
    fn compress_empty() { assert!(compress(&[]).is_empty()); }

    #[test]
    fn compress_single_sc() { eq(&compress(&[sc()]), &[sc()]); }

    #[test]
    fn compress_single_oc() { eq(&compress(&[oc()]), &[oc()]); }

    #[test]
    fn compress_same_type_collapses() {
        eq(&compress(&[sc(),sc(),sc(),sc()]), &[rep(vec![sc()], 4)]);
    }

    #[test]
    fn compress_two_different_no_grouping() {
        eq(&compress(&[sc(),oc()]), &[sc(),oc()]);
    }

    #[test]
    fn compress_three_non_repeating() {
        eq(&compress(&[sc(),sc(),oc()]), &[rep(vec![sc()],2), oc()]);
    }

    // ── compress: boundary-merge cases ───────────────────────────────────────

    #[test]
    fn compress_sc_oc_sc_x3_boundary_merge() {
        // [sc,oc,sc]×3: trailing sc and leading sc of adjacent periods merge in naive RLE
        let flat = flatten(&[rep(vec![sc(),oc(),sc()], 3)]);
        eq(&compress(&flat), &[rep(vec![sc(),oc(),sc()], 3)]);
    }

    #[test]
    fn compress_oc_sc_oc_x3_boundary_merge() {
        let flat = flatten(&[rep(vec![oc(),sc(),oc()], 3)]);
        eq(&compress(&flat), &[rep(vec![oc(),sc(),oc()], 3)]);
    }

    #[test]
    fn compress_sc_oc_sc_oc_x2_boundary_merge() {
        // period=2 beats period=4 with count=2
        let flat = flatten(&[rep(vec![sc(),oc(),sc(),oc()], 2)]);
        eq(&compress(&flat), &[rep(vec![sc(),oc()], 4)]);
    }

    // ── compress: clean periods (no boundary merge) ───────────────────────────

    #[test]
    fn compress_alternating_sc_oc_x12() {
        let flat = flatten(&[rep(vec![sc(),oc()], 12)]);
        eq(&compress(&flat), &[rep(vec![sc(),oc()], 12)]);
    }

    #[test]
    fn compress_checker_2sc_2oc_x4() {
        let flat = flatten(&[rep(vec![sc(),sc(),oc(),oc()], 4)]);
        eq(&compress(&flat), &[rep(vec![rep(vec![sc()],2),rep(vec![oc()],2)], 4)]);
    }

    #[test]
    fn compress_3sc_oc_x3() {
        let flat = flatten(&[rep(vec![sc(),sc(),sc(),oc()], 3)]);
        eq(&compress(&flat), &[rep(vec![rep(vec![sc()],3),oc()], 3)]);
    }

    #[test]
    fn compress_period_count_2_saves_one_token() {
        let flat = flatten(&[rep(vec![sc(),sc(),oc(),oc()], 2)]);
        eq(&compress(&flat), &[rep(vec![rep(vec![sc()],2),rep(vec![oc()],2)], 2)]);
    }

    // ── compress: prefix / suffix ─────────────────────────────────────────────

    #[test]
    fn compress_unique_prefix_then_repeat() {
        let input = flatten(&[rep(vec![sc()],3), rep(vec![oc(),sc()],4)]);
        eq(&compress(&input), &[rep(vec![sc()],3), rep(vec![oc(),sc()],4)]);
    }

    #[test]
    fn compress_repeat_then_unique_suffix() {
        let input = flatten(&[rep(vec![sc(),oc()],4), rep(vec![sc()],3)]);
        eq(&compress(&input), &[rep(vec![sc(),oc()],4), rep(vec![sc()],3)]);
    }

    #[test]
    fn compress_two_separate_repeat_groups() {
        let input = flatten(&[rep(vec![sc(),oc()],3), rep(vec![rep(vec![sc()],2),rep(vec![oc()],2)],2)]);
        eq(&compress(&input), &[rep(vec![sc(),oc()],3), rep(vec![rep(vec![sc()],2),rep(vec![oc()],2)],2)]);
    }

    // ── compress: nested repeats ──────────────────────────────────────────────

    #[test]
    fn compress_nested_sc_oc_x3_then_oc_x3() {
        let flat = flatten(&[rep(vec![sc(),oc(),sc(),oc(),sc(),oc(),oc()], 3)]);
        eq(&compress(&flat), &[rep(vec![rep(vec![sc(),oc()],3),oc()], 3)]);
    }

    #[test]
    fn compress_nested_sc_oc_x4_then_oc_x2() {
        let flat = flatten(&[rep(vec![sc(),oc(),sc(),oc(),sc(),oc(),sc(),oc(),oc()], 2)]);
        eq(&compress(&flat), &[rep(vec![rep(vec![sc(),oc()],4),oc()], 2)]);
    }

    // ── compress: non-divisible length ───────────────────────────────────────

    #[test]
    fn compress_7_chars_split_at_leftmost() {
        let input = vec![sc(),oc(),sc(),oc(),sc(),oc(),sc()];
        eq(&compress(&input), &[sc(), rep(vec![oc(),sc()], 3)]);
    }

    #[test]
    fn compress_period5_beats_naive_split() {
        let flat = flatten(&[rep(vec![sc(),rep(vec![oc(),sc()],2)], 2)]);
        eq(&compress(&flat), &[rep(vec![sc(),rep(vec![oc(),sc()],2)], 2)]);
    }

    // ── compress: edge cases ─────────────────────────────────────────────────

    #[test]
    fn compress_all_sc_single_leaf() {
        let flat = flatten(&[rep(vec![sc()], 10)]);
        eq(&compress(&flat), &[rep(vec![sc()], 10)]);
    }

    #[test]
    fn compress_count_10_repeat() {
        let flat = flatten(&[rep(vec![sc(),oc()], 10)]);
        eq(&compress(&flat), &[rep(vec![sc(),oc()], 10)]);
    }

    #[test]
    fn compress_count_is_integer_not_float() {
        let result = compress(&flatten(&[rep(vec![sc(),oc()], 3)]));
        assert!(!to_string(&result).contains('.'));
    }

    #[test]
    fn compress_nested_inner_over_flat_inner() {
        // period 5, count 2: [[sc,oc]×2, oc]×2 cheaper than literal
        let flat = flatten(&[rep(vec![sc(),oc(),sc(),oc(),oc()], 2)]);
        eq(&compress(&flat), &[rep(vec![rep(vec![sc(),oc()],2),oc()], 2)]);
    }

    // ── roundtrip: no information lost ───────────────────────────────────────

    #[test]
    fn roundtrip_sc_oc_sc_x3() {
        let flat = flatten(&[rep(vec![sc(),oc(),sc()], 3)]);
        assert_eq!(flatten(&compress(&flat)), flat);
    }

    #[test]
    fn roundtrip_diagonal_stripe_x3() {
        let flat = flatten(&[rep(vec![sc(),oc(),sc(),sc(),oc(),oc(),sc(),oc()], 3)]);
        assert_eq!(flatten(&compress(&flat)), flat);
    }

    #[test]
    fn roundtrip_all_sc() {
        let flat = flatten(&[rep(vec![sc()], 20)]);
        assert_eq!(flatten(&compress(&flat)), flat);
    }

    #[test]
    fn roundtrip_alternating_x15() {
        let flat = flatten(&[rep(vec![sc(),oc()], 15)]);
        assert_eq!(flatten(&compress(&flat)), flat);
    }

    #[test]
    fn roundtrip_nested_pattern_x3() {
        let flat = flatten(&[rep(vec![sc(),oc(),sc(),oc(),sc(),oc(),oc()], 3)]);
        assert_eq!(flatten(&compress(&flat)), flat);
    }

    // ── to_string ─────────────────────────────────────────────────────────────

    #[test]
    fn to_string_single_stitch() {
        assert_eq!(to_string(&[sc()]), "sc");
        assert_eq!(to_string(&[oc()]), "oc");
    }

    #[test]
    fn to_string_flat_sequence() {
        assert_eq!(to_string(&[sc(),oc(),sc()]), "sc, oc, sc");
    }

    #[test]
    fn to_string_single_stitch_repeat() {
        assert_eq!(to_string(&[rep(vec![sc()], 3)]), "sc × 3");
        assert_eq!(to_string(&[rep(vec![oc()], 10)]), "oc × 10");
    }

    #[test]
    fn to_string_shallow_repeat_group() {
        assert_eq!(to_string(&[rep(vec![sc(),oc()], 4)]), "[sc, oc] × 4");
    }

    #[test]
    fn to_string_nested_repeat_group() {
        let inner = rep(vec![sc(),oc()], 2);
        let outer = rep(vec![inner, sc()], 3);
        assert_eq!(to_string(&[outer]), "[[sc, oc] × 2, sc] × 3");
    }

    #[test]
    fn to_string_mixed_flat_and_grouped() {
        let item = rep(vec![oc(), rep(vec![sc()], 2)], 3);
        assert_eq!(to_string(&[sc(), item, oc()]), "sc, [oc, sc × 2] × 3, oc");
    }
}
