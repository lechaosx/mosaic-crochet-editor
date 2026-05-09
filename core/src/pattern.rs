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
    Split  { k: usize },
    Repeat { period: usize },
}

fn is_repeat(items: &[SequenceItem], period: usize) -> bool {
    items.chunks(period).all(|chunk| chunk == &items[..period])
}

/// Per-call cache: indexed by `start * stride + len`, where `stride = n + 1`.
/// `(start, len)` uniquely identifies a subslice of the top-level input.
struct PosCache {
    table:  Vec<Option<(u32, Decision)>>,
    stride: usize,
}

impl PosCache {
    fn new(n: usize) -> Self {
        let stride = n + 1;
        Self { table: vec![None; stride * stride], stride }
    }
    #[inline] fn idx(&self, start: usize, len: usize) -> usize { start * self.stride + len }
    #[inline] fn get(&self, start: usize, len: usize) -> Option<(u32, Decision)> { self.table[self.idx(start, len)] }
    #[inline] fn set(&mut self, start: usize, len: usize, v: (u32, Decision)) {
        let i = self.idx(start, len);
        self.table[i] = Some(v);
    }
}

fn solve_cost(
    items: &[SequenceItem],
    start: usize,
    len:   usize,
    cache: &mut PosCache,
) -> u32 {
    if let Some((cost, _)) = cache.get(start, len) {
        return cost;
    }

    if len <= 1 {
        cache.set(start, len, (len as u32, Decision::Literal));
        return len as u32;
    }

    let slice = &items[start..start + len];
    if slice[1..].iter().all(|x| x == &slice[0]) {
        let inner = solve_cost(items, start, 1, cache);
        cache.set(start, len, (inner, Decision::Repeat { period: 1 }));
        return inner;
    }

    let mut best_cost = len as u32;
    let mut best_dec  = Decision::Literal;

    for k in 1..len {
        let cost = solve_cost(items, start, k, cache) + solve_cost(items, start + k, len - k, cache);
        if cost < best_cost {
            best_cost = cost;
            best_dec  = Decision::Split { k };
        }
    }

    for period in 1..=(len / 2) {
        if len % period == 0 && is_repeat(slice, period) {
            let inner = solve_cost(items, start, period, cache);
            if inner < best_cost {
                best_cost = inner;
                best_dec  = Decision::Repeat { period };
            }
        }
    }

    cache.set(start, len, (best_cost, best_dec));
    best_cost
}

fn reconstruct(
    items:   &[SequenceItem],
    start:   usize,
    len:     usize,
    cache:   &PosCache,
) -> Vec<SequenceItem> {
    if len == 0 { return Vec::new(); }

    let (_, dec) = cache.get(start, len).expect("solve_cost must populate every reachable slice");
    match dec {
        Decision::Literal => items[start..start + len].to_vec(),
        Decision::Split { k } => {
            let mut out = reconstruct(items, start, k, cache);
            out.extend(reconstruct(items, start + k, len - k, cache));
            out
        }
        Decision::Repeat { period } => vec![SequenceItem::repeat(
            reconstruct(items, start, period, cache),
            len / period,
        )],
    }
}

/// Maximum-compression DP. The subproblem cache is keyed by `(start, len)`
/// over the input, so each lookup is O(1) and the DP runs in O(n³) time.
pub fn compress(items: &[SequenceItem]) -> Vec<SequenceItem> {
    let n = items.len();
    if n == 0 { return Vec::new(); }
    let mut cache = PosCache::new(n);
    solve_cost(items, 0, n, &mut cache);
    reconstruct(items, 0, n, &cache)
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
