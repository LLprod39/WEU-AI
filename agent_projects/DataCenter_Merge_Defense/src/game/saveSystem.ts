import { GameState, MetaState, SettingsState } from "./types";
import { yandexGamesSdk } from "../sdk/yandexGamesSdk";

export const SAVE_PROFILE_EXISTS_KEY = "saveProfileExists";
export const SAVE_PROFILE_PICKED_KEY = "saveProfilePicked";

const LOCAL_SAVE_KEY = "dcmd_profile_save_v1";
const CLOUD_SAVE_KEY = "dcmd_profile_v1";
const SAVE_VERSION = 1;
const CLOUD_SAVE_DEBOUNCE_MS = 900;

interface PersistedProfileData {
  version: number;
  metaState: MetaState;
  settingsState: SettingsState;
  savedAt: string;
}

export interface LoadedProfileResult {
  hasSave: boolean;
  source: "cloud" | "local" | "none";
  metaState?: MetaState;
  settingsState?: SettingsState;
}

let pendingPayload: PersistedProfileData | undefined;
let cloudSaveTimer: number | undefined;
let saveChain: Promise<void> = Promise.resolve();

export async function loadPersistedProfile(): Promise<LoadedProfileResult> {
  const cloudData = await yandexGamesSdk.getPlayerData<PersistedProfileData | null>(CLOUD_SAVE_KEY);
  if (isPersistedProfileData(cloudData)) {
    writeLocalProfile(cloudData);
    return {
      hasSave: true,
      source: "cloud",
      metaState: cloudData.metaState,
      settingsState: cloudData.settingsState
    };
  }

  const localData = readLocalProfile();
  if (localData) {
    return {
      hasSave: true,
      source: "local",
      metaState: localData.metaState,
      settingsState: localData.settingsState
    };
  }

  return { hasSave: false, source: "none" };
}

export function queueGameSave(gameState: GameState): void {
  const payload = buildPayload(gameState);
  writeLocalProfile(payload);
  pendingPayload = payload;

  if (cloudSaveTimer !== undefined) {
    window.clearTimeout(cloudSaveTimer);
  }

  cloudSaveTimer = window.setTimeout(() => {
    const nextPayload = pendingPayload;
    pendingPayload = undefined;
    cloudSaveTimer = undefined;

    if (!nextPayload) {
      return;
    }

    enqueueCloudSave(nextPayload, false);
  }, CLOUD_SAVE_DEBOUNCE_MS);
}

export async function flushGameSave(gameState: GameState): Promise<void> {
  const payload = buildPayload(gameState);
  writeLocalProfile(payload);
  pendingPayload = undefined;

  if (cloudSaveTimer !== undefined) {
    window.clearTimeout(cloudSaveTimer);
    cloudSaveTimer = undefined;
  }

  await enqueueCloudSave(payload, true);
}

export async function clearAllSaves(): Promise<void> {
  try {
    window.localStorage.removeItem(LOCAL_SAVE_KEY);
  } catch {
    // Ignore storage errors.
  }

  await yandexGamesSdk.setPlayerData(CLOUD_SAVE_KEY, null, true);
}

function enqueueCloudSave(payload: PersistedProfileData, flush: boolean): Promise<void> {
  saveChain = saveChain.then(async () => {
    await yandexGamesSdk.setPlayerData(CLOUD_SAVE_KEY, payload, flush);
  });
  return saveChain;
}

function buildPayload(gameState: GameState): PersistedProfileData {
  return {
    version: SAVE_VERSION,
    metaState: clone(gameState.metaState),
    settingsState: clone(gameState.settingsState),
    savedAt: new Date().toISOString()
  };
}

function readLocalProfile(): PersistedProfileData | undefined {
  try {
    const raw = window.localStorage.getItem(LOCAL_SAVE_KEY);
    if (!raw) {
      return undefined;
    }

    const parsed = JSON.parse(raw) as unknown;
    return isPersistedProfileData(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeLocalProfile(payload: PersistedProfileData): void {
  try {
    window.localStorage.setItem(LOCAL_SAVE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage errors.
  }
}

function isPersistedProfileData(value: unknown): value is PersistedProfileData {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<PersistedProfileData>;
  return (
    candidate.version === SAVE_VERSION &&
    typeof candidate.metaState === "object" &&
    candidate.metaState !== null &&
    typeof candidate.settingsState === "object" &&
    candidate.settingsState !== null &&
    typeof candidate.savedAt === "string"
  );
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
