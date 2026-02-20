import Phaser from "phaser";
import {
  applyDailyProgress,
  GAME_STATE_KEY,
  getMetaEffectTotal,
  refreshDailyTasksIfNeeded,
  resetRunState
} from "../game/gameState";
import {
  computeDailyScore,
  getDailySeed,
  getLocalDateKey,
  trySubmitDailyScore
} from "../game/dailyChallenge";
import { flushGameSave, queueGameSave } from "../game/saveSystem";
import { hideStickyInRun, tryShowInterstitialAfterRun, tryShowRewarded } from "../game/monetization";
import { PauseReason, yandexGamesSdk } from "../sdk/yandexGamesSdk";
import {
  CardConfig,
  EnemyConfig,
  GameState,
  PathCellConfig,
  TurretConfig,
  TurretRole,
  WaveEntryConfig
} from "../game/types";
import { generateCardsFromTemplates } from "../game/cardGenerator";
import { generateWaveEntries } from "../game/waveGenerator";
import { generateProceduralMap } from "../game/mapGenerator";
import { mixSeed } from "../game/random";
import { Colors, Fonts } from "../rendering/CyberTheme";
import { turretKey, turretGlowKey, enemyKey, TEX } from "../rendering/TextureFactory";
import { UIFactory } from "../rendering/UIFactory";
import { AnimationHelper } from "../rendering/AnimationHelper";

const LOOP_TICK_INTERVAL_MS = 250;
const MOBILE_BREAKPOINT_PX = 900;
const DEFAULT_GRID = { cols: 6, rows: 7 };
const GRID_SIDE_PADDING = 20;
const GRID_BOTTOM_PADDING = 20;
const GRID_TOP_OFFSET = 188;
const BUY_BUTTON_HEIGHT = 54;
const BUY_BUTTON_WIDTH_DESKTOP = 248;
const BUY_BUTTON_WIDTH_MOBILE_MIN = 200;
const HAND_SLOT_HEIGHT = 54;
const TURRET_SIZE_FACTOR = 0.84;
const TIER_BADGE_FACTOR = 0.32;
const ENEMY_SIZE_FACTOR = 0.46;
const ENEMY_HP_BAR_WIDTH_FACTOR = 0.56;
const ENEMY_HP_BAR_HEIGHT = 6;
const START_WAVE_DELAY_SEC = 0.8;
const INTER_WAVE_DELAY_SEC = 1.2;
const CARD_PICK_INTERVAL_WAVES = 2;
const CARD_PICK_OPTION_COUNT = 3;
const CRIT_DAMAGE_MULTIPLIER = 1.75;
const CARD_DRAFT_DEPTH = 90;
const END_RUN_OVERLAY_DEPTH = 130;
const END_RUN_BUTTON_WIDTH = 214;
const END_RUN_BUTTON_HEIGHT = 56;
const WAVE_CLEAR_REWARD_BASE = 14;
const WAVE_CLEAR_REWARD_PER_WAVE = 7;
const WAVE_CLEAR_REWARD_PER_ENEMY = 2;
const BOSS_CLEAR_REWARD_BASE = 28;
const BOSS_CLEAR_REWARD_PER_WAVE = 8;
const TYPE_COLOR_FALLBACK = Colors.indigo;
const TYPE_COLORS: Record<string, number> = {
  turret_basic: Colors.turretBasic,
  turret_splash: Colors.turretSplash,
  turret_slow: Colors.turretSlow,
};
const RUN_BACKDROP_KEY = "asset_run_backdrop";
const MENU_BACKDROP_KEY = "asset_menu_backdrop";
const TURRET_SHEET_BY_ROLE: Record<TurretRole, string> = {
  "single-target": "asset_turret_single_sheet",
  splash: "asset_turret_splash_sheet",
  slow: "asset_turret_slow_sheet"
};
const ENEMY_SHEET_BY_TAG = {
  basic: "asset_enemy_basic_sheet",
  fast: "asset_enemy_fast_sheet",
  tank: "asset_enemy_tank_sheet"
} as const;
const TURRET_ANIM_BY_ROLE: Record<TurretRole, string> = {
  "single-target": "anim_turret_single",
  splash: "anim_turret_splash",
  slow: "anim_turret_slow"
};
const IMPACT_SPRITE_KEY = "asset_vfx_impact_sheet";
const EXPLOSION_SPRITE_KEY = "asset_vfx_explosion_sheet";
const IMPACT_ANIM_KEY = "anim_vfx_impact";
const EXPLOSION_ANIM_KEY = "anim_vfx_explosion";
const ENEMY_ANIM_BY_TAG: Record<keyof typeof ENEMY_SHEET_BY_TAG, string> = {
  basic: "anim_enemy_basic",
  fast: "anim_enemy_fast",
  tank: "anim_enemy_tank"
};

interface GridSpec {
  cols: number;
  rows: number;
}

interface TurretView {
  id: number;
  baseType: string;
  tier: number;
  config: TurretConfig;
  cellIndex: number;
  attackCooldownSec: number;
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
  glow?: Phaser.GameObjects.Image;
  nameLabel: Phaser.GameObjects.Text;
  tierBadge: Phaser.GameObjects.Rectangle;
  tierLabel: Phaser.GameObjects.Text;
}

interface EnemyView {
  id: number;
  config: EnemyConfig;
  baseColor: number;
  hp: number;
  maxHp: number;
  speedMultiplier: number;
  slowRemainingSec: number;
  pathProgressCells: number;
  gridX: number;
  gridY: number;
  hpBarWidth: number;
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
  hpBg: Phaser.GameObjects.Rectangle;
  hpFill: Phaser.GameObjects.Rectangle;
}

interface RunCardModifiers {
  damageMultiplier: number;
  fireRateMultiplier: number;
  critChanceBonus: number;
  mergeBonusCredits: number;
}

interface WaveRewardLogEntry {
  waveNumber: number;
  waveCredits: number;
  bossCredits: number;
  totalCredits: number;
  detail: string;
}

interface RunStats {
  runTimeMs: number;
  merges: number;
  totalDamage: number;
  waveRewardCredits: number;
  bossRewardCredits: number;
}

interface RunStartPayload {
  mode?: "normal" | "daily";
  dateKey?: string;
}

export class RunScene extends Phaser.Scene {
  private gridGraphics?: Phaser.GameObjects.Graphics;
  private pathGraphics?: Phaser.GameObjects.Graphics;
  private hudLabel?: Phaser.GameObjects.Text;
  private hudHpLabel?: Phaser.GameObjects.Text;
  private hudWaveLabel?: Phaser.GameObjects.Text;
  private hudCreditsLabel?: Phaser.GameObjects.Text;
  private hudInfoBg?: Phaser.GameObjects.Rectangle;
  private hudHpBg?: Phaser.GameObjects.Rectangle;
  private hudWaveBg?: Phaser.GameObjects.Rectangle;
  private hudCreditsBg?: Phaser.GameObjects.Rectangle;
  private scanlineOverlay?: Phaser.GameObjects.TileSprite;
  private vignetteSprite?: Phaser.GameObjects.Image;
  private runBackdropImage?: Phaser.GameObjects.Image;
  private buyButtonContainer?: Phaser.GameObjects.Container;
  private buyButtonBackground?: Phaser.GameObjects.Rectangle;
  private buyButtonLabel?: Phaser.GameObjects.Text;
  private handSlotContainer?: Phaser.GameObjects.Container;
  private handSlotBackground?: Phaser.GameObjects.Rectangle;
  private handSlotLabel?: Phaser.GameObjects.Text;
  private handSlotHint?: Phaser.GameObjects.Text;
  private handCancelButton?: Phaser.GameObjects.Rectangle;
  private handCancelLabel?: Phaser.GameObjects.Text;
  private handDragToken?: Phaser.GameObjects.Container;
  private feedbackLabel?: Phaser.GameObjects.Text;
  private elapsedMs = 0;
  private gameState?: GameState;
  private gridSpec: GridSpec = { ...DEFAULT_GRID };
  private boardLeft = 0;
  private boardTop = 0;
  private boardWidth = 0;
  private boardHeight = 0;
  private cellSize = 56;
  private readonly turretsByCell = new Map<number, TurretView>();
  private readonly turretsByObject = new Map<Phaser.GameObjects.Container, TurretView>();
  private readonly enemiesById = new Map<number, EnemyView>();
  private readonly typeDisplayNames = new Map<string, string>();
  private readonly turretCatalog = new Map<string, Map<number, TurretConfig>>();
  private readonly enemyCatalog = new Map<string, EnemyConfig>();
  private readonly waveEntriesByWave = new Map<number, WaveEntryConfig[]>();
  private readonly pathCells: Phaser.Math.Vector2[] = [];
  private readonly pathSegmentLengths: number[] = [];
  private readonly blockedPathCells = new Set<number>();
  private readonly blockedObstacleCells = new Set<number>();
  private readonly resolvedMapPath: PathCellConfig[] = [];
  private readonly resolvedMapObstacles: PathCellConfig[] = [];
  private mapDataResolved = false;
  private turretIdCounter = 0;
  private enemyIdCounter = 0;
  private pathLengthCells = 0;
  private readonly purchasableTurrets: TurretConfig[] = [];
  private purchaseSelectionIndex = 0;
  private purchaseTurretConfig?: TurretConfig;
  private orderedWaveNumbers: number[] = [];
  private activeWaveIndex = 0;
  private activeWaveEntryIndex = 0;
  private spawnedInActiveEntry = 0;
  private spawnCooldownSec = 0;
  private interWaveDelaySec = 0;
  private runCompleted = false;
  private cardDraftOverlay?: Phaser.GameObjects.Container;
  private endRunOverlay?: Phaser.GameObjects.Container;
  private readonly offeredCards: CardConfig[] = [];
  private readonly selectedCardIds: string[] = [];
  private readonly waveRewardLog: WaveRewardLogEntry[] = [];
  private cardDraftWaveNumber = 0;
  private isCardDraftOpen = false;
  private runOutcome: "win" | "lose" | null = null;
  private highestWaveReached = 0;
  private runStats: RunStats = this.createDefaultRunStats();
  private runCardModifiers: RunCardModifiers = this.createDefaultRunCardModifiers();
  private runCreditMetaMultiplier = 1;
  private platformPaused = false;
  private unsubscribePauseSignal?: () => void;
  private saveDirty = false;
  private saveHeartbeatMs = 0;
  private rewardDoubleClaimed = false;
  private endRunActionLocked = false;
  private runSeed = 0;
  private runMode: "normal" | "daily" = "normal";
  private dailyDateKey = "";
  private dailySeed = 0;
  private dailyScore = 0;
  private dailyScoreSubmitted = false;
  private tutorialOverlay?: Phaser.GameObjects.Container;
  private tutorialStep = 0;
  private tutorialActive = false;
  private tutorialDragDetected = false;
  private readonly generatedCards: CardConfig[] = [];
  private turretInHand?: TurretConfig;
  private handTokenHomeX = 0;
  private handTokenHomeY = 0;

  constructor() {
    super("RunScene");
  }

  init(data: RunStartPayload): void {
    this.runMode = data.mode === "daily" ? "daily" : "normal";
    this.dailyDateKey = data.dateKey && data.dateKey.length > 0 ? data.dateKey : getLocalDateKey();
    this.dailySeed = getDailySeed(this.dailyDateKey);
    this.dailyScore = 0;
    this.dailyScoreSubmitted = false;
  }

  create(): void {
    this.gameState = this.registry.get(GAME_STATE_KEY) as GameState | undefined;
    if (!this.gameState) {
      this.showStateError("GameState не найден. Вернитесь в меню и начните заново.");
      return;
    }
    refreshDailyTasksIfNeeded(this.gameState.metaState, this.gameState.configs.meta);
    this.sound.mute = !this.gameState.settingsState.soundEnabled;
    hideStickyInRun();
    this.runCreditMetaMultiplier =
      1 +
      Math.max(0, getMetaEffectTotal(this.gameState.metaState, this.gameState.configs.meta, "run_credit_multiplier"));

    this.resetRuntimeState();
    this.ensureSpriteAnimations();
    this.runSeed = this.resolveRunSeed();
    this.cameras.main.setBackgroundColor(Colors.bgDark);
    this.gridGraphics = this.add.graphics().setDepth(2);
    this.pathGraphics = this.add.graphics().setDepth(6);

    this.applyConfiguredGridSpec();
    this.initializeTurretCatalog();
    this.initializePurchasableTurrets();
    this.initializeEnemyCatalog();
    this.initializeMapData();
    this.initializePathData();
    this.initializeWaveGenerator();
    this.initializeGeneratedCards();

    this.ensureAmbientMusic();
    this.hudInfoBg = this.add
      .rectangle(0, 0, 420, 84, Colors.bgOverlay, 0.88)
      .setStrokeStyle(1, Colors.borderLight, 0.86)
      .setOrigin(0, 0)
      .setDepth(40);
    this.hudLabel = this.add
      .text(0, 0, this.buildHudText(), {
        fontFamily: Fonts.mono,
        fontSize: "13px",
        color: "#dbeafe",
        lineSpacing: 2
      })
      .setOrigin(0, 0)
      .setDepth(41);

    this.hudHpBg = this.add
      .rectangle(0, 0, 152, 42, Colors.bgOverlay, 0.92)
      .setStrokeStyle(1, Colors.borderLight, 0.9)
      .setDepth(42);
    this.hudWaveBg = this.add
      .rectangle(0, 0, 152, 42, Colors.bgOverlay, 0.92)
      .setStrokeStyle(1, Colors.borderLight, 0.9)
      .setDepth(42);
    this.hudCreditsBg = this.add
      .rectangle(0, 0, 176, 42, Colors.bgOverlay, 0.92)
      .setStrokeStyle(1, Colors.borderLight, 0.9)
      .setDepth(42);
    this.hudHpLabel = this.add
      .text(0, 0, "", {
        fontFamily: Fonts.game,
        fontSize: "19px",
        color: "#a7f3d0"
      })
      .setOrigin(0.5)
      .setDepth(43);
    this.hudWaveLabel = this.add
      .text(0, 0, "", {
        fontFamily: Fonts.game,
        fontSize: "19px",
        color: "#bae6fd"
      })
      .setOrigin(0.5)
      .setDepth(43);
    this.hudCreditsLabel = this.add
      .text(0, 0, "", {
        fontFamily: Fonts.game,
        fontSize: "19px",
        color: "#fcd34d"
      })
      .setOrigin(0.5)
      .setDepth(43);
    this.feedbackLabel = this.add
      .text(this.scale.width / 2, 92, "", {
        fontFamily: Fonts.ui,
        fontSize: "16px",
        color: "#f8fafc"
      })
      .setOrigin(0.5)
      .setAlpha(0);

    this.createBuyButton();
    this.createHandSlot();
    this.createAmbientOverlays();
    this.applyLayout(this.scale.width, this.scale.height);
    this.refreshHudAndControls();

    if (this.gameState.runState.currentWave > 0) {
      const runPrefix = this.runMode === "daily" ? "Daily Challenge" : "Обычный забег";
      this.showFeedback(`${runPrefix} | Волна ${this.gameState.runState.currentWave}`, "#bfdbfe");
    }
    this.setupTutorialIfNeeded();

    this.input.on("dragstart", this.onDragStart, this);
    this.input.on("drag", this.onDrag, this);
    this.input.on("dragend", this.onDragEnd, this);
    this.input.on("pointerdown", this.onPointerDown, this);
    this.unsubscribePauseSignal = yandexGamesSdk.subscribePause((paused, reason) => {
      this.onPauseSignalChanged(paused, reason);
    });
    this.scale.on("resize", this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.destroyTutorialOverlay();
      this.destroyCardDraftOverlay();
      this.destroyEndRunOverlay();
      this.persistMetaProgress();
      if (this.gameState) {
        void flushGameSave(this.gameState);
      }
      this.unsubscribePauseSignal?.();
      this.unsubscribePauseSignal = undefined;

      this.scale.off("resize", this.onResize, this);
      this.input.off("dragstart", this.onDragStart, this);
      this.input.off("drag", this.onDrag, this);
      this.input.off("dragend", this.onDragEnd, this);
      this.input.off("pointerdown", this.onPointerDown, this);
    });
  }

  private resetRuntimeState(): void {
    this.elapsedMs = 0;
    this.turretIdCounter = 0;
    this.enemyIdCounter = 0;
    this.pathLengthCells = 0;
    this.purchaseSelectionIndex = 0;
    this.activeWaveIndex = 0;
    this.activeWaveEntryIndex = 0;
    this.spawnedInActiveEntry = 0;
    this.spawnCooldownSec = 0;
    this.interWaveDelaySec = 0;
    this.runCompleted = false;
    this.runOutcome = null;
    this.highestWaveReached = 0;
    this.runStats = this.createDefaultRunStats();
    this.resetRunCardModifiers();
    this.runCreditMetaMultiplier = 1;
    this.platformPaused = false;
    this.saveDirty = false;
    this.saveHeartbeatMs = 0;
    this.rewardDoubleClaimed = false;
    this.endRunActionLocked = false;
    this.runSeed = 0;
    this.mapDataResolved = false;
    this.dailyScore = 0;
    this.dailyScoreSubmitted = false;
    this.tutorialStep = 0;
    this.tutorialActive = false;
    this.tutorialDragDetected = false;
    this.turretInHand = undefined;
    this.handTokenHomeX = 0;
    this.handTokenHomeY = 0;
    this.isCardDraftOpen = false;
    this.cardDraftWaveNumber = 0;
    this.gridSpec = { ...DEFAULT_GRID };

    this.destroyCardDraftOverlay();
    this.destroyEndRunOverlay();
    this.destroyTutorialOverlay();
    this.destroyHandDragToken();
    this.offeredCards.length = 0;
    this.generatedCards.length = 0;
    this.resolvedMapPath.length = 0;
    this.resolvedMapObstacles.length = 0;
    this.selectedCardIds.length = 0;
    this.waveRewardLog.length = 0;
    this.turretsByCell.clear();
    this.turretsByObject.clear();
    this.enemiesById.clear();
    this.typeDisplayNames.clear();
    this.turretCatalog.clear();
    this.enemyCatalog.clear();
    this.waveEntriesByWave.clear();
    this.blockedPathCells.clear();
    this.blockedObstacleCells.clear();
    this.pathCells.length = 0;
    this.pathSegmentLengths.length = 0;
    this.purchasableTurrets.length = 0;
    this.purchaseTurretConfig = undefined;
    this.orderedWaveNumbers = [];
  }

  update(_time: number, delta: number): void {
    if (!this.gameState || this.gameState.runState.isPaused) {
      return;
    }

    const speedMultiplier =
      this.runMode === "daily"
        ? 1
        : this.gameState.settingsState.speedMultiplier >= 1.5
          ? 1.5
          : 1;
    const deltaSec = (delta * speedMultiplier) / 1000;

    if (!this.runCompleted) {
      this.runStats.runTimeMs += delta;
      this.updateWaveSpawner(deltaSec);
      this.updateEnemies(deltaSec);
      this.updateTurretCombat(deltaSec);

      if (!this.runCompleted && this.isAllWavesSpawned() && this.enemiesById.size === 0) {
        this.finishRun(true);
      }
    }
    this.updateTutorialProgress();

    this.elapsedMs += delta;
    this.saveHeartbeatMs += delta;
    if (this.saveDirty && this.saveHeartbeatMs >= 1800 && this.gameState) {
      queueGameSave(this.gameState);
      this.saveDirty = false;
      this.saveHeartbeatMs = 0;
    }
    if (this.elapsedMs >= LOOP_TICK_INTERVAL_MS) {
      const ticks = Math.floor(this.elapsedMs / LOOP_TICK_INTERVAL_MS);
      this.gameState.runState.loopTick += ticks;
      this.elapsedMs -= ticks * LOOP_TICK_INTERVAL_MS;
      this.refreshHudAndControls();
    }
  }

  private onResize(gameSize: Phaser.Structs.Size): void {
    this.applyLayout(gameSize.width, gameSize.height);
  }

  private onPauseSignalChanged(paused: boolean, reason: PauseReason): void {
    if (!this.gameState) {
      return;
    }

    if (paused) {
      this.platformPaused = true;
      this.gameState.runState.isPaused = true;
      this.showFeedback("Пауза: окно неактивно", "#fde68a");
      this.refreshHudAndControls();
      return;
    }

    this.platformPaused = false;
    if (!this.runCompleted && !this.isCardDraftOpen) {
      this.gameState.runState.isPaused = false;
    }
    if (reason !== "focus") {
      this.showFeedback("Возобновлено", "#a7f3d0");
    }
    this.refreshHudAndControls();
  }

  private applyLayout(width: number, height: number): void {
    const nextGridSpec = this.getConfiguredGridSpec();
    const gridChanged =
      this.gridSpec.cols !== nextGridSpec.cols || this.gridSpec.rows !== nextGridSpec.rows;
    this.gridSpec = { ...nextGridSpec };

    if (gridChanged) {
      this.initializeMapData();
      this.initializePathData();
      this.reconcileTurretCellsAfterGridChange();
    }

    const availableWidth = Math.max(220, width - GRID_SIDE_PADDING * 2);
    const availableHeight = Math.max(220, height - GRID_TOP_OFFSET - GRID_BOTTOM_PADDING);
    this.cellSize = Math.max(
      34,
      Math.floor(
        Math.min(availableWidth / this.gridSpec.cols, availableHeight / this.gridSpec.rows)
      )
    );

    this.boardWidth = this.cellSize * this.gridSpec.cols;
    this.boardHeight = this.cellSize * this.gridSpec.rows;
    this.boardLeft = Math.floor((width - this.boardWidth) / 2);
    const boardAreaTop = GRID_TOP_OFFSET + Math.max(0, availableHeight - this.boardHeight) / 2;
    this.boardTop = Math.floor(boardAreaTop);

    this.drawGrid();
    this.drawPath();
    this.positionAmbientOverlays(width, height);
    this.positionHudAndControls(width);
    this.updateHandTokenHomePosition();
    this.repositionAllTurrets();
    this.repositionAllEnemies();
    this.renderCardDraftOverlay();
    this.renderEndRunOverlay();
    this.renderTutorialOverlay();
    this.refreshHudAndControls();
  }

  private drawGrid(): void {
    const grid = this.gridGraphics;
    if (!grid) {
      return;
    }

    grid.clear();

    // Фон поля
    grid.fillStyle(Colors.bgPanel, 0.92);
    grid.fillRoundedRect(
      this.boardLeft - 8,
      this.boardTop - 8,
      this.boardWidth + 16,
      this.boardHeight + 16,
      12
    );
    grid.lineStyle(1, Colors.gridBorder, 0.5);
    grid.strokeRoundedRect(
      this.boardLeft - 8,
      this.boardTop - 8,
      this.boardWidth + 16,
      this.boardHeight + 16,
      12
    );

    // Угловые скобки рамки поля — мягче
    UIFactory.drawCornerBrackets(
      grid,
      this.boardLeft - 8,
      this.boardTop - 8,
      this.boardWidth + 16,
      this.boardHeight + 16,
      Colors.cyanBright,
      0.38,
      14,
      2
    );

    // Grid cells
    const cellInset = Math.max(2, Math.floor(this.cellSize * 0.07));
    for (let row = 0; row < this.gridSpec.rows; row += 1) {
      for (let col = 0; col < this.gridSpec.cols; col += 1) {
        const cellIndex = row * this.gridSpec.cols + col;
        const x = this.boardLeft + col * this.cellSize + cellInset;
        const y = this.boardTop + row * this.cellSize + cellInset;
        const size = this.cellSize - cellInset * 2;
        const isPathCell = this.blockedPathCells.has(cellIndex);
        const isObstacleCell = this.blockedObstacleCells.has(cellIndex);
        const cellColor = isPathCell
          ? Colors.gridCellPath
          : isObstacleCell
            ? Colors.gridCellObstacle
            : Colors.gridCellEmpty;
        const cellAlpha = isPathCell ? 0.9 : isObstacleCell ? 0.88 : 0.88;
        grid.fillStyle(cellColor, cellAlpha);
        grid.fillRoundedRect(x, y, size, size, 6);
        // Тонкая точка-сетка только на пустых клетках
        if (!isPathCell && !isObstacleCell) {
          grid.fillStyle(0xffffff, 0.03);
          const dotSpacing = Math.max(8, Math.floor(size / 3));
          for (let dy = dotSpacing; dy < size; dy += dotSpacing) {
            for (let dx = dotSpacing; dx < size; dx += dotSpacing) {
              grid.fillCircle(x + dx, y + dy, 1);
            }
          }
        }
        // Преграды: мягкий диагональный штрих вместо красного креста
        if (isObstacleCell) {
          grid.lineStyle(1, 0x2a2438, 0.5);
          const step = Math.max(6, Math.floor(size / 5));
          for (let d = -size; d < size * 2; d += step) {
            grid.beginPath();
            grid.moveTo(x + d, y);
            grid.lineTo(x + d + size, y + size);
            grid.strokePath();
          }
        }
      }
    }

    // Линии сетки — очень мягкие
    grid.lineStyle(1, Colors.gridLine, 0.35);
    for (let col = 0; col <= this.gridSpec.cols; col += 1) {
      const x = this.boardLeft + col * this.cellSize;
      grid.beginPath();
      grid.moveTo(x, this.boardTop);
      grid.lineTo(x, this.boardTop + this.boardHeight);
      grid.strokePath();
    }
    for (let row = 0; row <= this.gridSpec.rows; row += 1) {
      const y = this.boardTop + row * this.cellSize;
      grid.beginPath();
      grid.moveTo(this.boardLeft, y);
      grid.lineTo(this.boardLeft + this.boardWidth, y);
      grid.strokePath();
    }
  }

  private drawPath(): void {
    const pathGraphics = this.pathGraphics;
    if (!pathGraphics) {
      return;
    }

    pathGraphics.clear();
    if (this.pathCells.length < 2) {
      return;
    }

    const first = this.gridToWorld(this.pathCells[0].x, this.pathCells[0].y);
    const pathWidth = Math.max(5, Math.floor(this.cellSize * 0.22));
    const glowWidth = pathWidth + Math.max(6, Math.floor(this.cellSize * 0.3));

    // Мягкое свечение под путём
    pathGraphics.lineStyle(glowWidth, Colors.cyanDim ?? 0x0e4d5c, 0.25);
    pathGraphics.beginPath();
    pathGraphics.moveTo(first.x, first.y);
    for (let index = 1; index < this.pathCells.length; index += 1) {
      const next = this.gridToWorld(this.pathCells[index].x, this.pathCells[index].y);
      pathGraphics.lineTo(next.x, next.y);
    }
    pathGraphics.strokePath();

    // Основная линия пути — приглушённый циан
    pathGraphics.lineStyle(pathWidth, Colors.cyanBright, 0.4);
    pathGraphics.beginPath();
    pathGraphics.moveTo(first.x, first.y);
    for (let index = 1; index < this.pathCells.length; index += 1) {
      const next = this.gridToWorld(this.pathCells[index].x, this.pathCells[index].y);
      pathGraphics.lineTo(next.x, next.y);
    }
    pathGraphics.strokePath();

    const lastCell = this.pathCells[this.pathCells.length - 1];
    const last = this.gridToWorld(lastCell.x, lastCell.y);
    const markerRadius = Math.max(5, Math.floor(this.cellSize * 0.14));

    pathGraphics.fillStyle(Colors.pathStart ?? Colors.green, 0.85);
    pathGraphics.fillCircle(first.x, first.y, markerRadius);
    pathGraphics.fillStyle(Colors.pathEnd ?? Colors.redPale, 0.85);
    pathGraphics.fillCircle(last.x, last.y, markerRadius);
  }

  private positionHudAndControls(width: number): void {
    const isMobile = width < MOBILE_BREAKPOINT_PX;
    const gap = isMobile ? 8 : 12;
    const hpWidth = isMobile ? Math.min(118, (width - 24 - gap * 2) / 3) : 162;
    const waveWidth = hpWidth;
    const creditsWidth = isMobile ? Math.min(138, (width - 24 - gap * 2) / 3) : 188;
    const badgeY = isMobile ? 24 : 28;
    const badgeStartX = width / 2 - (hpWidth + waveWidth + creditsWidth + gap * 2) / 2 + hpWidth / 2;
    const waveX = badgeStartX + hpWidth / 2 + gap + waveWidth / 2;
    const creditsX = waveX + waveWidth / 2 + gap + creditsWidth / 2;

    this.hudHpBg?.setPosition(badgeStartX, badgeY).setDisplaySize(hpWidth, 42);
    this.hudWaveBg?.setPosition(waveX, badgeY).setDisplaySize(waveWidth, 42);
    this.hudCreditsBg?.setPosition(creditsX, badgeY).setDisplaySize(creditsWidth, 42);
    this.hudHpLabel?.setPosition(badgeStartX, badgeY);
    this.hudWaveLabel?.setPosition(waveX, badgeY);
    this.hudCreditsLabel?.setPosition(creditsX, badgeY);

    const infoPanelWidth = isMobile ? width - 20 : 468;
    const infoPanelY = isMobile ? 56 : 60;
    this.hudInfoBg
      ?.setPosition(10, infoPanelY)
      .setDisplaySize(infoPanelWidth, isMobile ? 58 : 62)
      .setOrigin(0, 0)
      .setDepth(40);
    this.hudLabel
      ?.setPosition(18, infoPanelY + 8)
      .setFontSize(isMobile ? "11px" : "13px")
      .setDepth(41);

    const buttonWidth = isMobile
      ? Math.max(BUY_BUTTON_WIDTH_MOBILE_MIN, Math.min(width - 32, 280))
      : BUY_BUTTON_WIDTH_DESKTOP;
    const buttonX = isMobile ? width / 2 : width - buttonWidth / 2 - 20;
    const buttonY = isMobile ? 96 : 48;
    this.buyButtonContainer?.setPosition(buttonX, buttonY).setDepth(45);
    this.buyButtonContainer?.setSize(buttonWidth, BUY_BUTTON_HEIGHT);
    this.buyButtonBackground?.setDisplaySize(buttonWidth, BUY_BUTTON_HEIGHT);
    this.buyButtonBackground?.setPosition(0, 0);
    this.buyButtonLabel?.setPosition(0, 0).setFontSize(isMobile ? "18px" : "20px");

    const slotWidth = buttonWidth;
    const slotY = buttonY + BUY_BUTTON_HEIGHT / 2 + HAND_SLOT_HEIGHT / 2 + (isMobile ? 10 : 8);
    this.handSlotContainer?.setPosition(buttonX, slotY).setDepth(45);
    this.handSlotContainer?.setSize(slotWidth, HAND_SLOT_HEIGHT);
    this.handSlotBackground?.setDisplaySize(slotWidth, HAND_SLOT_HEIGHT).setPosition(0, 0);
    this.handSlotLabel?.setPosition(-slotWidth / 2 + 12, -10).setFontSize(isMobile ? "13px" : "14px");
    this.handSlotHint?.setPosition(-slotWidth / 2 + 12, 10).setFontSize(isMobile ? "11px" : "12px");
    this.handCancelButton
      ?.setPosition(slotWidth / 2 - 48, 0)
      .setDisplaySize(86, Math.max(30, HAND_SLOT_HEIGHT - 14));
    this.handCancelLabel?.setPosition(slotWidth / 2 - 48, 0).setFontSize(isMobile ? "13px" : "14px");
    this.feedbackLabel?.setPosition(width / 2, this.boardTop - 18).setDepth(46);
  }

  private ensureAmbientMusic(): void {
    const musicKey = "asset_ambient_loop";
    if (!this.cache.audio.exists(musicKey)) {
      return;
    }
    if (this.sound.locked) {
      this.sound.once("unlocked", () => this.ensureAmbientMusic());
      return;
    }

    const existing = this.sound.get(musicKey);
    if (existing) {
      if (!existing.isPlaying) {
        existing.play({ loop: true, volume: 0.28 });
      }
      return;
    }

    const music = this.sound.add(musicKey, {
      loop: true,
      volume: 0.28
    });
    if (!music.isPlaying) {
      music.play();
    }
  }

  private createAmbientOverlays(): void {
    const backdropKey = this.textures.exists(RUN_BACKDROP_KEY)
      ? RUN_BACKDROP_KEY
      : this.textures.exists(MENU_BACKDROP_KEY)
        ? MENU_BACKDROP_KEY
        : undefined;
    if (backdropKey) {
      this.runBackdropImage = this.add
        .image(this.scale.width / 2, this.scale.height / 2, backdropKey)
        .setDepth(1)
        .setAlpha(0.14);
      this.runBackdropImage.setDisplaySize(this.scale.width, this.scale.height);
    }
    if (this.textures.exists(TEX.scanlines)) {
      this.scanlineOverlay = this.add
        .tileSprite(0, 0, this.scale.width, this.scale.height, TEX.scanlines)
        .setOrigin(0)
        .setDepth(100)
        .setAlpha(0.1);
    }
    if (this.textures.exists(TEX.vignette)) {
      this.vignetteSprite = this.add
        .image(this.scale.width / 2, this.scale.height / 2, TEX.vignette)
        .setDepth(101);
      this.vignetteSprite.setDisplaySize(this.scale.width, this.scale.height);
    }
  }

  private positionAmbientOverlays(width: number, height: number): void {
    if (this.runBackdropImage) {
      this.runBackdropImage.setPosition(width / 2, height / 2);
      this.runBackdropImage.setDisplaySize(width, height);
    }
    if (this.scanlineOverlay) {
      this.scanlineOverlay.setSize(width, height);
    }
    if (this.vignetteSprite) {
      this.vignetteSprite.setPosition(width / 2, height / 2);
      this.vignetteSprite.setDisplaySize(width, height);
    }
  }

  private createBuyButton(): void {
    this.buyButtonContainer = this.add.container(0, 0);
    this.buyButtonBackground = this.add
      .rectangle(0, 0, BUY_BUTTON_WIDTH_DESKTOP, BUY_BUTTON_HEIGHT, Colors.btnPrimary, 1)
      .setStrokeStyle(2, Colors.borderBright, 0.9)
      .setInteractive({ useHandCursor: true });

    this.buyButtonLabel = this.add
      .text(0, 0, "Купить турель", {
        fontFamily: Fonts.game,
        fontSize: "20px",
        color: "#ecfeff"
      })
      .setOrigin(0.5);

    this.buyButtonContainer.add([this.buyButtonBackground, this.buyButtonLabel]);
    this.buyButtonBackground.on("pointerdown", () => {
      AnimationHelper.buttonPress(this, this.buyButtonContainer!);
      this.onBuyTurretPressed();
    });
    this.buyButtonBackground.on("pointerover", () => {
      if (!this.buyButtonBackground || !this.isBuyButtonEnabled()) {
        return;
      }
      this.buyButtonBackground.setFillStyle(Colors.btnPrimaryHover, 1);
    });
    this.buyButtonBackground.on("pointerout", () => {
      this.updateBuyButtonVisual();
    });
  }

  private createHandSlot(): void {
    this.handSlotContainer = this.add.container(0, 0);
    this.handSlotBackground = this.add
      .rectangle(0, 0, BUY_BUTTON_WIDTH_DESKTOP, HAND_SLOT_HEIGHT, Colors.bgCard, 0.98)
      .setStrokeStyle(2, Colors.borderLight, 0.88);
    this.handSlotLabel = this.add
      .text(-BUY_BUTTON_WIDTH_DESKTOP / 2 + 12, -10, "Рука: пусто", {
        fontFamily: Fonts.game,
        fontSize: "14px",
        color: "#dbeafe"
      })
      .setOrigin(0, 0.5);
    this.handSlotHint = this.add
      .text(-BUY_BUTTON_WIDTH_DESKTOP / 2 + 12, 10, "Купите турель и поставьте её на клетку", {
        fontFamily: Fonts.mono,
        fontSize: "12px",
        color: "#94a3b8"
      })
      .setOrigin(0, 0.5);
    this.handCancelButton = this.add
      .rectangle(BUY_BUTTON_WIDTH_DESKTOP / 2 - 48, 0, 86, 38, Colors.btnSecondary, 0.96)
      .setStrokeStyle(1, Colors.borderLight, 0.82)
      .setInteractive({ useHandCursor: true });
    this.handCancelLabel = this.add
      .text(BUY_BUTTON_WIDTH_DESKTOP / 2 - 48, 0, "Отмена", {
        fontFamily: Fonts.ui,
        fontSize: "14px",
        color: "#e2e8f0"
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    const cancel = (): void => {
      this.onHandCancelPressed();
    };
    this.handCancelButton.on("pointerdown", cancel);
    this.handCancelLabel.on("pointerdown", cancel);
    this.handSlotContainer.add([
      this.handSlotBackground,
      this.handSlotLabel,
      this.handSlotHint,
      this.handCancelButton,
      this.handCancelLabel
    ]);
    this.refreshHandSlotVisual();
  }

  private onHandCancelPressed(): void {
    if (!this.gameState || !this.turretInHand || this.isGameplayInteractionLocked()) {
      return;
    }

    this.gameState.runState.credits += this.turretInHand.cost;
    this.markSaveDirty();
    this.showFeedback(`Покупка отменена: +${this.turretInHand.cost} кр`, "#fde68a");
    this.setTurretInHand(undefined);
    this.refreshHudAndControls();
  }

  private setTurretInHand(turret: TurretConfig | undefined): void {
    this.turretInHand = turret;
    this.refreshHandSlotVisual();
    if (!turret) {
      this.destroyHandDragToken();
      return;
    }
    this.createHandDragTokenForTurret(turret);
    this.updateHandTokenHomePosition();
  }

  private refreshHandSlotVisual(): void {
    if (!this.handSlotBackground || !this.handSlotLabel || !this.handSlotHint) {
      return;
    }

    if (!this.turretInHand) {
      this.handSlotBackground
        .setFillStyle(Colors.bgCard, 0.98)
        .setStrokeStyle(2, Colors.borderLight, 0.88);
      this.handSlotLabel.setText("Рука: пусто").setColor("#dbeafe");
      this.handSlotHint.setText("Купите турель и поставьте её на клетку").setColor("#94a3b8");
      this.handCancelButton?.setVisible(false).disableInteractive();
      this.handCancelLabel?.setVisible(false).disableInteractive();
      return;
    }

    const role = this.normalizeTurretRole(this.turretInHand.role);
    const baseType = this.extractBaseType(this.turretInHand.id);
    this.handSlotBackground
      .setFillStyle(Colors.bgPanel, 0.98)
      .setStrokeStyle(2, Colors.amber, 0.9);
    this.handSlotLabel
      .setText(`Рука: ${this.getTypeLabel(baseType)} [${this.getRoleLabel(role)}]`)
      .setColor("#fde68a");
    this.handSlotHint
      .setText("Tap по клетке или drag токена на поле")
      .setColor("#bfdbfe");
    this.handCancelButton?.setVisible(true).setInteractive({ useHandCursor: true });
    this.handCancelLabel?.setVisible(true).setInteractive({ useHandCursor: true });
  }

  private createHandDragTokenForTurret(turret: TurretConfig): void {
    this.destroyHandDragToken();
    const tokenSize = Math.max(28, Math.floor(this.cellSize * 0.64));
    const role = this.normalizeTurretRole(turret.role);
    const sheetKey = TURRET_SHEET_BY_ROLE[role];
    const animKey = TURRET_ANIM_BY_ROLE[role];
    const textureKey = turretKey(role, turret.level);
    const baseType = this.extractBaseType(turret.id);
    const color = this.resolveTierColor(baseType, turret.level);
    const body = this.textures.exists(sheetKey)
      ? this.add.sprite(0, 0, sheetKey, 0).setDisplaySize(tokenSize, tokenSize)
      : this.textures.exists(textureKey)
      ? this.add.image(0, 0, textureKey).setDisplaySize(tokenSize, tokenSize)
      : this.add.rectangle(0, 0, tokenSize, tokenSize, color, 1).setStrokeStyle(2, Colors.white, 0.75);
    if (body instanceof Phaser.GameObjects.Sprite && this.anims.exists(animKey)) {
      body.play(animKey);
    }
    const tierLabel = this.add
      .text(0, 0, `T${turret.level}`, {
        fontFamily: Fonts.mono,
        fontSize: `${Math.max(10, Math.floor(tokenSize * 0.35))}px`,
        color: "#f8fafc",
        stroke: "#020617",
        strokeThickness: 2
      })
      .setOrigin(0.5);
    const token = this.add.container(0, 0, [body, tierLabel]).setDepth(52);
    token.setSize(tokenSize, tokenSize);
    token.setInteractive(
      new Phaser.Geom.Rectangle(-tokenSize / 2, -tokenSize / 2, tokenSize, tokenSize),
      Phaser.Geom.Rectangle.Contains
    );
    this.input.setDraggable(token);
    this.handDragToken = token;
    this.snapHandTokenToHome();
  }

  private destroyHandDragToken(): void {
    if (!this.handDragToken) {
      return;
    }
    this.handDragToken.destroy(true);
    this.handDragToken = undefined;
  }

  private updateHandTokenHomePosition(): void {
    if (!this.handSlotContainer) {
      return;
    }
    this.handTokenHomeX = this.handSlotContainer.x - 10;
    this.handTokenHomeY = this.handSlotContainer.y;
    if (this.handDragToken && !this.input.activePointer.isDown) {
      this.snapHandTokenToHome();
    }
  }

  private snapHandTokenToHome(): void {
    if (!this.handDragToken) {
      return;
    }
    this.handDragToken.setPosition(this.handTokenHomeX, this.handTokenHomeY).setAlpha(1);
  }

  private onBuyTurretPressed(): void {
    if (!this.gameState || !this.purchaseTurretConfig) {
      this.showFeedback("Турель для покупки не настроена", "#fca5a5");
      return;
    }

    if (this.isCardDraftOpen) {
      this.showFeedback("Сначала выберите карту усиления", "#fde68a");
      return;
    }

    if (this.runCompleted) {
      this.showFeedback("Забег завершён. Используйте кнопки в окне итогов.", "#fca5a5");
      return;
    }

    if (this.turretInHand) {
      this.showFeedback("Сначала поставьте турель из руки", "#fde68a");
      return;
    }

    if (!this.isBuyButtonEnabled()) {
      if (this.getFreeCellIndexes().length === 0) {
        this.showFeedback("Свободных клеток нет", "#fca5a5");
      } else {
        this.showFeedback("Недостаточно кредитов", "#fca5a5");
      }
      return;
    }

    const turretForPurchase = this.resolvePurchaseTurretConfig();
    if (!turretForPurchase) {
      this.showFeedback("Нет доступной турели для покупки", "#fca5a5");
      return;
    }

    this.gameState.runState.credits -= turretForPurchase.cost;
    this.markSaveDirty();
    this.setTurretInHand(turretForPurchase);
    this.showFeedback(`${turretForPurchase.name} в руке`, "#a7f3d0");
    this.advancePurchaseSelection();
    this.refreshHudAndControls();
  }

  private onDragStart(
    _pointer: Phaser.Input.Pointer,
    gameObject: Phaser.GameObjects.GameObject
  ): void {
    if (gameObject === this.handDragToken) {
      if (this.isGameplayInteractionLocked() || !this.turretInHand) {
        this.snapHandTokenToHome();
        return;
      }
      this.children.bringToTop(this.handDragToken);
      this.handDragToken.setAlpha(0.95);
      return;
    }

    if (this.isGameplayInteractionLocked()) {
      return;
    }

    const turret = this.turretsByObject.get(gameObject as Phaser.GameObjects.Container);
    if (!turret) {
      return;
    }

    if (this.tutorialActive && this.tutorialStep <= 2) {
      this.tutorialDragDetected = true;
    }

    this.children.bringToTop(turret.container);
    turret.container.setAlpha(0.9);
  }

  private onDrag(
    _pointer: Phaser.Input.Pointer,
    gameObject: Phaser.GameObjects.GameObject,
    dragX: number,
    dragY: number
  ): void {
    if (gameObject === this.handDragToken) {
      if (!this.handDragToken || this.isGameplayInteractionLocked()) {
        return;
      }
      this.handDragToken.setPosition(dragX, dragY);
      return;
    }

    if (this.isGameplayInteractionLocked()) {
      return;
    }

    const turret = this.turretsByObject.get(gameObject as Phaser.GameObjects.Container);
    if (!turret) {
      return;
    }

    turret.container.setPosition(dragX, dragY);
  }

  private onDragEnd(
    pointer: Phaser.Input.Pointer,
    gameObject: Phaser.GameObjects.GameObject
  ): void {
    if (gameObject === this.handDragToken) {
      if (!this.handDragToken) {
        return;
      }
      this.handDragToken.setAlpha(1);
      if (this.isGameplayInteractionLocked() || !this.turretInHand) {
        this.snapHandTokenToHome();
        return;
      }
      const dropCell = this.worldToCell(pointer.worldX, pointer.worldY);
      if (dropCell !== undefined && this.tryPlaceTurretFromHand(dropCell, true)) {
        return;
      }
      this.snapHandTokenToHome();
      return;
    }

    const turret = this.turretsByObject.get(gameObject as Phaser.GameObjects.Container);
    if (!turret) {
      return;
    }

    if (this.isGameplayInteractionLocked()) {
      turret.container.setAlpha(1);
      this.snapTurretToCell(turret);
      return;
    }

    turret.container.setAlpha(1);
    const dropCell = this.worldToCell(pointer.worldX, pointer.worldY);
    if (dropCell === undefined || dropCell === turret.cellIndex) {
      this.snapTurretToCell(turret);
      return;
    }

    const target = this.turretsByCell.get(dropCell);
    if (!target || target === turret) {
      this.snapTurretToCell(turret);
      return;
    }

    if (target.baseType !== turret.baseType || target.tier !== turret.tier) {
      this.snapTurretToCell(turret);
      return;
    }

    const mergedConfig = this.getConfigByTypeAndTier(turret.baseType, turret.tier + 1);
    if (!mergedConfig) {
      this.showFeedback("Для этой турели нет следующего tier", "#fca5a5");
      this.snapTurretToCell(turret);
      return;
    }

    this.mergeTurrets(turret, target, mergedConfig);
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (
      this.isGameplayInteractionLocked() ||
      !this.turretInHand ||
      pointer.rightButtonDown()
    ) {
      return;
    }

    const cellIndex = this.worldToCell(pointer.worldX, pointer.worldY);
    if (cellIndex === undefined) {
      return;
    }
    this.tryPlaceTurretFromHand(cellIndex, false);
  }

  private tryPlaceTurretFromHand(cellIndex: number, fromDrag: boolean): boolean {
    if (!this.turretInHand || !this.canPlaceTurretAtCell(cellIndex)) {
      if (!fromDrag) {
        this.showFeedback("Эта клетка недоступна для размещения", "#fca5a5");
      }
      return false;
    }

    const turret = this.turretInHand;
    this.spawnTurretAtCell(turret, cellIndex);
    this.setTurretInHand(undefined);
    this.showFeedback(`${turret.name} размещена`, "#a7f3d0");
    this.refreshHudAndControls();
    return true;
  }

  private canPlaceTurretAtCell(cellIndex: number): boolean {
    if (
      this.blockedPathCells.has(cellIndex) ||
      this.blockedObstacleCells.has(cellIndex) ||
      this.turretsByCell.has(cellIndex)
    ) {
      return false;
    }
    return true;
  }

  private mergeTurrets(source: TurretView, target: TurretView, mergedConfig: TurretConfig): void {
    if (!this.gameState) {
      return;
    }

    this.turretsByCell.delete(source.cellIndex);
    this.turretsByObject.delete(source.container);
    source.container.destroy();

    target.tier = mergedConfig.level;
    target.config = mergedConfig;
    target.attackCooldownSec = 0;
    this.runStats.merges += 1;
    this.vibrate(18);
    applyDailyProgress(this.gameState.metaState, this.gameState.configs.meta, "merge_count", 1);
    this.markSaveDirty();
    this.refreshTurretVisual(target);
    this.snapTurretToCell(target);
    this.tweens.add({
      targets: target.container,
      scale: target.container.scale * 1.12,
      duration: 130,
      yoyo: true,
      ease: "Sine.easeOut"
    });
    const center = this.cellCenter(target.cellIndex);
    const roleColor = TYPE_COLORS[target.baseType] ?? TYPE_COLOR_FALLBACK;
    AnimationHelper.mergeBurst(this, center.x, center.y, roleColor, this.cellSize);

    const mergeBonus = this.runCardModifiers.mergeBonusCredits;
    if (mergeBonus > 0) {
      const grantedBonus = this.grantRunCredits(mergeBonus);
      this.showFeedback(
        `${this.getTypeLabel(target.baseType)} -> T${target.tier} (+${grantedBonus} кредитов)`,
        "#fde68a"
      );
    } else {
      this.showFeedback(`${this.getTypeLabel(target.baseType)} -> T${target.tier}`, "#a7f3d0");
    }

    this.refreshHudAndControls();
  }

  private spawnTurretAtCell(config: TurretConfig, cellIndex: number): void {
    const baseType = this.extractBaseType(config.id);
    const turretSize = Math.max(30, Math.floor(this.cellSize * TURRET_SIZE_FACTOR));
    const tierBadgeSize = Math.max(16, Math.floor(turretSize * TIER_BADGE_FACTOR));
    const role = this.normalizeTurretRole(config.role);
    const texKey = turretKey(role, config.level);
    const glowTexKey = turretGlowKey(role);

    // Body: Image texture with Rectangle fallback
    let body: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
    let glow: Phaser.GameObjects.Image | undefined;
    const sheetKey = TURRET_SHEET_BY_ROLE[role];
    const animKey = TURRET_ANIM_BY_ROLE[role];
    if (this.textures.exists(sheetKey)) {
      const sprite = this.add.sprite(0, 0, sheetKey, 0).setDisplaySize(turretSize, turretSize);
      if (this.anims.exists(animKey)) {
        sprite.play(animKey);
      }
      body = sprite;
      if (this.textures.exists(glowTexKey)) {
        const glowSize = turretSize * 1.4;
        glow = this.add.image(0, 0, glowTexKey).setDisplaySize(glowSize, glowSize).setAlpha(0.45);
        AnimationHelper.glowPulse(this, glow, 0.32, 0.6, 1500);
      }
    } else if (this.textures.exists(texKey)) {
      body = this.add.image(0, 0, texKey).setDisplaySize(turretSize, turretSize);
      // Glow behind turret
      if (this.textures.exists(glowTexKey)) {
        const glowSize = turretSize * 1.4;
        glow = this.add.image(0, 0, glowTexKey).setDisplaySize(glowSize, glowSize).setAlpha(0.5);
        AnimationHelper.glowPulse(this, glow, 0.35, 0.65, 1400);
      }
    } else {
      const color = this.resolveTierColor(baseType, config.level);
      body = this.add
        .rectangle(0, 0, turretSize, turretSize, color, 1)
        .setStrokeStyle(2, 0xe2e8f0, 0.7);
    }

    const shortLabel = `T${config.level}`;
    const nameLabel = this.add
      .text(0, -4, shortLabel, {
        fontFamily: Fonts.game,
        fontSize: `${Math.max(9, Math.floor(this.cellSize * 0.16))}px`,
        color: "#94a3b8",
        stroke: "#0f172a",
        strokeThickness: 1,
      })
      .setOrigin(0.5);
    const tierBadge = this.add
      .rectangle(
        turretSize * 0.26,
        -turretSize * 0.26,
        tierBadgeSize,
        tierBadgeSize,
        Colors.bgDeep,
        0.9
      )
      .setStrokeStyle(1, Colors.borderLight, 0.6);
    const tierLabel = this.add
      .text(tierBadge.x, tierBadge.y, `${config.level}`, {
        fontFamily: Fonts.game,
        fontSize: `${Math.max(9, Math.floor(this.cellSize * 0.16))}px`,
        color: Colors.textSecondary
      })
      .setOrigin(0.5);

    const children: Phaser.GameObjects.GameObject[] = [];
    if (glow) children.push(glow);
    children.push(body, nameLabel, tierBadge, tierLabel);
    const container = this.add.container(0, 0, children).setDepth(30);

    const turret: TurretView = {
      id: this.turretIdCounter,
      baseType,
      tier: config.level,
      config,
      cellIndex,
      attackCooldownSec: 0,
      container,
      body,
      glow,
      nameLabel,
      tierBadge,
      tierLabel
    };

    this.turretIdCounter += 1;
    this.turretsByCell.set(cellIndex, turret);
    this.turretsByObject.set(container, turret);
    this.refreshTurretVisual(turret);
    this.snapTurretToCell(turret);
  }

  private refreshTurretVisual(turret: TurretView): void {
    const turretSize = Math.max(30, Math.floor(this.cellSize * TURRET_SIZE_FACTOR));
    const tierBadgeSize = Math.max(14, Math.floor(turretSize * TIER_BADGE_FACTOR));
    const labelFontSize = `${Math.max(9, Math.floor(this.cellSize * 0.16))}px`;
    const tierFontSize = `${Math.max(9, Math.floor(this.cellSize * 0.16))}px`;

    // Update texture if Image, or color if Rectangle
    const role = this.normalizeTurretRole(turret.config.role);
    const texKey = turretKey(role, turret.tier);
    if (turret.body instanceof Phaser.GameObjects.Sprite) {
      const role = this.normalizeTurretRole(turret.config.role);
      const spriteSheet = TURRET_SHEET_BY_ROLE[role];
      const animKey = TURRET_ANIM_BY_ROLE[role];
      if (this.textures.exists(spriteSheet)) {
        turret.body.setTexture(spriteSheet).setDisplaySize(turretSize, turretSize);
      } else if (this.textures.exists(texKey)) {
        turret.body.setTexture(texKey).setDisplaySize(turretSize, turretSize);
      } else {
        turret.body.setDisplaySize(turretSize, turretSize);
      }
      if (this.anims.exists(animKey) && turret.body.anims.currentAnim?.key !== animKey) {
        turret.body.play(animKey);
      }
    } else if (turret.body instanceof Phaser.GameObjects.Image && this.textures.exists(texKey)) {
      turret.body.setTexture(texKey).setDisplaySize(turretSize, turretSize);
    } else if (turret.body instanceof Phaser.GameObjects.Rectangle) {
      const color = this.resolveTierColor(turret.baseType, turret.tier);
      turret.body.setDisplaySize(turretSize, turretSize).setFillStyle(color, 1);
    } else {
      turret.body.setDisplaySize(turretSize, turretSize);
    }

    if (turret.glow) {
      turret.glow.setDisplaySize(turretSize * 1.4, turretSize * 1.4);
    }

    turret.nameLabel
      .setText(`T${turret.tier}`)
      .setFontSize(labelFontSize)
      .setPosition(0, -4);
    turret.tierBadge
      .setDisplaySize(tierBadgeSize, tierBadgeSize)
      .setPosition(turretSize * 0.26, -turretSize * 0.26);
    turret.tierLabel
      .setText(String(turret.tier))
      .setFontSize(tierFontSize)
      .setPosition(turret.tierBadge.x, turret.tierBadge.y);

    turret.container.setScale(1);
    turret.container.setSize(turretSize, turretSize);
    turret.container.setInteractive(
      new Phaser.Geom.Rectangle(-turretSize / 2, -turretSize / 2, turretSize, turretSize),
      Phaser.Geom.Rectangle.Contains
    );
    this.input.setDraggable(turret.container);
  }

  private snapTurretToCell(turret: TurretView): void {
    const center = this.cellCenter(turret.cellIndex);
    turret.container.setPosition(center.x, center.y);
  }

  private repositionAllTurrets(): void {
    for (const turret of this.turretsByObject.values()) {
      this.refreshTurretVisual(turret);
      this.snapTurretToCell(turret);
    }
  }

  private reconcileTurretCellsAfterGridChange(): void {
    const totalCells = this.gridSpec.cols * this.gridSpec.rows;
    const occupied = new Set<number>();
    const turrets = Array.from(this.turretsByObject.values()).sort((a, b) => a.id - b.id);
    this.turretsByCell.clear();

    for (const turret of turrets) {
      const preferredCell = turret.cellIndex;
      const resolvedCell = this.resolveCellAfterGridChange(preferredCell, occupied, totalCells);
      if (resolvedCell === undefined) {
        this.turretsByObject.delete(turret.container);
        turret.container.destroy();
        continue;
      }

      turret.cellIndex = resolvedCell;
      occupied.add(resolvedCell);
      this.turretsByCell.set(resolvedCell, turret);
    }
  }

  private resolveCellAfterGridChange(
    preferredCell: number,
    occupied: Set<number>,
    totalCells: number
  ): number | undefined {
    const isPreferredValid =
      preferredCell >= 0 &&
      preferredCell < totalCells &&
      !occupied.has(preferredCell) &&
      !this.blockedPathCells.has(preferredCell) &&
      !this.blockedObstacleCells.has(preferredCell);
    if (isPreferredValid) {
      return preferredCell;
    }

    for (let index = 0; index < totalCells; index += 1) {
      if (
        !occupied.has(index) &&
        !this.blockedPathCells.has(index) &&
        !this.blockedObstacleCells.has(index)
      ) {
        return index;
      }
    }

    return undefined;
  }

  private cellCenter(cellIndex: number): { x: number; y: number } {
    const col = cellIndex % this.gridSpec.cols;
    const row = Math.floor(cellIndex / this.gridSpec.cols);
    return this.gridToWorld(col, row);
  }

  private gridToWorld(cellX: number, cellY: number): { x: number; y: number } {
    return {
      x: this.boardLeft + (cellX + 0.5) * this.cellSize,
      y: this.boardTop + (cellY + 0.5) * this.cellSize
    };
  }

  private worldToCell(worldX: number, worldY: number): number | undefined {
    if (
      worldX < this.boardLeft ||
      worldY < this.boardTop ||
      worldX >= this.boardLeft + this.boardWidth ||
      worldY >= this.boardTop + this.boardHeight
    ) {
      return undefined;
    }

    const col = Math.floor((worldX - this.boardLeft) / this.cellSize);
    const row = Math.floor((worldY - this.boardTop) / this.cellSize);
    if (col < 0 || row < 0 || col >= this.gridSpec.cols || row >= this.gridSpec.rows) {
      return undefined;
    }

    return row * this.gridSpec.cols + col;
  }

  private refreshHudAndControls(): void {
    this.syncPurchaseSelectionWithState();
    this.hudLabel?.setText(this.buildHudText());
    if (this.gameState) {
      const runState = this.gameState.runState;
      const totalWaves = this.orderedWaveNumbers.length;
      const maxWave = totalWaves > 0 ? this.orderedWaveNumbers[totalWaves - 1] : 0;
      this.hudHpLabel?.setText(`HP ${runState.baseHp}`);
      this.hudWaveLabel?.setText(
        maxWave > 0 ? `W ${runState.currentWave}/${maxWave}` : `W ${runState.currentWave}`
      );
      this.hudCreditsLabel?.setText(`CR ${this.formatCurrency(runState.credits)}`);
    }
    this.refreshHandSlotVisual();
    this.updateBuyButtonVisual();
  }

  private updateBuyButtonVisual(): void {
    if (!this.buyButtonBackground || !this.buyButtonLabel) {
      return;
    }

    this.syncPurchaseSelectionWithState();
    const isEnabled = this.isBuyButtonEnabled();
    const costLabel = this.purchaseTurretConfig ? this.purchaseTurretConfig.cost : 0;
    if (this.purchaseTurretConfig) {
      const baseType = this.extractBaseType(this.purchaseTurretConfig.id);
      const role = this.normalizeTurretRole(this.purchaseTurretConfig.role);
      const rareChancePercent = Math.round(this.getRareTurretChance() * 100);
      const isMobile = this.scale.width < MOBILE_BREAKPOINT_PX;
      if (this.turretInHand) {
        this.buyButtonLabel.setText("Рука занята");
      } else {
        this.buyButtonLabel.setText(
          isMobile
            ? `${this.getTypeLabel(baseType)} [${this.getRoleLabel(role)}]  -${costLabel}`
            : `Купить ${this.getTypeLabel(baseType)} [${this.getRoleLabel(role)}] (-${costLabel}) | редк. ${rareChancePercent}%`
        );
      }
    } else {
      this.buyButtonLabel.setText("Турели недоступны");
    }

    if (isEnabled) {
      this.buyButtonBackground.setFillStyle(Colors.btnPrimary, 1).setStrokeStyle(2, Colors.borderBright, 0.9);
      this.buyButtonLabel.setAlpha(1);
    } else {
      this.buyButtonBackground.setFillStyle(Colors.btnSecondary, 0.95).setStrokeStyle(2, Colors.border, 0.85);
      this.buyButtonLabel.setAlpha(0.84);
    }
  }

  private isBuyButtonEnabled(): boolean {
    if (
      !this.gameState ||
      !this.purchaseTurretConfig ||
      this.runCompleted ||
      this.isCardDraftOpen ||
      this.gameState.runState.isPaused ||
      this.turretInHand !== undefined
    ) {
      return false;
    }
    if (this.getFreeCellIndexes().length === 0) {
      return false;
    }

    return this.gameState.runState.credits >= this.purchaseTurretConfig.cost;
  }

  private initializePurchasableTurrets(): void {
    this.purchasableTurrets.length = 0;
    this.purchaseSelectionIndex = 0;
    if (!this.gameState) {
      this.purchaseTurretConfig = undefined;
      return;
    }

    const unlockedTurrets = new Set(this.gameState.metaState.unlockedTurretIds);
    const entries = this.gameState.configs.turrets
      .filter((turret) => turret.level === 1 && turret.cost > 0 && unlockedTurrets.has(turret.id))
      .sort((left, right) => {
        if (left.cost !== right.cost) {
          return left.cost - right.cost;
        }
        return left.id.localeCompare(right.id);
      });
    if (entries.length === 0) {
      entries.push(
        ...this.gameState.configs.turrets
          .filter((turret) => turret.level === 1 && turret.cost > 0)
          .sort((left, right) => {
            if (left.cost !== right.cost) {
              return left.cost - right.cost;
            }
            return left.id.localeCompare(right.id);
          })
      );
    }
    this.purchasableTurrets.push(...entries);
    this.purchaseTurretConfig = this.purchasableTurrets[0];
  }

  private syncPurchaseSelectionWithState(): void {
    if (!this.gameState || this.purchasableTurrets.length === 0) {
      this.purchaseTurretConfig = undefined;
      return;
    }

    this.purchaseSelectionIndex = Phaser.Math.Wrap(
      this.purchaseSelectionIndex,
      0,
      this.purchasableTurrets.length
    );
    const current = this.purchasableTurrets[this.purchaseSelectionIndex];
    const freeCells = this.getFreeCellIndexes().length;
    if (freeCells <= 0) {
      this.purchaseTurretConfig = current;
      return;
    }

    if (current.cost <= this.gameState.runState.credits) {
      this.purchaseTurretConfig = current;
      return;
    }

    const availableCredits = this.gameState.runState.credits;
    const affordableIndex = this.purchasableTurrets.findIndex(
      (turret) => turret.cost <= availableCredits
    );
    if (affordableIndex >= 0) {
      this.purchaseSelectionIndex = affordableIndex;
      this.purchaseTurretConfig = this.purchasableTurrets[affordableIndex];
      return;
    }

    this.purchaseTurretConfig = current;
  }

  private advancePurchaseSelection(): void {
    if (this.purchasableTurrets.length <= 1) {
      return;
    }

    this.purchaseSelectionIndex =
      (this.purchaseSelectionIndex + 1) % this.purchasableTurrets.length;
    this.purchaseTurretConfig = this.purchasableTurrets[this.purchaseSelectionIndex];
  }

  private resolvePurchaseTurretConfig(): TurretConfig | undefined {
    if (!this.gameState || !this.purchaseTurretConfig) {
      return undefined;
    }

    const defaultConfig = this.purchaseTurretConfig;
    const rareChance = this.getRareTurretChance();
    if (rareChance <= 0 || this.randomValue() >= rareChance) {
      return defaultConfig;
    }

    const rareIds = new Set(this.gameState.configs.meta.rare_turret_ids);
    const rareCandidates = this.purchasableTurrets.filter(
      (turret) => rareIds.has(turret.id) && turret.cost <= this.gameState!.runState.credits
    );
    if (rareCandidates.length === 0) {
      return defaultConfig;
    }

    const selectedRare = Phaser.Utils.Array.GetRandom(rareCandidates);
    this.showFeedback(`Редкий протокол: ${selectedRare.name}`, "#fcd34d");
    return selectedRare;
  }

  private getRareTurretChance(): number {
    if (!this.gameState) {
      return 0;
    }

    const bonus = getMetaEffectTotal(
      this.gameState.metaState,
      this.gameState.configs.meta,
      "rare_turret_chance"
    );
    return Phaser.Math.Clamp(bonus, 0, 0.95);
  }

  private showFeedback(message: string, colorHex = "#f8fafc"): void {
    if (!this.feedbackLabel) {
      return;
    }

    this.feedbackLabel.setText(message).setColor(colorHex).setAlpha(1);
    this.tweens.killTweensOf(this.feedbackLabel);
    this.tweens.add({
      targets: this.feedbackLabel,
      alpha: 0,
      duration: 650,
      delay: 550,
      ease: "Quad.easeIn"
    });
  }

  private setupTutorialIfNeeded(): void {
    if (!this.gameState) {
      return;
    }

    this.tutorialActive =
      this.runMode === "normal" &&
      this.gameState.settingsState.onboardingCompleted === false &&
      this.gameState.metaState.totalRuns <= 1;
    this.tutorialStep = this.tutorialActive ? 1 : 0;
    this.tutorialDragDetected = false;
    this.renderTutorialOverlay();
  }

  private updateTutorialProgress(): void {
    if (!this.tutorialActive || !this.gameState) {
      return;
    }

    if (this.tutorialStep === 1 && this.turretsByObject.size > 0) {
      this.tutorialStep = 2;
      this.renderTutorialOverlay();
      return;
    }

    if (this.tutorialStep === 2 && this.tutorialDragDetected) {
      this.tutorialStep = 3;
      this.renderTutorialOverlay();
      return;
    }

    if (this.tutorialStep === 3 && this.runStats.merges > 0) {
      this.completeTutorial();
    }
  }

  private renderTutorialOverlay(): void {
    this.destroyTutorialOverlay();
    if (!this.tutorialActive || this.tutorialStep <= 0) {
      return;
    }

    const width = this.scale.width;
    const isMobile = width < MOBILE_BREAKPOINT_PX;
    const overlay = this.add.container(0, 0).setDepth(150);
    const panelWidth = Math.min(width - 24, isMobile ? 360 : 520);
    const panel = this.add
      .rectangle(width / 2, 34, panelWidth, 68, Colors.bgOverlay, 0.96)
      .setStrokeStyle(2, Colors.border, 0.95);
    const steps = [
      "1/3: Купите турель и поставьте на клетку",
      "2/3: Перетащите турель по полю",
      "3/3: Слейте две одинаковые турели (merge)"
    ];
    const label = this.add
      .text(width / 2, 26, steps[this.tutorialStep - 1] ?? "", {
        fontFamily: Fonts.ui,
        fontSize: isMobile ? "14px" : "16px",
        color: "#fde68a",
        align: "center"
      })
      .setOrigin(0.5, 0.5);
    const hint = this.add
      .text(
        width / 2,
        45,
        isMobile ? "Mobile: удерживайте палец для перетаскивания" : "Desktop: ЛКМ и drag",
        {
          fontFamily: Fonts.ui,
          fontSize: isMobile ? "11px" : "12px",
          color: "#93c5fd",
          align: "center"
        }
      )
      .setOrigin(0.5, 0.5);
    const skip = this.add
      .text(width / 2 + panelWidth / 2 - 38, 16, "Пропустить", {
        fontFamily: Fonts.ui,
        fontSize: "12px",
        color: "#cbd5e1"
      })
      .setOrigin(0.5, 0.5)
      .setInteractive({ useHandCursor: true });
    skip.on("pointerdown", () => {
      this.completeTutorial();
    });

    overlay.add([panel, label, hint, skip]);
    this.tutorialOverlay = overlay;
  }

  private destroyTutorialOverlay(): void {
    if (!this.tutorialOverlay) {
      return;
    }

    this.tutorialOverlay.destroy(true);
    this.tutorialOverlay = undefined;
  }

  private completeTutorial(): void {
    if (!this.gameState) {
      return;
    }

    this.tutorialActive = false;
    this.tutorialStep = 0;
    this.gameState.settingsState.onboardingCompleted = true;
    this.markSaveDirty();
    queueGameSave(this.gameState);
    this.destroyTutorialOverlay();
    this.showFeedback("Туториал завершён", "#86efac");
  }

  private vibrate(durationMs: number): void {
    if (!this.gameState || !this.gameState.settingsState.vibrationEnabled) {
      return;
    }

    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(durationMs);
    }
  }

  private isGameplayInteractionLocked(): boolean {
    return (
      this.runCompleted ||
      this.isCardDraftOpen ||
      this.platformPaused ||
      this.gameState?.runState.isPaused === true
    );
  }

  private createDefaultRunStats(): RunStats {
    return {
      runTimeMs: 0,
      merges: 0,
      totalDamage: 0,
      waveRewardCredits: 0,
      bossRewardCredits: 0
    };
  }

  private persistMetaProgress(): void {
    if (!this.gameState) {
      return;
    }

    this.gameState.metaState.bestWave = Math.max(
      this.gameState.metaState.bestWave,
      this.highestWaveReached
    );
    this.markSaveDirty();
  }

  private createDefaultRunCardModifiers(): RunCardModifiers {
    return {
      damageMultiplier: 1,
      fireRateMultiplier: 1,
      critChanceBonus: 0,
      mergeBonusCredits: 0
    };
  }

  private resetRunCardModifiers(): void {
    this.runCardModifiers = this.createDefaultRunCardModifiers();
  }

  private initializeGeneratedCards(): void {
    if (!this.gameState) {
      this.generatedCards.length = 0;
      return;
    }

    this.generatedCards.length = 0;
    const cardsSeed = mixSeed(this.runSeed, "cards");
    const cards = generateCardsFromTemplates(this.gameState.configs.cards, cardsSeed);
    this.generatedCards.push(...cards);
  }

  private openCardDraft(completedWaveNumber: number): void {
    if (!this.gameState || this.isCardDraftOpen || this.generatedCards.length === 0) {
      return;
    }

    const choices = this.drawCardChoices(CARD_PICK_OPTION_COUNT, completedWaveNumber);
    if (choices.length === 0) {
      return;
    }

    this.offeredCards.length = 0;
    this.offeredCards.push(...choices);
    this.cardDraftWaveNumber = completedWaveNumber;
    this.isCardDraftOpen = true;
    this.gameState.runState.isPaused = true;
    this.renderCardDraftOverlay();
    this.showFeedback("Выберите карту усиления", "#fde68a");
  }

  private drawCardChoices(count: number, waveContext: number): CardConfig[] {
    if (!this.gameState) {
      return [];
    }

    if (this.generatedCards.length === 0) {
      return [];
    }

    if (this.runMode === "daily") {
      return [...this.generatedCards]
        .sort((left, right) => {
          const leftWeight = this.hashCardWeight(left.id, waveContext);
          const rightWeight = this.hashCardWeight(right.id, waveContext);
          if (leftWeight !== rightWeight) {
            return leftWeight - rightWeight;
          }
          return left.id.localeCompare(right.id);
        })
        .slice(0, Math.min(count, this.generatedCards.length));
    }

    const pool = [...this.generatedCards];
    Phaser.Utils.Array.Shuffle(pool);
    return pool.slice(0, Math.min(count, pool.length));
  }

  private hashCardWeight(cardId: string, waveContext: number): number {
    const source = `${this.dailyDateKey}:${waveContext}:${cardId}`;
    let hash = this.dailySeed || 2166136261;
    for (let i = 0; i < source.length; i += 1) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  private renderCardDraftOverlay(): void {
    this.destroyCardDraftOverlay();
    if (!this.isCardDraftOpen || this.offeredCards.length === 0) {
      return;
    }

    const width = this.scale.width;
    const height = this.scale.height;
    const isMobile = width < MOBILE_BREAKPOINT_PX;
    const overlay = this.add.container(0, 0).setDepth(CARD_DRAFT_DEPTH);

    const backdrop = UIFactory.createOverlayBackdrop(this, width, height, 0.82);

    const panelWidth = Math.min(width - 24, isMobile ? 420 : 1120);
    const cardCount = this.offeredCards.length;
    const cardGap = isMobile ? 12 : 16;
    const mobileCardHeight = Math.floor(
      (height - 36 - 138 - (cardCount - 1) * cardGap) / Math.max(1, cardCount)
    );
    const cardHeight = isMobile ? Phaser.Math.Clamp(mobileCardHeight, 92, 162) : 208;
    const panelHeight = isMobile ? 138 + cardCount * cardHeight + (cardCount - 1) * cardGap : 320;

    const panel = this.add
      .rectangle(width / 2, height / 2, panelWidth, panelHeight, Colors.bgOverlay, 0.96)
      .setStrokeStyle(2, Colors.cyanLight, 0.92);
    const accentLine = this.add
      .rectangle(width / 2, height / 2 - panelHeight / 2 + 50, panelWidth - 20, 2, Colors.amber, 0.66)
      .setOrigin(0.5);

    const titleText = this.cardDraftWaveNumber > 0 ? `Волна ${this.cardDraftWaveNumber} пройдена` : "Выбор карты";
    const title = this.add
      .text(width / 2, height / 2 - panelHeight / 2 + 24, titleText, {
        fontFamily: Fonts.game,
        fontSize: isMobile ? "19px" : "24px",
        color: "#e2e8f0",
        stroke: "#020617",
        strokeThickness: 4
      })
      .setOrigin(0.5, 0);
    const hint = this.add
      .text(width / 2, title.y + (isMobile ? 26 : 32), "Выберите 1 из 3 карт", {
        fontFamily: Fonts.mono,
        fontSize: isMobile ? "14px" : "16px",
        color: "#fcd34d"
      })
      .setOrigin(0.5, 0);

    overlay.add([backdrop, panel, accentLine, title, hint]);

    const innerWidth = panelWidth - 32;
    const cardsYBase = hint.y + (isMobile ? 36 : 50);
    const cardWidth = isMobile
      ? innerWidth
      : Math.floor((innerWidth - cardGap * (cardCount - 1)) / Math.max(1, cardCount));
    const cardContainers: Phaser.GameObjects.Container[] = [];

    this.offeredCards.forEach((card, index) => {
      const cardX = isMobile
        ? width / 2
        : width / 2 - ((cardWidth * cardCount + cardGap * (cardCount - 1)) / 2) + cardWidth / 2 + index * (cardWidth + cardGap);
      const cardY = isMobile ? cardsYBase + cardHeight / 2 + index * (cardHeight + cardGap) : cardsYBase + cardHeight / 2;
      const iconFontSize = isMobile ? (cardHeight < 120 ? "22px" : "28px") : "34px";
      const nameFontSize = isMobile ? (cardHeight < 120 ? "14px" : "16px") : "18px";
      const descriptionFontSize = isMobile ? (cardHeight < 120 ? "11px" : "13px") : "14px";
      const effectFontSize = isMobile ? (cardHeight < 120 ? "11px" : "12px") : "13px";

      const cardContainer = this.add.container(cardX, cardY);
      const cardBackground = this.add
        .rectangle(0, 0, cardWidth, cardHeight, Colors.bgCard, 0.98)
        .setStrokeStyle(2, Colors.borderLight, 0.95)
        .setInteractive({ useHandCursor: true });
      const icon = this.add
        .text(0, -cardHeight * 0.36, card.icon, {
          fontFamily: Fonts.game,
          fontSize: iconFontSize,
          color: "#f8fafc"
        })
        .setOrigin(0.5);
      const name = this.add
        .text(0, -cardHeight * 0.18, card.name, {
          fontFamily: Fonts.game,
          fontSize: nameFontSize,
          color: "#e2e8f0",
          stroke: "#0b1020",
          strokeThickness: 3
        })
        .setOrigin(0.5);
      const description = this.add
        .text(0, -cardHeight * 0.02, card.description, {
          fontFamily: Fonts.ui,
          fontSize: descriptionFontSize,
          color: "#cbd5e1",
          align: "center",
          wordWrap: { width: cardWidth - 28, useAdvancedWrap: true }
        })
        .setOrigin(0.5, 0);
      const effect = this.add
        .text(0, cardHeight * 0.3, this.buildCardEffectSummary(card), {
          fontFamily: Fonts.ui,
          fontSize: effectFontSize,
          color: "#fde68a",
          align: "center",
          wordWrap: { width: cardWidth - 28, useAdvancedWrap: true }
        })
        .setOrigin(0.5, 0.5);

      cardBackground.on("pointerover", () => {
        cardBackground
          .setFillStyle(Colors.btnSecondary, 1)
          .setStrokeStyle(2, Colors.cyanLight, 1);
        cardContainer.setScale(1.02);
      });
      cardBackground.on("pointerout", () => {
        cardBackground
          .setFillStyle(Colors.bgCard, 0.98)
          .setStrokeStyle(2, Colors.borderLight, 0.95);
        cardContainer.setScale(1);
      });
      cardBackground.on("pointerdown", () => {
        this.pickCard(card);
      });

      cardContainer.add([cardBackground, icon, name, description, effect]);
      overlay.add(cardContainer);
      cardContainers.push(cardContainer);
    });

    AnimationHelper.cardAppear(this, cardContainers, height + 90);

    this.cardDraftOverlay = overlay;
  }

  private destroyCardDraftOverlay(): void {
    if (!this.cardDraftOverlay) {
      return;
    }

    this.cardDraftOverlay.destroy(true);
    this.cardDraftOverlay = undefined;
  }

  private buildCardEffectSummary(card: CardConfig): string {
    const effects: string[] = [];
    if (card.damage_multiplier !== undefined && Math.abs(card.damage_multiplier - 1) > Number.EPSILON) {
      effects.push(`Урон x${this.formatMultiplier(card.damage_multiplier)}`);
    }
    if (card.fire_rate_multiplier !== undefined && Math.abs(card.fire_rate_multiplier - 1) > Number.EPSILON) {
      effects.push(`Скорость x${this.formatMultiplier(card.fire_rate_multiplier)}`);
    }
    if (card.crit_chance_bonus !== undefined && card.crit_chance_bonus > 0) {
      effects.push(`Крит +${Math.round(card.crit_chance_bonus * 100)}%`);
    }
    if (card.merge_bonus_credits !== undefined && card.merge_bonus_credits > 0) {
      effects.push(`Merge +${card.merge_bonus_credits}`);
    }

    return effects.length > 0 ? effects.join(" | ") : "Без эффекта";
  }

  private pickCard(card: CardConfig): void {
    if (!this.gameState || !this.isCardDraftOpen) {
      return;
    }

    this.applyCardEffects(card);
    this.selectedCardIds.push(card.id);
    this.isCardDraftOpen = false;
    this.offeredCards.length = 0;
    this.cardDraftWaveNumber = 0;
    this.destroyCardDraftOverlay();
    if (!this.runCompleted) {
      this.gameState.runState.isPaused = false;
    }

    this.showFeedback(`Выбрана карта: ${card.name}`, "#fde68a");
    this.refreshHudAndControls();
  }

  private applyCardEffects(card: CardConfig): void {
    const damageMultiplier = card.damage_multiplier ?? 1;
    const fireRateMultiplier = card.fire_rate_multiplier ?? 1;
    const critChanceBonus = card.crit_chance_bonus ?? 0;
    const mergeBonusCredits = card.merge_bonus_credits ?? 0;

    this.runCardModifiers.damageMultiplier *= damageMultiplier;
    this.runCardModifiers.fireRateMultiplier *= fireRateMultiplier;
    this.runCardModifiers.critChanceBonus = Phaser.Math.Clamp(
      this.runCardModifiers.critChanceBonus + critChanceBonus,
      0,
      1
    );
    this.runCardModifiers.mergeBonusCredits += mergeBonusCredits;
  }

  private rollShotDamage(baseDamage: number): { damage: number; isCritical: boolean } {
    const adjustedDamage = Math.max(0.1, baseDamage * this.runCardModifiers.damageMultiplier);
    const critChance = Phaser.Math.Clamp(this.runCardModifiers.critChanceBonus, 0, 1);
    const isCritical = critChance > 0 && this.randomValue() < critChance;
    const critDamageMultiplier = isCritical ? CRIT_DAMAGE_MULTIPLIER : 1;
    return {
      damage: adjustedDamage * critDamageMultiplier,
      isCritical
    };
  }

  private formatMultiplier(value: number): string {
    return value.toFixed(2).replace(/\.?0+$/, "");
  }

  private formatDuration(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, "0");
    const seconds = (totalSeconds % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  private formatDamage(value: number): string {
    return Math.round(Math.max(0, value)).toLocaleString("ru-RU");
  }

  private formatCurrency(value: number): string {
    return Math.round(Math.max(0, value)).toLocaleString("ru-RU");
  }

  private grantRunCredits(baseAmount: number): number {
    if (!this.gameState || baseAmount <= 0) {
      return 0;
    }

    const granted = Math.max(1, Math.round(baseAmount * this.runCreditMetaMultiplier));
    this.gameState.runState.credits += granted;
    this.gameState.metaState.totalCreditsEarned += granted;
    applyDailyProgress(this.gameState.metaState, this.gameState.configs.meta, "credits_earn", granted);
    this.markSaveDirty();
    return granted;
  }

  private markSaveDirty(): void {
    this.saveDirty = true;
  }

  private randomValue(): number {
    return Math.random();
  }

  private resolveRunSeed(): number {
    if (this.runMode === "daily") {
      return this.dailySeed >>> 0;
    }
    const nowSeed = Date.now() >>> 0;
    const randomSalt = Math.floor(Math.random() * 0xffffffff) >>> 0;
    return mixSeed(nowSeed, randomSalt);
  }

  private initializeTurretCatalog(): void {
    if (!this.gameState) {
      return;
    }

    for (const config of this.gameState.configs.turrets) {
      const baseType = this.extractBaseType(config.id);
      if (!this.turretCatalog.has(baseType)) {
        this.turretCatalog.set(baseType, new Map<number, TurretConfig>());
      }
      this.turretCatalog.get(baseType)?.set(config.level, config);

      if (config.level === 1 && !this.typeDisplayNames.has(baseType)) {
        this.typeDisplayNames.set(baseType, this.shrinkTypeName(config.name));
      }
    }
  }

  private initializeEnemyCatalog(): void {
    if (!this.gameState) {
      return;
    }

    for (const config of this.gameState.configs.enemies) {
      this.enemyCatalog.set(config.id, config);
    }
  }

  private initializeMapData(): void {
    if (!this.gameState) {
      return;
    }

    this.mapDataResolved = false;
    this.resolvedMapPath.length = 0;
    this.resolvedMapObstacles.length = 0;
    const wavesConfig = this.gameState.configs.waves;
    const mapConfig = wavesConfig.procedural_map;

    if (mapConfig?.enabled) {
      const mapSeed = mixSeed(this.runSeed, `map:${mapConfig.seed_offset ?? 0}`);
      const generatedMap = generateProceduralMap({
        cols: wavesConfig.grid.cols,
        rows: wavesConfig.grid.rows,
        seed: mapSeed,
        obstacleDensity: mapConfig.obstacle_density,
        maxAttempts: mapConfig.max_attempts,
        start: mapConfig.start,
        end: mapConfig.end
      });
      this.resolvedMapPath.push(...generatedMap.path);
      this.resolvedMapObstacles.push(...generatedMap.obstacles);
      this.mapDataResolved = true;
      if (generatedMap.usedFallback) {
        this.showFeedback("Procedural карта: fallback path", "#fde68a");
      }
      return;
    }

    this.resolvedMapPath.push(...wavesConfig.path.map((cell) => ({ ...cell })));
    if (wavesConfig.obstacles) {
      this.resolvedMapObstacles.push(...wavesConfig.obstacles.map((cell) => ({ ...cell })));
    }
    this.mapDataResolved = true;
  }

  private initializePathData(): void {
    if (!this.gameState) {
      return;
    }

    this.pathCells.length = 0;
    this.pathSegmentLengths.length = 0;
    this.blockedPathCells.clear();
    this.blockedObstacleCells.clear();

    const pathSource = this.mapDataResolved ? this.resolvedMapPath : this.gameState.configs.waves.path;
    for (const node of pathSource) {
      this.pathCells.push(new Phaser.Math.Vector2(node.col, node.row));
      this.blockedPathCells.add(node.row * this.gridSpec.cols + node.col);
    }
    const obstacleSource = this.mapDataResolved
      ? this.resolvedMapObstacles
      : this.gameState.configs.waves.obstacles ?? [];
    for (const obstacle of obstacleSource) {
      const cellIndex = obstacle.row * this.gridSpec.cols + obstacle.col;
      if (!this.blockedPathCells.has(cellIndex)) {
        this.blockedObstacleCells.add(cellIndex);
      }
    }

    this.pathLengthCells = 0;
    for (let index = 0; index < this.pathCells.length - 1; index += 1) {
      const start = this.pathCells[index];
      const end = this.pathCells[index + 1];
      const length = Phaser.Math.Distance.Between(start.x, start.y, end.x, end.y);
      this.pathSegmentLengths.push(length);
      this.pathLengthCells += length;
    }
  }

  private initializeWaveGenerator(): void {
    if (!this.gameState) {
      return;
    }

    this.waveEntriesByWave.clear();
    const waveSeed = mixSeed(this.runSeed, "waves");
    const generatedEntries = generateWaveEntries(
      this.gameState.configs.waves,
      this.gameState.configs.enemies,
      waveSeed
    );
    const orderedEntries = [...generatedEntries].sort((a, b) => {
      if (a.wave !== b.wave) {
        return a.wave - b.wave;
      }
      return a.enemy_id.localeCompare(b.enemy_id);
    });
    for (const entry of orderedEntries) {
      if (!this.waveEntriesByWave.has(entry.wave)) {
        this.waveEntriesByWave.set(entry.wave, []);
      }
      this.waveEntriesByWave.get(entry.wave)?.push(entry);
    }

    this.orderedWaveNumbers = Array.from(this.waveEntriesByWave.keys()).sort((a, b) => a - b);
    this.activeWaveIndex = 0;
    this.activeWaveEntryIndex = 0;
    this.spawnedInActiveEntry = 0;
    this.interWaveDelaySec = 0;
    this.spawnCooldownSec = START_WAVE_DELAY_SEC;

    this.gameState.runState.currentWave = this.orderedWaveNumbers[0] ?? 0;
    this.highestWaveReached = Math.max(this.highestWaveReached, this.gameState.runState.currentWave);
  }

  private updateWaveSpawner(deltaSec: number): void {
    if (!this.gameState || this.isAllWavesSpawned()) {
      return;
    }

    if (this.interWaveDelaySec > 0) {
      this.interWaveDelaySec = Math.max(0, this.interWaveDelaySec - deltaSec);
      if (this.interWaveDelaySec > 0) {
        return;
      }
    }

    this.spawnCooldownSec -= deltaSec;

    while (this.spawnCooldownSec <= 0 && !this.isAllWavesSpawned()) {
      const entries = this.getActiveWaveEntries();
      if (!entries || entries.length === 0) {
        this.activeWaveIndex += 1;
        this.activeWaveEntryIndex = 0;
        this.spawnedInActiveEntry = 0;
        continue;
      }

      if (this.activeWaveEntryIndex >= entries.length) {
        if (this.enemiesById.size === 0) {
          this.advanceToNextWave();
          if (this.interWaveDelaySec > 0) {
            return;
          }
          continue;
        }
        this.spawnCooldownSec = 0;
        return;
      }

      const entry = entries[this.activeWaveEntryIndex];
      this.spawnEnemy(entry.enemy_id);
      this.spawnedInActiveEntry += 1;

      if (this.spawnedInActiveEntry >= entry.count) {
        this.activeWaveEntryIndex += 1;
        this.spawnedInActiveEntry = 0;
      } else {
        this.spawnCooldownSec += entry.spawn_interval_sec;
      }
    }
  }

  private advanceToNextWave(): void {
    if (!this.gameState) {
      return;
    }

    const completedWaveOrdinal = this.activeWaveIndex + 1;
    const completedWaveNumber = this.orderedWaveNumbers[this.activeWaveIndex] ?? 0;
    this.highestWaveReached = Math.max(this.highestWaveReached, completedWaveNumber);
    applyDailyProgress(this.gameState.metaState, this.gameState.configs.meta, "wave_clear_count", 1);
    this.markSaveDirty();
    this.grantWaveCompletionRewards(completedWaveNumber);
    this.activeWaveIndex += 1;
    this.activeWaveEntryIndex = 0;
    this.spawnedInActiveEntry = 0;
    this.spawnCooldownSec = 0;

    if (this.isAllWavesSpawned()) {
      this.refreshHudAndControls();
      return;
    }

    this.interWaveDelaySec = INTER_WAVE_DELAY_SEC;
    const nextWaveNumber = this.orderedWaveNumbers[this.activeWaveIndex];
    if (nextWaveNumber === undefined) {
      return;
    }
    this.gameState.runState.currentWave = nextWaveNumber;
    this.highestWaveReached = Math.max(this.highestWaveReached, nextWaveNumber);
    this.showFeedback(`Волна ${nextWaveNumber}`, "#bfdbfe");

    const shouldOfferCard = completedWaveOrdinal % CARD_PICK_INTERVAL_WAVES === 0;
    if (shouldOfferCard) {
      this.openCardDraft(completedWaveNumber);
    }

    this.refreshHudAndControls();
  }

  private grantWaveCompletionRewards(waveNumber: number): void {
    if (!this.gameState || waveNumber <= 0) {
      return;
    }

    const entries = this.waveEntriesByWave.get(waveNumber) ?? [];
    const totalEnemiesInWave = entries.reduce((sum, entry) => sum + entry.count, 0);
    const waveCredits =
      WAVE_CLEAR_REWARD_BASE +
      waveNumber * WAVE_CLEAR_REWARD_PER_WAVE +
      totalEnemiesInWave * WAVE_CLEAR_REWARD_PER_ENEMY;
    const hasBoss = this.isBossWave(entries);
    const bossCredits = hasBoss
      ? BOSS_CLEAR_REWARD_BASE + waveNumber * BOSS_CLEAR_REWARD_PER_WAVE
      : 0;
    const grantedWaveCredits = this.grantRunCredits(waveCredits);
    const grantedBossCredits = this.grantRunCredits(bossCredits);
    const totalCredits = Math.max(0, grantedWaveCredits + grantedBossCredits);

    if (totalCredits <= 0) {
      return;
    }

    this.runStats.waveRewardCredits += grantedWaveCredits;
    this.runStats.bossRewardCredits += grantedBossCredits;

    const enemyDetails = this.buildWaveRewardDetail(entries);
    this.waveRewardLog.push({
      waveNumber,
      waveCredits: grantedWaveCredits,
      bossCredits: grantedBossCredits,
      totalCredits,
      detail: enemyDetails
    });
    if (this.waveRewardLog.length > 6) {
      this.waveRewardLog.shift();
    }

    const rewardMessage = hasBoss
      ? `Награда волны ${waveNumber}: +${totalCredits} кр (волна ${grantedWaveCredits} + босс ${grantedBossCredits})`
      : `Награда волны ${waveNumber}: +${grantedWaveCredits} кр`;
    this.showFeedback(rewardMessage, hasBoss ? "#fcd34d" : "#86efac");
  }

  private isBossWave(entries: WaveEntryConfig[]): boolean {
    return entries.some((entry) => {
      const enemy = this.enemyCatalog.get(entry.enemy_id);
      if (!enemy) {
        return false;
      }
      return enemy.tags.includes("boss") || enemy.tags.includes("tank");
    });
  }

  private buildWaveRewardDetail(entries: WaveEntryConfig[]): string {
    if (entries.length === 0) {
      return "Нет данных по врагам";
    }

    return entries
      .map((entry) => {
        const enemyName = this.enemyCatalog.get(entry.enemy_id)?.name ?? entry.enemy_id;
        return `${enemyName} x${entry.count}`;
      })
      .join(", ");
  }

  private getActiveWaveEntries(): WaveEntryConfig[] | undefined {
    if (this.isAllWavesSpawned()) {
      return undefined;
    }

    const waveNumber = this.orderedWaveNumbers[this.activeWaveIndex];
    return this.waveEntriesByWave.get(waveNumber);
  }

  private isAllWavesSpawned(): boolean {
    return this.activeWaveIndex >= this.orderedWaveNumbers.length;
  }

  private spawnEnemy(enemyId: string): void {
    const config = this.enemyCatalog.get(enemyId);
    if (!config || this.pathCells.length < 2) {
      return;
    }

    const color = this.resolveEnemyColor(config);
    const bodySize = Math.max(18, Math.floor(this.cellSize * ENEMY_SIZE_FACTOR));
    const hpBarWidth = Math.max(22, Math.floor(this.cellSize * ENEMY_HP_BAR_WIDTH_FACTOR));

    // Resolve enemy tag for texture
    const enemyTag = config.tags.includes("tank")
      ? "tank"
      : config.tags.includes("fast")
        ? "fast"
        : "basic";
    const sheetKey = ENEMY_SHEET_BY_TAG[enemyTag];
    const texKey = this.textures.exists(sheetKey) ? sheetKey : enemyKey(enemyTag);

    let body: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
    const enemyAnimKey = ENEMY_ANIM_BY_TAG[enemyTag];
    if (this.textures.exists(texKey)) {
      if (this.anims.exists(enemyAnimKey)) {
        const sprite = this.add.sprite(0, 0, texKey, 0).setDisplaySize(bodySize, bodySize);
        sprite.play(enemyAnimKey);
        body = sprite;
      } else {
        body = this.add.image(0, 0, texKey).setDisplaySize(bodySize, bodySize);
      }
    } else {
      body = this.add
        .rectangle(0, 0, bodySize, bodySize, color, 1)
        .setStrokeStyle(2, 0x0f172a, 0.7);
    }

    const hpBg = this.add
      .rectangle(0, -Math.floor(bodySize * 0.62), hpBarWidth, ENEMY_HP_BAR_HEIGHT, Colors.bgCard, 0.92)
      .setStrokeStyle(1, Colors.border, 0.8);
    const hpFill = this.add.rectangle(
      hpBg.x,
      hpBg.y,
      hpBarWidth,
      ENEMY_HP_BAR_HEIGHT - 2,
      Colors.green,
      0.95
    );

    const container = this.add.container(0, 0, [body, hpBg, hpFill]).setDepth(22);
    const startCell = this.pathCells[0];

    const enemy: EnemyView = {
      id: this.enemyIdCounter,
      config,
      baseColor: color,
      hp: config.hp,
      maxHp: config.hp,
      speedMultiplier: 1,
      slowRemainingSec: 0,
      pathProgressCells: 0,
      gridX: startCell.x,
      gridY: startCell.y,
      hpBarWidth,
      container,
      body,
      hpBg,
      hpFill
    };

    this.enemyIdCounter += 1;
    this.enemiesById.set(enemy.id, enemy);
    this.refreshEnemyVisual(enemy);
    this.placeEnemyByPathProgress(enemy);
  }

  private refreshEnemyVisual(enemy: EnemyView): void {
    const bodySize = Math.max(18, Math.floor(this.cellSize * ENEMY_SIZE_FACTOR));
    const hpBarWidth = Math.max(22, Math.floor(this.cellSize * ENEMY_HP_BAR_WIDTH_FACTOR));
    const hpY = -Math.floor(bodySize * 0.62);

    enemy.hpBarWidth = hpBarWidth;
    enemy.body.setDisplaySize(bodySize, bodySize);
    if (enemy.body instanceof Phaser.GameObjects.Rectangle) {
      this.applyEnemySpeedVisual(enemy);
    } else {
      // For Image bodies, use tint for slow effect
      this.applyEnemySpeedVisualImage(enemy);
    }
    enemy.hpBg.setDisplaySize(hpBarWidth, ENEMY_HP_BAR_HEIGHT).setPosition(0, hpY);
    enemy.hpFill
      .setDisplaySize(hpBarWidth, Math.max(2, ENEMY_HP_BAR_HEIGHT - 2))
      .setPosition(enemy.hpBg.x - hpBarWidth / 2, hpY)
      .setOrigin(0, 0.5);
    this.updateEnemyHpBar(enemy);
  }

  private repositionAllEnemies(): void {
    for (const enemy of this.enemiesById.values()) {
      this.refreshEnemyVisual(enemy);
      this.placeEnemyByPathProgress(enemy);
    }
  }

  private updateEnemies(deltaSec: number): void {
    if (this.enemiesById.size === 0 || this.pathLengthCells <= 0) {
      return;
    }

    const leakedEnemyIds: number[] = [];

    for (const enemy of this.enemiesById.values()) {
      this.updateEnemySlowState(enemy, deltaSec);
      const currentSpeed = enemy.config.speed * enemy.speedMultiplier;
      enemy.pathProgressCells += currentSpeed * deltaSec;
      if (enemy.pathProgressCells >= this.pathLengthCells) {
        leakedEnemyIds.push(enemy.id);
        continue;
      }

      this.placeEnemyByPathProgress(enemy);
    }

    if (leakedEnemyIds.length > 0) {
      for (const enemyId of leakedEnemyIds) {
        this.handleEnemyLeak(enemyId);
      }
      this.refreshHudAndControls();
    }
  }

  private updateEnemySlowState(enemy: EnemyView, deltaSec: number): void {
    if (enemy.slowRemainingSec <= 0) {
      return;
    }

    enemy.slowRemainingSec = Math.max(0, enemy.slowRemainingSec - deltaSec);
    if (enemy.slowRemainingSec === 0) {
      enemy.speedMultiplier = 1;
      if (enemy.body instanceof Phaser.GameObjects.Rectangle) {
        this.applyEnemySpeedVisual(enemy);
      } else {
        this.applyEnemySpeedVisualImage(enemy);
      }
    }
  }

  private applySlowToEnemy(enemy: EnemyView, slowPercent: number, durationSec: number): void {
    if (!this.enemiesById.has(enemy.id)) {
      return;
    }

    const nextMultiplier = Phaser.Math.Clamp(1 - slowPercent / 100, 0, 1);
    enemy.speedMultiplier = Math.min(enemy.speedMultiplier, nextMultiplier);
    enemy.slowRemainingSec = Math.max(enemy.slowRemainingSec, durationSec);
    if (enemy.body instanceof Phaser.GameObjects.Rectangle) {
      this.applyEnemySpeedVisual(enemy);
    } else {
      this.applyEnemySpeedVisualImage(enemy);
    }
    this.playSlowPulse(enemy);
  }

  private applyEnemySpeedVisual(enemy: EnemyView): void {
    if (!(enemy.body instanceof Phaser.GameObjects.Rectangle)) {
      return;
    }
    const isSlowed = enemy.slowRemainingSec > 0 && enemy.speedMultiplier < 1;
    if (isSlowed) {
      const base = Phaser.Display.Color.IntegerToColor(enemy.baseColor);
      const slowTint = Phaser.Display.Color.IntegerToColor(0x60a5fa);
      const blend = Phaser.Display.Color.Interpolate.ColorWithColor(base, slowTint, 100, 32);
      const blendedColor = Phaser.Display.Color.GetColor(blend.r, blend.g, blend.b);
      enemy.body.setFillStyle(blendedColor, 1).setStrokeStyle(2, 0x7dd3fc, 0.95);
      return;
    }

    enemy.body.setFillStyle(enemy.baseColor, 1).setStrokeStyle(2, 0x0f172a, 0.7);
  }

  private applyEnemySpeedVisualImage(enemy: EnemyView): void {
    if (
      !(enemy.body instanceof Phaser.GameObjects.Image) &&
      !(enemy.body instanceof Phaser.GameObjects.Sprite)
    ) {
      return;
    }
    const isSlowed = enemy.slowRemainingSec > 0 && enemy.speedMultiplier < 1;
    if (isSlowed) {
      enemy.body.setTint(0x60a5fa);
    } else {
      enemy.body.clearTint();
    }
  }

  private playImpactEffect(x: number, y: number, color: number): void {
    if (this.textures.exists(IMPACT_SPRITE_KEY) && this.anims.exists(IMPACT_ANIM_KEY)) {
      const fxSize = Math.max(14, Math.floor(this.cellSize * 0.42));
      const fx = this.add.sprite(x, y, IMPACT_SPRITE_KEY, 0).setDepth(36).setDisplaySize(fxSize, fxSize).setAlpha(0.9);
      fx.setTint(color);
      fx.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => fx.destroy());
      fx.play(IMPACT_ANIM_KEY);
      return;
    }

    AnimationHelper.impactRing(this, x, y, color, this.cellSize);
  }

  private playExplosionEffect(x: number, y: number, color: number): void {
    if (this.textures.exists(EXPLOSION_SPRITE_KEY) && this.anims.exists(EXPLOSION_ANIM_KEY)) {
      const fxSize = Math.max(18, Math.floor(this.cellSize * 0.55));
      const fx = this.add.sprite(x, y, EXPLOSION_SPRITE_KEY, 0).setDepth(37).setDisplaySize(fxSize, fxSize).setAlpha(0.85);
      fx.setTint(color);
      fx.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => fx.destroy());
      fx.play(EXPLOSION_ANIM_KEY);
      return;
    }

    AnimationHelper.enemyDeath(this, x, y, color, this.cellSize);
  }

  private ensureSpriteAnimations(): void {
    this.ensureLoopAnimation("anim_turret_single", "asset_turret_single_sheet", 7, 8);
    this.ensureLoopAnimation("anim_turret_splash", "asset_turret_splash_sheet", 7, 10);
    this.ensureLoopAnimation("anim_turret_slow", "asset_turret_slow_sheet", 7, 9);
    this.ensureLoopAnimation("anim_enemy_basic", "asset_enemy_basic_sheet", 7, 10);
    this.ensureLoopAnimation("anim_enemy_fast", "asset_enemy_fast_sheet", 7, 12);
    this.ensureLoopAnimation("anim_enemy_tank", "asset_enemy_tank_sheet", 7, 8);
    this.ensureLoopAnimation(IMPACT_ANIM_KEY, IMPACT_SPRITE_KEY, 7, 24);
    this.ensureLoopAnimation(EXPLOSION_ANIM_KEY, EXPLOSION_SPRITE_KEY, 7, 20);
  }

  private ensureLoopAnimation(animKey: string, textureKey: string, endFrame: number, frameRate: number): void {
    if (!this.textures.exists(textureKey) || this.anims.exists(animKey)) {
      return;
    }

    this.anims.create({
      key: animKey,
      frames: this.anims.generateFrameNumbers(textureKey, { start: 0, end: endFrame }),
      frameRate,
      repeat: -1
    });
  }

  private placeEnemyByPathProgress(enemy: EnemyView): void {
    const cellPosition = this.samplePathCellPosition(enemy.pathProgressCells);
    enemy.gridX = cellPosition.x;
    enemy.gridY = cellPosition.y;
    const world = this.gridToWorld(cellPosition.x, cellPosition.y);
    enemy.container.setPosition(world.x, world.y);
  }

  private samplePathCellPosition(progressCells: number): { x: number; y: number } {
    if (this.pathCells.length === 0) {
      return { x: 0, y: 0 };
    }
    if (progressCells <= 0) {
      return { x: this.pathCells[0].x, y: this.pathCells[0].y };
    }

    let remaining = progressCells;
    for (let index = 0; index < this.pathSegmentLengths.length; index += 1) {
      const segmentLength = this.pathSegmentLengths[index];
      if (remaining <= segmentLength) {
        const start = this.pathCells[index];
        const end = this.pathCells[index + 1];
        const t = segmentLength <= 0 ? 0 : remaining / segmentLength;

        return {
          x: Phaser.Math.Linear(start.x, end.x, t),
          y: Phaser.Math.Linear(start.y, end.y, t)
        };
      }

      remaining -= segmentLength;
    }

    const lastPoint = this.pathCells[this.pathCells.length - 1];
    return { x: lastPoint.x, y: lastPoint.y };
  }

  private handleEnemyLeak(enemyId: number): void {
    if (!this.gameState) {
      return;
    }

    const enemy = this.enemiesById.get(enemyId);
    if (!enemy) {
      return;
    }

    this.destroyEnemy(enemy.id);
    const leakDamage = this.gameState.configs.waves.leak_damage;
    this.gameState.runState.baseHp = Math.max(0, this.gameState.runState.baseHp - leakDamage);
    this.showFeedback(`Прорыв: -${leakDamage} жизней`, "#fda4af");

    if (this.gameState.runState.baseHp <= 0) {
      this.finishRun(false);
    }
  }

  private destroyEnemy(enemyId: number): void {
    const enemy = this.enemiesById.get(enemyId);
    if (!enemy) {
      return;
    }

    this.playExplosionEffect(enemy.container.x, enemy.container.y, enemy.baseColor);
    this.enemiesById.delete(enemyId);
    enemy.container.destroy();
  }

  private updateTurretCombat(deltaSec: number): void {
    if (!this.gameState || this.enemiesById.size === 0) {
      return;
    }

    let creditsChanged = false;

    for (const turret of this.turretsByObject.values()) {
      turret.attackCooldownSec = Math.max(0, turret.attackCooldownSec - deltaSec);
      if (turret.attackCooldownSec > 0) {
        continue;
      }

      const target = this.findTargetForTurret(turret);
      if (!target) {
        continue;
      }

      const kills = this.fireTurret(turret, target);
      if (kills > 0) {
        creditsChanged = true;
      }

      const adjustedFireRate = Math.max(
        0.1,
        turret.config.fire_rate * this.runCardModifiers.fireRateMultiplier
      );
      turret.attackCooldownSec = 1 / adjustedFireRate;
      this.tweens.add({
        targets: turret.body,
        alpha: 0.65,
        duration: 50,
        yoyo: true,
        ease: "Sine.easeOut"
      });
    }

    if (creditsChanged) {
      this.refreshHudAndControls();
    }
  }

  private findTargetForTurret(turret: TurretView): EnemyView | undefined {
    const turretCol = turret.cellIndex % this.gridSpec.cols;
    const turretRow = Math.floor(turret.cellIndex / this.gridSpec.cols);

    let selected: EnemyView | undefined;
    let shortestDistance = Number.POSITIVE_INFINITY;
    for (const enemy of this.enemiesById.values()) {
      const distance = Phaser.Math.Distance.Between(turretCol, turretRow, enemy.gridX, enemy.gridY);
      if (distance > turret.config.range) {
        continue;
      }

      const isCloser = distance < shortestDistance - 0.0001;
      const isSameDistanceAsSelected =
        Math.abs(distance - shortestDistance) <= 0.0001 && selected !== undefined;
      const isFurtherOnPath = isSameDistanceAsSelected
        ? selected !== undefined && enemy.pathProgressCells > selected.pathProgressCells
        : false;

      if (!selected || isCloser || isFurtherOnPath) {
        selected = enemy;
        shortestDistance = distance;
      }
    }

    return selected;
  }

  private fireTurret(turret: TurretView, target: EnemyView): number {
    const role = this.normalizeTurretRole(turret.config.role);
    const shotColor = this.getShotColorForRole(role);
    const origin = this.cellCenter(turret.cellIndex);
    const impactPoint = { x: target.container.x, y: target.container.y };
    AnimationHelper.shotTrail(this, origin, impactPoint, shotColor, this.cellSize);
    AnimationHelper.muzzleFlash(this, origin.x, origin.y, shotColor, this.cellSize);

    const splashRadius = turret.config.splash_radius;
    if (role === "splash" && splashRadius !== undefined) {
      let kills = 0;
      const victims = Array.from(this.enemiesById.values()).filter((enemy) => {
        const distance = Phaser.Math.Distance.Between(
          target.gridX,
          target.gridY,
          enemy.gridX,
          enemy.gridY
        );
        return distance <= splashRadius;
      });

      this.playSplashPulse(impactPoint.x, impactPoint.y, splashRadius);
      for (const enemy of victims) {
        kills += this.applyDamage(enemy, turret.config.damage, shotColor);
      }
      return kills;
    }

    const kills = this.applyDamage(target, turret.config.damage, shotColor);
    if (
      role === "slow" &&
      turret.config.slow_percent !== undefined &&
      turret.config.slow_duration_sec !== undefined &&
      this.enemiesById.has(target.id)
    ) {
      this.applySlowToEnemy(target, turret.config.slow_percent, turret.config.slow_duration_sec);
    }
    return kills;
  }

  private applyDamage(enemy: EnemyView, damage: number, hitColor: number): number {
    if (!this.gameState || !this.enemiesById.has(enemy.id)) {
      return 0;
    }

    this.playImpactEffect(enemy.container.x, enemy.container.y, hitColor);
    const damageProfile = this.rollShotDamage(damage);
    if (damageProfile.isCritical) {
      this.playImpactEffect(enemy.container.x, enemy.container.y, Colors.amber);
    }

    const appliedDamage = Math.min(enemy.hp, damageProfile.damage);
    enemy.hp = Math.max(0, enemy.hp - damageProfile.damage);
    this.runStats.totalDamage += appliedDamage;
    this.updateEnemyHpBar(enemy);

    if (enemy.hp > 0) {
      return 0;
    }

    this.playImpactEffect(enemy.container.x, enemy.container.y, Colors.white);
    this.grantRunCredits(enemy.config.reward);
    applyDailyProgress(this.gameState.metaState, this.gameState.configs.meta, "enemy_kill_count", 1);
    this.markSaveDirty();
    this.destroyEnemy(enemy.id);
    return 1;
  }

  private updateEnemyHpBar(enemy: EnemyView): void {
    const ratio = Phaser.Math.Clamp(enemy.hp / enemy.maxHp, 0, 1);
    const width = Math.max(1, enemy.hpBarWidth * ratio);

    enemy.hpFill.setDisplaySize(width, enemy.hpFill.height);
    enemy.hpFill.setPosition(enemy.hpBg.x - enemy.hpBarWidth / 2, enemy.hpBg.y);

    if (ratio > 0.6) {
      enemy.hpFill.setFillStyle(Colors.green, 0.95);
    } else if (ratio > 0.3) {
      enemy.hpFill.setFillStyle(Colors.amber, 0.95);
    } else {
      enemy.hpFill.setFillStyle(Colors.red, 0.95);
    }
  }

  private finishRun(victory: boolean): void {
    if (!this.gameState || this.runCompleted) {
      return;
    }

    this.destroyCardDraftOverlay();
    this.isCardDraftOpen = false;
    this.offeredCards.length = 0;
    this.cardDraftWaveNumber = 0;
    this.setTurretInHand(undefined);
    this.resetRunCardModifiers();
    this.selectedCardIds.length = 0;
    this.runCompleted = true;
    this.runOutcome = victory ? "win" : "lose";
    this.highestWaveReached = Math.max(this.highestWaveReached, this.gameState.runState.currentWave);
    this.gameState.runState.isPaused = true;
    if (this.runMode === "daily") {
      const waveForScore = Math.max(this.highestWaveReached, this.gameState.runState.currentWave);
      this.dailyScore = computeDailyScore({
        wave: waveForScore,
        runTimeMs: this.runStats.runTimeMs,
        merges: this.runStats.merges,
        totalDamage: this.runStats.totalDamage
      });
      void this.submitDailyScoreIfNeeded();
    }

    if (victory) {
      this.showFeedback("Все волны отражены", "#86efac");
    } else {
      this.showFeedback("Энергия ядра исчерпана", "#fca5a5");
    }

    this.renderEndRunOverlay();
    this.persistMetaProgress();
    this.refreshHudAndControls();
  }

  private renderEndRunOverlay(): void {
    this.destroyEndRunOverlay();
    if (!this.runCompleted || !this.gameState || !this.runOutcome) {
      return;
    }

    const width = this.scale.width;
    const height = this.scale.height;
    const isMobile = width < MOBILE_BREAKPOINT_PX;
    const overlay = this.add.container(0, 0).setDepth(END_RUN_OVERLAY_DEPTH);
    const panelWidth = Math.min(width - 24, isMobile ? 430 : 660);
    const panelHeight = isMobile ? 530 : 430;
    const panelTop = height / 2 - panelHeight / 2;
    const panelBottom = panelTop + panelHeight;
    const isDaily = this.runMode === "daily";
    const reachedWave = Math.max(this.highestWaveReached, this.gameState.runState.currentWave);
    const maxWave = this.orderedWaveNumbers[this.orderedWaveNumbers.length - 1] ?? reachedWave;
    const totalBonusCredits = this.runStats.waveRewardCredits + this.runStats.bossRewardCredits;

    const backdrop = UIFactory.createOverlayBackdrop(this, width, height, 0.82);
    const panel = this.add
      .rectangle(width / 2, height / 2, panelWidth, panelHeight, Colors.bgOverlay, 0.96)
      .setStrokeStyle(2, Colors.cyanLight, 0.92);
    const accentLine = this.add
      .rectangle(width / 2, panelTop + 58, panelWidth - 24, 2, Colors.amber, 0.72)
      .setOrigin(0.5);
    const title = this.add
      .text(
        width / 2,
        panelTop + 24,
        this.runOutcome === "win" ? "Победа" : "Поражение",
        {
          fontFamily: Fonts.game,
          fontSize: isMobile ? "30px" : "38px",
          color: this.runOutcome === "win" ? "#86efac" : "#fca5a5"
        }
      )
      .setOrigin(0.5, 0);
    const summary = this.add
      .text(
        width / 2,
        title.y + 58,
        [
          `Волна: ${reachedWave}${maxWave > 0 ? ` / ${maxWave}` : ""}`,
          `Время: ${this.formatDuration(this.runStats.runTimeMs)}`,
          `Merges: ${this.runStats.merges}`,
          `Урон: ${this.formatDamage(this.runStats.totalDamage)}`,
          isDaily
            ? `Daily score: ${this.formatCurrency(this.dailyScore)}${this.dailyScoreSubmitted ? " (submitted)" : ""}`
            : "Mode: normal"
        ].join("\n"),
        {
          fontFamily: Fonts.mono,
          fontSize: isMobile ? "16px" : "18px",
          color: "#e2e8f0",
          align: "center"
        }
      )
      .setOrigin(0.5, 0);
    const rewards = this.add
      .text(
        width / 2,
        summary.y + (isMobile ? 128 : 136),
        [
          `Награды за волны: +${this.formatCurrency(this.runStats.waveRewardCredits)} кр`,
          `Награды за босса: +${this.formatCurrency(this.runStats.bossRewardCredits)} кр`,
          `Итого бонус: +${this.formatCurrency(totalBonusCredits)} кр`
        ].join("\n"),
        {
          fontFamily: Fonts.game,
          fontSize: isMobile ? "15px" : "16px",
          color: "#fde68a",
          align: "center"
        }
      )
      .setOrigin(0.5, 0);
    const rewardDetailLines =
      this.waveRewardLog.length > 0
        ? this.waveRewardLog.slice(-3).map((entry) => {
            const bossPart = entry.bossCredits > 0 ? `, босс +${entry.bossCredits}` : "";
            return `Волна ${entry.waveNumber}: +${entry.totalCredits} (волна +${entry.waveCredits}${bossPart}) | ${entry.detail}`;
          })
        : ["Награды за волны появятся после первой зачистки."];
    const details = this.add
      .text(width / 2, rewards.y + (isMobile ? 90 : 84), rewardDetailLines.join("\n"), {
        fontFamily: Fonts.ui,
        fontSize: isMobile ? "12px" : "13px",
        color: "#cbd5e1",
        align: "center",
        wordWrap: { width: panelWidth - 40, useAdvancedWrap: true }
      })
      .setOrigin(0.5, 0);

    overlay.add([backdrop, panel, accentLine, title, summary, rewards, details]);

    const rewardedHint = this.add
      .text(
        width / 2,
        details.y + (isMobile ? 74 : 66),
        isDaily
          ? `Daily date: ${this.dailyDateKey}`
          : this.rewardDoubleClaimed
          ? "Rewarded: бонус уже удвоен"
          : totalBonusCredits > 0
            ? `Rewarded: удвоить бонус +${this.formatCurrency(totalBonusCredits)} кр`
            : "Rewarded недоступен: бонус 0",
        {
          fontFamily: Fonts.mono,
          fontSize: isMobile ? "13px" : "14px",
          color:
            isDaily || this.rewardDoubleClaimed || totalBonusCredits <= 0
              ? "#94a3b8"
              : "#fde68a",
          align: "center"
        }
      )
      .setOrigin(0.5, 0);
    overlay.add(rewardedHint);

    const buttonWidth = isMobile ? Math.min(panelWidth - 46, 280) : END_RUN_BUTTON_WIDTH;
    const firstButtonX = isMobile ? width / 2 : width / 2 - (buttonWidth + 18) / 2;
    const firstButtonY = panelBottom - (isMobile ? 98 : 44);
    const secondButtonX = isMobile ? width / 2 : width / 2 + (buttonWidth + 18) / 2;
    const secondButtonY = panelBottom - 44;
    const rewardedButtonY = isMobile ? panelBottom - 152 : panelBottom - 108;
    const rewardButtonEnabled = !isDaily && !this.rewardDoubleClaimed && totalBonusCredits > 0;
    const rewardedButton = this.createEndRunButton(
      width / 2,
      rewardedButtonY,
      isMobile ? Math.min(panelWidth - 46, 280) : END_RUN_BUTTON_WIDTH + 70,
      this.rewardDoubleClaimed ? "x2 уже получено" : "Удвоить бонус (Ad)",
      rewardButtonEnabled ? Colors.amber : Colors.btnSecondary,
      rewardButtonEnabled ? Colors.amberPale : Colors.btnSecondaryHover,
      "#fefce8",
      () => {
        if (!rewardButtonEnabled) {
          return;
        }
        void this.onRewardedDoublePressed(totalBonusCredits);
      }
    );
    const replayButton = this.createEndRunButton(
      firstButtonX,
      firstButtonY,
      buttonWidth,
      "Сыграть ещё",
      Colors.btnPrimary,
      Colors.btnPrimaryHover,
      "#ecfeff",
      this.onPlayAgainPressed
    );
    const hubButton = this.createEndRunButton(
      secondButtonX,
      secondButtonY,
      buttonWidth,
      "В хаб",
      Colors.btnSecondary,
      Colors.btnSecondaryHover,
      "#e2e8f0",
      this.onReturnToHubPressed
    );
    overlay.add([rewardedButton, replayButton, hubButton]);

    panel.setScale(0.95);
    overlay.setAlpha(0);
    this.tweens.add({
      targets: overlay,
      alpha: 1,
      duration: 220,
      ease: "Quad.easeOut"
    });
    this.tweens.add({
      targets: panel,
      scale: 1,
      duration: 240,
      ease: "Back.easeOut"
    });

    this.endRunOverlay = overlay;
  }

  private createEndRunButton(
    x: number,
    y: number,
    width: number,
    label: string,
    baseColor: number,
    hoverColor: number,
    textColor: string,
    onClick: () => void | Promise<void>
  ): Phaser.GameObjects.Container {
    const background = this.add
      .rectangle(0, 0, width, END_RUN_BUTTON_HEIGHT, baseColor, 1)
      .setStrokeStyle(2, Colors.borderLight, 0.84)
      .setInteractive({ useHandCursor: true });
    const caption = this.add
      .text(0, 0, label, {
        fontFamily: Fonts.game,
        fontSize: "20px",
        color: textColor
      })
      .setOrigin(0.5);
    const button = this.add.container(x, y, [background, caption]);

    background.on("pointerover", () => {
      background.setFillStyle(hoverColor, 1);
    });
    background.on("pointerout", () => {
      background.setFillStyle(baseColor, 1);
    });
    background.on("pointerdown", () => {
      void onClick.call(this);
    });
    caption.setInteractive({ useHandCursor: true });
    caption.on("pointerdown", () => {
      void onClick.call(this);
    });

    return button;
  }

  private destroyEndRunOverlay(): void {
    if (!this.endRunOverlay) {
      return;
    }

    this.endRunOverlay.destroy(true);
    this.endRunOverlay = undefined;
  }

  private onPlayAgainPressed(): void {
    void this.onPlayAgainPressedAsync();
  }

  private async onPlayAgainPressedAsync(): Promise<void> {
    if (!this.gameState || !this.runCompleted || this.endRunActionLocked) {
      return;
    }
    this.endRunActionLocked = true;

    this.persistMetaProgress();
    await tryShowInterstitialAfterRun(this.gameState);
    resetRunState(this.gameState);
    this.gameState.metaState.totalRuns += 1;
    await flushGameSave(this.gameState);
    this.scene.restart({
      mode: this.runMode,
      dateKey: this.dailyDateKey
    } as RunStartPayload);
  }

  private onReturnToHubPressed(): void {
    void this.onReturnToHubPressedAsync();
  }

  private async onReturnToHubPressedAsync(): Promise<void> {
    if (!this.runCompleted || !this.gameState || this.endRunActionLocked) {
      return;
    }
    this.endRunActionLocked = true;

    this.persistMetaProgress();
    await tryShowInterstitialAfterRun(this.gameState);
    await flushGameSave(this.gameState);
    this.scene.start("MenuScene");
  }

  private async onRewardedDoublePressed(totalBonusCredits: number): Promise<void> {
    if (
      !this.gameState ||
      this.runMode === "daily" ||
      this.rewardDoubleClaimed ||
      totalBonusCredits <= 0 ||
      this.endRunActionLocked
    ) {
      return;
    }

    this.endRunActionLocked = true;
    const result = await tryShowRewarded();
    if (!result.shown || !result.rewarded) {
      this.endRunActionLocked = false;
      this.showFeedback("Rewarded не просмотрено до конца", "#fca5a5");
      return;
    }

    this.rewardDoubleClaimed = true;
    this.gameState.runState.credits += totalBonusCredits;
    this.gameState.metaState.totalCreditsEarned += totalBonusCredits;
    applyDailyProgress(this.gameState.metaState, this.gameState.configs.meta, "credits_earn", totalBonusCredits);
    this.markSaveDirty();
    queueGameSave(this.gameState);
    this.endRunActionLocked = false;
    this.showFeedback(`Бонус удвоен: +${this.formatCurrency(totalBonusCredits)} кр`, "#fde68a");
    this.renderEndRunOverlay();
    this.refreshHudAndControls();
  }

  private async submitDailyScoreIfNeeded(): Promise<void> {
    if (!this.gameState || this.runMode !== "daily" || this.dailyScore <= 0) {
      return;
    }

    const result = await trySubmitDailyScore(this.gameState, this.dailyScore, this.dailyDateKey);
    if (result.submitted) {
      this.dailyScoreSubmitted = true;
      this.markSaveDirty();
      queueGameSave(this.gameState);
      this.showFeedback("Daily score отправлен в лидерборд", "#86efac");
      return;
    }

    if (result.reason === "score_not_better") {
      this.showFeedback("Daily score не побил ваш лучший результат", "#94a3b8");
    }
  }

  private playSplashPulse(x: number, y: number, splashRadiusCells: number): void {
    const radius = Math.max(this.cellSize * 0.28, splashRadiusCells * this.cellSize * 0.85);
    const pulse = this.add
      .circle(x, y, radius, Colors.turretSplash, 0.08)
      .setStrokeStyle(1, Colors.amber, 0.5)
      .setDepth(34);
    pulse.setScale(0.6);

    this.tweens.add({
      targets: pulse,
      alpha: 0,
      scale: 1.05,
      duration: 200,
      ease: "Sine.easeOut",
      onComplete: () => {
        pulse.destroy();
      }
    });
  }

  private playSlowPulse(enemy: EnemyView): void {
    const pulse = this.add
      .circle(enemy.container.x, enemy.container.y, Math.max(6, this.cellSize * 0.16), Colors.cyanBright, 0.12)
      .setStrokeStyle(1, Colors.cyanLight, 0.6)
      .setDepth(34);
    pulse.setScale(0.6);

    this.tweens.add({
      targets: pulse,
      alpha: 0,
      scale: 1.35,
      duration: 220,
      ease: "Quad.easeOut",
      onComplete: () => {
        pulse.destroy();
      }
    });
  }

  private normalizeTurretRole(rawRole: string): TurretRole {
    const normalized = rawRole.replace(/_/g, "-");
    if (normalized === "splash" || normalized === "slow" || normalized === "single-target") {
      return normalized;
    }
    return "single-target";
  }

  private getRoleLabel(role: TurretRole): string {
    if (role === "single-target") {
      return "single-target";
    }
    if (role === "splash") {
      return "splash";
    }
    return "slow";
  }

  private getShotColorForRole(role: TurretRole): number {
    if (role === "splash") {
      return Colors.amber;
    }
    if (role === "slow") {
      return Colors.cyanBright;
    }
    return Colors.bluePale;
  }

  private getConfigByTypeAndTier(baseType: string, tier: number): TurretConfig | undefined {
    return this.turretCatalog.get(baseType)?.get(tier);
  }

  private getTypeLabel(baseType: string): string {
    return this.typeDisplayNames.get(baseType) ?? "Node";
  }

  private extractBaseType(turretId: string): string {
    return turretId.replace(/_lv\d+$/i, "");
  }

  private shrinkTypeName(rawName: string): string {
    const firstWord = rawName.split(" ")[0];
    return firstWord.length <= 10 ? firstWord : firstWord.slice(0, 10);
  }

  private resolveTierColor(baseType: string, tier: number): number {
    const baseColor = TYPE_COLORS[baseType] ?? TYPE_COLOR_FALLBACK;
    const color = Phaser.Display.Color.IntegerToColor(baseColor);
    const brightenFactor = Math.max(0, tier - 1) * 0.2;

    const red = Phaser.Math.Clamp(
      Math.floor(color.red + (255 - color.red) * brightenFactor),
      0,
      255
    );
    const green = Phaser.Math.Clamp(
      Math.floor(color.green + (255 - color.green) * brightenFactor),
      0,
      255
    );
    const blue = Phaser.Math.Clamp(
      Math.floor(color.blue + (255 - color.blue) * brightenFactor),
      0,
      255
    );

    return Phaser.Display.Color.GetColor(red, green, blue);
  }

  private resolveEnemyColor(enemy: EnemyConfig): number {
    if (enemy.tags.includes("tank")) {
      return 0x7c3aed;
    }
    if (enemy.tags.includes("fast")) {
      return 0xf97316;
    }
    return 0x22d3ee;
  }

  private getFreeCellIndexes(): number[] {
    const totalCells = this.gridSpec.cols * this.gridSpec.rows;
    const freeCells: number[] = [];
    for (let cellIndex = 0; cellIndex < totalCells; cellIndex += 1) {
      if (this.blockedPathCells.has(cellIndex) || this.blockedObstacleCells.has(cellIndex)) {
        continue;
      }
      if (!this.turretsByCell.has(cellIndex)) {
        freeCells.push(cellIndex);
      }
    }

    return freeCells;
  }

  private getConfiguredGridSpec(): GridSpec {
    if (!this.gameState) {
      return { ...DEFAULT_GRID };
    }

    return {
      cols: this.gameState.configs.waves.grid.cols,
      rows: this.gameState.configs.waves.grid.rows
    };
  }

  private applyConfiguredGridSpec(): void {
    this.gridSpec = this.getConfiguredGridSpec();
  }

  private buildHudText(): string {
    if (!this.gameState) {
      return "GameState не загружен";
    }

    const totalCells = this.gridSpec.cols * this.gridSpec.rows;
    const playableCells = totalCells - this.blockedPathCells.size - this.blockedObstacleCells.size;
    const freeCells = this.getFreeCellIndexes().length;
    const placedTurrets = this.turretsByObject.size;
    const purchaseCost = this.purchaseTurretConfig?.cost ?? 0;
    const inHandLabel = this.turretInHand
      ? `${this.getTypeLabel(this.extractBaseType(this.turretInHand.id))} (-${this.turretInHand.cost})`
      : "пусто";
    const statusLabel = this.runCompleted
      ? this.runOutcome === "win"
        ? "Статус: Победа"
        : "Статус: Поражение"
      : this.isCardDraftOpen
        ? "Статус: Выбор карты"
      : "Статус: В бою";
    const modifiersLabel = [
      `Урон x${this.formatMultiplier(this.runCardModifiers.damageMultiplier)}`,
      `Скорость x${this.formatMultiplier(this.runCardModifiers.fireRateMultiplier)}`,
      `Крит ${Math.round(this.runCardModifiers.critChanceBonus * 100)}%`,
      `Merge +${this.runCardModifiers.mergeBonusCredits}`
    ].join(" / ");

    return [
      `Mode: ${this.runMode === "daily" ? `Daily ${this.dailyDateKey}` : "Normal"} | Speed x${this.runMode === "daily" ? "1.0 fixed" : this.gameState.settingsState.speedMultiplier.toFixed(1)} | ${statusLabel}`,
      `Turrets: ${placedTurrets} | Enemies: ${this.enemiesById.size} | Free cells: ${freeCells}/${playableCells} | Buy: ${purchaseCost} | Hand: ${inHandLabel}`,
      `Buffs: ${modifiersLabel} | Economy x${this.formatMultiplier(this.runCreditMetaMultiplier)} | Cards ${this.selectedCardIds.length}`,
      `Merges ${this.runStats.merges} | Damage ${this.formatDamage(this.runStats.totalDamage)} | Time ${this.formatDuration(this.runStats.runTimeMs)}`
    ].join("\n");
  }

  private showStateError(message: string): void {
    this.cameras.main.setBackgroundColor("#2b1111");
    this.add.text(16, 16, message, {
      fontFamily: Fonts.ui,
      fontSize: "24px",
      color: "#fecaca",
      wordWrap: { width: this.scale.width - 32 }
    });
  }
}
