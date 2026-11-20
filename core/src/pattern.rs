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

/// Longest repeat body, in items, that compression searches for. It bounds
/// compression to O(n·P²) time and O(n + P²) memory.
const MAX_REPEAT_PERIOD: usize = 64;

/// Fewest-items encoding: a sequence costs the items it writes out, with
/// each repeat body counted once. Among equally cheap encodings, a repeat of
/// everything that remains wins, then the shortest leading block.
pub fn compress(items: &[SequenceItem]) -> Vec<SequenceItem> {
    compress_capped(items, MAX_REPEAT_PERIOD)
}

/// Searches only repeats whose body has at most `max_period` items.
///
/// One right-to-left pass computes `best[a]`, the cost of `items[a..]`, from
/// its first block: a single item, or `c ≥ 2` copies of a primitive body of
/// period `p ≤ max_period`. Copies of a body share its cost, so per `p` only
/// the cheapest remainder `best[a + c·p]` over the current `p`-periodic run is
/// needed, which a running minimum per residue `a % p` keeps. Body costs come
/// from the same recurrence restricted to slices of at most `max_period`
/// items, kept in ring buffers.
fn compress_capped(items: &[SequenceItem], max_period: usize) -> Vec<SequenceItem> {
    let n = items.len();
    let cap = max_period.min(n / 2);
    let divisors: Vec<Vec<usize>> = (0..=cap)
        .map(|len| (1..=len / 2).filter(|&q| len.is_multiple_of(q)).collect())
        .collect();
    let width = (cap + 1).next_power_of_two();
    let mask = width - 1;

    // lce[p]: length of the common prefix of items[a..] and items[a + p..].
    let mut lce = vec![0usize; cap + 1];
    // The cost of items[s..s + len] for the last `width` starts s and ends
    // s + len, at by_start[(s & mask) * width + len] and
    // by_end[((s + len) & mask) * width + width - len]. The two layouts make
    // the halves of all splits of items[a..a + len] two ascending runs.
    let mut by_start = vec![0u16; width * width];
    let mut by_end = vec![0u16; width * width];
    let mut primitive = vec![false; cap + 1];
    // run_best[p(p-1)/2 + a % p]: cheapest (best[x], smallest x) over the
    // ends x = a + 2p, a + 3p, … of p-periodic blocks starting at a.
    let mut run_best = vec![(0u32, 0usize); (cap + 1) * cap / 2];
    let mut best = vec![0u32; n + 1];
    // step[a]: length and period of the first block of items[a..]; period 0
    // is a single item.
    let mut step = vec![(1usize, 0usize); n];

    for a in (0..n).rev() {
        for p in 1..=cap {
            lce[p] = if a + p < n && items[a] == items[a + p] {
                lce[p] + 1
            } else {
                0
            };
        }

        let row = (a & mask) * width;
        for len in 1..=cap.min(n - a) {
            let end_row = ((a + len) & mask) * width;
            let period = divisors[len].iter().find(|&&q| lce[q] >= len - q);
            primitive[len] = period.is_none();
            let repeat = period.map_or(len as u16, |&q| by_start[row + q]);
            // Splits into items[a..a + k] and items[a + k..a + len], k = 1..len.
            let lefts = &by_start[row + 1..row + len];
            let rights = &by_end[end_row + width - len + 1..end_row + width];
            let split = lefts.iter().zip(rights).map(|(l, r)| l + r).min();
            let cost = split.map_or(repeat, |split| split.min(repeat));
            by_start[row + len] = cost;
            by_end[end_row + width - len] = cost;
        }

        let (mut cost, mut len, mut period) = (best[a + 1] + 1, 1, 0);
        let mut whole = false;
        for p in 1..=cap {
            if lce[p] < p {
                continue;
            }
            let run = &mut run_best[p * (p - 1) / 2 + a % p];
            let end = a + 2 * p;
            if lce[p] < 2 * p || best[end] <= run.0 {
                *run = (best[end], end);
            }
            if !primitive[p] {
                continue;
            }
            let candidate = u32::from(by_start[row + p]) + run.0;
            let reaches_end = run.1 == n;
            if candidate < cost || candidate == cost && (reaches_end || !whole && run.1 - a < len) {
                (cost, len, period, whole) = (candidate, run.1 - a, p, reaches_end);
            }
        }
        best[a] = cost;
        step[a] = (len, period);
    }

    let mut out = Vec::new();
    let mut a = 0;
    while a < n {
        let (len, period) = step[a];
        out.push(if period == 0 {
            items[a].clone()
        } else {
            let body = compress_capped(&items[a..a + period], max_period);
            SequenceItem::repeat(body, len / period)
        });
        a += len;
    }
    out
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
    seq.iter()
        .map(|item| match item {
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

    fn sc() -> SequenceItem {
        SequenceItem::Stitch(Stitch::Sc)
    }
    fn oc() -> SequenceItem {
        SequenceItem::Stitch(Stitch::Oc)
    }
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
                    for _ in 0..data.count {
                        r.extend_from_slice(&inner);
                    }
                }
            }
        }
        r
    }

    fn eq(got: &[SequenceItem], expected: &[SequenceItem]) {
        assert_eq!(
            to_string(got),
            to_string(expected),
            "\n  got:      {}\n  expected: {}",
            to_string(got),
            to_string(expected),
        );
    }

    // ── uncapped reference ───────────────────────────────────────────────────

    /// The O(n³) interval DP that `compress` replaced: it searches repeats of
    /// any period, and `compress` must agree with it wherever its result has
    /// no repeat body longer than the cap.
    fn reference_compress(items: &[SequenceItem]) -> Vec<SequenceItem> {
        #[derive(Clone, Copy)]
        enum Decision {
            Literal,
            Split(usize),
            Repeat(usize),
        }

        let n = items.len();
        // lce[i * n + j]: common prefix length of items[i..] and items[j..].
        let mut lce = vec![0usize; n * n];
        for i in (0..n).rev() {
            for j in ((i + 1)..n).rev() {
                if items[i] == items[j] {
                    lce[i * n + j] = 1 + if j + 1 < n {
                        lce[(i + 1) * n + j + 1]
                    } else {
                        0
                    };
                }
            }
        }

        let stride = n + 1;
        let mut cost = vec![0usize; stride * stride];
        let mut dec = vec![Decision::Literal; stride * stride];
        for start in 0..n {
            cost[start * stride + 1] = 1;
        }
        for len in 2..=n {
            for start in 0..=(n - len) {
                let mut best = (len, Decision::Literal);
                if let Some(period) =
                    (1..=len / 2).find(|&q| len % q == 0 && lce[start * n + start + q] >= len - q)
                {
                    best = (cost[start * stride + period], Decision::Repeat(period));
                }
                for k in 1..len {
                    let total = cost[start * stride + k] + cost[(start + k) * stride + len - k];
                    if total < best.0 {
                        best = (total, Decision::Split(k));
                    }
                }
                (cost[start * stride + len], dec[start * stride + len]) = best;
            }
        }

        fn rebuild(
            items: &[SequenceItem],
            start: usize,
            len: usize,
            dec: &[Decision],
            stride: usize,
        ) -> Vec<SequenceItem> {
            match dec[start * stride + len] {
                Decision::Literal => items[start..start + len].to_vec(),
                Decision::Split(k) => {
                    let mut out = rebuild(items, start, k, dec, stride);
                    out.extend(rebuild(items, start + k, len - k, dec, stride));
                    out
                }
                Decision::Repeat(period) => vec![SequenceItem::repeat(
                    rebuild(items, start, period, dec, stride),
                    len / period,
                )],
            }
        }
        rebuild(items, 0, n, &dec, stride)
    }

    fn longest_period(seq: &[SequenceItem]) -> usize {
        seq.iter()
            .map(|item| match item {
                SequenceItem::RepeatGroup(data) => {
                    flatten(&data.items).len().max(longest_period(&data.items))
                }
                _ => 0,
            })
            .max()
            .unwrap_or(0)
    }

    /// Deterministic xorshift64, so failures reproduce.
    struct Rng(u64);

    impl Rng {
        fn below(&mut self, n: usize) -> usize {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            (self.0 % n as u64) as usize
        }

        fn items(&mut self, len: usize, alphabet: &[SequenceItem]) -> Vec<SequenceItem> {
            (0..len)
                .map(|_| alphabet[self.below(alphabet.len())].clone())
                .collect()
        }
    }

    /// Random rows and motif rows (a random motif repeated, with random
    /// edges and occasional changed stitches) over sc, oc and a corner group.
    fn sample_row(rng: &mut Rng) -> Vec<SequenceItem> {
        let corner = SequenceItem::group(vec![sc(), SequenceItem::Stitch(Stitch::Ch), sc()]);
        let alphabet = [sc(), oc(), corner];
        let alphabet = &alphabet[..2 + rng.below(2)];
        if rng.below(2) == 0 {
            let len = 1 + rng.below(40);
            return rng.items(len, alphabet);
        }
        let motif_len = 1 + rng.below(10);
        let motif = rng.items(motif_len, alphabet);
        let copies = 2 + rng.below(5);
        let (prefix_len, suffix_len) = (rng.below(4), rng.below(4));
        let mut row = rng.items(prefix_len, alphabet);
        for _ in 0..copies {
            row.extend_from_slice(&motif);
        }
        row.extend(rng.items(suffix_len, alphabet));
        if rng.below(3) == 0 {
            let at = rng.below(row.len());
            row[at] = alphabet[rng.below(alphabet.len())].clone();
        }
        row
    }

    #[test]
    fn compress_matches_reference_unless_it_needs_a_longer_repeat() {
        let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
        let mut compared = 0;
        for _ in 0..4000 {
            let row = sample_row(&mut rng);
            let max_period = 1 + rng.below(8);
            let got = compress_capped(&row, max_period);
            assert_eq!(flatten(&got), row);
            let expected = reference_compress(&row);
            if longest_period(&expected) <= max_period {
                compared += 1;
                assert_eq!(
                    to_string(&got),
                    to_string(&expected),
                    "row {} with max period {max_period}",
                    to_string(&row),
                );
            }
        }
        assert!(compared > 2000, "only {compared} rows compared");
    }

    // ── compress: basics ─────────────────────────────────────────────────────

    #[test]
    fn compress_empty() {
        assert!(compress(&[]).is_empty());
    }

    #[test]
    fn compress_single_sc() {
        eq(&compress(&[sc()]), &[sc()]);
    }

    #[test]
    fn compress_single_oc() {
        eq(&compress(&[oc()]), &[oc()]);
    }

    #[test]
    fn compress_same_type_collapses() {
        eq(&compress(&[sc(), sc(), sc(), sc()]), &[rep(vec![sc()], 4)]);
    }

    #[test]
    fn compress_two_different_no_grouping() {
        eq(&compress(&[sc(), oc()]), &[sc(), oc()]);
    }

    #[test]
    fn compress_three_non_repeating() {
        eq(&compress(&[sc(), sc(), oc()]), &[rep(vec![sc()], 2), oc()]);
    }

    // ── compress: boundary-merge cases ───────────────────────────────────────

    #[test]
    fn compress_sc_oc_sc_x3_boundary_merge() {
        // [sc,oc,sc]×3: trailing sc and leading sc of adjacent periods merge in naive RLE
        let flat = flatten(&[rep(vec![sc(), oc(), sc()], 3)]);
        eq(&compress(&flat), &[rep(vec![sc(), oc(), sc()], 3)]);
    }

    #[test]
    fn compress_oc_sc_oc_x3_boundary_merge() {
        let flat = flatten(&[rep(vec![oc(), sc(), oc()], 3)]);
        eq(&compress(&flat), &[rep(vec![oc(), sc(), oc()], 3)]);
    }

    #[test]
    fn compress_sc_oc_sc_oc_x2_boundary_merge() {
        // period=2 beats period=4 with count=2
        let flat = flatten(&[rep(vec![sc(), oc(), sc(), oc()], 2)]);
        eq(&compress(&flat), &[rep(vec![sc(), oc()], 4)]);
    }

    // ── compress: clean periods (no boundary merge) ───────────────────────────

    #[test]
    fn compress_alternating_sc_oc_x12() {
        let flat = flatten(&[rep(vec![sc(), oc()], 12)]);
        eq(&compress(&flat), &[rep(vec![sc(), oc()], 12)]);
    }

    #[test]
    fn compress_checker_2sc_2oc_x4() {
        let flat = flatten(&[rep(vec![sc(), sc(), oc(), oc()], 4)]);
        eq(
            &compress(&flat),
            &[rep(vec![rep(vec![sc()], 2), rep(vec![oc()], 2)], 4)],
        );
    }

    #[test]
    fn compress_3sc_oc_x3() {
        let flat = flatten(&[rep(vec![sc(), sc(), sc(), oc()], 3)]);
        eq(&compress(&flat), &[rep(vec![rep(vec![sc()], 3), oc()], 3)]);
    }

    #[test]
    fn compress_period_count_2_saves_one_token() {
        let flat = flatten(&[rep(vec![sc(), sc(), oc(), oc()], 2)]);
        eq(
            &compress(&flat),
            &[rep(vec![rep(vec![sc()], 2), rep(vec![oc()], 2)], 2)],
        );
    }

    // ── compress: prefix / suffix ─────────────────────────────────────────────

    #[test]
    fn compress_unique_prefix_then_repeat() {
        let input = flatten(&[rep(vec![sc()], 3), rep(vec![oc(), sc()], 4)]);
        eq(
            &compress(&input),
            &[rep(vec![sc()], 3), rep(vec![oc(), sc()], 4)],
        );
    }

    #[test]
    fn compress_repeat_then_unique_suffix() {
        let input = flatten(&[rep(vec![sc(), oc()], 4), rep(vec![sc()], 3)]);
        eq(
            &compress(&input),
            &[rep(vec![sc(), oc()], 4), rep(vec![sc()], 3)],
        );
    }

    #[test]
    fn compress_two_separate_repeat_groups() {
        let input = flatten(&[
            rep(vec![sc(), oc()], 3),
            rep(vec![rep(vec![sc()], 2), rep(vec![oc()], 2)], 2),
        ]);
        eq(
            &compress(&input),
            &[
                rep(vec![sc(), oc()], 3),
                rep(vec![rep(vec![sc()], 2), rep(vec![oc()], 2)], 2),
            ],
        );
    }

    // ── compress: nested repeats ──────────────────────────────────────────────

    #[test]
    fn compress_nested_sc_oc_x3_then_oc_x3() {
        let flat = flatten(&[rep(vec![sc(), oc(), sc(), oc(), sc(), oc(), oc()], 3)]);
        eq(
            &compress(&flat),
            &[rep(vec![rep(vec![sc(), oc()], 3), oc()], 3)],
        );
    }

    #[test]
    fn compress_nested_sc_oc_x4_then_oc_x2() {
        let flat = flatten(&[rep(
            vec![sc(), oc(), sc(), oc(), sc(), oc(), sc(), oc(), oc()],
            2,
        )]);
        eq(
            &compress(&flat),
            &[rep(vec![rep(vec![sc(), oc()], 4), oc()], 2)],
        );
    }

    // ── compress: non-divisible length ───────────────────────────────────────

    #[test]
    fn compress_7_chars_split_at_leftmost() {
        let input = vec![sc(), oc(), sc(), oc(), sc(), oc(), sc()];
        eq(&compress(&input), &[sc(), rep(vec![oc(), sc()], 3)]);
    }

    #[test]
    fn compress_period5_beats_naive_split() {
        let flat = flatten(&[rep(vec![sc(), rep(vec![oc(), sc()], 2)], 2)]);
        eq(
            &compress(&flat),
            &[rep(vec![sc(), rep(vec![oc(), sc()], 2)], 2)],
        );
    }

    // ── compress: edge cases ─────────────────────────────────────────────────

    #[test]
    fn compress_all_sc_single_leaf() {
        let flat = flatten(&[rep(vec![sc()], 10)]);
        eq(&compress(&flat), &[rep(vec![sc()], 10)]);
    }

    #[test]
    fn compress_count_10_repeat() {
        let flat = flatten(&[rep(vec![sc(), oc()], 10)]);
        eq(&compress(&flat), &[rep(vec![sc(), oc()], 10)]);
    }

    #[test]
    fn compress_count_is_integer_not_float() {
        let result = compress(&flatten(&[rep(vec![sc(), oc()], 3)]));
        assert!(!to_string(&result).contains('.'));
    }

    #[test]
    fn compress_nested_inner_over_flat_inner() {
        // period 5, count 2: [[sc,oc]×2, oc]×2 cheaper than literal
        let flat = flatten(&[rep(vec![sc(), oc(), sc(), oc(), oc()], 2)]);
        eq(
            &compress(&flat),
            &[rep(vec![rep(vec![sc(), oc()], 2), oc()], 2)],
        );
    }

    // ── compress: repeat period cap ───────────────────────────────────────────

    /// `sc` followed by `len - 1` `oc`: a primitive body that compresses to two tokens.
    fn sc_then_oc(len: usize) -> Vec<SequenceItem> {
        let mut body = vec![sc()];
        body.resize(len, oc());
        body
    }

    #[test]
    fn compress_keeps_repeat_at_period_cap() {
        let p = MAX_REPEAT_PERIOD;
        let row = [vec![sc()], sc_then_oc(p), sc_then_oc(p)].concat();
        eq(
            &compress(&row),
            &[sc(), rep(vec![sc(), rep(vec![oc()], p - 1)], 2)],
        );
    }

    #[test]
    fn compress_spells_out_repeat_beyond_period_cap() {
        let p = MAX_REPEAT_PERIOD + 1;
        let row = [vec![sc()], sc_then_oc(p), sc_then_oc(p)].concat();
        eq(
            &compress(&row),
            &[
                rep(vec![sc()], 2),
                rep(vec![oc()], p - 1),
                sc(),
                rep(vec![oc()], p - 1),
            ],
        );
    }

    // ── roundtrip: no information lost ───────────────────────────────────────

    #[test]
    fn roundtrip_sc_oc_sc_x3() {
        let flat = flatten(&[rep(vec![sc(), oc(), sc()], 3)]);
        assert_eq!(flatten(&compress(&flat)), flat);
    }

    #[test]
    fn roundtrip_diagonal_stripe_x3() {
        let flat = flatten(&[rep(vec![sc(), oc(), sc(), sc(), oc(), oc(), sc(), oc()], 3)]);
        assert_eq!(flatten(&compress(&flat)), flat);
    }

    #[test]
    fn roundtrip_all_sc() {
        let flat = flatten(&[rep(vec![sc()], 20)]);
        assert_eq!(flatten(&compress(&flat)), flat);
    }

    #[test]
    fn roundtrip_alternating_x15() {
        let flat = flatten(&[rep(vec![sc(), oc()], 15)]);
        assert_eq!(flatten(&compress(&flat)), flat);
    }

    #[test]
    fn roundtrip_nested_pattern_x3() {
        let flat = flatten(&[rep(vec![sc(), oc(), sc(), oc(), sc(), oc(), oc()], 3)]);
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
        assert_eq!(to_string(&[sc(), oc(), sc()]), "sc, oc, sc");
    }

    #[test]
    fn to_string_single_stitch_repeat() {
        assert_eq!(to_string(&[rep(vec![sc()], 3)]), "sc × 3");
        assert_eq!(to_string(&[rep(vec![oc()], 10)]), "oc × 10");
    }

    #[test]
    fn to_string_shallow_repeat_group() {
        assert_eq!(to_string(&[rep(vec![sc(), oc()], 4)]), "[sc, oc] × 4");
    }

    #[test]
    fn to_string_nested_repeat_group() {
        let inner = rep(vec![sc(), oc()], 2);
        let outer = rep(vec![inner, sc()], 3);
        assert_eq!(to_string(&[outer]), "[[sc, oc] × 2, sc] × 3");
    }

    #[test]
    fn to_string_mixed_flat_and_grouped() {
        let item = rep(vec![oc(), rep(vec![sc()], 2)], 3);
        assert_eq!(to_string(&[sc(), item, oc()]), "sc, [oc, sc × 2] × 3, oc");
    }
}
