#[derive(Clone, Debug)]
pub enum SequenceItem {
    Stitch(String),
    RepeatGroup { items: Vec<SequenceItem>, count: usize },
}

#[derive(Clone)]
struct Solution {
    seq:  Vec<SequenceItem>,
    cost: usize,
}

pub struct CompressMemo(std::collections::HashMap<Vec<String>, Solution>);

impl CompressMemo {
    pub fn new() -> Self {
        Self(std::collections::HashMap::new())
    }
}

fn is_repeat(flat: &[String], period: usize) -> bool {
    flat.chunks(period).all(|chunk| chunk == &flat[..period])
}

fn solve(flat: &[String], memo: &mut CompressMemo) -> Solution {
    if let Some(cached) = memo.0.get(flat) {
        return cached.clone();
    }

    let n = flat.len();
    let mut best = Solution {
        seq:  flat.iter().map(|s| SequenceItem::Stitch(s.clone())).collect(),
        cost: n,
    };

    // Try all splits
    for k in 1..n {
        let left  = solve(&flat[..k], memo);
        let right = solve(&flat[k..], memo);
        let cost  = left.cost + right.cost;
        if cost < best.cost {
            best.cost = cost;
            best.seq  = left.seq.into_iter().chain(right.seq).collect();
        }
    }

    // Try all repeating periods
    for period in 1..=(n / 2) {
        if n % period == 0 && is_repeat(flat, period) {
            let inner = solve(&flat[..period], memo);
            if inner.cost < best.cost {
                best.cost = inner.cost;
                best.seq  = vec![SequenceItem::RepeatGroup {
                    items: inner.seq,
                    count: n / period,
                }];
            }
        }
    }

    memo.0.insert(flat.to_vec(), best.clone());
    best
}

/// Maximum-compression DP with content-keyed memoization.
/// Pass the same memo across all compress calls in an export to share work
/// across rows and rounds.
pub fn compress(flat: &[String], memo: &mut CompressMemo) -> Vec<SequenceItem> {
    solve(flat, memo).seq
}

/// Human-readable serialization.
/// Single-stitch repeats: "sc × 3". Multi-stitch groups: "[sc, dc] × 4".
pub fn to_string(seq: &[SequenceItem]) -> String {
    seq.iter().map(|item| match item {
        SequenceItem::Stitch(s) => s.clone(),
        SequenceItem::RepeatGroup { items, count } => {
            if let [SequenceItem::Stitch(s)] = items.as_slice() {
                format!("{s} × {count}")
            } else {
                format!("[{}] × {count}", to_string(items))
            }
        }
    })
    .collect::<Vec<_>>()
    .join(", ")
}
