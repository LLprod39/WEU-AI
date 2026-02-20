import Phaser from "phaser";
import { Colors, Fonts, Sizes } from "./CyberTheme";
import { AnimationHelper } from "./AnimationHelper";

/** Reusable UI component builders for the cyberpunk theme */
export class UIFactory {
  /** Draw L-shaped corner brackets on a Graphics object */
  static drawCornerBrackets(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
    color: number = Colors.cyanBright,
    alpha: number = 0.6,
    len: number = Sizes.cornerBracketLen,
    thick: number = Sizes.cornerBracketThick
  ): void {
    g.lineStyle(thick, color, alpha);
    // Top-left
    g.beginPath();
    g.moveTo(x, y + len);
    g.lineTo(x, y);
    g.lineTo(x + len, y);
    g.strokePath();
    // Top-right
    g.beginPath();
    g.moveTo(x + w - len, y);
    g.lineTo(x + w, y);
    g.lineTo(x + w, y + len);
    g.strokePath();
    // Bottom-left
    g.beginPath();
    g.moveTo(x, y + h - len);
    g.lineTo(x, y + h);
    g.lineTo(x + len, y + h);
    g.strokePath();
    // Bottom-right
    g.beginPath();
    g.moveTo(x + w - len, y + h);
    g.lineTo(x + w, y + h);
    g.lineTo(x + w, y + h - len);
    g.strokePath();
  }

  private static drawButtonSurface(
    g: Phaser.GameObjects.Graphics,
    width: number,
    height: number,
    topColor: number,
    bottomColor: number,
    borderColor: number,
    alpha = 1
  ): void {
    g.clear();
    g.fillGradientStyle(topColor, topColor, bottomColor, bottomColor, alpha);
    g.fillRoundedRect(-width / 2, -height / 2, width, height, Sizes.buttonRadius);
    g.lineStyle(2, borderColor, 0.94);
    g.strokeRoundedRect(-width / 2, -height / 2, width, height, Sizes.buttonRadius);

    // Top shine strip
    g.fillStyle(0xffffff, 0.14);
    g.fillRoundedRect(-width / 2 + 2, -height / 2 + 2, width - 4, Math.max(6, Math.floor(height * 0.26)), 4);
  }

  /** Create a cyberpunk panel with title bar and corner brackets */
  static createPanel(
    scene: Phaser.Scene,
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    title: string
  ): {
    container: Phaser.GameObjects.Container;
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    const container = scene.add.container(centerX, centerY);

    // Layered panel body
    const bg = scene.add.graphics();
    bg.fillGradientStyle(Colors.bgCard, Colors.bgCard, Colors.bgPanel, Colors.bgPanel, 0.95);
    bg.fillRoundedRect(-width / 2, -height / 2, width, height, Sizes.panelRadius);
    bg.lineStyle(2, Colors.borderLight, 0.84);
    bg.strokeRoundedRect(-width / 2, -height / 2, width, height, Sizes.panelRadius);
    bg.fillStyle(0xffffff, 0.035);
    bg.fillRoundedRect(-width / 2 + 2, -height / 2 + 2, width - 4, 30, 6);

    // Corner brackets
    this.drawCornerBrackets(bg, -width / 2, -height / 2, width, height);

    // Title bar
    const titleBarHeight = 34;
    bg.fillStyle(Colors.bgOverlay, 0.76);
    bg.fillRect(-width / 2 + 2, -height / 2 + 2, width - 4, titleBarHeight);
    bg.lineStyle(1, Colors.cyanLight, 0.55);
    bg.beginPath();
    bg.moveTo(-width / 2 + 2, -height / 2 + titleBarHeight + 2);
    bg.lineTo(width / 2 - 2, -height / 2 + titleBarHeight + 2);
    bg.strokePath();

    const accent = scene.add
      .rectangle(-width / 2 + 8, -height / 2 + titleBarHeight / 2 + 2, 4, titleBarHeight - 8, Colors.amber, 0.86)
      .setOrigin(0.5);

    const titleLabel = scene.add
      .text(-width / 2 + 14, -height / 2 + titleBarHeight / 2 + 2, title, {
        fontFamily: Fonts.game,
        fontSize: "16px",
        color: "#dbeafe",
      })
      .setOrigin(0, 0.5);

    container.add([bg, accent, titleLabel]);
    return { container, x: centerX, y: centerY, width, height };
  }

  /** Create a styled button with hover/press animations */
  static createButton(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    options: {
      baseColor?: number;
      hoverColor?: number;
      textColor?: string;
      fontSize?: string;
      onClick?: () => void;
      glowing?: boolean;
    } = {}
  ): Phaser.GameObjects.Container {
    const baseColor = options.baseColor ?? Colors.btnPrimary;
    const hoverColor = options.hoverColor ?? Colors.btnPrimaryHover;
    const textColor = options.textColor ?? "#ecfeff";
    const fontSize = options.fontSize ?? "20px";

    const container = scene.add.container(x, y);

    // Optional glow behind button
    if (options.glowing) {
      const glow = scene.add.graphics();
      glow.fillStyle(baseColor, 0.12);
      glow.fillRoundedRect(-width / 2 - 4, -height / 2 - 4, width + 8, height + 8, Sizes.buttonRadius + 2);
      container.add(glow);
      AnimationHelper.glowPulse(scene, glow, 0.08, 0.2, 1400);
    }

    const bg = scene.add.graphics();
    this.drawButtonSurface(bg, width, height, baseColor, Colors.bgOverlay, Colors.borderBright, 1);

    const text = scene.add
      .text(0, 0, label, {
        fontFamily: Fonts.game,
        fontSize,
        color: textColor,
      })
      .setOrigin(0.5);

    // Hit area covers entire button
    const hitArea = scene.add
      .rectangle(0, 0, width, height, 0x000000, 0)
      .setInteractive({ useHandCursor: true });

    container.add([bg, text, hitArea]);

    hitArea.on("pointerover", () => {
      this.drawButtonSurface(bg, width, height, hoverColor, Colors.blue, Colors.cyanLight, 1);
      text.setScale(1.03);
    });

    hitArea.on("pointerout", () => {
      this.drawButtonSurface(bg, width, height, baseColor, Colors.bgOverlay, Colors.borderBright, 1);
      text.setScale(1);
    });

    hitArea.on("pointerdown", () => {
      AnimationHelper.buttonPress(scene, container);
      options.onClick?.();
    });

    return container;
  }

  /** Create a progress bar (for daily tasks, HP) */
  static createProgressBar(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    height: number,
    progress: number,
    options: {
      bgColor?: number;
      fillColor?: number;
      borderColor?: number;
    } = {}
  ): Phaser.GameObjects.Container {
    const bgColor = options.bgColor ?? Colors.bgCard;
    const fillColor = options.fillColor ?? Colors.green;
    const borderColor = options.borderColor ?? Colors.border;
    const ratio = Phaser.Math.Clamp(progress, 0, 1);

    const container = scene.add.container(x, y);
    const bg = scene.add
      .rectangle(0, 0, width, height, bgColor, 0.9)
      .setStrokeStyle(1, borderColor, 0.8);
    const fillWidth = Math.max(1, width * ratio);
    const fill = scene.add
      .rectangle(-width / 2 + fillWidth / 2, 0, fillWidth, height - 2, fillColor, 0.9)
      .setOrigin(0.5);

    container.add([bg, fill]);
    return container;
  }

  /** Consistent modal overlay backdrop */
  static createOverlayBackdrop(
    scene: Phaser.Scene,
    width: number,
    height: number,
    alpha = 0.84
  ): Phaser.GameObjects.Rectangle {
    const backdrop = scene.add
      .rectangle(width / 2, height / 2, width, height, Colors.bgDeep, alpha)
      .setInteractive({ useHandCursor: false });
    backdrop.on("pointerdown", () => {
      /* consume clicks */
    });
    return backdrop;
  }
}
