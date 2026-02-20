declare global {
  interface Window {
    YaGames?: {
      init: () => Promise<unknown>;
    };
  }
}

export async function initYsdk(): Promise<any | null> {
  try {
    if (typeof window === "undefined" || !window.YaGames) {
      return null;
    }
    return await window.YaGames.init();
  } catch {
    return null;
  }
}
