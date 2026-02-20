import Phaser from "phaser";

/** Shared animation presets for the cyberpunk theme */
export class AnimationHelper {
  /** Scale-bounce on press (button / card) */
  static buttonPress(scene: Phaser.Scene, target: Phaser.GameObjects.GameObject): void {
    scene.tweens.add({
      targets: target,
      scale: 0.92,
      duration: 60,
      yoyo: true,
      ease: "Sine.easeOut",
    });
  }

  /** Gentle alpha oscillation — attach to a glow sprite */
  static glowPulse(
    scene: Phaser.Scene,
    target: Phaser.GameObjects.GameObject,
    minAlpha = 0.4,
    maxAlpha = 0.8,
    duration = 1200
  ): Phaser.Tweens.Tween {
    return scene.tweens.add({
      targets: target,
      alpha: { from: minAlpha, to: maxAlpha },
      duration,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  /** Expanding concentric circles on merge */
  static mergeBurst(scene: Phaser.Scene, x: number, y: number, color: number, cellSize: number): void {
    const rings = 3;
    for (let i = 0; i < rings; i++) {
      const ring = scene.add
        .circle(x, y, cellSize * 0.15, color, 0)
        .setStrokeStyle(2, color, 0.7 - i * 0.15)
        .setDepth(38);
      scene.tweens.add({
        targets: ring,
        scale: 1.6 + i * 0.5,
        alpha: 0,
        duration: 280 + i * 60,
        delay: i * 40,
        ease: "Cubic.easeOut",
        onComplete: () => ring.destroy(),
      });
    }
  }

  /** Flash + scale-down on enemy death — умеренный размер */
  static enemyDeath(
    scene: Phaser.Scene,
    x: number,
    y: number,
    color: number,
    cellSize: number
  ): void {
    const flash = scene.add.circle(x, y, cellSize * 0.18, 0xffffff, 0.6).setDepth(37);
    scene.tweens.add({
      targets: flash,
      alpha: 0,
      scale: 1.7,
      duration: 180,
      ease: "Cubic.easeOut",
      onComplete: () => flash.destroy(),
    });
    const ring = scene.add
      .circle(x, y, cellSize * 0.1, color, 0)
      .setStrokeStyle(1, color, 0.5)
      .setDepth(37);
    scene.tweens.add({
      targets: ring,
      scale: 1.6,
      alpha: 0,
      duration: 260,
      ease: "Sine.easeOut",
      onComplete: () => ring.destroy(),
    });
  }

  /** Floating text that drifts up and fades (damage numbers, +credits) */
  static floatingText(
    scene: Phaser.Scene,
    x: number,
    y: number,
    text: string,
    color: string,
    fontSize = "14px"
  ): void {
    const label = scene.add
      .text(x, y, text, {
        fontFamily: "Verdana, sans-serif",
        fontSize,
        color,
        stroke: "#000000",
        strokeThickness: 2,
      })
      .setOrigin(0.5)
      .setDepth(50)
      .setAlpha(1);
    scene.tweens.add({
      targets: label,
      y: y - 30,
      alpha: 0,
      duration: 700,
      ease: "Quad.easeOut",
      onComplete: () => label.destroy(),
    });
  }

  /** Staggered slide-in for card containers */
  static cardAppear(
    scene: Phaser.Scene,
    containers: Phaser.GameObjects.Container[],
    fromY: number
  ): void {
    containers.forEach((container, i) => {
      const targetY = container.y;
      container.setY(fromY);
      container.setAlpha(0);
      scene.tweens.add({
        targets: container,
        y: targetY,
        alpha: 1,
        duration: 260,
        delay: i * 80,
        ease: "Back.easeOut",
      });
    });
  }

  /** Тонкий след выстрела */
  static shotTrail(
    scene: Phaser.Scene,
    origin: { x: number; y: number },
    impact: { x: number; y: number },
    color: number,
    cellSize: number
  ): void {
    const g = scene.add.graphics().setDepth(35);
    g.lineStyle(Math.max(3, Math.floor(cellSize * 0.08)), color, 0.22);
    g.beginPath();
    g.moveTo(origin.x, origin.y);
    g.lineTo(impact.x, impact.y);
    g.strokePath();
    g.lineStyle(Math.max(1, Math.floor(cellSize * 0.03)), color, 0.65);
    g.beginPath();
    g.moveTo(origin.x, origin.y);
    g.lineTo(impact.x, impact.y);
    g.strokePath();

    scene.tweens.add({
      targets: g,
      alpha: 0,
      duration: 120,
      ease: "Quad.easeOut",
      onComplete: () => g.destroy(),
    });
  }

  /** Muzzle flash on turret fire */
  static muzzleFlash(scene: Phaser.Scene, x: number, y: number, color: number, cellSize: number): void {
    const radius = Math.max(4, cellSize * 0.12);
    const flash = scene.add.circle(x, y, radius, color, 0.85).setDepth(36);
    scene.tweens.add({
      targets: flash,
      alpha: 0,
      scale: 1.8,
      duration: 100,
      ease: "Sine.easeOut",
      onComplete: () => flash.destroy(),
    });
  }

  /** Impact ring on hit — компактный, не перекрывает экран */
  static impactRing(scene: Phaser.Scene, x: number, y: number, color: number, cellSize: number): void {
    const ring = scene.add
      .circle(x, y, Math.max(3, cellSize * 0.08), color, 0)
      .setStrokeStyle(1, color, 0.5)
      .setDepth(36);
    scene.tweens.add({
      targets: ring,
      scale: 1.6,
      alpha: 0,
      duration: 160,
      ease: "Cubic.easeOut",
      onComplete: () => ring.destroy(),
    });
  }
}
