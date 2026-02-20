import Phaser from "phaser";
import {
  applyDailyProgress,
  canPurchaseUpgrade,
  claimDailyTask,
  GAME_STATE_KEY,
  getMetaEffectTotal,
  getUpgradeLevel,
  purchaseUpgrade,
  refreshDailyTasksIfNeeded,
  resetProfileState,
  resetRunState
} from "../game/gameState";
import { Colors, Fonts } from "../rendering/CyberTheme";
import { UIFactory } from "../rendering/UIFactory";
import {
  clearAllSaves,
  flushGameSave,
  queueGameSave,
  SAVE_PROFILE_EXISTS_KEY,
  SAVE_PROFILE_PICKED_KEY
} from "../game/saveSystem";
import {
  DailyLeaderboardSnapshot,
  getLocalDateKey,
  loadDailyLeaderboard
} from "../game/dailyChallenge";
import {
  getIapCatalog,
  IAP_NO_ADS_ID,
  IAP_STARTER_PACK_ID,
  IapCatalogItem,
  purchaseAndApply,
  syncPendingPurchases
} from "../game/iap";
import { showStickyInHub } from "../game/monetization";
import { yandexGamesSdk, YANDEX_SDK_STATE_KEY, YandexSdkState } from "../sdk/yandexGamesSdk";
import { DailyTaskState, GameState, MetaUpgradeConfig } from "../game/types";

const MOBILE_BREAKPOINT_PX = 920;

export class MenuScene extends Phaser.Scene {
  private root?: Phaser.GameObjects.Container;
  private feedbackLabel?: Phaser.GameObjects.Text;
  private saveChoiceOverlay?: Phaser.GameObjects.Container;
  private iapOverlay?: Phaser.GameObjects.Container;
  private settingsOverlay?: Phaser.GameObjects.Container;
  private iapCatalog: IapCatalogItem[] = [];
  private iapHydrated = false;
  private iapHydrating = false;
  private dailyLeaderboard?: DailyLeaderboardSnapshot;
  private dailyLeaderboardLoading = false;

  constructor() {
    super("MenuScene");
  }

  create(): void {
    this.cameras.main.setBackgroundColor(Colors.bgDark);
    try {
      this.createLayout();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown MenuScene error";
      console.error("[MenuScene] create failed", error);
      this.add
        .text(24, 24, `MenuScene error:\n${message}`, {
          fontFamily: Fonts.ui,
          fontSize: "18px",
          color: "#fecaca"
        })
        .setDepth(999);
    }
    this.scale.on("resize", this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off("resize", this.onResize, this);
    });
  }

  private createLayout(): void {
    const gameState = this.registry.get(GAME_STATE_KEY) as GameState | undefined;
    const sdkState =
      (this.registry.get(YANDEX_SDK_STATE_KEY) as YandexSdkState | undefined) ??
      yandexGamesSdk.getState();
    this.root?.destroy(true);

    const root = this.add.container(0, 0);
    this.root = root;

    const { width, height } = this.scale;
    const isMobile = width < MOBILE_BREAKPOINT_PX;

    if (this.textures.exists("asset_menu_backdrop")) {
      const bgImage = this.add
        .image(width / 2, height / 2, "asset_menu_backdrop")
        .setDisplaySize(width, height)
        .setAlpha(0.22);
      root.add(bgImage);
    }

    const backdrop = this.add.graphics();
    backdrop.fillGradientStyle(Colors.bgDeep, Colors.bgDark, Colors.bgPanel, Colors.bgCard, 0.9);
    backdrop.fillRect(0, 0, width, height);
    backdrop.fillStyle(0x020617, 0.38);
    backdrop.fillRect(0, 0, width, height);
    root.add(backdrop);

    if (this.textures.exists("scanlines")) {
      const scanlines = this.add
        .tileSprite(width / 2, height / 2, width, height, "scanlines")
        .setAlpha(0.08);
      root.add(scanlines);
      this.tweens.add({
        targets: scanlines,
        tilePositionY: 220,
        duration: 9500,
        repeat: -1,
        ease: "Linear"
      });
    }

    if (!gameState) {
      const error = this.add
        .text(width / 2, height / 2, "GameState не найден. Перезапустите приложение.", {
          fontFamily: Fonts.ui,
          fontSize: "24px",
          color: "#fecaca"
        })
        .setOrigin(0.5);
      root.add(error);
      return;
    }

    refreshDailyTasksIfNeeded(gameState.metaState, gameState.configs.meta);
    this.sound.mute = !gameState.settingsState.soundEnabled;
    this.ensureAmbientMusic();
    showStickyInHub(gameState);
    if (!this.iapHydrated) {
      void this.hydrateIapData(gameState);
    }
    const todayDateKey = getLocalDateKey();
    const needDailyRefresh =
      !this.dailyLeaderboard || this.dailyLeaderboard.dateKey !== todayDateKey;
    if (!this.dailyLeaderboardLoading && needDailyRefresh) {
      void this.hydrateDailyLeaderboard();
    }

    const topStrip = this.add
      .rectangle(width / 2, 72, Math.min(width - 20, 1380), 136, Colors.bgOverlay, 0.86)
      .setStrokeStyle(2, Colors.cyanLight, 0.86);
    root.add(topStrip);

    const title = this.add
      .text(width / 2, 24, "DATA CENTER // META HUB", {
        fontFamily: Fonts.game,
        fontSize: isMobile ? "24px" : "40px",
        color: "#e0f2fe",
        stroke: "#04101f",
        strokeThickness: 5
      })
      .setOrigin(0.5, 0);
    root.add(title);

    const subtitle = this.add
      .text(width / 2, isMobile ? 58 : 66, "Build. Merge. Defend. Upgrade. Repeat.", {
        fontFamily: Fonts.mono,
        fontSize: isMobile ? "11px" : "14px",
        color: "#7dd3fc"
      })
      .setOrigin(0.5, 0);
    root.add(subtitle);

    const rareChance = Math.round(
      getMetaEffectTotal(gameState.metaState, gameState.configs.meta, "rare_turret_chance") * 100
    );
    const startCreditsBonus = Math.floor(
      getMetaEffectTotal(gameState.metaState, gameState.configs.meta, "starting_credits_flat")
    );
    const baseHpBonus = Math.floor(
      getMetaEffectTotal(gameState.metaState, gameState.configs.meta, "base_hp_flat")
    );

    const metaStatsLabel = this.add
      .text(
        width / 2,
        isMobile ? 92 : 100,
        [
          `Meta Credits: ${gameState.metaState.metaCredits} | Runs: ${gameState.metaState.totalRuns} | Best Wave: ${gameState.metaState.bestWave}`,
          `no_ads: ${gameState.settingsState.noAdsPurchased ? "ON" : "OFF"} | Speed: x${gameState.settingsState.speedMultiplier.toFixed(1)} | Rare drop: ${rareChance}%`,
          `Start bonus: +${startCreditsBonus} credits | Base HP bonus: +${baseHpBonus}`
        ].join("\n"),
        {
          fontFamily: Fonts.ui,
          fontSize: isMobile ? "12px" : "15px",
          color: "#bfdbfe",
          align: "center"
        }
      )
      .setOrigin(0.5, 0.5);
    root.add(metaStatsLabel);
    const sdkLabel = this.add
      .text(
        width / 2,
        isMobile ? 128 : 138,
        `SDK: ${sdkState.mode === "yandex" ? "Yandex" : "Guest"} | Ready: ${
          sdkState.readyCalled ? "yes" : "pending"
        }`,
        {
          fontFamily: Fonts.mono,
          fontSize: isMobile ? "10px" : "12px",
          color: sdkState.mode === "yandex" ? "#86efac" : "#fcd34d"
        }
      )
      .setOrigin(0.5, 0.5);
    root.add(sdkLabel);
    const dailyTopLabel = this.add
      .text(width / 2, isMobile ? 144 : 156, this.buildDailyLeaderboardText(gameState), {
        fontFamily: Fonts.ui,
        fontSize: isMobile ? "10px" : "12px",
        color: "#93c5fd",
        align: "center"
      })
      .setOrigin(0.5, 0.5);
    root.add(dailyTopLabel);

    const headerScan = this.add
      .rectangle(width / 2, isMobile ? 156 : 170, Math.min(width - 24, 1360), 1, Colors.cyanLight, 0.48)
      .setOrigin(0.5);
    root.add(headerScan);

    const heroElements = [topStrip, title, subtitle, metaStatsLabel, sdkLabel, dailyTopLabel, headerScan];
    heroElements.forEach((element, index) => {
      const targetY = element.y;
      element.setAlpha(0);
      element.setY(targetY - 10);
      this.tweens.add({
        targets: element,
        alpha: 1,
        y: targetY,
        delay: 60 * index,
        duration: 380,
        ease: "Quad.easeOut"
      });
    });

    yandexGamesSdk.markReady();
    this.registry.set(YANDEX_SDK_STATE_KEY, yandexGamesSdk.getState());

    const bodyTop = isMobile ? 168 : 180;
    const bodyHeight = Math.max(isMobile ? 260 : 280, height - bodyTop - (isMobile ? 260 : 118));

    if (isMobile) {
      const upgradesPanel = UIFactory.createPanel(this, width / 2, bodyTop + bodyHeight * 0.36, width - 20, bodyHeight * 0.52, "Апгрейды");
      root.add(upgradesPanel.container);
      this.renderUpgradeList(gameState, upgradesPanel, root, true);

      const dailyPanel = UIFactory.createPanel(this, width / 2, bodyTop + bodyHeight * 0.79, width - 20, bodyHeight * 0.34, "Daily задания");
      root.add(dailyPanel.container);
      this.renderDailyTasks(gameState, dailyPanel, root, true);
    } else {
      const leftWidth = Math.min(780, width * 0.62);
      const rightWidth = Math.min(550, width * 0.33);
      const gap = 14;
      const totalWidth = leftWidth + rightWidth + gap;
      const leftCenter = width / 2 - totalWidth / 2 + leftWidth / 2;
      const rightCenter = leftCenter + leftWidth / 2 + gap + rightWidth / 2;

      const upgradesPanel = UIFactory.createPanel(this, leftCenter, bodyTop + bodyHeight / 2, leftWidth, bodyHeight, "Дерево апгрейдов");
      root.add(upgradesPanel.container);
      this.renderUpgradeList(gameState, upgradesPanel, root, false);

      const dailyPanel = UIFactory.createPanel(this, rightCenter, bodyTop + bodyHeight / 2, rightWidth, bodyHeight, "Daily задания");
      root.add(dailyPanel.container);
      this.renderDailyTasks(gameState, dailyPanel, root, false);
    }

    const playButtonWidth = isMobile ? Math.min(width - 24, 320) : 340;
    const startRun = (): void => {
      const picked = this.registry.get(SAVE_PROFILE_PICKED_KEY) as boolean | undefined;
      if (picked === false) {
        this.showFeedback("Сначала выберите: Продолжить или Новая игра", "#fde68a");
        return;
      }

      refreshDailyTasksIfNeeded(gameState.metaState, gameState.configs.meta);
      resetRunState(gameState);
      gameState.metaState.totalRuns += 1;
      applyDailyProgress(gameState.metaState, gameState.configs.meta, "run_count", 1);
      queueGameSave(gameState);
      this.scene.start("RunScene");
    };

    const playButton = UIFactory.createButton(
      this,
      width / 2,
      height - (isMobile ? 46 : 48),
      playButtonWidth,
      70,
      "СТАРТ ЗАБЕГА",
      { fontSize: isMobile ? "24px" : "30px", onClick: startRun, glowing: true }
    );
    root.add(playButton);

    const startDailyRun = (): void => {
      const picked = this.registry.get(SAVE_PROFILE_PICKED_KEY) as boolean | undefined;
      if (picked === false) {
        this.showFeedback("Сначала выберите профиль", "#fde68a");
        return;
      }

      refreshDailyTasksIfNeeded(gameState.metaState, gameState.configs.meta);
      resetRunState(gameState);
      gameState.metaState.totalRuns += 1;
      applyDailyProgress(gameState.metaState, gameState.configs.meta, "run_count", 1);
      queueGameSave(gameState);
      this.scene.start("RunScene", {
        mode: "daily",
        dateKey: getLocalDateKey()
      });
    };
    const leftButtonY = isMobile ? height - 114 : height - 48;
    const leftButtonWidth = isMobile ? Math.max(128, Math.min(width * 0.42, 172)) : 152;
    const settingsWidth = isMobile ? leftButtonWidth : 150;
    const leftButtonStartX = isMobile ? width / 2 - (leftButtonWidth + settingsWidth + 14) / 2 + leftButtonWidth / 2 : 84;

    const dailyButton = UIFactory.createButton(this, leftButtonStartX, leftButtonY, leftButtonWidth, 54, "DAILY", {
      baseColor: Colors.btnPurple,
      hoverColor: 0x9333ea,
      textColor: "#f5f3ff",
      fontSize: "22px",
      onClick: startDailyRun
    });
    root.add(dailyButton);

    const openSettings = (): void => {
      this.renderSettingsOverlay(gameState);
    };
    const settingsButtonX = isMobile ? leftButtonStartX + leftButtonWidth / 2 + 14 + settingsWidth / 2 : 254;
    const settingsButton = UIFactory.createButton(this, settingsButtonX, leftButtonY, settingsWidth, 54, "SETTINGS", {
      baseColor: Colors.btnPrimary,
      hoverColor: Colors.btnPrimaryHover,
      fontSize: "22px",
      onClick: openSettings
    });
    root.add(settingsButton);

    const openStore = (): void => {
      const picked = this.registry.get(SAVE_PROFILE_PICKED_KEY) as boolean | undefined;
      if (picked === false) {
        this.showFeedback("Сначала выберите профиль", "#fde68a");
        return;
      }
      this.renderIapOverlay(gameState);
    };
    const shopButton = UIFactory.createButton(
      this,
      isMobile ? width / 2 : width - 84,
      isMobile ? height - 172 : leftButtonY,
      isMobile ? Math.min(width - 24, 232) : 138,
      54,
      "IAP",
      {
        baseColor: Colors.btnBlue,
        hoverColor: 0x2563eb,
        textColor: "#eff6ff",
        fontSize: "20px",
        onClick: openStore
      }
    );
    root.add(shopButton);

    const controlHint = this.add
      .text(
        width / 2,
        isMobile ? height - 212 : height - 84,
        isMobile
          ? "Mobile: купить -> tap клетки (или drag токена), merge drag-ом"
          : "Desktop: купить -> click клетки (или drag токена), merge броском на одинаковую турель",
        {
          fontFamily: Fonts.mono,
          fontSize: isMobile ? "11px" : "13px",
          color: "#94a3b8",
          align: "center"
        }
      )
      .setOrigin(0.5);
    root.add(controlHint);
    const assetCredits = this.add
      .text(
        12,
        height - 10,
        "Assets: generated sprites/backgrounds + music (CC0) via OpenGameArt",
        {
          fontFamily: Fonts.mono,
          fontSize: isMobile ? "9px" : "10px",
          color: "#64748b"
        }
      )
      .setOrigin(0, 1);
    root.add(assetCredits);

    this.feedbackLabel = this.add
      .text(width / 2, isMobile ? height - 236 : height - 96, "", {
        fontFamily: Fonts.ui,
        fontSize: isMobile ? "16px" : "18px",
        color: "#fde68a"
      })
      .setOrigin(0.5)
      .setAlpha(0);
    root.add(this.feedbackLabel);
    this.renderSaveChoiceOverlay(gameState);
  }

  private async hydrateIapData(gameState: GameState): Promise<void> {
    if (this.iapHydrating) {
      return;
    }

    this.iapHydrating = true;
    const syncResult = await syncPendingPurchases(gameState);
    this.iapCatalog = await getIapCatalog();
    this.iapHydrated = true;
    this.iapHydrating = false;

    if (syncResult.applied > 0) {
      queueGameSave(gameState);
      this.showFeedback(`Покупки применены: ${syncResult.applied}`, "#86efac");
    }

    if (!this.scene.isActive()) {
      return;
    }
    this.createLayout();
  }

  private async hydrateDailyLeaderboard(): Promise<void> {
    this.dailyLeaderboardLoading = true;
    const dateKey = getLocalDateKey();
    this.dailyLeaderboard = await loadDailyLeaderboard(dateKey);
    this.dailyLeaderboardLoading = false;
    if (!this.scene.isActive()) {
      return;
    }
    this.createLayout();
  }

  private buildDailyLeaderboardText(gameState: GameState): string {
    const dateKey = getLocalDateKey();
    if (this.dailyLeaderboardLoading) {
      return `Daily ${dateKey}: загрузка лидерборда...`;
    }

    const bestLocal =
      gameState.settingsState.dailyChallengeDateKey === dateKey
        ? gameState.settingsState.dailyChallengeBestScore
        : 0;
    if (!this.dailyLeaderboard) {
      return `Daily ${dateKey}: best local ${bestLocal} | leaderboard unavailable`;
    }

    const topLines = this.dailyLeaderboard.top
      .slice(0, 3)
      .map((entry) => `#${entry.rank} ${entry.playerName}: ${entry.score}`)
      .join(" | ");
    const playerPart = this.dailyLeaderboard.player
      ? `You #${this.dailyLeaderboard.player.rank}: ${this.dailyLeaderboard.player.score}`
      : `You: ${bestLocal}`;

    return `Daily ${dateKey} | ${playerPart}${topLines ? ` | ${topLines}` : ""}`;
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

  private renderSettingsOverlay(gameState: GameState): void {
    this.settingsOverlay?.destroy(true);
    this.settingsOverlay = undefined;

    const width = this.scale.width;
    const height = this.scale.height;
    const overlay = this.add.container(0, 0).setDepth(430);
    const backdrop = UIFactory.createOverlayBackdrop(this, width, height, 0.84);
    const panelWidth = Math.min(width - 24, 460);
    const panelHeight = 338;
    const panel = this.add
      .rectangle(width / 2, height / 2, panelWidth, panelHeight, Colors.bgOverlay, 0.98)
      .setStrokeStyle(2, Colors.cyanLight, 0.9);
    const title = this.add
      .text(width / 2, height / 2 - 145, "Настройки", {
        fontFamily: Fonts.game,
        fontSize: "30px",
        color: "#dbeafe"
      })
      .setOrigin(0.5);

    const soundRow = this.createSettingsRow(
      width / 2,
      height / 2 - 66,
      "Звук",
      gameState.settingsState.soundEnabled ? "ON" : "OFF",
      () => {
        gameState.settingsState.soundEnabled = !gameState.settingsState.soundEnabled;
        this.sound.mute = !gameState.settingsState.soundEnabled;
        queueGameSave(gameState);
        this.renderSettingsOverlay(gameState);
      }
    );
    const vibrationRow = this.createSettingsRow(
      width / 2,
      height / 2 + 0,
      "Вибрация",
      gameState.settingsState.vibrationEnabled ? "ON" : "OFF",
      () => {
        gameState.settingsState.vibrationEnabled = !gameState.settingsState.vibrationEnabled;
        queueGameSave(gameState);
        this.renderSettingsOverlay(gameState);
      }
    );
    const speedRow = this.createSettingsRow(
      width / 2,
      height / 2 + 66,
      "Скорость",
      `x${gameState.settingsState.speedMultiplier.toFixed(1)}`,
      () => {
        gameState.settingsState.speedMultiplier =
          gameState.settingsState.speedMultiplier >= 1.5 ? 1 : 1.5;
        queueGameSave(gameState);
        this.renderSettingsOverlay(gameState);
      }
    );

    const close = (): void => {
      this.settingsOverlay?.destroy(true);
      this.settingsOverlay = undefined;
      this.createLayout();
    };
    const closeButton = UIFactory.createButton(this, width / 2, height / 2 + 133, 200, 52, "Закрыть", {
      baseColor: Colors.btnSecondary,
      hoverColor: Colors.btnSecondaryHover,
      fontSize: "24px",
      onClick: close
    });

    overlay.add([
      backdrop,
      panel,
      title,
      soundRow,
      vibrationRow,
      speedRow,
      closeButton
    ]);
    this.settingsOverlay = overlay;
  }

  private createSettingsRow(
    x: number,
    y: number,
    label: string,
    value: string,
    onToggle: () => void
  ): Phaser.GameObjects.Container {
    const row = this.add.container(x, y);
    const frame = this.add
      .rectangle(0, 0, 370, 54, Colors.bgCard, 0.96)
      .setStrokeStyle(1, Colors.border, 0.9);
    const key = this.add
      .text(-166, 0, label, {
        fontFamily: Fonts.game,
        fontSize: "21px",
        color: "#e2e8f0"
      })
      .setOrigin(0, 0.5);
    const toggle = this.add
      .rectangle(122, 0, 126, 40, Colors.btnPrimary, 1)
      .setStrokeStyle(1, Colors.borderBright, 0.9)
      .setInteractive({ useHandCursor: true });
    const toggleLabel = this.add
      .text(122, 0, value, {
        fontFamily: Fonts.game,
        fontSize: "18px",
        color: "#ecfeff"
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    toggle.on("pointerdown", onToggle);
    toggleLabel.on("pointerdown", onToggle);
    row.add([frame, key, toggle, toggleLabel]);
    return row;
  }

  private renderIapOverlay(gameState: GameState): void {
    this.iapOverlay?.destroy(true);
    this.iapOverlay = undefined;

    const width = this.scale.width;
    const height = this.scale.height;
    const overlay = this.add.container(0, 0).setDepth(420);
    const backdrop = UIFactory.createOverlayBackdrop(this, width, height, 0.82);

    const panelWidth = Math.min(width - 24, 620);
    const panelHeight = 360;
    const panel = this.add
      .rectangle(width / 2, height / 2, panelWidth, panelHeight, Colors.bgOverlay, 0.98)
      .setStrokeStyle(2, Colors.cyanLight, 0.92);
    const title = this.add
      .text(width / 2, height / 2 - 154, "Магазин IAP", {
        fontFamily: Fonts.game,
        fontSize: "30px",
        color: "#dbeafe"
      })
      .setOrigin(0.5);
    const close = this.add
      .text(width / 2 + panelWidth / 2 - 26, height / 2 - panelHeight / 2 + 16, "✕", {
        fontFamily: Fonts.ui,
        fontSize: "24px",
        color: "#cbd5e1"
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    close.on("pointerdown", () => {
      this.iapOverlay?.destroy(true);
      this.iapOverlay = undefined;
    });

    overlay.add([backdrop, panel, title, close]);

    const noAds = this.resolveCatalogItem(IAP_NO_ADS_ID);
    const starter = this.resolveCatalogItem(IAP_STARTER_PACK_ID);
    this.renderIapRow(
      overlay,
      gameState,
      {
        id: IAP_NO_ADS_ID,
        title: noAds?.title ?? "no_ads",
        description: noAds?.description || "Отключает interstitial и sticky рекламу.",
        price: noAds?.price ?? "N/A",
        status: gameState.settingsState.noAdsPurchased ? "Куплено" : "Доступно",
        canBuy: !gameState.settingsState.noAdsPurchased
      },
      height / 2 - 56
    );
    this.renderIapRow(
      overlay,
      gameState,
      {
        id: IAP_STARTER_PACK_ID,
        title: starter?.title ?? "starter_pack",
        description:
          starter?.description ||
          "Consumable: +350 Meta Credits за каждую покупку.",
        price: starter?.price ?? "N/A",
        status: `Куплено: ${gameState.settingsState.starterPackPurchases}`,
        canBuy: true
      },
      height / 2 + 58
    );

    this.iapOverlay = overlay;
  }

  private renderIapRow(
    overlay: Phaser.GameObjects.Container,
    gameState: GameState,
    row: {
      id: string;
      title: string;
      description: string;
      price: string;
      status: string;
      canBuy: boolean;
    },
    y: number
  ): void {
    const width = this.scale.width;
    const frame = this.add
      .rectangle(width / 2, y, Math.min(width - 64, 560), 92, Colors.bgCard, 0.96)
      .setStrokeStyle(1, Colors.border, 0.9);
    const title = this.add
      .text(width / 2 - 248, y - 24, `${row.title} | ${row.price}`, {
        fontFamily: Fonts.game,
        fontSize: "18px",
        color: "#e2e8f0"
      })
      .setOrigin(0, 0.5);
    const desc = this.add
      .text(width / 2 - 248, y + 6, `${row.description} (${row.status})`, {
        fontFamily: Fonts.ui,
        fontSize: "13px",
        color: "#94a3b8",
        wordWrap: { width: 366 }
      })
      .setOrigin(0, 0.5);
    const buyButton = this.add
      .rectangle(width / 2 + 208, y, 120, 46, row.canBuy ? Colors.btnPrimary : Colors.btnSecondary, 1)
      .setStrokeStyle(1, row.canBuy ? Colors.borderBright : Colors.border, 0.9)
      .setInteractive({ useHandCursor: row.canBuy });
    const buyLabel = this.add
      .text(width / 2 + 208, y, row.canBuy ? "Купить" : "Куплено", {
        fontFamily: Fonts.game,
        fontSize: "18px",
        color: row.canBuy ? "#ecfeff" : "#cbd5e1"
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: row.canBuy });

    const buyAction = (): void => {
      if (!row.canBuy) {
        return;
      }
      void this.purchaseIap(gameState, row.id);
    };
    buyButton.on("pointerdown", buyAction);
    buyLabel.on("pointerdown", buyAction);

    overlay.add([frame, title, desc, buyButton, buyLabel]);
  }

  private async purchaseIap(gameState: GameState, productId: string): Promise<void> {
    const result = await purchaseAndApply(gameState, productId);
    if (!result.ok) {
      this.showFeedback(result.message, "#fca5a5");
      return;
    }

    await flushGameSave(gameState);
    this.showFeedback(result.message, "#86efac");
    this.iapCatalog = await getIapCatalog();
    this.createLayout();
  }

  private resolveCatalogItem(productId: string): IapCatalogItem | undefined {
    return this.iapCatalog.find((item) => item.id === productId);
  }

  private renderSaveChoiceOverlay(gameState: GameState): void {
    this.saveChoiceOverlay?.destroy(true);
    this.saveChoiceOverlay = undefined;

    const hasSave = this.registry.get(SAVE_PROFILE_EXISTS_KEY) as boolean | undefined;
    const picked = this.registry.get(SAVE_PROFILE_PICKED_KEY) as boolean | undefined;
    if (!hasSave || picked) {
      return;
    }

    const width = this.scale.width;
    const height = this.scale.height;
    const overlay = this.add.container(0, 0).setDepth(400);
    const backdrop = UIFactory.createOverlayBackdrop(this, width, height, 0.82);
    const panelWidth = Math.min(width - 24, 540);
    const panelHeight = 250;
    const panel = this.add
      .rectangle(width / 2, height / 2, panelWidth, panelHeight, Colors.bgOverlay, 0.98)
      .setStrokeStyle(2, Colors.cyanLight, 0.92);
    const title = this.add
      .text(width / 2, height / 2 - 92, "Профиль найден", {
        fontFamily: Fonts.game,
        fontSize: "30px",
        color: "#dbeafe"
      })
      .setOrigin(0.5);
    const desc = this.add
      .text(width / 2, height / 2 - 48, "Выберите действие для сохранений:", {
        fontFamily: Fonts.ui,
        fontSize: "18px",
        color: "#bfdbfe"
      })
      .setOrigin(0.5);

    const continueButton = this.createSaveChoiceButton(
      width / 2 - 124,
      height / 2 + 32,
      210,
      "Продолжить",
      Colors.btnPrimary,
      async () => {
        this.registry.set(SAVE_PROFILE_PICKED_KEY, true);
        this.showFeedback("Профиль загружен", "#86efac");
        this.renderSaveChoiceOverlay(gameState);
      }
    );

    const newButton = this.createSaveChoiceButton(
      width / 2 + 124,
      height / 2 + 32,
      210,
      "Новая игра",
      Colors.btnDanger,
      async () => {
        resetProfileState(gameState);
        await clearAllSaves();
        await flushGameSave(gameState);
        this.registry.set(SAVE_PROFILE_PICKED_KEY, true);
        this.registry.set(SAVE_PROFILE_EXISTS_KEY, false);
        this.showFeedback("Профиль сброшен", "#fca5a5");
        this.createLayout();
      }
    );

    overlay.add([
      backdrop,
      panel,
      title,
      desc,
      continueButton.container,
      newButton.container
    ]);
    this.saveChoiceOverlay = overlay;
  }

  private createSaveChoiceButton(
    x: number,
    y: number,
    width: number,
    label: string,
    baseColor: number,
    onClick: () => Promise<void>
  ): { container: Phaser.GameObjects.Container } {
    const background = this.add
      .rectangle(0, 0, width, 56, baseColor, 1)
      .setStrokeStyle(2, Colors.borderLight, 0.86)
      .setInteractive({ useHandCursor: true });
    const text = this.add
      .text(0, 0, label, {
        fontFamily: Fonts.game,
        fontSize: "24px",
        color: "#f8fafc"
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    const container = this.add.container(x, y, [background, text]);

    background.on("pointerover", () => background.setAlpha(0.9));
    background.on("pointerout", () => background.setAlpha(1));
    background.on("pointerdown", () => {
      void onClick();
    });
    text.on("pointerdown", () => {
      void onClick();
    });

    return { container };
  }

  private renderUpgradeList(
    gameState: GameState,
    panel: { container: Phaser.GameObjects.Container; width: number; height: number },
    _root: Phaser.GameObjects.Container,
    isMobile: boolean
  ): void {
    const top = -panel.height / 2 + 46;
    const rowHeight = isMobile ? 34 : 44;
    const maxVisibleRows = Math.floor((panel.height - 66) / rowHeight);
    const upgrades = gameState.configs.meta.upgrades.slice(0, maxVisibleRows);

    upgrades.forEach((upgrade, index) => {
      const y = top + index * rowHeight;
      this.renderUpgradeRow(gameState, panel, upgrade, y, isMobile);
    });

    if (gameState.configs.meta.upgrades.length > maxVisibleRows) {
      const remaining = gameState.configs.meta.upgrades.length - maxVisibleRows;
      const note = this.add
        .text(0, panel.height / 2 - 20, `+ ещё ${remaining} апгрейдов (увеличьте высоту окна)`, {
          fontFamily: Fonts.ui,
          fontSize: "12px",
          color: "#94a3b8"
        })
        .setOrigin(0.5);
      panel.container.add(note);
    }
  }

  private renderUpgradeRow(
    gameState: GameState,
    panel: { container: Phaser.GameObjects.Container; width: number },
    upgrade: MetaUpgradeConfig,
    rowY: number,
    isMobile: boolean
  ): void {
    const currentLevel = getUpgradeLevel(gameState.metaState, upgrade.id);
    const check = canPurchaseUpgrade(gameState.metaState, gameState.configs.meta, upgrade.id);
    const maxed = currentLevel >= upgrade.max_level;

    const label = this.add
      .text(-panel.width / 2 + 14, rowY, `${upgrade.name} [${currentLevel}/${upgrade.max_level}]`, {
        fontFamily: Fonts.game,
        fontSize: isMobile ? "13px" : "15px",
        color: maxed ? "#86efac" : "#e2e8f0"
      })
      .setOrigin(0, 0.5);
    panel.container.add(label);

    const desc = this.add
      .text(-panel.width / 2 + (isMobile ? 190 : 270), rowY, upgrade.description, {
        fontFamily: Fonts.ui,
        fontSize: isMobile ? "10px" : "12px",
        color: "#94a3b8",
        wordWrap: { width: isMobile ? panel.width - 310 : panel.width - 430 }
      })
      .setOrigin(0, 0.5);
    panel.container.add(desc);

    const buttonWidth = isMobile ? 106 : 124;
    const buttonHeight = isMobile ? 24 : 30;
    const buttonX = panel.width / 2 - buttonWidth / 2 - 12;
    const button = this.add
      .rectangle(buttonX, rowY, buttonWidth, buttonHeight, check.ok ? Colors.btnPrimary : Colors.btnSecondary, 1)
      .setStrokeStyle(1, check.ok ? Colors.borderBright : Colors.border, 0.9)
      .setInteractive({ useHandCursor: check.ok });
    const buttonLabel = this.add
      .text(buttonX, rowY, maxed ? "Max" : `Купить ${upgrade.cost}`, {
        fontFamily: Fonts.game,
        fontSize: isMobile ? "10px" : "12px",
        color: check.ok ? "#ecfeff" : "#cbd5e1"
      })
      .setOrigin(0.5);

    if (check.ok) {
      button.on("pointerdown", () => {
        const result = purchaseUpgrade(gameState.metaState, gameState.configs.meta, upgrade.id);
        if (!result.ok) {
          this.showFeedback(result.reason ?? "Не удалось купить апгрейд", "#fca5a5");
          return;
        }

        queueGameSave(gameState);
        this.showFeedback(`Апгрейд куплен: ${upgrade.name}`, "#86efac");
        this.createLayout();
      });
    }

    panel.container.add([button, buttonLabel]);

    if (!check.ok && !maxed) {
      const reason = this.add
        .text(buttonX - buttonWidth / 2 - 6, rowY, check.reason ?? "", {
          fontFamily: Fonts.ui,
          fontSize: "10px",
          color: "#fca5a5",
          align: "right"
        })
        .setOrigin(1, 0.5);
      panel.container.add(reason);
    }

  }

  private renderDailyTasks(
    gameState: GameState,
    panel: { container: Phaser.GameObjects.Container; width: number; height: number },
    _root: Phaser.GameObjects.Container,
    isMobile: boolean
  ): void {
    const tasks = gameState.metaState.daily.tasks;
    const top = -panel.height / 2 + 46;
    const rowHeight = isMobile ? 74 : 94;

    const dateLabel = this.add
      .text(
        -panel.width / 2 + 14,
        -panel.height / 2 + 24,
        `Локальная дата: ${gameState.metaState.daily.dateKey || "-"}`,
        {
          fontFamily: Fonts.ui,
          fontSize: "12px",
          color: "#93c5fd"
        }
      )
      .setOrigin(0, 0.5);
    panel.container.add(dateLabel);

    tasks.forEach((task, index) => {
      const y = top + index * rowHeight;
      this.renderDailyTaskRow(gameState, panel, task, y, isMobile);
    });
  }

  private renderDailyTaskRow(
    gameState: GameState,
    panel: { container: Phaser.GameObjects.Container; width: number },
    task: DailyTaskState,
    rowY: number,
    isMobile: boolean
  ): void {
    const progress = `${task.progress}/${task.target}`;
    const completed = task.progress >= task.target;
    const claimed = task.claimed;

    const frame = this.add
      .rectangle(0, rowY + (isMobile ? 8 : 10), panel.width - 22, isMobile ? 66 : 84, Colors.bgCard, 0.95)
      .setStrokeStyle(1, completed ? Colors.green : Colors.border, 0.9);
    panel.container.add(frame);

    const title = this.add
      .text(-panel.width / 2 + 14, rowY - (isMobile ? 8 : 12), task.name, {
        fontFamily: Fonts.game,
        fontSize: isMobile ? "13px" : "15px",
        color: "#e2e8f0"
      })
      .setOrigin(0, 0.5);
    const desc = this.add
      .text(-panel.width / 2 + 14, rowY + (isMobile ? 10 : 12), `${task.description} | ${progress}`, {
        fontFamily: Fonts.ui,
        fontSize: isMobile ? "11px" : "12px",
        color: completed ? "#86efac" : "#94a3b8",
        wordWrap: { width: panel.width - 190 }
      })
      .setOrigin(0, 0.5);
    panel.container.add([title, desc]);

    const buttonText = claimed ? "Получено" : completed ? `Забрать +${task.rewardMetaCredits}` : "В процессе";
    const claimEnabled = completed && !claimed;
    const buttonWidth = isMobile ? 114 : 128;
    const buttonHeight = isMobile ? 28 : 34;
    const buttonX = panel.width / 2 - buttonWidth / 2 - 12;

    const button = this.add
      .rectangle(
        buttonX,
        rowY + (isMobile ? 1 : 0),
        buttonWidth,
        buttonHeight,
        claimEnabled ? Colors.btnPrimary : Colors.btnSecondary,
        1
      )
      .setStrokeStyle(1, claimEnabled ? Colors.borderBright : Colors.border, 0.9)
      .setInteractive({ useHandCursor: claimEnabled });
    const label = this.add
      .text(buttonX, rowY + (isMobile ? 1 : 0), buttonText, {
        fontFamily: Fonts.game,
        fontSize: isMobile ? "11px" : "12px",
        color: claimEnabled ? "#ecfeff" : "#cbd5e1"
      })
      .setOrigin(0.5);

    if (claimEnabled) {
      button.on("pointerdown", () => {
        const result = claimDailyTask(gameState.metaState, task.id);
        if (!result.ok) {
          this.showFeedback(result.reason ?? "Нельзя получить награду", "#fca5a5");
          return;
        }

        queueGameSave(gameState);
        this.showFeedback(`Получено +${result.reward} Meta Credits`, "#86efac");
        this.createLayout();
      });
    }

    panel.container.add([button, label]);
  }

  private showFeedback(message: string, color = "#fde68a"): void {
    if (!this.feedbackLabel) {
      return;
    }

    this.feedbackLabel.setText(message).setColor(color).setAlpha(1);
    this.tweens.killTweensOf(this.feedbackLabel);
    this.tweens.add({
      targets: this.feedbackLabel,
      alpha: 0,
      duration: 680,
      delay: 600,
      ease: "Quad.easeOut"
    });
  }

  private onResize(): void {
    try {
      this.createLayout();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown MenuScene resize error";
      console.error("[MenuScene] resize failed", error);
      this.add
        .text(24, 24, `MenuScene resize error:\n${message}`, {
          fontFamily: Fonts.ui,
          fontSize: "16px",
          color: "#fecaca"
        })
        .setDepth(999);
    }
  }
}
