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
