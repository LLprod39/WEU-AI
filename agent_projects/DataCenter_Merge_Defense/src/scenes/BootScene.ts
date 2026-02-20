import Phaser from "phaser";
import { validateGameConfigs } from "../game/configValidation";
import { createInitialGameState, GAME_STATE_KEY } from "../game/gameState";
import { TextureFactory } from "../rendering";
import { loadPersistedProfile, SAVE_PROFILE_EXISTS_KEY, SAVE_PROFILE_PICKED_KEY } from "../game/saveSystem";
import { GameConfigs } from "../game/types";
import { yandexGamesSdk, YANDEX_SDK_STATE_KEY } from "../sdk/yandexGamesSdk";
import { Fonts } from "../rendering/CyberTheme";

const CONFIG_KEYS = {
  turrets: "config_turrets",
  enemies: "config_enemies",
  cards: "config_cards",
  waves: "config_waves",
  meta: "config_meta"
} as const;

const STATIC_ASSETS = {
  menuBackdrop: "asset_menu_backdrop",
  runBackdrop: "asset_run_backdrop",
  turretSingleSheet: "asset_turret_single_sheet",
  turretSplashSheet: "asset_turret_splash_sheet",
  turretSlowSheet: "asset_turret_slow_sheet",
  enemyBasicSheet: "asset_enemy_basic_sheet",
  enemyFastSheet: "asset_enemy_fast_sheet",
  enemyTankSheet: "asset_enemy_tank_sheet",
  vfxImpactSheet: "asset_vfx_impact_sheet",
  vfxExplosionSheet: "asset_vfx_explosion_sheet",
  ambientLoop: "asset_ambient_loop"
} as const;

export class BootScene extends Phaser.Scene {
  private bootCompleted = false;

  constructor() {
    super("BootScene");
  }

  preload(): void {
    this.load.json(CONFIG_KEYS.turrets, "/configs/turrets.json");
    this.load.json(CONFIG_KEYS.enemies, "/configs/enemies.json");
    this.load.json(CONFIG_KEYS.cards, "/configs/cards.json");
    this.load.json(CONFIG_KEYS.waves, "/configs/waves.json");
    this.load.json(CONFIG_KEYS.meta, "/configs/meta.json");
    this.load.image(STATIC_ASSETS.menuBackdrop, "/assets/images/bg_menu_datacenter.png");
    this.load.image(STATIC_ASSETS.runBackdrop, "/assets/images/bg_run_datacenter.png");
    this.load.spritesheet(STATIC_ASSETS.turretSingleSheet, "/assets/images/turret_single_target_sheet.png", {
      frameWidth: 256,
      frameHeight: 256
    });
    this.load.spritesheet(STATIC_ASSETS.turretSplashSheet, "/assets/images/turret_splash_sheet.png", {
      frameWidth: 256,
      frameHeight: 256
    });
    this.load.spritesheet(STATIC_ASSETS.turretSlowSheet, "/assets/images/turret_slow_sheet.png", {
      frameWidth: 256,
      frameHeight: 256
    });
    this.load.spritesheet(STATIC_ASSETS.enemyBasicSheet, "/assets/images/enemy_basic_sheet.png", {
      frameWidth: 256,
      frameHeight: 256
    });
    this.load.spritesheet(STATIC_ASSETS.enemyFastSheet, "/assets/images/enemy_fast_sheet.png", {
      frameWidth: 256,
      frameHeight: 256
    });
    this.load.spritesheet(STATIC_ASSETS.enemyTankSheet, "/assets/images/enemy_tank_sheet.png", {
      frameWidth: 256,
      frameHeight: 256
    });
    this.load.spritesheet(STATIC_ASSETS.vfxImpactSheet, "/assets/images/vfx_impact_ring_sheet.png", {
      frameWidth: 256,
      frameHeight: 256
    });
    this.load.spritesheet(STATIC_ASSETS.vfxExplosionSheet, "/assets/images/vfx_explosion_sheet.png", {
      frameWidth: 256,
      frameHeight: 256
    });
    this.load.audio(STATIC_ASSETS.ambientLoop, "/assets/audio/busy_cyberworld.ogg");
  }

  create(): void {
    this.showBootStatus("Инициализация...");
    window.setTimeout(() => {
      if (!this.bootCompleted) {
        this.forceBootFallback("Таймаут инициализации. Запуск в offline-режиме.");
      }
    }, 6000);
    void this.createAsync();
  }

  private async createAsync(): Promise<void> {
    try {
      const configs = this.readConfigs();
      validateGameConfigs(configs);
      TextureFactory.generateAll(this);
      this.showBootStatus("SDK...");
      const sdkState = await this.safeSdkInit();
      this.showBootStatus("Профиль...");
      const loadedProfile = await this.safeLoadProfile();

      const gameState = createInitialGameState(configs, {
        metaState: loadedProfile.metaState,
        settingsState: loadedProfile.settingsState
      });
      this.registry.set(GAME_STATE_KEY, gameState);
      this.registry.set(YANDEX_SDK_STATE_KEY, sdkState);
      this.registry.set(SAVE_PROFILE_EXISTS_KEY, loadedProfile.hasSave);
      this.registry.set(SAVE_PROFILE_PICKED_KEY, !loadedProfile.hasSave);

      this.bootCompleted = true;
      this.scene.start("MenuScene");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Config validation failed: unknown error";

      this.showFatalConfigError(message);
      console.error("[BootScene] Config initialization failed", error);
    }
  }

  private async safeSdkInit() {
    try {
      return await yandexGamesSdk.init();
    } catch (error) {
      console.warn("[BootScene] safeSdkInit fallback", error);
      return yandexGamesSdk.getState();
    }
  }

  private async safeLoadProfile() {
    try {
      return await Promise.race([
        loadPersistedProfile(),
        new Promise<Awaited<ReturnType<typeof loadPersistedProfile>>>((resolve) => {
          window.setTimeout(() => resolve({ hasSave: false, source: "none" }), 2500);
        })
      ]);
    } catch (error) {
      console.warn("[BootScene] safeLoadProfile fallback", error);
      return { hasSave: false, source: "none" } as Awaited<ReturnType<typeof loadPersistedProfile>>;
    }
  }

  private forceBootFallback(statusMessage: string): void {
    try {
      const configs = this.readConfigs();
      validateGameConfigs(configs);
      TextureFactory.generateAll(this);
      const gameState = createInitialGameState(configs);
      this.registry.set(GAME_STATE_KEY, gameState);
      this.registry.set(YANDEX_SDK_STATE_KEY, yandexGamesSdk.getState());
      this.registry.set(SAVE_PROFILE_EXISTS_KEY, false);
      this.registry.set(SAVE_PROFILE_PICKED_KEY, true);
      this.bootCompleted = true;
      this.scene.start("MenuScene");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Boot fallback failed";
      this.showFatalConfigError(`${statusMessage}\n${message}`);
      console.error("[BootScene] force fallback failed", error);
    }
  }

  private showBootStatus(message: string): void {
    this.cameras.main.setBackgroundColor("#050816");
    this.children.removeAll(true);
    if (this.textures.exists(STATIC_ASSETS.menuBackdrop)) {
      this.add
        .image(this.scale.width / 2, this.scale.height / 2, STATIC_ASSETS.menuBackdrop)
        .setDisplaySize(this.scale.width, this.scale.height)
        .setAlpha(0.22);
      this.add
        .rectangle(this.scale.width / 2, this.scale.height / 2, this.scale.width, this.scale.height, 0x020617, 0.68);
    }
    this.add.text(20, 20, "DataCenter Merge Defense", {
      fontFamily: Fonts.game,
      fontSize: "32px",
      color: "#e2e8f0",
      shadow: { color: "#0284c7", blur: 14, fill: true }
    });
    this.add.text(20, 60, message, {
      fontFamily: Fonts.ui,
      fontSize: "22px",
      color: "#bae6fd"
    });
  }

  private readConfigs(): GameConfigs {
    return {
      turrets: this.cache.json.get(CONFIG_KEYS.turrets) as GameConfigs["turrets"],
      enemies: this.cache.json.get(CONFIG_KEYS.enemies) as GameConfigs["enemies"],
      cards: this.cache.json.get(CONFIG_KEYS.cards) as GameConfigs["cards"],
      waves: this.cache.json.get(CONFIG_KEYS.waves) as GameConfigs["waves"],
      meta: this.cache.json.get(CONFIG_KEYS.meta) as GameConfigs["meta"]
    };
  }

  private showFatalConfigError(message: string): void {
    this.cameras.main.setBackgroundColor("#2b1111");
    const titleStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: Fonts.game,
      fontSize: "32px",
      color: "#fecaca"
    };
    const textStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: Fonts.ui,
      fontSize: "20px",
      color: "#fecaca",
      wordWrap: { width: this.scale.width - 40 }
    };

    this.add.text(20, 20, "Ошибка загрузки конфигов", titleStyle);
    this.add.text(20, 72, message, textStyle);
  }
}
