// Sample usage sketch for Cocos Creator 3.x
// Put this into your Cocos project script and fix import paths.

import { makeEmptyBoard, set } from '../llk_core/board';
import { findAnyPair, findAnyPair as hint, removePair, ensureHasMove } from '../llk_core/solver';

// 8x10 example
const b = makeEmptyBoard(8, 10);

// Fill with pairs (very naive demo)
let t = 1;
for (let r = 0; r < b.rows; r++) {
  for (let c = 0; c < b.cols; c += 2) {
    set(b, { r, c }, t);
    set(b, { r, c: c + 1 }, t);
    t = (t % 6) + 1;
  }
}

ensureHasMove(b);
const p = findAnyPair(b);
console.log('anyPair', p);
