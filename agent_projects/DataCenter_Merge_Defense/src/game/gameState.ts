import {
  DailyTaskState,
  DailyTaskTemplateConfig,
  GameConfigs,
  GameState,
  MetaConfig,
  MetaState,
  MetaUpgradeConfig,
  MetaUpgradeEffectType,
  RunState,
  SettingsState
} from "./types";

export const GAME_STATE_KEY = "gameState";

const META_STATE_STORAGE_KEY = "dcmd_meta_state";

const DEFAULT_META_STATE: MetaState = {
  totalRuns: 0,
  bestWave: 0,
  totalCreditsEarned: 0,
  metaCredits: 0,
  upgradeLevels: {},
  unlockedTurretIds: [],
  daily: {
    dateKey: "",
    tasks: []
  }
};

const DEFAULT_SETTINGS_STATE: SettingsState = {
  soundEnabled: true,
  vibrationEnabled: true,
  speedMultiplier: 1,
  lastInterstitialRunShown: 0,
  noAdsPurchased: false,
  starterPackPurchases: 0,
  dailyChallengeDateKey: "",
  dailyChallengeBestScore: 0,
  dailyChallengeLastSubmitTs: 0,
  onboardingCompleted: false
};

export type DailyProgressType =
  | "merge_count"
  | "wave_clear_count"
  | "enemy_kill_count"
  | "credits_earn"
  | "run_count";

export interface PurchaseUpgradeResult {
  ok: boolean;
  reason?: string;
}

export interface ClaimDailyTaskResult {
  ok: boolean;
  reward?: number;
  reason?: string;
}

export interface InitialGameStateData {
  metaState?: MetaState;
  settingsState?: SettingsState;
}

export function createInitialGameState(configs: GameConfigs, initialData?: InitialGameStateData): GameState {
  const loadedMetaState = initialData?.metaState ?? loadLegacyMetaState();
  const metaState = normalizeMetaState(loadedMetaState, configs.meta);
  const settingsState = normalizeSettingsState(initialData?.settingsState);
  refreshDailyTasksIfNeeded(metaState, configs.meta);

  return {
    runState: createRunState(configs, metaState),
    metaState,
    settingsState,
    configs
  };
}

export function resetRunState(state: GameState): void {
  refreshDailyTasksIfNeeded(state.metaState, state.configs.meta);
  state.runState = createRunState(state.configs, state.metaState);
  persistMetaState(state.metaState);
}

export function persistMetaState(metaState: MetaState): void {
  try {
    window.localStorage.setItem(META_STATE_STORAGE_KEY, JSON.stringify(metaState));
  } catch {
    // Ignore storage errors; meta persistence is best-effort.
  }
}

export function createDefaultSettingsState(): SettingsState {
  return { ...DEFAULT_SETTINGS_STATE };
}

export function resetProfileState(state: GameState): void {
  state.metaState = normalizeMetaState(
    { ...DEFAULT_META_STATE, daily: { ...DEFAULT_META_STATE.daily, tasks: [] } },
    state.configs.meta
  );
  state.settingsState = createDefaultSettingsState();
  refreshDailyTasksIfNeeded(state.metaState, state.configs.meta);
  resetRunState(state);
}

export function refreshDailyTasksIfNeeded(metaState: MetaState, metaConfig: MetaConfig): boolean {
  const todayKey = getLocalDateKey();
  if (metaState.daily.dateKey === todayKey && metaState.daily.tasks.length === 3) {
    return false;
  }

  metaState.daily.dateKey = todayKey;
  metaState.daily.tasks = pickDailyTasks(metaConfig.daily_tasks, 3, todayKey);
  persistMetaState(metaState);
  return true;
}

export function applyDailyProgress(
  metaState: MetaState,
  metaConfig: MetaConfig,
  type: DailyProgressType,
  amount = 1
): void {
  if (amount <= 0) {
    return;
  }

  refreshDailyTasksIfNeeded(metaState, metaConfig);
  let changed = false;

  for (const task of metaState.daily.tasks) {
    if (task.claimed || task.type !== type) {
      continue;
    }

    const next = Math.min(task.target, task.progress + amount);
    if (next !== task.progress) {
      task.progress = next;
      changed = true;
    }
  }

  if (changed) {
    persistMetaState(metaState);
  }
}

export function claimDailyTask(metaState: MetaState, taskId: string): ClaimDailyTaskResult {
  const task = metaState.daily.tasks.find((entry) => entry.id === taskId);
  if (!task) {
    return { ok: false, reason: "Задание не найдено" };
  }
  if (task.claimed) {
    return { ok: false, reason: "Награда уже получена" };
  }
  if (task.progress < task.target) {
    return { ok: false, reason: "Цель задания не достигнута" };
  }

  task.claimed = true;
  metaState.metaCredits += task.rewardMetaCredits;
  persistMetaState(metaState);
  return { ok: true, reward: task.rewardMetaCredits };
}

export function getUpgradeById(metaConfig: MetaConfig, upgradeId: string): MetaUpgradeConfig | undefined {
  return metaConfig.upgrades.find((upgrade) => upgrade.id === upgradeId);
}

export function getUpgradeLevel(metaState: MetaState, upgradeId: string): number {
  return normalizeNonNegativeInteger(metaState.upgradeLevels[upgradeId]);
}

export function canPurchaseUpgrade(
  metaState: MetaState,
  metaConfig: MetaConfig,
  upgradeId: string
): PurchaseUpgradeResult {
  const upgrade = getUpgradeById(metaConfig, upgradeId);
  if (!upgrade) {
    return { ok: false, reason: "Апгрейд не найден" };
  }

  const level = getUpgradeLevel(metaState, upgrade.id);
  if (level >= upgrade.max_level) {
    return { ok: false, reason: "Достигнут максимальный уровень" };
  }

  if (metaState.metaCredits < upgrade.cost) {
    return { ok: false, reason: "Недостаточно Meta Credits" };
  }

  const requirements = upgrade.requires ?? [];
  const missingRequirement = requirements.find((requiredUpgradeId) =>
    getUpgradeLevel(metaState, requiredUpgradeId) <= 0
  );
  if (missingRequirement) {
    const requiredUpgrade = getUpgradeById(metaConfig, missingRequirement);
    return {
      ok: false,
      reason: `Нужен апгрейд: ${requiredUpgrade?.name ?? missingRequirement}`
    };
  }

  return { ok: true };
}

export function purchaseUpgrade(
  metaState: MetaState,
  metaConfig: MetaConfig,
  upgradeId: string
): PurchaseUpgradeResult {
  const check = canPurchaseUpgrade(metaState, metaConfig, upgradeId);
  if (!check.ok) {
    return check;
  }

  const upgrade = getUpgradeById(metaConfig, upgradeId);
  if (!upgrade) {
    return { ok: false, reason: "Апгрейд не найден" };
  }

  const currentLevel = getUpgradeLevel(metaState, upgrade.id);
  metaState.metaCredits = Math.max(0, metaState.metaCredits - upgrade.cost);
  metaState.upgradeLevels[upgrade.id] = currentLevel + 1;
  applyUnlockEffects(metaState, [upgrade]);
  persistMetaState(metaState);
  return { ok: true };
}

export function getMetaEffectTotal(
  metaState: MetaState,
  metaConfig: MetaConfig,
  effectType: MetaUpgradeEffectType
): number {
  let total = 0;

  for (const upgrade of metaConfig.upgrades) {
    const level = getUpgradeLevel(metaState, upgrade.id);
    if (level <= 0) {
      continue;
    }

    for (const effect of upgrade.effects) {
      if (effect.type !== effectType) {
        continue;
      }

      total += effect.value * level;
    }
  }

  return total;
}

function createRunState(configs: GameConfigs, metaState: MetaState): RunState {
  const startCreditsBonus = getMetaEffectTotal(metaState, configs.meta, "starting_credits_flat");
  const baseHpBonus = getMetaEffectTotal(metaState, configs.meta, "base_hp_flat");

  return {
    baseHp: Math.max(1, configs.waves.base_hp + Math.floor(baseHpBonus)),
    credits: Math.max(0, configs.waves.starting_credits + Math.floor(startCreditsBonus)),
    currentWave: 1,
    loopTick: 0,
    isPaused: false
  };
}

function loadLegacyMetaState(): MetaState {
  try {
    const raw = window.localStorage.getItem(META_STATE_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_META_STATE, daily: { ...DEFAULT_META_STATE.daily, tasks: [] } };
    }

    const parsed = JSON.parse(raw) as Partial<MetaState>;
    const parsedDaily =
      typeof parsed.daily === "object" && parsed.daily !== null
        ? (parsed.daily as Partial<MetaState["daily"]>)
        : undefined;

    return {
      totalRuns: normalizeNonNegativeInteger(parsed.totalRuns),
      bestWave: normalizeNonNegativeInteger(parsed.bestWave),
      totalCreditsEarned: normalizeNonNegativeInteger(parsed.totalCreditsEarned),
      metaCredits: normalizeNonNegativeInteger(parsed.metaCredits),
      upgradeLevels: normalizeUpgradeLevels(parsed.upgradeLevels),
      unlockedTurretIds: normalizeStringArray(parsed.unlockedTurretIds),
      daily: {
        dateKey: typeof parsedDaily?.dateKey === "string" ? parsedDaily.dateKey : "",
        tasks: normalizeDailyTasks(parsedDaily?.tasks)
      }
    };
  } catch {
    return { ...DEFAULT_META_STATE, daily: { ...DEFAULT_META_STATE.daily, tasks: [] } };
  }
}

function normalizeSettingsState(value: SettingsState | undefined): SettingsState {
  if (!value) {
    return createDefaultSettingsState();
  }

  const speedMultiplier = typeof value.speedMultiplier === "number" ? value.speedMultiplier : 1;

  return {
    soundEnabled: value.soundEnabled !== false,
    vibrationEnabled: value.vibrationEnabled !== false,
    speedMultiplier: speedMultiplier > 0 ? speedMultiplier : 1,
    lastInterstitialRunShown:
      typeof value.lastInterstitialRunShown === "number" && Number.isFinite(value.lastInterstitialRunShown)
        ? Math.max(0, Math.floor(value.lastInterstitialRunShown))
        : 0,
    noAdsPurchased: value.noAdsPurchased === true,
    starterPackPurchases:
      typeof value.starterPackPurchases === "number" && Number.isFinite(value.starterPackPurchases)
        ? Math.max(0, Math.floor(value.starterPackPurchases))
        : 0,
    dailyChallengeDateKey:
      typeof value.dailyChallengeDateKey === "string" ? value.dailyChallengeDateKey : "",
    dailyChallengeBestScore:
      typeof value.dailyChallengeBestScore === "number" && Number.isFinite(value.dailyChallengeBestScore)
        ? Math.max(0, Math.floor(value.dailyChallengeBestScore))
        : 0,
    dailyChallengeLastSubmitTs:
      typeof value.dailyChallengeLastSubmitTs === "number" && Number.isFinite(value.dailyChallengeLastSubmitTs)
        ? Math.max(0, Math.floor(value.dailyChallengeLastSubmitTs))
        : 0,
    onboardingCompleted: value.onboardingCompleted === true
  };
}

function normalizeMetaState(metaState: MetaState, metaConfig: MetaConfig): MetaState {
  const normalized: MetaState = {
    ...metaState,
    metaCredits: Math.max(metaConfig.starting_meta_credits, metaState.metaCredits),
    upgradeLevels: { ...metaState.upgradeLevels },
    unlockedTurretIds: normalizeStringArray(metaState.unlockedTurretIds),
    daily: {
      dateKey: metaState.daily.dateKey,
      tasks: normalizeDailyTasks(metaState.daily.tasks)
    }
  };

  const unlocked = new Set(metaConfig.default_unlocked_turret_ids);
  for (const turretId of normalized.unlockedTurretIds) {
    unlocked.add(turretId);
  }

  applyUnlockEffects(normalized, metaConfig.upgrades);
  for (const turretId of normalized.unlockedTurretIds) {
    unlocked.add(turretId);
  }

  normalized.unlockedTurretIds = Array.from(unlocked).sort();
  return normalized;
}

function applyUnlockEffects(metaState: MetaState, upgrades: MetaUpgradeConfig[]): void {
  const unlocked = new Set(metaState.unlockedTurretIds);

  for (const upgrade of upgrades) {
    const level = getUpgradeLevel(metaState, upgrade.id);
    if (level <= 0) {
      continue;
    }

    for (const effect of upgrade.effects) {
      if (effect.type === "unlock_turret" && effect.target_id) {
        unlocked.add(effect.target_id);
      }
    }
  }

  metaState.unlockedTurretIds = Array.from(unlocked).sort();
}

function getLocalDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function pickDailyTasks(
  templates: DailyTaskTemplateConfig[],
  count: number,
  dateKey: string
): DailyTaskState[] {
  const pool = [...templates];
  const selected: DailyTaskState[] = [];
  let seed = hashString(dateKey);

  while (pool.length > 0 && selected.length < count) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const index = seed % pool.length;
    const template = pool.splice(index, 1)[0];
    selected.push({
      id: template.id,
      name: template.name,
      description: template.description,
      type: template.type,
      target: template.target,
      rewardMetaCredits: template.reward_meta_credits,
      progress: 0,
      claimed: false
    });
  }

  return selected;
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeUpgradeLevels(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null) {
    return {};
  }

  const record: Record<string, number> = {};
  for (const [key, rawLevel] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key !== "string" || key.trim().length === 0) {
      continue;
    }

    const level = normalizeNonNegativeInteger(rawLevel);
    if (level > 0) {
      record[key] = level;
    }
  }

  return record;
}

function normalizeDailyTasks(value: unknown): DailyTaskState[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((rawTask) => normalizeDailyTask(rawTask))
    .filter((task): task is DailyTaskState => task !== undefined);
}

function normalizeDailyTask(value: unknown): DailyTaskState | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const raw = value as Partial<DailyTaskState>;
  if (
    typeof raw.id !== "string" ||
    raw.id.trim().length === 0 ||
    typeof raw.name !== "string" ||
    raw.name.trim().length === 0 ||
    typeof raw.description !== "string" ||
    raw.description.trim().length === 0 ||
    !isDailyProgressType(raw.type)
  ) {
    return undefined;
  }

  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    type: raw.type,
    target: Math.max(1, normalizeNonNegativeInteger(raw.target)),
    rewardMetaCredits: Math.max(1, normalizeNonNegativeInteger(raw.rewardMetaCredits)),
    progress: normalizeNonNegativeInteger(raw.progress),
    claimed: raw.claimed === true
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }

    const normalized = entry.trim();
    if (normalized.length > 0) {
      unique.add(normalized);
    }
  }

  return Array.from(unique);
}

function isDailyProgressType(value: unknown): value is DailyProgressType {
  return (
    value === "merge_count" ||
    value === "wave_clear_count" ||
    value === "enemy_kill_count" ||
    value === "credits_earn" ||
    value === "run_count"
  );
}

function normalizeNonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  const normalized = Math.floor(value);
  return normalized >= 0 ? normalized : 0;
}
