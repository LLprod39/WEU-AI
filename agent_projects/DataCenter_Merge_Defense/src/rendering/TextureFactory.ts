import Phaser from "phaser";
import { Colors, Sizes } from "./CyberTheme";

/** Size at which we generate base textures. Sprites scale to actual cell size at runtime. */
const TEX_SIZE = 64;
const HALF = TEX_SIZE / 2;
const ENEMY_TEX = 48;
const ENEMY_HALF = ENEMY_TEX / 2;

/* ---------- texture keys ---------- */

export function turretKey(role: string, tier: number): string {
  return `turret_${role}_t${tier}`;
}

export function turretGlowKey(role: string): string {
  return `turret_glow_${role}`;
}

export function enemyKey(tag: string): string {
  return `enemy_${tag}`;
}

export const TEX = {
  gridCellEmpty: "grid_cell_empty",
  gridCellPath: "grid_cell_path",
  panelBg: "panel_bg",
  btnPrimary: "btn_primary",
  btnSecondary: "btn_secondary",
  cardFrame: "card_frame",
  vignette: "vignette",
  scanlines: "scanlines",
} as const;

/* ---------- helpers ---------- */

function glowCircle(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  baseRadius: number,
  color: number,
  layers: number = Sizes.glowLayers,
  baseAlpha: number = Sizes.glowBaseAlpha
): void {
  for (let i = layers; i >= 1; i--) {
    const ratio = i / layers;
    const radius = baseRadius * (1 + ratio * 0.8);
    const alpha = baseAlpha * (1 - ratio * 0.6);
    g.fillStyle(color, alpha);
    g.fillCircle(cx, cy, radius);
  }
}

function brighten(color: number, tier: number): number {
  const c = Phaser.Display.Color.IntegerToColor(color);
  const factor = Math.max(0, tier - 1) * 0.18;
  const r = Phaser.Math.Clamp(Math.floor(c.red + (255 - c.red) * factor), 0, 255);
  const gr = Phaser.Math.Clamp(Math.floor(c.green + (255 - c.green) * factor), 0, 255);
  const b = Phaser.Math.Clamp(Math.floor(c.blue + (255 - c.blue) * factor), 0, 255);
  return Phaser.Display.Color.GetColor(r, gr, b);
}

/* ---------- turret shapes ---------- */

function drawServerRack(g: Phaser.GameObjects.Graphics, color: number): void {
  // Rounded rect "server rack"
  const inset = 6;
  g.fillStyle(color, 1);
  g.fillRoundedRect(inset, inset, TEX_SIZE - inset * 2, TEX_SIZE - inset * 2, 8);
  // Horizontal slot lines
  g.lineStyle(1, 0xffffff, 0.25);
  for (let y = 18; y < TEX_SIZE - 12; y += 10) {
    g.beginPath();
    g.moveTo(inset + 8, y);
    g.lineTo(TEX_SIZE - inset - 8, y);
    g.strokePath();
  }
  // LED dot
  g.fillStyle(0xffffff, 0.7);
  g.fillCircle(TEX_SIZE - inset - 12, inset + 10, 3);
  // Border
  g.lineStyle(2, 0xffffff, 0.35);
  g.strokeRoundedRect(inset, inset, TEX_SIZE - inset * 2, TEX_SIZE - inset * 2, 8);
}

function drawAntenna(g: Phaser.GameObjects.Graphics, color: number): void {
  // Circle "antenna dish"
  const radius = TEX_SIZE / 2 - 8;
  g.fillStyle(color, 1);
  g.fillCircle(HALF, HALF, radius);
  // Inner ring
  g.lineStyle(2, 0xffffff, 0.3);
  g.strokeCircle(HALF, HALF, radius * 0.6);
  // Cross
  g.lineStyle(1, 0xffffff, 0.2);
  g.beginPath();
  g.moveTo(HALF - radius * 0.4, HALF);
  g.lineTo(HALF + radius * 0.4, HALF);
  g.strokePath();
  g.beginPath();
  g.moveTo(HALF, HALF - radius * 0.4);
  g.lineTo(HALF, HALF + radius * 0.4);
  g.strokePath();
  // Outer border
  g.lineStyle(2, 0xffffff, 0.35);
  g.strokeCircle(HALF, HALF, radius);
}

function drawFirewall(g: Phaser.GameObjects.Graphics, color: number): void {
  // Hexagon "firewall shield"
  const radius = TEX_SIZE / 2 - 8;
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    points.push({
      x: HALF + radius * Math.cos(angle),
      y: HALF + radius * Math.sin(angle),
    });
  }
  g.fillStyle(color, 1);
  g.beginPath();
  g.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < 6; i++) {
    g.lineTo(points[i].x, points[i].y);
  }
  g.closePath();
  g.fillPath();
  // Shield icon (inner hex)
  const innerRadius = radius * 0.55;
  g.lineStyle(2, 0xffffff, 0.3);
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const px = HALF + innerRadius * Math.cos(angle);
    const py = HALF + innerRadius * Math.sin(angle);
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.strokePath();
  // Outer border
  g.lineStyle(2, 0xffffff, 0.35);
  g.beginPath();
  g.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < 6; i++) {
    g.lineTo(points[i].x, points[i].y);
  }
  g.closePath();
  g.strokePath();
}

/* ---------- enemy shapes ---------- */

function drawDiamond(g: Phaser.GameObjects.Graphics, color: number): void {
  g.fillStyle(color, 1);
  g.beginPath();
  g.moveTo(ENEMY_HALF, 4);
  g.lineTo(ENEMY_TEX - 4, ENEMY_HALF);
  g.lineTo(ENEMY_HALF, ENEMY_TEX - 4);
  g.lineTo(4, ENEMY_HALF);
  g.closePath();
  g.fillPath();
  g.lineStyle(2, 0xffffff, 0.3);
  g.beginPath();
  g.moveTo(ENEMY_HALF, 4);
  g.lineTo(ENEMY_TEX - 4, ENEMY_HALF);
  g.lineTo(ENEMY_HALF, ENEMY_TEX - 4);
  g.lineTo(4, ENEMY_HALF);
  g.closePath();
  g.strokePath();
}

function drawChevron(g: Phaser.GameObjects.Graphics, color: number): void {
  // Arrow / chevron pointing right (direction of travel)
  g.fillStyle(color, 1);
  g.beginPath();
  g.moveTo(ENEMY_TEX - 6, ENEMY_HALF);
  g.lineTo(10, 6);
  g.lineTo(18, ENEMY_HALF);
  g.lineTo(10, ENEMY_TEX - 6);
  g.closePath();
  g.fillPath();
  g.lineStyle(2, 0xffffff, 0.3);
  g.beginPath();
  g.moveTo(ENEMY_TEX - 6, ENEMY_HALF);
  g.lineTo(10, 6);
  g.lineTo(18, ENEMY_HALF);
  g.lineTo(10, ENEMY_TEX - 6);
  g.closePath();
  g.strokePath();
}

function drawShieldHex(g: Phaser.GameObjects.Graphics, color: number): void {
  // Wide hexagon "shield"
  const rx = ENEMY_HALF - 4;
  const ry = ENEMY_HALF - 6;
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i;
    points.push({
      x: ENEMY_HALF + rx * Math.cos(angle),
      y: ENEMY_HALF + ry * Math.sin(angle),
    });
  }
  g.fillStyle(color, 1);
  g.beginPath();
  g.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < 6; i++) g.lineTo(points[i].x, points[i].y);
  g.closePath();
  g.fillPath();
  // Inner cross
  g.lineStyle(2, 0xffffff, 0.25);
  g.beginPath();
  g.moveTo(ENEMY_HALF - 8, ENEMY_HALF);
  g.lineTo(ENEMY_HALF + 8, ENEMY_HALF);
  g.strokePath();
  g.beginPath();
  g.moveTo(ENEMY_HALF, ENEMY_HALF - 8);
  g.lineTo(ENEMY_HALF, ENEMY_HALF + 8);
  g.strokePath();
  // Border
  g.lineStyle(2, 0xffffff, 0.35);
  g.beginPath();
  g.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < 6; i++) g.lineTo(points[i].x, points[i].y);
  g.closePath();
  g.strokePath();
}

/* ---------- public API ---------- */

export class TextureFactory {
  static generateAll(scene: Phaser.Scene): void {
    this.generateTurrets(scene);
    this.generateTurretGlows(scene);
    this.generateEnemies(scene);
    this.generateUI(scene);
    this.generateAmbient(scene);
  }

  /* --- turrets --- */
  private static generateTurrets(scene: Phaser.Scene): void {
    const roles: { role: string; color: number; draw: (g: Phaser.GameObjects.Graphics, c: number) => void }[] = [
      { role: "single-target", color: Colors.turretBasic, draw: drawServerRack },
      { role: "splash", color: Colors.turretSplash, draw: drawAntenna },
      { role: "slow", color: Colors.turretSlow, draw: drawFirewall },
    ];

    for (const { role, color, draw } of roles) {
      for (let tier = 1; tier <= 5; tier++) {
        const key = turretKey(role, tier);
        if (scene.textures.exists(key)) continue;
        const g = scene.add.graphics();
        draw(g, brighten(color, tier));
        g.generateTexture(key, TEX_SIZE, TEX_SIZE);
        g.destroy();
      }
    }
  }

  /* --- turret glows --- */
  private static generateTurretGlows(scene: Phaser.Scene): void {
    const glows: { role: string; color: number }[] = [
      { role: "single-target", color: Colors.glowCyan },
      { role: "splash", color: Colors.glowAmber },
      { role: "slow", color: Colors.glowGreen },
    ];

    const glowSize = TEX_SIZE + 24;
    const center = glowSize / 2;
    for (const { role, color } of glows) {
      const key = turretGlowKey(role);
      if (scene.textures.exists(key)) continue;
      const g = scene.add.graphics();
      glowCircle(g, center, center, TEX_SIZE / 2 - 2, color, 5, 0.1);
      g.generateTexture(key, glowSize, glowSize);
      g.destroy();
    }
  }

  /* --- enemies --- */
  private static generateEnemies(scene: Phaser.Scene): void {
    const enemies: { tag: string; color: number; draw: (g: Phaser.GameObjects.Graphics, c: number) => void }[] = [
      { tag: "basic", color: Colors.enemyBasic, draw: drawDiamond },
      { tag: "fast", color: Colors.enemyFast, draw: drawChevron },
      { tag: "tank", color: Colors.enemyTank, draw: drawShieldHex },
    ];

    for (const { tag, color, draw } of enemies) {
      const key = enemyKey(tag);
      if (scene.textures.exists(key)) continue;
      const g = scene.add.graphics();
      draw(g, color);
      g.generateTexture(key, ENEMY_TEX, ENEMY_TEX);
      g.destroy();
    }
  }

  /* --- UI textures --- */
  private static generateUI(scene: Phaser.Scene): void {
    // Grid cell — empty
    if (!scene.textures.exists(TEX.gridCellEmpty)) {
      const size = 32;
      const g = scene.add.graphics();
      g.fillStyle(Colors.gridCellEmpty, 0.92);
      g.fillRoundedRect(0, 0, size, size, 4);
      // Dot grid pattern
      g.fillStyle(0xffffff, 0.06);
      for (let y = 8; y < size; y += 8) {
        for (let x = 8; x < size; x += 8) {
          g.fillCircle(x, y, 1);
        }
      }
      g.generateTexture(TEX.gridCellEmpty, size, size);
      g.destroy();
    }

    // Grid cell — path
    if (!scene.textures.exists(TEX.gridCellPath)) {
      const size = 32;
      const g = scene.add.graphics();
      g.fillStyle(Colors.gridCellPath, 0.96);
      g.fillRoundedRect(0, 0, size, size, 4);
      // Circuit trace pattern
      g.lineStyle(1, Colors.cyanBright, 0.1);
      g.beginPath();
      g.moveTo(4, size / 2);
      g.lineTo(size / 2, size / 2);
      g.lineTo(size / 2, 4);
      g.strokePath();
      g.beginPath();
      g.moveTo(size / 2, size - 4);
      g.lineTo(size / 2, size / 2);
      g.lineTo(size - 4, size / 2);
      g.strokePath();
      g.generateTexture(TEX.gridCellPath, size, size);
      g.destroy();
    }

    // Card frame
    if (!scene.textures.exists(TEX.cardFrame)) {
      const w = 200;
      const h = 240;
      const g = scene.add.graphics();
      g.fillStyle(Colors.bgCard, 0.98);
      g.fillRoundedRect(0, 0, w, h, Sizes.cardRadius);
      g.lineStyle(2, Colors.borderLight, 0.9);
      g.strokeRoundedRect(0, 0, w, h, Sizes.cardRadius);
      // Left accent bar
      g.fillStyle(Colors.cyan, 0.7);
      g.fillRect(0, 12, 4, h - 24);
      g.generateTexture(TEX.cardFrame, w, h);
      g.destroy();
    }
  }

  /* --- ambient --- */
  private static generateAmbient(scene: Phaser.Scene): void {
    // Scanline overlay
    if (!scene.textures.exists(TEX.scanlines)) {
      const h = 256;
      const w = 4;
      const g = scene.add.graphics();
      for (let y = 0; y < h; y += 4) {
        g.fillStyle(0x000000, 0.03);
        g.fillRect(0, y, w, 2);
      }
      g.generateTexture(TEX.scanlines, w, h);
      g.destroy();
    }

    // Vignette — dark edges
    if (!scene.textures.exists(TEX.vignette)) {
      const size = 256;
      const g = scene.add.graphics();
      const center = size / 2;
      const layers = 8;
      for (let i = layers; i >= 1; i--) {
        const ratio = i / layers;
        const radius = center * (0.5 + ratio * 0.5);
        g.fillStyle(0x000000, 0.04 * ratio);
        g.fillCircle(center, center, radius);
      }
      // Clear center by drawing over with transparent
      g.fillStyle(0x000000, 0);
      g.fillCircle(center, center, center * 0.4);
      g.generateTexture(TEX.vignette, size, size);
      g.destroy();
    }
  }
}
