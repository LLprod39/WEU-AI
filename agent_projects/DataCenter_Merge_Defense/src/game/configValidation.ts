import {
  CardEffectValueConfig,
  CardTemplateConfig,
  DailyTaskTemplateConfig,
  DailyTaskType,
  EnemyConfig,
  GameConfigs,
  MetaUpgradeConfig,
  MetaUpgradeEffectType,
  TurretConfig,
  TurretRole,
  WaveEntryConfig
} from "./types";

export function validateGameConfigs(configs: GameConfigs): void {
  validateTurrets(configs.turrets);
  validateEnemies(configs.enemies);
  validateCards(configs.cards);
  validateWaves(configs.waves, configs.enemies);
  validateMeta(configs.meta, configs.turrets);
}

function validateTurrets(turrets: TurretConfig[]): void {
  assertArrayWithItems(turrets, "turrets");
  const ids = new Set<string>();

  turrets.forEach((turret, index) => {
    const path = `turrets[${index}]`;

    assertString(turret.id, `${path}.id`);
    assertUniqueId(turret.id, ids, `${path}.id`);
    assertString(turret.name, `${path}.name`);
    assertTurretRole(turret.role, `${path}.role`);
    assertPositiveInteger(turret.level, `${path}.level`);
    assertNonNegativeNumber(turret.cost, `${path}.cost`);
    assertPositiveNumber(turret.damage, `${path}.damage`);
    assertPositiveNumber(turret.fire_rate, `${path}.fire_rate`);
    assertPositiveNumber(turret.range, `${path}.range`);
    assert(typeof turret.merge_to === "string", `${path}.merge_to: must be a string`);

    if (turret.role === "splash") {
      assertPositiveNumber(turret.splash_radius, `${path}.splash_radius`);
    }

    if (turret.role === "slow") {
      assertPercent(turret.slow_percent, `${path}.slow_percent`);
      assertPositiveNumber(turret.slow_duration_sec, `${path}.slow_duration_sec`);
    }
  });

  turrets.forEach((turret, index) => {
    if (turret.merge_to.length > 0) {
      assert(ids.has(turret.merge_to), `turrets[${index}].merge_to: unknown turret id "${turret.merge_to}"`);
    }
  });
}

function validateEnemies(enemies: EnemyConfig[]): void {
  assertArrayWithItems(enemies, "enemies");
  const ids = new Set<string>();

  enemies.forEach((enemy, index) => {
    const path = `enemies[${index}]`;
    assertString(enemy.id, `${path}.id`);
    assertUniqueId(enemy.id, ids, `${path}.id`);
    assertString(enemy.name, `${path}.name`);
    assertPositiveNumber(enemy.hp, `${path}.hp`);
    assertPositiveNumber(enemy.speed, `${path}.speed`);
    assertNonNegativeNumber(enemy.reward, `${path}.reward`);
    assert(Array.isArray(enemy.tags), `${path}.tags: must be an array`);
  });
}

function validateCards(cards: CardTemplateConfig[]): void {
  assertArrayWithItems(cards, "cards");
  assert(cards.length >= 3, "cards: must contain at least 3 entries");
  const ids = new Set<string>();

  cards.forEach((card, index) => {
    const path = `cards[${index}]`;
    assertString(card.id, `${path}.id`);
    assertUniqueId(card.id, ids, `${path}.id`);
    assertString(card.icon, `${path}.icon`);
    assertString(card.name, `${path}.name`);
    assertString(card.description, `${path}.description`);
    assertCardMultiplier(card.fire_rate_multiplier, `${path}.fire_rate_multiplier`);
    assertCardMultiplier(card.damage_multiplier, `${path}.damage_multiplier`);
    assertCardCritChance(card.crit_chance_bonus, `${path}.crit_chance_bonus`);
    assertCardMergeBonus(card.merge_bonus_credits, `${path}.merge_bonus_credits`);

    const hasMeaningfulEffect =
      isMeaningfulCardMultiplier(card.fire_rate_multiplier) ||
      isMeaningfulCardMultiplier(card.damage_multiplier) ||
      hasPositiveCardValue(card.crit_chance_bonus) ||
      hasPositiveCardValue(card.merge_bonus_credits);

    assert(hasMeaningfulEffect, `${path}: card must have at least one effect`);
  });
}

function validateWaves(wavesConfig: GameConfigs["waves"], enemies: EnemyConfig[]): void {
  assertObject(wavesConfig, "waves");
  assertPositiveNumber(wavesConfig.base_hp, "waves.base_hp");
  assertNonNegativeNumber(wavesConfig.starting_credits, "waves.starting_credits");
  assertPositiveInteger(wavesConfig.leak_damage, "waves.leak_damage");
  assertObject(wavesConfig.grid, "waves.grid");
  assertPositiveInteger(wavesConfig.grid.cols, "waves.grid.cols");
  assertPositiveInteger(wavesConfig.grid.rows, "waves.grid.rows");
  assertArrayWithItems(wavesConfig.path, "waves.path");
  validatePath(wavesConfig.path, wavesConfig.grid.cols, wavesConfig.grid.rows);
  validateObstacles(
    wavesConfig.obstacles,
    wavesConfig.path,
    wavesConfig.grid.cols,
    wavesConfig.grid.rows
  );
  assertArrayWithItems(wavesConfig.waves, "waves.waves");

  const enemyIds = new Set(enemies.map((enemy) => enemy.id));
  const waveNumbers = new Set<number>();

  wavesConfig.waves.forEach((waveEntry, index) => {
    validateWaveEntry(waveEntry, `waves.waves[${index}]`, enemyIds);
    assert(!waveNumbers.has(waveEntry.wave), `waves.waves[${index}].wave: duplicate wave number`);
    waveNumbers.add(waveEntry.wave);
  });

  validateWaveScaling(wavesConfig.wave_scaling, enemyIds);
  validateProceduralMap(wavesConfig.procedural_map, wavesConfig.grid.cols, wavesConfig.grid.rows);
}

function validatePath(
  path: GameConfigs["waves"]["path"],
  gridCols: number,
  gridRows: number
): void {
  assert(path.length >= 2, "waves.path: must contain at least 2 points");

  path.forEach((point, index) => {
    const pathKey = `waves.path[${index}]`;
    assertObject(point, pathKey);
    assertNonNegativeInteger(point.col, `${pathKey}.col`);
    assertNonNegativeInteger(point.row, `${pathKey}.row`);
    assert(point.col < gridCols, `${pathKey}.col: must be inside grid width`);
    assert(point.row < gridRows, `${pathKey}.row: must be inside grid height`);

    if (index > 0) {
      const prev = path[index - 1];
      assert(
        prev.col !== point.col || prev.row !== point.row,
        `${pathKey}: duplicate consecutive point`
      );
    }
  });
}

function validateObstacles(
  obstacles: GameConfigs["waves"]["obstacles"],
  path: GameConfigs["waves"]["path"],
  gridCols: number,
  gridRows: number
): void {
  if (obstacles === undefined) {
    return;
  }

  assert(Array.isArray(obstacles), "waves.obstacles: must be an array");
  const pathCells = new Set(path.map((point) => `${point.col}:${point.row}`));
  const obstacleCells = new Set<string>();
  obstacles.forEach((point, index) => {
    const cellPath = `waves.obstacles[${index}]`;
    assertObject(point, cellPath);
    assertNonNegativeInteger(point.col, `${cellPath}.col`);
    assertNonNegativeInteger(point.row, `${cellPath}.row`);
    assert(point.col < gridCols, `${cellPath}.col: must be inside grid width`);
    assert(point.row < gridRows, `${cellPath}.row: must be inside grid height`);

    const cellKey = `${point.col}:${point.row}`;
    assert(!pathCells.has(cellKey), `${cellPath}: cannot overlap waves.path`);
    assert(!obstacleCells.has(cellKey), `${cellPath}: duplicate obstacle cell`);
    obstacleCells.add(cellKey);
  });
}

function validateWaveScaling(
  scaling: GameConfigs["waves"]["wave_scaling"],
  enemyIds: Set<string>
): void {
  if (scaling === undefined) {
    return;
  }

  assertObject(scaling, "waves.wave_scaling");
  if (scaling.enabled !== undefined) {
    assert(typeof scaling.enabled === "boolean", "waves.wave_scaling.enabled: must be boolean");
  }
  assertPositiveInteger(scaling.max_waves, "waves.wave_scaling.max_waves");
  assertPositiveInteger(scaling.base_enemy_count, "waves.wave_scaling.base_enemy_count");
  assertPositiveNumber(
    scaling.enemy_count_growth_per_wave,
    "waves.wave_scaling.enemy_count_growth_per_wave"
  );
  if (scaling.extra_enemy_count_per_5_waves !== undefined) {
    assertNonNegativeNumber(
      scaling.extra_enemy_count_per_5_waves,
      "waves.wave_scaling.extra_enemy_count_per_5_waves"
    );
  }
  assertPositiveNumber(
    scaling.spawn_interval_base_sec,
    "waves.wave_scaling.spawn_interval_base_sec"
  );
  assertNonNegativeNumber(
    scaling.spawn_interval_decay_per_wave,
    "waves.wave_scaling.spawn_interval_decay_per_wave"
  );
  assertPositiveNumber(
    scaling.spawn_interval_min_sec,
    "waves.wave_scaling.spawn_interval_min_sec"
  );
  assertPositiveInteger(scaling.min_entries_per_wave, "waves.wave_scaling.min_entries_per_wave");
  assertPositiveInteger(scaling.max_entries_per_wave, "waves.wave_scaling.max_entries_per_wave");
  assert(
    scaling.max_entries_per_wave >= scaling.min_entries_per_wave,
    "waves.wave_scaling.max_entries_per_wave: must be >= min_entries_per_wave"
  );

  if (scaling.boss_wave_interval !== undefined) {
    assertPositiveInteger(scaling.boss_wave_interval, "waves.wave_scaling.boss_wave_interval");
  }
  if (scaling.boss_enemy_id !== undefined) {
    assertString(scaling.boss_enemy_id, "waves.wave_scaling.boss_enemy_id");
    assert(
      enemyIds.has(scaling.boss_enemy_id),
      `waves.wave_scaling.boss_enemy_id: unknown enemy id "${scaling.boss_enemy_id}"`
    );
  }

  assertArrayWithItems(scaling.enemy_pool, "waves.wave_scaling.enemy_pool");
  scaling.enemy_pool.forEach((entry, index) => {
    const entryPath = `waves.wave_scaling.enemy_pool[${index}]`;
    assertObject(entry, entryPath);
    assertString(entry.enemy_id, `${entryPath}.enemy_id`);
    assert(enemyIds.has(entry.enemy_id), `${entryPath}.enemy_id: unknown enemy id "${entry.enemy_id}"`);
    assertPositiveNumber(entry.weight, `${entryPath}.weight`);
    if (entry.start_wave !== undefined) {
      assertPositiveInteger(entry.start_wave, `${entryPath}.start_wave`);
    }
  });
}

function validateProceduralMap(
  proceduralMap: GameConfigs["waves"]["procedural_map"],
  gridCols: number,
  gridRows: number
): void {
  if (proceduralMap === undefined) {
    return;
  }

  assertObject(proceduralMap, "waves.procedural_map");
  if (proceduralMap.enabled !== undefined) {
    assert(typeof proceduralMap.enabled === "boolean", "waves.procedural_map.enabled: must be boolean");
  }
  assert(
    typeof proceduralMap.obstacle_density === "number" &&
      Number.isFinite(proceduralMap.obstacle_density) &&
      proceduralMap.obstacle_density >= 0 &&
      proceduralMap.obstacle_density <= 0.65,
    "waves.procedural_map.obstacle_density: must be in range [0, 0.65]"
  );
  assertPositiveInteger(proceduralMap.max_attempts, "waves.procedural_map.max_attempts");
  if (proceduralMap.seed_offset !== undefined) {
    assertNumber(proceduralMap.seed_offset, "waves.procedural_map.seed_offset");
  }
  if (proceduralMap.start !== undefined) {
    validateMapAnchor(proceduralMap.start, "waves.procedural_map.start", gridCols, gridRows);
  }
  if (proceduralMap.end !== undefined) {
    validateMapAnchor(proceduralMap.end, "waves.procedural_map.end", gridCols, gridRows);
  }
}

function validateMapAnchor(
  point: GameConfigs["waves"]["path"][number],
  path: string,
  gridCols: number,
  gridRows: number
): void {
  assertObject(point, path);
  assertNonNegativeInteger(point.col, `${path}.col`);
  assertNonNegativeInteger(point.row, `${path}.row`);
  assert(point.col < gridCols, `${path}.col: must be inside grid width`);
  assert(point.row < gridRows, `${path}.row: must be inside grid height`);
}

function validateWaveEntry(entry: WaveEntryConfig, path: string, enemyIds: Set<string>): void {
  assertPositiveInteger(entry.wave, `${path}.wave`);
  assertString(entry.enemy_id, `${path}.enemy_id`);
  assert(enemyIds.has(entry.enemy_id), `${path}.enemy_id: unknown enemy id "${entry.enemy_id}"`);
  assertPositiveInteger(entry.count, `${path}.count`);
  assertPositiveNumber(entry.spawn_interval_sec, `${path}.spawn_interval_sec`);
}

function validateMeta(metaConfig: GameConfigs["meta"], turrets: TurretConfig[]): void {
  assertObject(metaConfig, "meta");
  assertNonNegativeInteger(metaConfig.starting_meta_credits, "meta.starting_meta_credits");
  assertArrayWithItems(metaConfig.default_unlocked_turret_ids, "meta.default_unlocked_turret_ids");
  assertArrayWithItems(metaConfig.rare_turret_ids, "meta.rare_turret_ids");
  assertArrayWithItems(metaConfig.upgrades, "meta.upgrades");
  assertArrayWithItems(metaConfig.daily_tasks, "meta.daily_tasks");

  const turretIds = new Set(turrets.map((turret) => turret.id));
  metaConfig.default_unlocked_turret_ids.forEach((id, index) => {
    assertString(id, `meta.default_unlocked_turret_ids[${index}]`);
    assert(turretIds.has(id), `meta.default_unlocked_turret_ids[${index}]: unknown turret id "${id}"`);
  });
  metaConfig.rare_turret_ids.forEach((id, index) => {
    assertString(id, `meta.rare_turret_ids[${index}]`);
    assert(turretIds.has(id), `meta.rare_turret_ids[${index}]: unknown turret id "${id}"`);
  });

  const upgradeIds = new Set<string>();
  metaConfig.upgrades.forEach((upgrade, index) => {
    validateMetaUpgrade(upgrade, `meta.upgrades[${index}]`, turretIds);
    assertUniqueId(upgrade.id, upgradeIds, `meta.upgrades[${index}].id`);
  });

  metaConfig.upgrades.forEach((upgrade, index) => {
    const requires = upgrade.requires ?? [];
    requires.forEach((requiredId, requiresIndex) => {
      assertString(requiredId, `meta.upgrades[${index}].requires[${requiresIndex}]`);
      assert(
        upgradeIds.has(requiredId),
        `meta.upgrades[${index}].requires[${requiresIndex}]: unknown upgrade id "${requiredId}"`
      );
    });
  });

  const taskIds = new Set<string>();
  metaConfig.daily_tasks.forEach((task, index) => {
    validateDailyTaskTemplate(task, `meta.daily_tasks[${index}]`);
    assertUniqueId(task.id, taskIds, `meta.daily_tasks[${index}].id`);
  });
}

function validateMetaUpgrade(
  upgrade: MetaUpgradeConfig,
  path: string,
  turretIds: Set<string>
): void {
  assertString(upgrade.id, `${path}.id`);
  assertString(upgrade.name, `${path}.name`);
  assertString(upgrade.description, `${path}.description`);
  assertPositiveInteger(upgrade.cost, `${path}.cost`);
  assertPositiveInteger(upgrade.max_level, `${path}.max_level`);
  assertArrayWithItems(upgrade.effects, `${path}.effects`);

  if (upgrade.requires !== undefined) {
    assert(Array.isArray(upgrade.requires), `${path}.requires: must be an array`);
  }

  upgrade.effects.forEach((effect, effectIndex) => {
    const effectPath = `${path}.effects[${effectIndex}]`;
    assertObject(effect, effectPath);
    assertMetaEffectType(effect.type, `${effectPath}.type`);
    assertPositiveNumber(effect.value, `${effectPath}.value`);

    if (effect.type === "unlock_turret") {
      assertString(effect.target_id, `${effectPath}.target_id`);
      assert(
        turretIds.has(effect.target_id),
        `${effectPath}.target_id: unknown turret id "${effect.target_id}"`
      );
    }
  });
}

function validateDailyTaskTemplate(task: DailyTaskTemplateConfig, path: string): void {
  assertString(task.id, `${path}.id`);
  assertString(task.name, `${path}.name`);
  assertString(task.description, `${path}.description`);
  assertDailyTaskType(task.type, `${path}.type`);
  assertPositiveInteger(task.target, `${path}.target`);
  assertPositiveInteger(task.reward_meta_credits, `${path}.reward_meta_credits`);
}

function assertUniqueId(id: string, ids: Set<string>, path: string): void {
  assert(!ids.has(id), `${path}: duplicate id "${id}"`);
  ids.add(id);
}

function assertArrayWithItems(value: unknown, path: string): void {
  assert(Array.isArray(value), `${path}: must be an array`);
  assert(value.length > 0, `${path}: must not be empty`);
}

function assertObject(value: unknown, path: string): void {
  assert(typeof value === "object" && value !== null, `${path}: must be an object`);
}

function assertString(value: unknown, path: string): asserts value is string {
  assert(typeof value === "string" && value.trim().length > 0, `${path}: must be a non-empty string`);
}

function assertPositiveInteger(value: unknown, path: string): void {
  assert(typeof value === "number" && Number.isInteger(value) && value > 0, `${path}: must be a positive integer`);
}

function assertNonNegativeInteger(value: unknown, path: string): void {
  assert(
    typeof value === "number" && Number.isInteger(value) && value >= 0,
    `${path}: must be a non-negative integer`
  );
}

function assertNonNegativeNumber(value: unknown, path: string): void {
  assert(typeof value === "number" && Number.isFinite(value) && value >= 0, `${path}: must be a non-negative number`);
}

function assertPositiveNumber(value: unknown, path: string): void {
  assert(isPositiveNumber(value), `${path}: must be a positive number`);
}

function assertNumber(value: unknown, path: string): void {
  assert(typeof value === "number" && Number.isFinite(value), `${path}: must be a number`);
}

function assertCardMultiplier(value: CardEffectValueConfig | undefined, path: string): void {
  assertCardValue(value, path, {
    allowZero: false,
    allowFloat: true,
    minInclusive: 0,
    maxInclusive: Number.POSITIVE_INFINITY
  });
}

function assertCardCritChance(value: CardEffectValueConfig | undefined, path: string): void {
  assertCardValue(value, path, {
    allowZero: true,
    allowFloat: true,
    minInclusive: 0,
    maxInclusive: 1
  });
}

function assertCardMergeBonus(value: CardEffectValueConfig | undefined, path: string): void {
  assertCardValue(value, path, {
    allowZero: true,
    allowFloat: false,
    minInclusive: 0,
    maxInclusive: Number.POSITIVE_INFINITY
  });
}

function assertCardValue(
  value: CardEffectValueConfig | undefined,
  path: string,
  options: {
    allowZero: boolean;
    allowFloat: boolean;
    minInclusive: number;
    maxInclusive: number;
  }
): void {
  if (value === undefined) {
    return;
  }

  if (typeof value === "number") {
    assertCardNumericValue(value, path, options);
    return;
  }

  assertObject(value, path);
  assertNumber(value.min, `${path}.min`);
  assertNumber(value.max, `${path}.max`);
  assert(value.max >= value.min, `${path}.max: must be >= ${path}.min`);
  assertCardNumericValue(value.min, `${path}.min`, options);
  assertCardNumericValue(value.max, `${path}.max`, options);
  if (value.precision !== undefined) {
    assertNonNegativeInteger(value.precision, `${path}.precision`);
    assert(value.precision <= 6, `${path}.precision: must be <= 6`);
  }
}

function assertCardNumericValue(
  value: number,
  path: string,
  options: {
    allowZero: boolean;
    allowFloat: boolean;
    minInclusive: number;
    maxInclusive: number;
  }
): void {
  assert(
    typeof value === "number" && Number.isFinite(value),
    `${path}: must be a finite number`
  );
  if (!options.allowFloat) {
    assert(Number.isInteger(value), `${path}: must be an integer`);
  }
  if (options.allowZero) {
    assert(value >= options.minInclusive, `${path}: must be >= ${options.minInclusive}`);
  } else {
    assert(value > 0, `${path}: must be > 0`);
    assert(value >= options.minInclusive, `${path}: must be >= ${options.minInclusive}`);
  }
  assert(value <= options.maxInclusive, `${path}: must be <= ${options.maxInclusive}`);
}

function assertPercent(value: unknown, path: string): void {
  assert(typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 100, `${path}: must be in range (0, 100]`);
}

function assertTurretRole(value: unknown, path: string): asserts value is TurretRole {
  assert(
    value === "single-target" || value === "splash" || value === "slow",
    `${path}: must be one of "single-target", "splash", "slow"`
  );
}

function assertMetaEffectType(value: unknown, path: string): asserts value is MetaUpgradeEffectType {
  assert(
    value === "starting_credits_flat" ||
      value === "base_hp_flat" ||
      value === "rare_turret_chance" ||
      value === "unlock_turret" ||
      value === "run_credit_multiplier",
    `${path}: unknown meta effect type`
  );
}

function assertDailyTaskType(value: unknown, path: string): asserts value is DailyTaskType {
  assert(
    value === "merge_count" ||
      value === "wave_clear_count" ||
      value === "enemy_kill_count" ||
      value === "credits_earn" ||
      value === "run_count",
    `${path}: unknown daily task type`
  );
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isMeaningfulCardMultiplier(value: CardEffectValueConfig | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  if (typeof value === "number") {
    return Math.abs(value - 1) > Number.EPSILON;
  }

  return Math.abs(value.min - 1) > Number.EPSILON || Math.abs(value.max - 1) > Number.EPSILON;
}

function hasPositiveCardValue(value: CardEffectValueConfig | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  if (typeof value === "number") {
    return value > 0;
  }

  return value.max > 0;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Config validation failed: ${message}`);
  }
}
