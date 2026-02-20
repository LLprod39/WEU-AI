const STORAGE_KEY = 'yg_merge2048_v1';

export interface SaveData {
  version: number;
  bestScore: number;
  soundEnabled: boolean;
  lastBoard: number[][] | null;
  lastScore: number;
}

const DEFAULTS: SaveData = {
  version: 1,
  bestScore: 0,
  soundEnabled: true,
  lastBoard: null,
  lastScore: 0,
};

export function load(): SaveData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    return {
      version: parsed.version ?? DEFAULTS.version,
      bestScore: typeof parsed.bestScore === 'number' ? parsed.bestScore : DEFAULTS.bestScore,
      soundEnabled: typeof parsed.soundEnabled === 'boolean' ? parsed.soundEnabled : DEFAULTS.soundEnabled,
      lastBoard: Array.isArray(parsed.lastBoard) ? parsed.lastBoard : DEFAULTS.lastBoard,
      lastScore: typeof parsed.lastScore === 'number' ? parsed.lastScore : DEFAULTS.lastScore,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function save(partial: Partial<SaveData>): void {
  try {
    const current = load();
    const next: SaveData = {
      version: partial.version !== undefined ? partial.version : current.version,
      bestScore: partial.bestScore !== undefined ? partial.bestScore : current.bestScore,
      soundEnabled: partial.soundEnabled !== undefined ? partial.soundEnabled : current.soundEnabled,
      lastBoard: partial.lastBoard !== undefined ? partial.lastBoard : current.lastBoard,
      lastScore: partial.lastScore !== undefined ? partial.lastScore : current.lastScore,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}
