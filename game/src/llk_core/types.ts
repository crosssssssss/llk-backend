export type Pos = { r: number; c: number };

export type Cell = {
  // 0 = empty; >0 = tile type
  t: number;
};

export type Board = {
  rows: number;
  cols: number;
  // grid includes border padding (recommended) handled by helpers
  grid: Cell[][];
};

export type Path = Pos[];

export type Pair = { a: Pos; b: Pos; path: Path };
