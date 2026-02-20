import { canvas, toGameCoords } from './CanvasHost';

const DRAG_THRESHOLD_PX = 10;

export type GamePoint = { x: number; y: number };

export interface InputManagerEvents {
  onTap?: (point: GamePoint) => void;
  onDragStart?: (point: GamePoint) => void;
  onDragMove?: (point: GamePoint) => void;
  onDragEnd?: (point: GamePoint) => void;
}

export class InputManager {
  private activePointerId: number | null = null;
  private startGame: GamePoint | null = null;
  private isDragging = false;
  private readonly events: InputManagerEvents;

  constructor(events: InputManagerEvents = {}) {
    this.events = events;
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointercancel', this.handlePointerUp);
  }

  getActivePointerId(): number | null {
    return this.activePointerId;
  }

  private gameCoordsFromPointer(e: PointerEvent): GamePoint {
    return toGameCoords(e.clientX, e.clientY);
  }

  private static distance(a: GamePoint, b: GamePoint): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private handlePointerDown = (e: PointerEvent): void => {
    if (this.activePointerId !== null) return;
    this.activePointerId = e.pointerId;
    this.startGame = this.gameCoordsFromPointer(e);
    this.isDragging = false;
  };

  private handlePointerMove = (e: PointerEvent): void => {
    if (this.activePointerId === null || e.pointerId !== this.activePointerId || this.startGame === null) return;
    const game = this.gameCoordsFromPointer(e);
    if (!this.isDragging) {
      if (InputManager.distance(this.startGame, game) >= DRAG_THRESHOLD_PX) {
        this.isDragging = true;
        this.events.onDragStart?.(game);
      }
    } else {
      this.events.onDragMove?.(game);
    }
  };

  private handlePointerUp = (e: PointerEvent): void => {
    if (this.activePointerId === null || e.pointerId !== this.activePointerId) return;
    const game = this.gameCoordsFromPointer(e);
    if (this.isDragging) {
      this.events.onDragEnd?.(game);
    } else {
      this.events.onTap?.(game);
    }
    this.activePointerId = null;
    this.startGame = null;
    this.isDragging = false;
  };

  destroy(): void {
    canvas.removeEventListener('pointerdown', this.handlePointerDown);
    canvas.removeEventListener('pointermove', this.handlePointerMove);
    canvas.removeEventListener('pointerup', this.handlePointerUp);
    canvas.removeEventListener('pointercancel', this.handlePointerUp);
    this.activePointerId = null;
    this.startGame = null;
    this.isDragging = false;
  }
}
