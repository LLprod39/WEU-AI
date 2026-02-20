import { AppRegistry, type AppDefinition } from './AppRegistry.ts';

export type { AppDefinition, AppLaunchContext, AppLaunchResult } from './AppRegistry.ts';

export type WindowState = 'normal' | 'minimized' | 'maximized' | 'closed';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesktopWindow {
  id: string;
  appId: string;
  title: string;
  bounds: WindowBounds;
  state: WindowState;
  zIndex: number;
  isFocused: boolean;
  payload?: unknown;
  createdAt: number;
  updatedAt: number;
}

export interface DesktopEngineOptions {
  defaultBounds?: WindowBounds;
  minimumWindowSize?: {
    width: number;
    height: number;
  };
  desktopSize?: {
    width: number;
    height: number;
  };
}

export interface CreateWindowInput {
  appId: string;
  title: string;
  bounds?: Partial<WindowBounds>;
  state?: Exclude<WindowState, 'closed'>;
  payload?: unknown;
  id?: string;
}

export type DesktopEngineEventMap = {
  appRegistered: { app: AppDefinition };
  appUnregistered: { appId: string };
  windowOpened: { window: DesktopWindow };
  windowUpdated: { window: DesktopWindow };
  windowClosed: { window: DesktopWindow };
  windowFocused: { window: DesktopWindow };
  snapshotChanged: { windows: DesktopWindow[]; apps: AppDefinition[] };
};

type EventKey = keyof DesktopEngineEventMap;
type EventHandler<K extends EventKey> = (payload: DesktopEngineEventMap[K]) => void;

const DEFAULT_BOUNDS: WindowBounds = {
  x: 120,
  y: 80,
  width: 900,
  height: 620,
};

const DEFAULT_MIN_SIZE = {
  width: 320,
  height: 220,
};

const DEFAULT_DESKTOP_SIZE = {
  width: 1920,
  height: 1080,
};

export class DesktopEngine {
  private readonly appRegistry = new AppRegistry();
  private readonly windows = new Map<string, DesktopWindow>();
  private readonly listeners = new Map<EventKey, Set<(payload: unknown) => void>>();

  private readonly defaultBounds: WindowBounds;
  private readonly minimumWindowSize: { width: number; height: number };
  private desktopSize: { width: number; height: number };
  private idCounter = 0;
  private zCounter = 0;

  constructor(options: DesktopEngineOptions = {}) {
    this.defaultBounds = {
      ...DEFAULT_BOUNDS,
      ...options.defaultBounds,
    };
    this.minimumWindowSize = {
      ...DEFAULT_MIN_SIZE,
      ...options.minimumWindowSize,
    };
    this.desktopSize = {
      ...DEFAULT_DESKTOP_SIZE,
      ...options.desktopSize,
    };
  }

  registerApp(app: AppDefinition): void {
    const registeredApp = this.appRegistry.register(app);
    this.emit('appRegistered', { app: registeredApp });
    this.emitSnapshotChanged();
  }

  unregisterApp(appId: string): void {
    if (!this.appRegistry.unregister(appId)) {
      return;
    }

    for (const window of this.windows.values()) {
      if (window.appId === appId && window.state !== 'closed') {
        this.closeWindow(window.id);
      }
    }

    this.emit('appUnregistered', { appId });
    this.emitSnapshotChanged();
  }

  listApps(): AppDefinition[] {
    return this.appRegistry.list();
  }

  getApp(appId: string): AppDefinition | undefined {
    return this.appRegistry.get(appId);
  }

  setDesktopSize(width: number, height: number): void {
    if (width <= 0 || height <= 0) {
      throw new Error('Desktop size must be greater than zero.');
    }
    this.desktopSize = { width, height };
  }

  async launchApp(appId: string, args?: unknown): Promise<DesktopWindow> {
    const window = await this.appRegistry.launch({
      appId,
      args,
      engine: this,
      findOpenWindowByAppId: (targetAppId) => this.findOpenWindowByAppId(targetAppId),
      focusWindow: (windowId) => this.focusWindow(windowId),
      createWindow: (input) => this.createWindow(input),
    });

    return this.cloneWindow(window);
  }

  createWindow(input: CreateWindowInput): DesktopWindow {
    if (!this.appRegistry.has(input.appId)) {
      throw new Error(`Cannot create window for unknown app "${input.appId}".`);
    }

    const id = input.id?.trim() || this.nextWindowId();
    if (this.windows.has(id)) {
      throw new Error(`Window "${id}" already exists.`);
    }

    const now = Date.now();
    const window: DesktopWindow = {
      id,
      appId: input.appId,
      title: input.title,
      bounds: this.normalizeBounds(input.bounds),
      state: input.state ?? 'normal',
      zIndex: this.nextZIndex(),
      isFocused: true,
      payload: input.payload,
      createdAt: now,
      updatedAt: now,
    };

    this.blurAllWindows();
    this.windows.set(id, window);

    this.emit('windowOpened', { window: this.cloneWindow(window) });
    this.emit('windowFocused', { window: this.cloneWindow(window) });
    this.emitSnapshotChanged();

    return this.cloneWindow(window);
  }

  getWindow(windowId: string): DesktopWindow | undefined {
    const window = this.windows.get(windowId);
    return window ? this.cloneWindow(window) : undefined;
  }

  listWindows(options: { includeClosed?: boolean } = {}): DesktopWindow[] {
    const includeClosed = options.includeClosed ?? false;
    const windows = Array.from(this.windows.values())
      .filter((window) => includeClosed || window.state !== 'closed')
      .sort((a, b) => a.zIndex - b.zIndex)
      .map((window) => this.cloneWindow(window));

    return windows;
  }

  focusWindow(windowId: string): DesktopWindow {
    const window = this.requireWindow(windowId);
    if (window.state === 'closed') {
      throw new Error(`Cannot focus closed window "${windowId}".`);
    }

    this.blurAllWindows();
    window.isFocused = true;
    window.zIndex = this.nextZIndex();
    this.touch(window);

    this.emit('windowFocused', { window: this.cloneWindow(window) });
    this.emit('windowUpdated', { window: this.cloneWindow(window) });
    this.emitSnapshotChanged();

    return this.cloneWindow(window);
  }

  closeWindow(windowId: string): void {
    const window = this.requireWindow(windowId);
    if (window.state === 'closed') {
      return;
    }

    window.state = 'closed';
    window.isFocused = false;
    this.touch(window);

    this.emit('windowClosed', { window: this.cloneWindow(window) });
    this.emit('windowUpdated', { window: this.cloneWindow(window) });

    const nextTopWindow = this.findTopWindow();
    if (nextTopWindow) {
      nextTopWindow.isFocused = true;
      this.touch(nextTopWindow);
      this.emit('windowFocused', { window: this.cloneWindow(nextTopWindow) });
      this.emit('windowUpdated', { window: this.cloneWindow(nextTopWindow) });
    }

    this.emitSnapshotChanged();
  }

  minimizeWindow(windowId: string): DesktopWindow {
    const window = this.requireOpenWindow(windowId);
    window.state = 'minimized';
    window.isFocused = false;
    this.touch(window);

    this.emit('windowUpdated', { window: this.cloneWindow(window) });

    const nextTopWindow = this.findTopWindow();
    if (nextTopWindow) {
      nextTopWindow.isFocused = true;
      this.touch(nextTopWindow);
      this.emit('windowFocused', { window: this.cloneWindow(nextTopWindow) });
      this.emit('windowUpdated', { window: this.cloneWindow(nextTopWindow) });
    }

    this.emitSnapshotChanged();
    return this.cloneWindow(window);
  }

  maximizeWindow(windowId: string): DesktopWindow {
    const window = this.requireOpenWindow(windowId);
    window.state = 'maximized';
    window.isFocused = true;
    window.zIndex = this.nextZIndex();
    window.bounds = {
      x: 0,
      y: 0,
      width: this.desktopSize.width,
      height: this.desktopSize.height,
    };
    this.blurAllWindows(window.id);
    this.touch(window);

    this.emit('windowFocused', { window: this.cloneWindow(window) });
    this.emit('windowUpdated', { window: this.cloneWindow(window) });
    this.emitSnapshotChanged();

    return this.cloneWindow(window);
  }

  restoreWindow(windowId: string): DesktopWindow {
    const window = this.requireWindow(windowId);
    if (window.state === 'closed') {
      throw new Error(`Cannot restore closed window "${windowId}".`);
    }

    window.state = 'normal';
    window.isFocused = true;
    window.zIndex = this.nextZIndex();
    window.bounds = this.normalizeBounds(window.bounds);
    this.blurAllWindows(window.id);
    this.touch(window);

    this.emit('windowFocused', { window: this.cloneWindow(window) });
    this.emit('windowUpdated', { window: this.cloneWindow(window) });
    this.emitSnapshotChanged();

    return this.cloneWindow(window);
  }

  moveWindow(windowId: string, nextPosition: Pick<WindowBounds, 'x' | 'y'>): DesktopWindow {
    const window = this.requireOpenWindow(windowId);
    const bounds = this.normalizeBounds({
      ...window.bounds,
      x: nextPosition.x,
      y: nextPosition.y,
    });
    window.bounds = bounds;
    this.touch(window);

    this.emit('windowUpdated', { window: this.cloneWindow(window) });
    this.emitSnapshotChanged();
    return this.cloneWindow(window);
  }

  resizeWindow(
    windowId: string,
    nextSize: Partial<Pick<WindowBounds, 'width' | 'height'>> & Partial<Pick<WindowBounds, 'x' | 'y'>>,
  ): DesktopWindow {
    const window = this.requireOpenWindow(windowId);
    const bounds = this.normalizeBounds({
      ...window.bounds,
      ...nextSize,
    });
    window.bounds = bounds;
    this.touch(window);

    this.emit('windowUpdated', { window: this.cloneWindow(window) });
    this.emitSnapshotChanged();
    return this.cloneWindow(window);
  }

  on<K extends EventKey>(event: K, handler: EventHandler<K>): () => void {
    const typedHandler = handler as (payload: unknown) => void;
    const set = this.listeners.get(event) ?? new Set<(payload: unknown) => void>();
    set.add(typedHandler);
    this.listeners.set(event, set);
    return () => this.off(event, handler);
  }

  off<K extends EventKey>(event: K, handler: EventHandler<K>): void {
    const set = this.listeners.get(event);
    if (!set) {
      return;
    }
    set.delete(handler as (payload: unknown) => void);
    if (set.size === 0) {
      this.listeners.delete(event);
    }
  }

  snapshot(): { windows: DesktopWindow[]; apps: AppDefinition[] } {
    return {
      windows: this.listWindows({ includeClosed: false }),
      apps: this.listApps(),
    };
  }

  private emit<K extends EventKey>(event: K, payload: DesktopEngineEventMap[K]): void {
    const handlers = this.listeners.get(event);
    if (!handlers || handlers.size === 0) {
      return;
    }
    for (const handler of handlers) {
      handler(payload);
    }
  }

  private emitSnapshotChanged(): void {
    this.emit('snapshotChanged', this.snapshot());
  }

  private blurAllWindows(exceptId?: string): void {
    for (const window of this.windows.values()) {
      if (window.state === 'closed') {
        window.isFocused = false;
        continue;
      }
      window.isFocused = window.id === exceptId;
    }
  }

  private findOpenWindowByAppId(appId: string): DesktopWindow | undefined {
    for (const window of this.windows.values()) {
      if (window.appId === appId && window.state !== 'closed') {
        return window;
      }
    }
    return undefined;
  }

  private findTopWindow(): DesktopWindow | undefined {
    let top: DesktopWindow | undefined;
    for (const window of this.windows.values()) {
      if (window.state === 'closed' || window.state === 'minimized') {
        continue;
      }
      if (!top || window.zIndex > top.zIndex) {
        top = window;
      }
    }
    return top;
  }

  private normalizeBounds(bounds?: Partial<WindowBounds>): WindowBounds {
    const next = {
      ...this.defaultBounds,
      ...bounds,
    };

    const width = Math.max(this.minimumWindowSize.width, next.width);
    const height = Math.max(this.minimumWindowSize.height, next.height);
    const maxX = Math.max(0, this.desktopSize.width - width);
    const maxY = Math.max(0, this.desktopSize.height - height);

    return {
      x: this.clamp(next.x, 0, maxX),
      y: this.clamp(next.y, 0, maxY),
      width,
      height,
    };
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  private touch(window: DesktopWindow): void {
    window.updatedAt = Date.now();
  }

  private requireWindow(windowId: string): DesktopWindow {
    const window = this.windows.get(windowId);
    if (!window) {
      throw new Error(`Window "${windowId}" does not exist.`);
    }
    return window;
  }

  private requireOpenWindow(windowId: string): DesktopWindow {
    const window = this.requireWindow(windowId);
    if (window.state === 'closed') {
      throw new Error(`Window "${windowId}" is already closed.`);
    }
    return window;
  }

  private nextWindowId(): string {
    this.idCounter += 1;
    return `window-${this.idCounter}`;
  }

  private nextZIndex(): number {
    this.zCounter += 1;
    return this.zCounter;
  }

  private cloneWindow(window: DesktopWindow): DesktopWindow {
    return {
      ...window,
      bounds: { ...window.bounds },
    };
  }
}
