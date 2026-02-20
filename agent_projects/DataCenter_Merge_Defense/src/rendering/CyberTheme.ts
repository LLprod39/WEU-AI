/** Centralized cyberpunk theme — palette, fonts, sizing constants */

export const Colors = {
  // Background shades
  bgDeep: 0x030712,
  bgDark: 0x07101d,
  bgPanel: 0x0d1a2f,
  bgCard: 0x12243f,
  bgOverlay: 0x081325,

  // Accents — приглушённые для пути и подсветок
  cyan: 0x22d3ee,
  cyanBright: 0x38bdf8,
  cyanLight: 0x7dd3fc,
  cyanDim: 0x0e4d5c,
  blue: 0x3b82f6,
  bluePale: 0x93c5fd,
  blueLight: 0xdbeafe,
  indigo: 0x0ea5e9,

  // Turret roles
  turretBasic: 0x3b82f6,
  turretSplash: 0xf59e0b,
  turretSlow: 0x10b981,

  // Enemy types
  enemyBasic: 0x38bdf8,
  enemyFast: 0xfb923c,
  enemyTank: 0xa855f7,

  // Status
  green: 0x22c55e,
  greenBright: 0x86efac,
  amber: 0xf59e0b,
  amberPale: 0xfcd34d,
  red: 0xef4444,
  redPale: 0xfda4af,
  pathStart: 0x134e3a,
  pathEnd: 0x4c1d34,

  // UI
  white: 0xf8fafc,
  textPrimary: 0xe2e8f0,
  textSecondary: 0x94a3b8,
  border: 0x2a3f64,
  borderLight: 0x466792,
  borderBright: 0x34d399,

  // Buttons
  btnPrimary: 0x0891b2,
  btnPrimaryHover: 0x0ea5e9,
  btnSecondary: 0x1f2937,
  btnSecondaryHover: 0x334155,
  btnDanger: 0x9f1239,
  btnPurple: 0x7e22ce,
  btnBlue: 0x1d4ed8,

  // Grid — мягкие тона, без резких контрастов
  gridCellEmpty: 0x0f1729,
  gridCellPath: 0x0e3344,
  gridCellObstacle: 0x1a1620,
  gridLine: 0x1e3348,
  gridBorder: 0x253d52,

  // Glow
  glowCyan: 0x0ea5e9,
  glowAmber: 0xf59e0b,
  glowGreen: 0x10b981,
} as const;

export const Fonts = {
  mono: "Share Tech Mono, Consolas, monospace",
  ui: "Rajdhani, Trebuchet MS, sans-serif",
  game: "Orbitron, Rajdhani, sans-serif",
} as const;

export const Sizes = {
  cornerBracketLen: 14,
  cornerBracketThick: 2,
  panelRadius: 8,
  buttonRadius: 6,
  cardRadius: 8,
  glowLayers: 4,
  glowBaseAlpha: 0.12,
} as const;
