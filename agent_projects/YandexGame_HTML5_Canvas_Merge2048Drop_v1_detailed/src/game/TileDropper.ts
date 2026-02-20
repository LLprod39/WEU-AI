import { cellToWorld } from "./GridMapper";

export type ActiveDrop = {
  value: number;
  col: number;
  y: number;
  targetRow: number;
  speed: number;
  isDropping: boolean;
};

export class TileDropper {
  activeDrop: ActiveDrop | null = null;

  /** Вызывается при приземлении плитки. */
  onLanded: ((value: number, col: number, targetRow: number) => void) | null = null;

  startDrop(value: number, col: number, targetRow: number, speed: number = 600): void {
    const { y: targetY } = cellToWorld(targetRow, col);
    this.activeDrop = {
      value,
      col,
      y: targetY - 200,
      targetRow,
      speed,
      isDropping: true,
    };
  }

  update(dt: number): void {
    const drop = this.activeDrop;
    if (!drop || !drop.isDropping) return;

    const targetY = cellToWorld(drop.targetRow, drop.col).y;
    drop.y += drop.speed * dt;

    if (drop.y >= targetY) {
      drop.y = targetY;
      drop.isDropping = false;
      this.onLanded?.(drop.value, drop.col, drop.targetRow);
    }
  }
}
