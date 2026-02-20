/**
 * Объекты пула могут реализовать reset() для сброса состояния при возврате в пул,
 * либо поля задаются при повторном использовании (spawn).
 */
export interface Resettable {
  reset(): void;
}

function isResettable(obj: unknown): obj is Resettable {
  return typeof (obj as Resettable).reset === 'function';
}

export class ObjectPool<T> {
  private readonly factory: () => T;
  private readonly pool: T[] = [];

  constructor(factory: () => T, initialSize: number = 0) {
    this.factory = factory;
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(factory());
    }
  }

  /**
   * Взять объект из пула. Если пул пуст — создаётся новый объект через factory.
   */
  acquire(): T {
    const obj = this.pool.pop();
    if (obj !== undefined) {
      return obj;
    }
    return this.factory();
  }

  /**
   * Вернуть объект в пул. Если у объекта есть reset(), он вызывается перед возвратом.
   */
  release(obj: T): void {
    if (isResettable(obj)) {
      obj.reset();
    }
    this.pool.push(obj);
  }
}
