export type TurretRole = "single-target" | "splash" | "slow";

export interface TurretConfig {
  id: string;
  name: string;
  role: TurretRole;
  level: number;
  cost: number;
  damage: number;
  fire_rate: number;
  range: number;
  merge_to: string;
  splash_radius?: number;
  slow_percent?: number;
  slow_duration_sec?: number;
}

export interface EnemyConfig {
  id: string;
  name: string;
  hp: number;
  speed: number;
  reward: number;
  tags: string[];
}

export interface NumericRangeConfig {
  min: number;
  max: number;
  precision?: number;
}

export type CardEffectValueConfig = number | NumericRangeConfig;

export interface CardTemplateConfig {
  id: string;
  icon: string;
  name: string;
  description: string;
  fire_rate_multiplier?: CardEffectValueConfig;
  damage_multiplier?: CardEffectValueConfig;
  crit_chance_bonus?: CardEffectValueConfig;
  merge_bonus_credits?: CardEffectValueConfig;
}

export interface CardConfig {
  id: string;
  icon: string;
  name: string;
  description: string;
  fire_rate_multiplier?: number;
  damage_multiplier?: number;
  crit_chance_bonus?: number;
  merge_bonus_credits?: number;
}

export interface WaveEntryConfig {
  wave: number;
  enemy_id: string;
  count: number;
  spawn_interval_sec: number;
}

export interface GridConfig {
  cols: number;
  rows: number;
}

export interface PathCellConfig {
  col: number;
  row: number;
}

export interface ProceduralWaveEnemyPoolEntryConfig {
  enemy_id: string;
  weight: number;
  start_wave?: number;
}

export interface WaveScalingConfig {
  enabled?: boolean;
  max_waves: number;
  base_enemy_count: number;
  enemy_count_growth_per_wave: number;
  extra_enemy_count_per_5_waves?: number;
  spawn_interval_base_sec: number;
  spawn_interval_decay_per_wave: number;
  spawn_interval_min_sec: number;
  min_entries_per_wave: number;
  max_entries_per_wave: number;
  boss_wave_interval?: number;
  boss_enemy_id?: string;
  enemy_pool: ProceduralWaveEnemyPoolEntryConfig[];
}

export interface ProceduralMapConfig {
  enabled?: boolean;
  obstacle_density: number;
  max_attempts: number;
  seed_offset?: number;
  start?: PathCellConfig;
  end?: PathCellConfig;
}

export interface WavesConfig {
  base_hp: number;
  starting_credits: number;
  leak_damage: number;
  grid: GridConfig;
  path: PathCellConfig[];
  obstacles?: PathCellConfig[];
  waves: WaveEntryConfig[];
  wave_scaling?: WaveScalingConfig;
  procedural_map?: ProceduralMapConfig;
}

export type MetaUpgradeEffectType =
  | "starting_credits_flat"
  | "base_hp_flat"
  | "rare_turret_chance"
  | "unlock_turret"
  | "run_credit_multiplier";

export interface MetaUpgradeEffectConfig {
  type: MetaUpgradeEffectType;
  value: number;
  target_id?: string;
}

export interface MetaUpgradeConfig {
  id: string;
  name: string;
  description: string;
  cost: number;
  max_level: number;
  requires?: string[];
  effects: MetaUpgradeEffectConfig[];
}

export type DailyTaskType =
  | "merge_count"
  | "wave_clear_count"
  | "enemy_kill_count"
  | "credits_earn"
  | "run_count";

export interface DailyTaskTemplateConfig {
  id: string;
  name: string;
  description: string;
  type: DailyTaskType;
  target: number;
  reward_meta_credits: number;
}

export interface MetaConfig {
  starting_meta_credits: number;
  default_unlocked_turret_ids: string[];
  rare_turret_ids: string[];
  upgrades: MetaUpgradeConfig[];
  daily_tasks: DailyTaskTemplateConfig[];
}

export interface GameConfigs {
  turrets: TurretConfig[];
  enemies: EnemyConfig[];
  cards: CardTemplateConfig[];
  waves: WavesConfig;
  meta: MetaConfig;
}

export interface RunState {
  baseHp: number;
  credits: number;
  currentWave: number;
  loopTick: number;
  isPaused: boolean;
}

export interface DailyTaskState {
  id: string;
  name: string;
  description: string;
  type: DailyTaskType;
  target: number;
  rewardMetaCredits: number;
  progress: number;
  claimed: boolean;
}

export interface MetaState {
  totalRuns: number;
  bestWave: number;
  totalCreditsEarned: number;
  metaCredits: number;
  upgradeLevels: Record<string, number>;
  unlockedTurretIds: string[];
  daily: {
    dateKey: string;
    tasks: DailyTaskState[];
  };
}

export interface SettingsState {
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  speedMultiplier: number;
  lastInterstitialRunShown: number;
  noAdsPurchased: boolean;
  starterPackPurchases: number;
  dailyChallengeDateKey: string;
  dailyChallengeBestScore: number;
  dailyChallengeLastSubmitTs: number;
  onboardingCompleted: boolean;
}

export interface GameState {
  runState: RunState;
  metaState: MetaState;
  settingsState: SettingsState;
  configs: GameConfigs;
}
