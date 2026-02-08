export type LevelGoal =
  | { type: 'clear_all' }
  | { type: 'clear_target'; target: number };

export type LevelConfig = {
  id: number;
  innerRows: number;
  innerCols: number;
  time: number;
  tileTypes: number;
  goal: LevelGoal;
  obstacles?: string[];
  rewardNode?: boolean;
};

export type LevelPack = {
  meta: { version: string };
  levels: LevelConfig[];
};

export function getLevel(pack: LevelPack, id: number): LevelConfig {
  const l = pack.levels.find((x) => x.id === id);
  if (!l) throw new Error('LEVEL_NOT_FOUND:' + id);
  return l;
}
