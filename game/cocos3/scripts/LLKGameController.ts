/**
 * Cocos Creator 3.x script skeleton.
 * - Generates a level board
 * - Handles selection + elimination
 * - Props: hint/shuffle/freeze (timer)
 *
 * You still need to implement UI grid rendering (Prefab) and bind tile clicks.
 */

import { _decorator, Component } from 'cc';
const { ccclass, property } = _decorator;

import { generateBoard } from '../../src/llk_core/generator';
import { findPath } from '../../src/llk_core/link';
import { removePair, ensureHasMove, findAnyPair, shuffleBoard } from '../../src/llk_core/solver';
import type { Board, Pos } from '../../src/llk_core/types';
import type { LevelPack } from '../../src/llk_core/levels';

@ccclass('LLKGameController')
export class LLKGameController extends Component {
  private board: Board | null = null;
  private selected: Pos | null = null;

  // TODO: load this from resources in your project
  public levelPack: LevelPack | null = null;

  start() {
    // Example: assume levelPack already assigned
    const level = this.levelPack?.levels?.[0];
    if (!level) {
      console.warn('levelPack not set');
      return;
    }
    this.board = generateBoard(level);
    ensureHasMove(this.board);
    console.log('board generated', this.board);

    const hint = findAnyPair(this.board);
    console.log('hint pair', hint);

    // TODO: render grid
  }

  /**
   * Call this when a tile is clicked.
   */
  onTileClick(pos: Pos) {
    if (!this.board) return;

    if (!this.selected) {
      this.selected = pos;
      return;
    }

    const a = this.selected;
    const b = pos;
    this.selected = null;

    const path = findPath(this.board, a, b, 2);
    if (!path) {
      // TODO: UI feedback
      return;
    }

    removePair(this.board, a, b);
    // TODO: animate path, then rerender tiles

    if (!ensureHasMove(this.board)) {
      shuffleBoard(this.board);
    }
  }
}
