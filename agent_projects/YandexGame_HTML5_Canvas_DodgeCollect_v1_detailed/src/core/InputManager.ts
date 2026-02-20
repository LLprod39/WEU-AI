/** Порог в игровых единицах: движение меньше = tap, больше = drag. */
const DRAG_THRESHOLD_GAME_UNITS = 10;

export type ToGameCoords = (
  clientX: number,
  clientY: number
) => { x: number; y: number };

export type TapCallback = (pos: { x: number; y: number }) => void;
export type DragCallback = (pos: { x: number; y: number }) => void;

export interface InputManagerOptions {
  canvas: HTMLCanvasElement;
  toGameCoords: ToGameCoords;
  dragThreshold?: number;
}

export class InputManager {
  private readonly canvas: HTMLCanvasElement;
  private readonly toGameCoords: ToGameCoords;
  private readonly dragThreshold: number;

  /** Активный pointerId или null, если нет нажатия. */
  activePointerId: number | null = null;
  /** Стартовая позиция в игровых координатах. */
  startPos: { x: number; y: number } | null = null;
  /** Последняя позиция в игровых координатах. */
  lastPos: { x: number; y: number } | null = null;

  /** true после первого вызова onDragStart в текущем жесте. */
  private dragStarted = false;

  private readonly onTapCbs: TapCallback[] = [];
  private readonly onDragStartCbs: DragCallback[] = [];
  private readonly onDragMoveCbs: DragCallback[] = [];
  private readonly onDragEndCbs: DragCallback[] = [];

  private boundHandlePointerDown: (e: PointerEvent) => void;
  private boundHandlePointerMove: (e: PointerEvent) => void;
  private boundHandlePointerUp: (e: PointerEvent) => void;
  private boundHandlePointerCancel: (e: PointerEvent) => void;

  constructor(options: InputManagerOptions) {
    this.canvas = options.canvas;
    this.toGameCoords = options.toGameCoords;
    this.dragThreshold = options.dragThreshold ?? DRAG_THRESHOLD_GAME_UNITS;

    this.boundHandlePointerDown = this.handlePointerDown.bind(this);
    this.boundHandlePointerMove = this.handlePointerMove.bind(this);
    this.boundHandlePointerUp = this.handlePointerUp.bind(this);
    this.boundHandlePointerCancel = this.handlePointerCancel.bind(this);

    this.canvas.addEventListener('pointerdown', this.boundHandlePointerDown, {
      passive: true,
    });
    this.canvas.addEventListener('pointermove', this.boundHandlePointerMove, {
      passive: true,
    });
    this.canvas.addEventListener('pointerup', this.boundHandlePointerUp, {
      passive: true,
    });
    this.canvas.addEventListener('pointercancel', this.boundHandlePointerCancel, {
      passive: true,
    });
  }

  private toGame(e: PointerEvent): { x: number; y: number } {
    return this.toGameCoords(e.clientX, e.clientY);
  }

  private handlePointerDown(e: PointerEvent): void {
    if (this.activePointerId !== null) return;
    this.activePointerId = e.pointerId;
    this.dragStarted = false;
    const pos = this.toGame(e);
    this.startPos = pos;
    this.lastPos = pos;
  }

  private handlePointerMove(e: PointerEvent): void {
    if (this.activePointerId !== e.pointerId) return;
    this.lastPos = this.toGame(e);
    const dist = this.getDistanceFromStart();
    if (!this.dragStarted && dist >= this.dragThreshold) {
      this.dragStarted = true;
      const start = this.startPos!;
      this.onDragStartCbs.forEach((cb) => cb({ x: start.x, y: start.y }));
    }
    if (this.dragStarted && this.lastPos) {
      this.onDragMoveCbs.forEach((cb) =>
        cb({ x: this.lastPos!.x, y: this.lastPos!.y })
      );
    }
  }

  private handlePointerUp(e: PointerEvent): void {
    if (this.activePointerId !== e.pointerId) return;
    this.lastPos = this.toGame(e);
    if (this.dragStarted) {
      if (this.lastPos) {
        this.onDragEndCbs.forEach((cb) =>
          cb({ x: this.lastPos!.x, y: this.lastPos!.y })
        );
      }
    } else {
      const pos = this.startPos ?? this.lastPos;
      if (pos) {
        this.onTapCbs.forEach((cb) => cb({ x: pos.x, y: pos.y }));
      }
    }
    this.activePointerId = null;
    this.dragStarted = false;
    // startPos/lastPos не сбрасываем — по ним можно отличить tap от drag до следующего pointerdown
  }

  private handlePointerCancel(e: PointerEvent): void {
    if (this.activePointerId !== e.pointerId) return;
    if (this.dragStarted && this.lastPos) {
      this.onDragEndCbs.forEach((cb) =>
        cb({ x: this.lastPos!.x, y: this.lastPos!.y })
      );
    }
    this.activePointerId = null;
    this.dragStarted = false;
    this.startPos = null;
    this.lastPos = null;
  }

  /**
   * Дистанция от старта до последней позиции в игровых единицах.
   * 0 если нет активного/завершённого жеста.
   */
  getDistanceFromStart(): number {
    const start = this.startPos;
    const last = this.lastPos;
    if (!start || !last) return 0;
    return Math.hypot(last.x - start.x, last.y - start.y);
  }

  /** true, если перемещение не превысило порог (tap). */
  isTap(): boolean {
    return this.getDistanceFromStart() < this.dragThreshold;
  }

  /** true, если перемещение превысило порог (drag). */
  isDrag(): boolean {
    return this.getDistanceFromStart() >= this.dragThreshold;
  }

  /** Подписка на tap (вызов только если не было значимого движения). Возвращает функцию отписки. */
  onTap(cb: TapCallback): () => void {
    this.onTapCbs.push(cb);
    return () => {
      const i = this.onTapCbs.indexOf(cb);
      if (i >= 0) this.onTapCbs.splice(i, 1);
    };
  }

  /** Подписка на начало перетаскивания (когда превышен порог). */
  onDragStart(cb: DragCallback): void {
    this.onDragStartCbs.push(cb);
  }

  /** Подписка на движение при перетаскивании. */
  onDragMove(cb: DragCallback): void {
    this.onDragMoveCbs.push(cb);
  }

  /** Подписка на окончание перетаскивания. */
  onDragEnd(cb: DragCallback): void {
    this.onDragEndCbs.push(cb);
  }

  destroy(): void {
    this.canvas.removeEventListener('pointerdown', this.boundHandlePointerDown);
    this.canvas.removeEventListener('pointermove', this.boundHandlePointerMove);
    this.canvas.removeEventListener('pointerup', this.boundHandlePointerUp);
    this.canvas.removeEventListener(
      'pointercancel',
      this.boundHandlePointerCancel
    );
    this.activePointerId = null;
    this.startPos = null;
    this.lastPos = null;
  }
}
