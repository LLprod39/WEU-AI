declare global {
  interface Window {
    YaGames?: {
      init: () => Promise<any>;
    };
  }
}

export type InitYsdkResult = { ok: true; sdk: any } | { ok: false };

/**
 * Инициализирует Yandex Games SDK. Никогда не бросает исключений.
 * При недоступности или ошибке возвращает { ok: false }.
 */
export async function initYsdk(): Promise<InitYsdkResult> {
  try {
    if (typeof window === 'undefined' || !window.YaGames) {
      return { ok: false };
    }
    const sdk = await window.YaGames.init();
    if (sdk) {
      return { ok: true, sdk };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}
