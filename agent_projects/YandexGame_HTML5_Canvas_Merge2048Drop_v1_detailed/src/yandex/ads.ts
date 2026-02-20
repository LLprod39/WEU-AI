import { getYsdk } from "./state";

let isShowing = false;
let lastInterstitialAt = 0;
let pendingRewarded = false;

export type AdHooks = {
  onAdOpen?: () => void;
  onAdClose?: () => void;
};

let hooks: AdHooks = {};

export function setHooks(h: AdHooks): void {
  hooks = { ...hooks, ...h };
}

export function showInterstitial(_reason: string): Promise<{ ok: boolean }> {
  try {
    const ysdk = getYsdk();
    if (ysdk == null || isShowing) {
      return Promise.resolve({ ok: false });
    }
    isShowing = true;
    return new Promise((resolve) => {
      try {
        ysdk.adv?.showFullscreenAdv?.({
          onOpen: () => {
            hooks.onAdOpen?.();
          },
          onClose: () => {
            isShowing = false;
            hooks.onAdClose?.();
            resolve({ ok: true });
          },
          onError: () => {
            isShowing = false;
            resolve({ ok: false });
          },
        });
      } catch {
        isShowing = false;
        resolve({ ok: false });
      }
    });
  } catch {
    return Promise.resolve({ ok: false });
  }
}

export function getIsShowing(): boolean {
  return isShowing;
}

export function getLastInterstitialAt(): number {
  return lastInterstitialAt;
}

export function showRewarded(_reason: string): Promise<{ rewarded: boolean }> {
  try {
    const ysdk = getYsdk();
    if (ysdk == null || pendingRewarded) {
      return Promise.resolve({ rewarded: false });
    }
    pendingRewarded = true;
    let rewarded = false;
    return new Promise((resolve) => {
      try {
        ysdk.adv?.showRewardedVideo?.({
          onOpen: () => {
            hooks.onAdOpen?.();
          },
          onRewarded: () => {
            rewarded = true;
          },
          onClose: () => {
            pendingRewarded = false;
            hooks.onAdClose?.();
            resolve({ rewarded });
          },
          onError: () => {
            pendingRewarded = false;
            resolve({ rewarded: false });
          },
        });
      } catch {
        pendingRewarded = false;
        resolve({ rewarded: false });
      }
    });
  } catch {
    return Promise.resolve({ rewarded: false });
  }
}

export function getPendingRewarded(): boolean {
  return pendingRewarded;
}

/** Игнорировать UI-ввод: реклама показывается или ожидается результат (rewarded). */
export function isAdBlockingInput(): boolean {
  return isShowing || pendingRewarded;
}

export function setShowing(value: boolean): void {
  isShowing = value;
  if (value) hooks.onAdOpen?.();
  else hooks.onAdClose?.();
}

export function setLastInterstitialAt(value: number): void {
  lastInterstitialAt = value;
}

export function setPendingRewarded(value: boolean): void {
  pendingRewarded = value;
}

/**
 * Можно ли показать межстраничную рекламу: не показываем сейчас и прошло не менее minSeconds с последнего показа.
 */
export function canShowInterstitial(minSeconds: number): boolean {
  if (isShowing || pendingRewarded) return false;
  const now = Date.now();
  return now - lastInterstitialAt >= minSeconds * 1000;
}
