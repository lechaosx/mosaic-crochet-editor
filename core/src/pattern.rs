use std::collections::HashMap;

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

type SymbolId = u32;

/// Memo shared across `compress` calls. The DP runs on interned `u32` ids
/// internally so memo keys are cheap to clone, hash, and compare; the
/// `SequenceItem` table only grows when callers introduce a new compound token.
pub struct CompressMemo {
    interner: HashMap<SequenceItem, SymbolId>,
    symbols:  Vec<SequenceItem>,
    cache:    HashMap<Vec<SymbolId>, (usize, Decision)>,
}

impl CompressMemo {
    pub fn new() -> Self {
        Self {
            interner: HashMap::new(),
            symbols:  Vec::new(),
            cache:    HashMap::new(),
        }
    }

    fn intern(&mut self, item: &SequenceItem) -> SymbolId {
        if let Some(&id) = self.interner.get(item) { return id; }
        let id = self.symbols.len() as SymbolId;
        self.symbols.push(item.clone());
        self.interner.insert(item.clone(), id);
        id
    }

    fn encode(&mut self, items: &[SequenceItem]) -> Vec<SymbolId> {
        items.iter().map(|i| self.intern(i)).collect()
    }
}

fn is_repeat(ids: &[SymbolId], period: usize) -> bool {
    ids.chunks(period).all(|chunk| chunk == &ids[..period])
}

fn solve_cost(
    ids:   &[SymbolId],
    cache: &mut HashMap<Vec<SymbolId>, (usize, Decision)>,
) -> usize {
    if let Some(&(cost, _)) = cache.get(ids) {
        return cost;
    }

    let n = ids.len();
    if n <= 1 {
        cache.insert(ids.to_vec(), (n, Decision::Literal));
        return n;
    }

    if ids[1..].iter().all(|&id| id == ids[0]) {
        let inner = solve_cost(&ids[..1], cache);
        cache.insert(ids.to_vec(), (inner, Decision::Repeat { period: 1 }));
        return inner;
    }

    let mut best_cost = n;
    let mut best_dec  = Decision::Literal;

    for k in 1..n {
        let cost = solve_cost(&ids[..k], cache) + solve_cost(&ids[k..], cache);
        if cost < best_cost {
            best_cost = cost;
            best_dec  = Decision::Split { k };
        }
    }

    for period in 1..=(n / 2) {
        if n % period == 0 && is_repeat(ids, period) {
            let inner = solve_cost(&ids[..period], cache);
            if inner < best_cost {
                best_cost = inner;
                best_dec  = Decision::Repeat { period };
            }
        }
    }

    cache.insert(ids.to_vec(), (best_cost, best_dec));
    best_cost
}

fn reconstruct(
    ids:     &[SymbolId],
    cache:   &HashMap<Vec<SymbolId>, (usize, Decision)>,
    symbols: &[SequenceItem],
) -> Vec<SequenceItem> {
    let n = ids.len();
    if n == 0 { return Vec::new(); }

    let &(_, dec) = cache.get(ids).expect("solve_cost must populate every reachable slice");
    match dec {
        Decision::Literal => ids.iter()
            .map(|&id| symbols[id as usize].clone())
            .collect(),
        Decision::Split { k } => {
            let mut out = reconstruct(&ids[..k], cache, symbols);
            out.extend(reconstruct(&ids[k..], cache, symbols));
            out
        }
        Decision::Repeat { period } => vec![SequenceItem::repeat(
            reconstruct(&ids[..period], cache, symbols),
            n / period,
        )],
    }
}

/// Maximum-compression DP with content-keyed memoization.
/// Pass the same memo across all compress calls in an export to share work
/// across rows and rounds.
pub fn compress(items: &[SequenceItem], memo: &mut CompressMemo) -> Vec<SequenceItem> {
    let ids = memo.encode(items);
    solve_cost(&ids, &mut memo.cache);
    reconstruct(&ids, &memo.cache, &memo.symbols)
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
