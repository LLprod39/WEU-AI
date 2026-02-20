import { GameState } from "./types";
import { LeaderboardEntry, yandexGamesSdk } from "../sdk/yandexGamesSdk";

export const DAILY_LEADERBOARD_NAME = "daily_challenge_score";
const DAILY_SUBMIT_COOLDOWN_MS = 12000;

export interface DailyLeaderboardSnapshot {
  dateKey: string;
  top: LeaderboardEntry[];
  player?: LeaderboardEntry;
}

export function getLocalDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getDailySeed(dateKey: string): number {
  let hash = 2166136261;
  for (let i = 0; i < dateKey.length; i += 1) {
    hash ^= dateKey.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export function computeDailyScore(params: {
  wave: number;
  runTimeMs: number;
  merges: number;
  totalDamage: number;
}): number {
  const wavePart = Math.max(0, params.wave) * 12000;
  const mergePart = Math.max(0, params.merges) * 260;
  const damagePart = Math.floor(Math.max(0, params.totalDamage) / 14);
  const timePenalty = Math.floor(Math.max(0, params.runTimeMs) / 1000) * 22;

  return Math.max(0, wavePart + mergePart + damagePart - timePenalty);
}

export async function trySubmitDailyScore(
  gameState: GameState,
  score: number,
  dateKey: string
): Promise<{ submitted: boolean; reason?: string }> {
  const now = Date.now();
  if (
    now - gameState.settingsState.dailyChallengeLastSubmitTs < DAILY_SUBMIT_COOLDOWN_MS
  ) {
    return { submitted: false, reason: "submit_cooldown" };
  }

  if (gameState.settingsState.dailyChallengeDateKey !== dateKey) {
    gameState.settingsState.dailyChallengeDateKey = dateKey;
    gameState.settingsState.dailyChallengeBestScore = 0;
  }

  if (score <= gameState.settingsState.dailyChallengeBestScore) {
    gameState.settingsState.dailyChallengeLastSubmitTs = now;
    return { submitted: false, reason: "score_not_better" };
  }

  const submitted = await yandexGamesSdk.setLeaderboardScore(
    DAILY_LEADERBOARD_NAME,
    score,
    JSON.stringify({ dateKey })
  );
  gameState.settingsState.dailyChallengeLastSubmitTs = now;

  if (!submitted) {
    return { submitted: false, reason: "sdk_unavailable" };
  }

  gameState.settingsState.dailyChallengeDateKey = dateKey;
  gameState.settingsState.dailyChallengeBestScore = score;
  return { submitted: true };
}

export async function loadDailyLeaderboard(dateKey: string): Promise<DailyLeaderboardSnapshot> {
  const topResponse = await yandexGamesSdk.getLeaderboardTop(DAILY_LEADERBOARD_NAME, 10);
  const player = await yandexGamesSdk.getLeaderboardPlayerEntry(DAILY_LEADERBOARD_NAME);

  const filteredTop = topResponse.entries.filter((entry) => {
    if (!entry.extraData) {
      return true;
    }

    try {
      const extra = JSON.parse(entry.extraData) as { dateKey?: string };
      return !extra.dateKey || extra.dateKey === dateKey;
    } catch {
      return true;
    }
  });

  const filteredPlayer = (() => {
    if (!player?.extraData) {
      return player;
    }
    try {
      const extra = JSON.parse(player.extraData) as { dateKey?: string };
      if (extra.dateKey && extra.dateKey !== dateKey) {
        return undefined;
      }
      return player;
    } catch {
      return player;
    }
  })();

  return {
    dateKey,
    top: filteredTop,
    player: filteredPlayer
  };
}
