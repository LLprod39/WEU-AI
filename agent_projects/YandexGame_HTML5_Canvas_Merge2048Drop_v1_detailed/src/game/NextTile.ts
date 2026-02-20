/** Порог очков/ходов, после которого появляется шанс на плитку 8. */
const SCORE_THRESHOLD_8 = 2000;

/** Базовые шансы: 2 — 80%, 4 — 20%. При score >= 2000: 2 — 70%, 4 — 25%, 8 — 5%. */
export function rollNextValue(scoreOrMoves: number): number {
  const r = Math.random();

  if (scoreOrMoves >= SCORE_THRESHOLD_8) {
    if (r < 0.7) return 2;
    if (r < 0.95) return 4;
    return 8;
  }

  if (r < 0.8) return 2;
  return 4;
}
