import { Board, Pair, Pos } from './types';
import { findPath } from './link';
import { get, isEmpty, set } from './board';

export function findAnyPair(b: Board): Pair | null {
  const tiles: { p: Pos; t: number }[] = [];
  for (let r = 0; r < b.rows; r++) {
    for (let c = 0; c < b.cols; c++) {
      const t = get(b, { r, c }).t;
      if (t !== 0) tiles.push({ p: { r, c }, t });
    }
  }

  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) {
      if (tiles[i].t !== tiles[j].t) continue;
      const path = findPath(b, tiles[i].p, tiles[j].p, 2);
      if (path) return { a: tiles[i].p, b: tiles[j].p, path };
    }
  }
  return null;
}

export function removePair(b: Board, a: Pos, c: Pos): void {
  set(b, a, 0);
  set(b, c, 0);
}

export function shuffleBoard(b: Board): void {
  const ps: Pos[] = [];
  const ts: number[] = [];
  for (let r = 0; r < b.rows; r++) {
    for (let c = 0; c < b.cols; c++) {
      const t = get(b, { r, c }).t;
      if (t !== 0) {
        ps.push({ r, c });
        ts.push(t);
      }
    }
  }
  // fisher-yates
  for (let i = ts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ts[i], ts[j]] = [ts[j], ts[i]];
  }
  for (let i = 0; i < ps.length; i++) {
    set(b, ps[i], ts[i]);
  }
}

export function hasMove(b: Board): boolean {
  return findAnyPair(b) !== null;
}

export function ensureHasMove(b: Board, maxShuffle = 10): boolean {
  for (let i = 0; i < maxShuffle; i++) {
    if (hasMove(b)) return true;
    shuffleBoard(b);
  }
  return hasMove(b);
}
