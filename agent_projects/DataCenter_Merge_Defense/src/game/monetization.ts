import { GameState } from "./types";
import { yandexGamesSdk } from "../sdk/yandexGamesSdk";

const INTERSTITIAL_RUN_COOLDOWN = 2;

export function shouldShowInterstitialAfterRun(gameState: GameState): boolean {
  if (gameState.settingsState.noAdsPurchased) {
    return false;
  }

  const currentRuns = gameState.metaState.totalRuns;
  const lastShown = gameState.settingsState.lastInterstitialRunShown;
  return currentRuns - lastShown >= INTERSTITIAL_RUN_COOLDOWN;
}

export async function tryShowInterstitialAfterRun(gameState: GameState): Promise<boolean> {
  if (!shouldShowInterstitialAfterRun(gameState)) {
    return false;
  }

  const result = await yandexGamesSdk.showInterstitial();
  if (result.shown) {
    gameState.settingsState.lastInterstitialRunShown = gameState.metaState.totalRuns;
  }

  return result.shown;
}

export async function tryShowRewarded(): Promise<{ shown: boolean; rewarded: boolean }> {
  return yandexGamesSdk.showRewarded();
}

export function showStickyInHub(gameState: GameState): void {
  const state = yandexGamesSdk.getState();
  if (state.mode !== "yandex") {
    return;
  }

  if (gameState.settingsState.noAdsPurchased) {
    yandexGamesSdk.showStickyBanner(false);
    return;
  }

  yandexGamesSdk.showStickyBanner(true);
}

export function hideStickyInRun(): void {
  yandexGamesSdk.showStickyBanner(false);
}
