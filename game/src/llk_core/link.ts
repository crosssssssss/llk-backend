import { Board, Path, Pos } from './types';
import { get, inBounds, isEmpty } from './board';

// Directions: up, right, down, left
const DIRS = [
  { dr: -1, dc: 0 },
  { dr: 0, dc: 1 },
  { dr: 1, dc: 0 },
  { dr: 0, dc: -1 }
];

type State = {
  p: Pos;
  dir: number;      // 0..3, -1 = start (no direction yet)
  turns: number;    // number of direction changes so far
  prev: number;     // index of previous state in pool
};

function key(p: Pos, dir: number, turns: number) {
  return `${p.r},${p.c},${dir},${turns}`;
}

// Find a path with <= maxTurns turns (standard llk uses 2)
export function findPath(b: Board, a: Pos, c: Pos, maxTurns = 2): Path | null {
  if (!inBounds(b, a) || !inBounds(b, c)) return null;
  const ta = get(b, a).t;
  const tc = get(b, c).t;
  if (ta === 0 || tc === 0) return null;
  if (ta !== tc) return null;
  if (a.r === c.r && a.c === c.c) return null;

  // BFS over (pos, dir, turns)
  const pool: State[] = [];
  const q: number[] = [];
  const seen = new Set<string>();

  const push = (st: State) => {
    const k = key(st.p, st.dir, st.turns);
    if (seen.has(k)) return;
    seen.add(k);
    pool.push(st);
    q.push(pool.length - 1);
  };

  push({ p: a, dir: -1, turns: 0, prev: -1 });

  while (q.length) {
    const i = q.shift()!;
    const cur = pool[i];

    for (let nd = 0; nd < 4; nd++) {
      const nt = cur.dir === -1 || cur.dir === nd ? cur.turns : cur.turns + 1;
      if (nt > maxTurns) continue;

      // walk in straight line until blocked
      let p = { ...cur.p };
      while (true) {
        p = { r: p.r + DIRS[nd].dr, c: p.c + DIRS[nd].dc };
        if (!inBounds(b, p)) break;

        // allow stepping onto target cell; otherwise must be empty
        const isTarget = p.r === c.r && p.c === c.c;
        if (!isTarget && !isEmpty(b, p)) break;

        const nxt: State = { p: { ...p }, dir: nd, turns: nt, prev: i };
        if (isTarget) {
          // reconstruct path
          return reconstruct(pool, nxt);
        }
        push(nxt);
      }
    }
  }

  return null;
}

function reconstruct(pool: State[], end: State): Path {
  const path: Pos[] = [end.p];
  let prev = end.prev;
  while (prev !== -1) {
    path.push(pool[prev].p);
    prev = pool[prev].prev;
  }
  path.reverse();
  // compress consecutive duplicates (possible due to line-walk states)
  const compact: Pos[] = [];
  for (const p of path) {
    const last = compact[compact.length - 1];
    if (!last || last.r !== p.r || last.c !== p.c) compact.push(p);
  }
  return compact;
}
