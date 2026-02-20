import { ysdk } from './state';

let isShowing = false;
let lastInterstitialAt = 0;

export type ShowInterstitialResult = { ok: true } | { ok: false; reason: string };

export type ShowRewardedResult =
  | { ok: true; rewarded: boolean }
  | { ok: false };

export interface AdHooks {
  onAdOpen?: () => void;
  onAdClose?: () => void;
}

let onAdOpenHook: () => void = () => {};
let onAdCloseHook: () => void = () => {};

/** Установить коллбеки для паузы игры и отключения звука во время показа рекламы. Никогда не бросает. */
export function setHooks(hooks: AdHooks): void {
  try {
    onAdOpenHook = hooks?.onAdOpen ?? (() => {});
    onAdCloseHook = hooks?.onAdClose ?? (() => {});
  } catch {
    // ignore
  }
}

/**
 * Показать полноэкранную рекламу. При показе вызываются onAdOpen/onAdClose (пауза, звук).
 * Если передан minSeconds, показ не выполняется, если с последнего показа прошло меньше minSeconds секунд.
 * @returns {ok: true} при успешном закрытии, {ok: false, reason} если показ невозможен или ошибка.
 */
export function showInterstitial(_reason: string, minSeconds?: number): Promise<ShowInterstitialResult> {
  try {
    if (ysdk == null || ysdk.adv == null) {
      return Promise.resolve({ ok: false, reason: 'sdk_unavailable' });
    }
    if (isShowing) {
      return Promise.resolve({ ok: false, reason: 'already_showing' });
    }
    if (minSeconds != null && minSeconds > 0) {
      const elapsed = (Date.now() - lastInterstitialAt) / 1000;
      if (elapsed < minSeconds) {
        return Promise.resolve({ ok: false, reason: 'too_soon' });
      }
    }

    isShowing = true;

    return new Promise<ShowInterstitialResult>((resolve) => {
      const onOpen = (): void => {
        try { onAdOpenHook(); } catch { /* ignore */ }
      };
      const onClose = (wasShown?: boolean): void => {
        isShowing = false;
        try { onAdCloseHook(); } catch { /* ignore */ }
        if (wasShown) lastInterstitialAt = Date.now();
        resolve({ ok: true });
      };
      const onError = (_err: unknown): void => {
        isShowing = false;
        try { onAdCloseHook(); } catch { /* ignore */ }
        resolve({ ok: false, reason: 'ad_error' });
      };

      try {
        ysdk.adv.showFullscreenAdv({
          callbacks: { onOpen, onClose, onError },
        });
      } catch {
        isShowing = false;
        try { onAdCloseHook(); } catch { /* ignore */ }
        resolve({ ok: false, reason: 'ad_error' });
      }
    });
  } catch {
    return Promise.resolve({ ok: false, reason: 'ad_error' });
  }
}

/**
 * Показать рекламу за награду. При просмотре до конца вызывается onRewarded, затем onClose.
 * @returns {ok: true, rewarded: true} если пользователь досмотрел (onRewarded и onClose), иначе {ok: false}.
 */
export function showRewarded(_reason: string): Promise<ShowRewardedResult> {
  try {
    if (ysdk == null || ysdk.adv == null) {
      return Promise.resolve({ ok: false });
    }
    if (isShowing) {
      return Promise.resolve({ ok: false });
    }

    isShowing = true;
    let rewarded = false;

    return new Promise<ShowRewardedResult>((resolve) => {
      const onRewarded = (): void => {
        rewarded = true;
      };
      const onClose = (): void => {
        isShowing = false;
        try { onAdCloseHook(); } catch { /* ignore */ }
        resolve({ ok: true, rewarded });
      };
      const onError = (): void => {
        isShowing = false;
        try { onAdCloseHook(); } catch { /* ignore */ }
        resolve({ ok: false });
      };

      try {
        ysdk.adv.showRewardedVideo({
          callbacks: { onRewarded, onClose, onError },
        });
      } catch {
        isShowing = false;
        try { onAdCloseHook(); } catch { /* ignore */ }
        resolve({ ok: false });
      }
    });
  } catch {
    return Promise.resolve({ ok: false });
  }
}

/**
 * Общий guard: не показывать, если ysdk недоступен или уже показывается реклама.
 * Дополнительно проверяет, что с последнего показа прошло не менее minSeconds секунд.
 */
export function canShowInterstitial(minSeconds: number): boolean {
  try {
    if (ysdk == null || isShowing === true) return false;
    const elapsed = (Date.now() - lastInterstitialAt) / 1000;
    return elapsed >= minSeconds;
  } catch {
    return false;
  }
}

export function setInterstitialShowing(value: boolean): void {
  try {
    isShowing = value;
  } catch {
    // ignore
  }
}

export function markInterstitialShown(): void {
  try {
    lastInterstitialAt = Date.now();
  } catch {
    // ignore
  }
}
