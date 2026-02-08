// Sample usage sketch for Cocos Creator 3.x
// Put this into your Cocos project script and fix import paths.

import { makeBoardWithBorder, set } from '../llk_core/board';
import { findAnyPair, ensureHasMove } from '../llk_core/solver';

// inner 8x10 example -> board is 10x12 with border
const b = makeBoardWithBorder(8, 10);

// Fill ONLY playable area (1..8, 1..10) with pairs (very naive demo)
let t = 1;
for (let r = 1; r <= 8; r++) {
  for (let c = 1; c <= 10; c += 2) {
    set(b, { r, c }, t);
    set(b, { r, c: c + 1 }, t);
    t = (t % 6) + 1;
  }
}

ensureHasMove(b);
const p = findAnyPair(b);
console.log('anyPair', p);
