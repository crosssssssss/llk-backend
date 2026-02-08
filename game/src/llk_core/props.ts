import { Board, Pair } from './types';
import { shuffleBoard, findAnyPair } from './solver';

export type PropType = 'hint' | 'shuffle' | 'freeze';

export function useHint(b: Board): Pair | null {
  return findAnyPair(b);
}

export function useShuffle(b: Board): void {
  shuffleBoard(b);
}

// freeze is timer-level; handled by game controller.
