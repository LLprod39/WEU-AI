/** События UI/игры для шины событий */
export type GameEvent =
  | 'SOUND_TOGGLE'
  | 'SHOW_INTERSTITIAL'
  | string;

export type EventHandler<T = unknown> = (payload?: T) => void;

const handlers = new Map<GameEvent, Set<EventHandler>>();

/**
 * Подписка на событие.
 */
export function on<T = unknown>(event: GameEvent, handler: EventHandler<T>): void {
  let set = handlers.get(event);
  if (!set) {
    set = new Set();
    handlers.set(event, set);
  }
  set.add(handler as EventHandler);
}

/**
 * Отписка от события. Если handler не передан — снимаются все подписчики события.
 */
export function off<T = unknown>(event: GameEvent, handler?: EventHandler<T>): void {
  const set = handlers.get(event);
  if (!set) return;
  if (handler) {
    set.delete(handler as EventHandler);
    if (set.size === 0) handlers.delete(event);
  } else {
    handlers.delete(event);
  }
}

/**
 * Отправка события всем подписчикам.
 */
export function emit<T = unknown>(event: GameEvent, payload?: T): void {
  const set = handlers.get(event);
  if (!set) return;
  set.forEach((h) => {
    try {
      h(payload);
    } catch {
      // ошибка в обработчике — не показываем игроку
    }
  });
}
