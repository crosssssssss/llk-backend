import { Board, Pos } from './types';
import { makeBoardWithBorder, set, isEmpty } from './board';
import { ensureHasMove } from './solver';
import type { LevelConfig } from './levels';

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function playablePositions(innerRows: number, innerCols: number): Pos[] {
  const ps: Pos[] = [];
  for (let r = 1; r <= innerRows; r++) {
    for (let c = 1; c <= innerCols; c++) ps.push({ r, c });
  }
  return ps;
}

/**
 * Generates a board for the level (naive but works for MVP):
 * - Fill playable area with pairs of tile types
 * - Keep a 1-cell empty border
 * - Ensure there is at least one move (shuffle up to N times)
 */
export function generateBoard(level: LevelConfig, seed?: number): Board {
  const b = makeBoardWithBorder(level.innerRows, level.innerCols);
  const ps = playablePositions(level.innerRows, level.innerCols);

  // must be even number of tiles
  if (ps.length % 2 !== 0) throw new Error('Playable cells must be even');

  shuffle(ps);

  // create paired tile list
  const pairs = ps.length / 2;
  const ts: number[] = [];
  for (let i = 0; i < pairs; i++) {
    const t = (i % level.tileTypes) + 1;
    ts.push(t, t);
  }
  shuffle(ts);

  for (let i = 0; i < ps.length; i++) {
    set(b, ps[i], ts[i]);
  }

  // (obstacles ignored in v0)
  ensureHasMove(b, 20);
  return b;
}
