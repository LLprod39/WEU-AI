const SAVE_KEY = 'yg_save_v1';

export interface SaveData {
  version: number;
  bestScore: number;
  soundEnabled: boolean;
  tutorialShown: boolean;
}

const DEFAULTS: SaveData = {
  version: 1,
  bestScore: 0,
  soundEnabled: true,
  tutorialShown: false,
};

export function load(): SaveData {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SAVE_KEY) : null;
    if (raw == null) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    return {
      version: typeof parsed.version === 'number' ? parsed.version : DEFAULTS.version,
      bestScore: typeof parsed.bestScore === 'number' ? parsed.bestScore : DEFAULTS.bestScore,
      soundEnabled: typeof parsed.soundEnabled === 'boolean' ? parsed.soundEnabled : DEFAULTS.soundEnabled,
      tutorialShown: typeof parsed.tutorialShown === 'boolean' ? parsed.tutorialShown : DEFAULTS.tutorialShown,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function save(partial: Partial<SaveData>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const current = load();
    const next: SaveData = {
      version: partial.version !== undefined ? partial.version : current.version,
      bestScore: partial.bestScore !== undefined ? partial.bestScore : current.bestScore,
      soundEnabled: partial.soundEnabled !== undefined ? partial.soundEnabled : current.soundEnabled,
      tutorialShown: partial.tutorialShown !== undefined ? partial.tutorialShown : current.tutorialShown,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(next));
  } catch {
    // localStorage недоступен или запись не удалась — молча игнорируем
  }
}
