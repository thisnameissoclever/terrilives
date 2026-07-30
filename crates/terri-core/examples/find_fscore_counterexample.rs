//! Searches for a grid on which the `f_score: tentative * heuristic(..)` mutant
//! of `TileGrid::find_path_adjacent` returns a **non-optimal** path.
//!
//! Why this exists: that mutant survives the whole suite, and
//! `docs/mutation-baseline.md` files the `find_path` twin as "A REAL GAP, not an
//! equivalent mutant" carried on trust since M1a Task 9. Adding a second copy of
//! a known gap to the baseline is the thing the baseline doc warns about - "a
//! baseline that only ever grows becomes a permission slip" - so this looks for
//! the fixture that kills it instead.
//!
//! It reimplements both the real and the mutated search locally rather than
//! importing them, because the point is to compare two variants of the same
//! algorithm, and only one of them exists in the crate.
//!
//!     cargo run -p terri-core --example find_fscore_counterexample

use std::collections::{BinaryHeap, VecDeque};

const NEIGHBOURS: [(i32, i32); 4] = [(1, 0), (-1, 0), (0, 1), (0, -1)];

#[derive(PartialEq, Eq)]
struct Node {
    f: u32,
    index: usize,
    pos: (i32, i32),
}
impl Ord for Node {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        other
            .f
            .cmp(&self.f)
            .then_with(|| other.index.cmp(&self.index))
    }
}
impl PartialOrd for Node {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

struct Grid {
    w: i32,
    h: i32,
    blocked: Vec<bool>,
}
impl Grid {
    fn walkable(&self, x: i32, y: i32) -> bool {
        x >= 0 && y >= 0 && x < self.w && y < self.h && !self.blocked[(y * self.w + x) as usize]
    }
    fn index(&self, x: i32, y: i32) -> usize {
        (y * self.w + x) as usize
    }
}

fn adjacent(a: (i32, i32), b: (i32, i32)) -> bool {
    (a.0 - b.0).abs() + (a.1 - b.1).abs() == 1
}
fn heuristic(a: (i32, i32), b: (i32, i32)) -> u32 {
    ((a.0 - b.0).abs() + (a.1 - b.1).abs()) as u32
}

/// `multiply = false` is the shipped code; `true` is the mutant.
fn search(g: &Grid, from: (i32, i32), to: (i32, i32), multiply: bool) -> Option<usize> {
    if !g.walkable(from.0, from.1) {
        return None;
    }
    if adjacent(from, to) {
        return Some(0);
    }
    let cells = (g.w * g.h) as usize;
    let mut gs = vec![u32::MAX; cells];
    let mut came = vec![usize::MAX; cells];
    let mut closed = vec![false; cells];
    let start = g.index(from.0, from.1);
    gs[start] = 0;
    let mut open = BinaryHeap::new();
    open.push(Node {
        f: heuristic(from, to),
        index: start,
        pos: from,
    });
    while let Some(cur) = open.pop() {
        if adjacent(cur.pos, to) {
            let mut n = 0usize;
            let mut c = cur.index;
            while c != start {
                n += 1;
                c = came[c];
            }
            return Some(n);
        }
        if closed[cur.index] {
            continue;
        }
        closed[cur.index] = true;
        for (dx, dy) in NEIGHBOURS {
            let next = (cur.pos.0 + dx, cur.pos.1 + dy);
            if !g.walkable(next.0, next.1) {
                continue;
            }
            let ni = g.index(next.0, next.1);
            if closed[ni] {
                continue;
            }
            let tentative = gs[cur.index].saturating_add(1);
            if tentative < gs[ni] {
                gs[ni] = tentative;
                came[ni] = cur.index;
                let hh = heuristic(next, to);
                open.push(Node {
                    f: if multiply {
                        tentative.saturating_mul(hh)
                    } else {
                        tentative + hh
                    },
                    index: ni,
                    pos: next,
                });
            }
        }
    }
    None
}

/// True optimum by BFS: fewest steps to any tile adjacent to `to`.
fn optimal(g: &Grid, from: (i32, i32), to: (i32, i32)) -> Option<usize> {
    if !g.walkable(from.0, from.1) {
        return None;
    }
    if adjacent(from, to) {
        return Some(0);
    }
    let cells = (g.w * g.h) as usize;
    let mut dist = vec![usize::MAX; cells];
    let mut q = VecDeque::new();
    dist[g.index(from.0, from.1)] = 0;
    q.push_back(from);
    while let Some(p) = q.pop_front() {
        let d = dist[g.index(p.0, p.1)];
        if adjacent(p, to) {
            return Some(d);
        }
        for (dx, dy) in NEIGHBOURS {
            let n = (p.0 + dx, p.1 + dy);
            if !g.walkable(n.0, n.1) {
                continue;
            }
            let ni = g.index(n.0, n.1);
            if dist[ni] != usize::MAX {
                continue;
            }
            dist[ni] = d + 1;
            q.push_back(n);
        }
    }
    None
}

fn main() {
    // A tiny deterministic LCG, so a counterexample is reproducible.
    let mut seed: u64 = 0x2026_0729;
    let mut next = move || {
        seed = seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (seed >> 33) as u32
    };

    let mut examined = 0u64;
    for w in 3..=7i32 {
        for h in 3..=7i32 {
            for _ in 0..4000 {
                let mut blocked = vec![false; (w * h) as usize];
                for b in blocked.iter_mut() {
                    *b = next() % 100 < 30;
                }
                let g = Grid { w, h, blocked };
                for fy in 0..h {
                    for fx in 0..w {
                        for ty in 0..h {
                            for tx in 0..w {
                                examined += 1;
                                let real = search(&g, (fx, fy), (tx, ty), false);
                                let mutant = search(&g, (fx, fy), (tx, ty), true);
                                let best = optimal(&g, (fx, fy), (tx, ty));
                                if real != best {
                                    println!(
                                        "SHIPPED CODE IS WRONG - investigate, not a mutant issue"
                                    );
                                    println!("  {w}x{h} from ({fx},{fy}) to ({tx},{ty}) real={real:?} best={best:?}");
                                    return;
                                }
                                if mutant != best {
                                    println!("COUNTEREXAMPLE after {examined} cases");
                                    println!("  grid {w}x{h}, from ({fx},{fy}) to ({tx},{ty})");
                                    println!("  optimal = {best:?}, mutant = {mutant:?}");
                                    println!("  blocked tiles:");
                                    for y in 0..h {
                                        let row: String = (0..w)
                                            .map(|x| {
                                                if g.blocked[(y * w + x) as usize] {
                                                    '#'
                                                } else {
                                                    '.'
                                                }
                                            })
                                            .collect();
                                        println!("    {row}");
                                    }
                                    println!("  as set_blocked calls:");
                                    for y in 0..h {
                                        for x in 0..w {
                                            if g.blocked[(y * w + x) as usize] {
                                                println!("    grid.set_blocked({x}, {y}, true);");
                                            }
                                        }
                                    }
                                    return;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    println!("no counterexample in {examined} cases - the mutant may be equivalent");
}
