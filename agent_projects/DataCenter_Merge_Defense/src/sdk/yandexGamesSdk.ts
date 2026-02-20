import Phaser from "phaser";

export const YANDEX_SDK_STATE_KEY = "yandexSdkState";

export type PauseReason = "platform" | "blur" | "focus" | "visibility";

type PauseListener = (paused: boolean, reason: PauseReason) => void;

interface YandexLoadingApi {
  ready?: () => void;
}

interface YandexFeatures {
  LoadingAPI?: YandexLoadingApi;
}

interface YandexGamesSdkInstance {
  features?: YandexFeatures;
  adv?: YandexAdvApi;
  leaderboards?: YandexLeaderboardsApi;
  on?: (event: "game_api_pause" | "game_api_resume", callback: () => void) => void;
  off?: (event: "game_api_pause" | "game_api_resume", callback: () => void) => void;
  getPlayer?: (options?: { scopes?: boolean }) => Promise<YandexPlayer>;
  getPayments?: () => Promise<YandexPayments>;
}

interface YandexPlayer {
  getData?: (keys?: string[]) => Promise<Record<string, unknown>>;
  setData?: (data: Record<string, unknown>, flush?: boolean) => Promise<void>;
}

interface YandexFullscreenCallbacks {
  onClose?: (wasShown: boolean) => void;
  onError?: (error: unknown) => void;
}

interface YandexRewardedCallbacks {
  onOpen?: () => void;
  onRewarded?: () => void;
  onClose?: () => void;
  onError?: (error: unknown) => void;
}

interface YandexAdvApi {
  showFullscreenAdv?: (callbacks?: YandexFullscreenCallbacks) => void;
  showRewardedVideo?: (callbacks?: YandexRewardedCallbacks) => void;
  showBannerAdv?: () => void;
  hideBannerAdv?: () => void;
}

interface YandexPurchaseProduct {
  id: string;
  title?: string;
  description?: string;
  imageURI?: string;
  price?: string;
  priceValue?: string;
  priceCurrencyCode?: string;
}

interface YandexPurchaseItem {
  productID: string;
  purchaseToken?: string;
  developerPayload?: string;
}

interface YandexPayments {
  getCatalog?: () => Promise<YandexPurchaseProduct[]>;
  getPurchases?: () => Promise<YandexPurchaseItem[]>;
  purchase?: (productId: string, developerPayload?: string) => Promise<YandexPurchaseItem>;
  consumePurchase?: (purchaseToken: string) => Promise<void>;
}

interface YandexLeaderboardUser {
  uniqueID?: string;
  publicName?: string;
  firstName?: string;
  lastName?: string;
}

interface YandexLeaderboardEntry {
  score: number;
  rank: number;
  extraData?: string;
  player?: YandexLeaderboardUser;
}

interface YandexLeaderboardEntriesResponse {
  userRank?: number;
  entries?: YandexLeaderboardEntry[];
}

interface YandexLeaderboardsApi {
  setScore?: (name: string, score: number, extraData?: string) => Promise<void>;
  getEntries?: (
    name: string,
    options?: {
      includeUser?: boolean;
      quantityTop?: number;
      quantityAround?: number;
    }
  ) => Promise<YandexLeaderboardEntriesResponse>;
  getPlayerEntry?: (name: string) => Promise<YandexLeaderboardEntry>;
}

interface YandexGamesGlobal {
  init: () => Promise<YandexGamesSdkInstance>;
}

declare global {
  interface Window {
    YaGames?: YandexGamesGlobal;
  }
}

export interface YandexSdkState {
  initialized: boolean;
  mode: "yandex" | "guest";
  readyCalled: boolean;
}

export interface InterstitialResult {
  shown: boolean;
}

export interface RewardedResult {
  shown: boolean;
  rewarded: boolean;
}

export interface PaymentsCatalogItem {
  id: string;
  title: string;
  description: string;
  price: string;
  priceValue?: string;
  priceCurrencyCode?: string;
}

export interface PaymentsPurchaseItem {
  productID: string;
  purchaseToken?: string;
  developerPayload?: string;
}

export interface LeaderboardEntry {
  score: number;
  rank: number;
  playerName: string;
  extraData?: string;
}

class YandexGamesSdkService {
  private sdk?: YandexGamesSdkInstance;
  private player?: YandexPlayer;
  private playerPromise?: Promise<YandexPlayer | undefined>;
  private payments?: YandexPayments;
  private paymentsPromise?: Promise<YandexPayments | undefined>;
  private initPromise?: Promise<YandexSdkState>;
  private state: YandexSdkState = {
    initialized: false,
    mode: "guest",
    readyCalled: false
  };
  private readonly pauseListeners = new Set<PauseListener>();
  private visibilityBound = false;

  init(): Promise<YandexSdkState> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.bindBrowserPauseSignals();

    this.initPromise = (async () => {
      const yaGames = window.YaGames;
      if (!yaGames || typeof yaGames.init !== "function") {
        this.state = { initialized: true, mode: "guest", readyCalled: false };
        return this.state;
      }

      try {
        this.sdk = await this.withTimeout(yaGames.init(), 4000);
        this.bindPlatformPauseSignals();
        this.state = { initialized: true, mode: "yandex", readyCalled: false };
      } catch (error) {
        console.warn("[YandexSDK] init failed, fallback to guest mode", error);
        this.state = { initialized: true, mode: "guest", readyCalled: false };
      }

      return this.state;
    })();

    return this.initPromise;
  }

  getState(): YandexSdkState {
    return { ...this.state };
  }

  markReady(): void {
    if (this.state.readyCalled) {
      return;
    }

    this.state.readyCalled = true;
    this.sdk?.features?.LoadingAPI?.ready?.();
  }

  subscribePause(listener: PauseListener): () => void {
    this.pauseListeners.add(listener);
    return () => {
      this.pauseListeners.delete(listener);
    };
  }

  connectGameSound(game: Phaser.Game): () => void {
    const unsubscribe = this.subscribePause((paused) => {
      game.sound.mute = paused;
    });

    return () => {
      unsubscribe();
    };
  }

  async getPlayerData<T>(key: string): Promise<T | undefined> {
    const player = await this.getPlayer();
    const raw = player?.getData ? await this.withTimeout(player.getData([key]), 2500) : undefined;
    if (!raw || !(key in raw)) {
      return undefined;
    }

    return raw[key] as T;
  }

  async setPlayerData(key: string, value: unknown, flush = false): Promise<boolean> {
    const player = await this.getPlayer();
    if (!player?.setData) {
      return false;
    }

    try {
      await this.withTimeout(player.setData({ [key]: value }, flush), 2500);
      return true;
    } catch (error) {
      console.warn("[YandexSDK] setPlayerData failed", error);
      return false;
    }
  }

  showInterstitial(): Promise<InterstitialResult> {
    if (!this.sdk?.adv?.showFullscreenAdv) {
      return Promise.resolve({ shown: false });
    }

    return new Promise((resolve) => {
      try {
        this.sdk?.adv?.showFullscreenAdv?.({
          onClose: (wasShown) => resolve({ shown: wasShown }),
          onError: () => resolve({ shown: false })
        });
      } catch (error) {
        console.warn("[YandexSDK] showInterstitial failed", error);
        resolve({ shown: false });
      }
    });
  }

  showRewarded(): Promise<RewardedResult> {
    if (!this.sdk?.adv?.showRewardedVideo) {
      return Promise.resolve({ shown: false, rewarded: false });
    }

    return new Promise((resolve) => {
      let rewarded = false;
      try {
        this.sdk?.adv?.showRewardedVideo?.({
          onRewarded: () => {
            rewarded = true;
          },
          onClose: () => {
            resolve({ shown: true, rewarded });
          },
          onError: () => {
            resolve({ shown: false, rewarded: false });
          }
        });
      } catch (error) {
        console.warn("[YandexSDK] showRewarded failed", error);
        resolve({ shown: false, rewarded: false });
      }
    });
  }

  showStickyBanner(visible: boolean): boolean {
    if (!this.sdk?.adv) {
      return false;
    }

    try {
      if (visible) {
        this.sdk.adv.showBannerAdv?.();
      } else {
        this.sdk.adv.hideBannerAdv?.();
      }
      return true;
    } catch (error) {
      console.warn("[YandexSDK] sticky banner failed", error);
      return false;
    }
  }

  async getPaymentsCatalog(): Promise<PaymentsCatalogItem[]> {
    const payments = await this.getPayments();
    if (!payments?.getCatalog) {
      return [];
    }

    try {
      const catalog = await payments.getCatalog();
      return (catalog ?? []).map((item) => ({
        id: item.id,
        title: item.title ?? item.id,
        description: item.description ?? "",
        price: item.price ?? "-",
        priceValue: item.priceValue,
        priceCurrencyCode: item.priceCurrencyCode
      }));
    } catch (error) {
      console.warn("[YandexSDK] getPaymentsCatalog failed", error);
      return [];
    }
  }

  async getPurchases(): Promise<PaymentsPurchaseItem[]> {
    const payments = await this.getPayments();
    if (!payments?.getPurchases) {
      return [];
    }

    try {
      const purchases = await payments.getPurchases();
      return (purchases ?? []).map((item) => ({
        productID: item.productID,
        purchaseToken: item.purchaseToken,
        developerPayload: item.developerPayload
      }));
    } catch (error) {
      console.warn("[YandexSDK] getPurchases failed", error);
      return [];
    }
  }

  async purchaseProduct(productId: string, developerPayload?: string): Promise<PaymentsPurchaseItem | undefined> {
    const payments = await this.getPayments();
    if (!payments?.purchase) {
      return undefined;
    }

    try {
      const purchase = await payments.purchase(productId, developerPayload);
      return {
        productID: purchase.productID,
        purchaseToken: purchase.purchaseToken,
        developerPayload: purchase.developerPayload
      };
    } catch (error) {
      console.warn("[YandexSDK] purchaseProduct failed", error);
      return undefined;
    }
  }

  async consumePurchase(purchaseToken: string): Promise<boolean> {
    const payments = await this.getPayments();
    if (!payments?.consumePurchase) {
      return false;
    }

    try {
      await payments.consumePurchase(purchaseToken);
      return true;
    } catch (error) {
      console.warn("[YandexSDK] consumePurchase failed", error);
      return false;
    }
  }

  async setLeaderboardScore(name: string, score: number, extraData?: string): Promise<boolean> {
    if (this.state.mode !== "yandex" || !this.sdk?.leaderboards?.setScore) {
      return false;
    }

    try {
      await this.sdk.leaderboards.setScore(name, score, extraData);
      return true;
    } catch (error) {
      console.warn("[YandexSDK] setLeaderboardScore failed", error);
      return false;
    }
  }

  async getLeaderboardTop(
    name: string,
    quantityTop = 10
  ): Promise<{ entries: LeaderboardEntry[]; userRank?: number }> {
    if (this.state.mode !== "yandex" || !this.sdk?.leaderboards?.getEntries) {
      return { entries: [] };
    }

    try {
      const response = await this.sdk.leaderboards.getEntries(name, {
        includeUser: true,
        quantityTop,
        quantityAround: 0
      });
      const entries = (response.entries ?? []).map((entry) => ({
        score: entry.score,
        rank: entry.rank,
        playerName:
          entry.player?.publicName ||
          entry.player?.firstName ||
          entry.player?.uniqueID ||
          "Guest",
        extraData: entry.extraData
      }));
      return { entries, userRank: response.userRank };
    } catch (error) {
      console.warn("[YandexSDK] getLeaderboardTop failed", error);
      return { entries: [] };
    }
  }

  async getLeaderboardPlayerEntry(name: string): Promise<LeaderboardEntry | undefined> {
    if (this.state.mode !== "yandex" || !this.sdk?.leaderboards?.getPlayerEntry) {
      return undefined;
    }

    try {
      const entry = await this.sdk.leaderboards.getPlayerEntry(name);
      return {
        score: entry.score,
        rank: entry.rank,
        playerName:
          entry.player?.publicName || entry.player?.firstName || entry.player?.uniqueID || "You",
        extraData: entry.extraData
      };
    } catch (error) {
      console.warn("[YandexSDK] getLeaderboardPlayerEntry failed", error);
      return undefined;
    }
  }

  private emitPause(paused: boolean, reason: PauseReason): void {
    this.pauseListeners.forEach((listener) => listener(paused, reason));
  }

  private bindPlatformPauseSignals(): void {
    if (!this.sdk?.on) {
      return;
    }

    this.sdk.on("game_api_pause", () => this.emitPause(true, "platform"));
    this.sdk.on("game_api_resume", () => this.emitPause(false, "platform"));
  }

  private async getPlayer(): Promise<YandexPlayer | undefined> {
    if (this.player) {
      return this.player;
    }
    if (this.playerPromise) {
      return this.playerPromise;
    }

    this.playerPromise = (async () => {
      if (this.state.mode !== "yandex") {
        return undefined;
      }

      try {
        const playerPromise = this.sdk?.getPlayer?.({ scopes: false });
        const player = playerPromise ? await this.withTimeout(playerPromise, 2500) : undefined;
        this.player = player;
        return player;
      } catch (error) {
        console.warn("[YandexSDK] getPlayer failed", error);
        return undefined;
      }
    })();

    return this.playerPromise;
  }

  private async getPayments(): Promise<YandexPayments | undefined> {
    if (this.payments) {
      return this.payments;
    }
    if (this.paymentsPromise) {
      return this.paymentsPromise;
    }

    this.paymentsPromise = (async () => {
      if (this.state.mode !== "yandex") {
        return undefined;
      }

      try {
        const paymentsPromise = this.sdk?.getPayments?.();
        const payments = paymentsPromise
          ? await this.withTimeout(paymentsPromise, 2500)
          : undefined;
        this.payments = payments;
        return payments;
      } catch (error) {
        console.warn("[YandexSDK] getPayments failed", error);
        return undefined;
      }
    })();

    return this.paymentsPromise;
  }

  private bindBrowserPauseSignals(): void {
    if (this.visibilityBound) {
      return;
    }

    this.visibilityBound = true;

    window.addEventListener("blur", () => {
      this.emitPause(true, "blur");
    });

    window.addEventListener("focus", () => {
      this.emitPause(false, "focus");
    });

    document.addEventListener("visibilitychange", () => {
      const paused = document.hidden;
      this.emitPause(paused, "visibility");
    });
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeoutHandle: number | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = window.setTimeout(() => {
        reject(new Error("Yandex SDK init timeout"));
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutHandle !== undefined) {
        window.clearTimeout(timeoutHandle);
      }
    }
  }
}

export const yandexGamesSdk = new YandexGamesSdkService();
