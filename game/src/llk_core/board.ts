import { Board, Cell, Pos } from './types';

export function makeEmptyBoard(rows: number, cols: number): Board {
  const grid: Cell[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: Cell[] = [];
    for (let c = 0; c < cols; c++) row.push({ t: 0 });
    grid.push(row);
  }
  return { rows, cols, grid };
}

export function inBounds(b: Board, p: Pos): boolean {
  return p.r >= 0 && p.r < b.rows && p.c >= 0 && p.c < b.cols;
}

export function get(b: Board, p: Pos): Cell {
  return b.grid[p.r][p.c];
}

export function set(b: Board, p: Pos, t: number): void {
  b.grid[p.r][p.c].t = t;
}

export function isEmpty(b: Board, p: Pos): boolean {
  return get(b, p).t === 0;
}

export function cloneBoard(b: Board): Board {
  return {
    rows: b.rows,
    cols: b.cols,
    grid: b.grid.map((row) => row.map((c) => ({ t: c.t })))
  };
}
