import type { CreateWindowInput, DesktopEngine, DesktopWindow, WindowBounds, WindowState } from './DesktopEngine.ts';

export interface AppLaunchContext {
  engine: DesktopEngine;
  app: AppDefinition;
  args?: unknown;
}

export interface AppLaunchResult {
  title?: string;
  bounds?: Partial<WindowBounds>;
  state?: Exclude<WindowState, 'closed'>;
  payload?: unknown;
}

export interface AppDefinition {
  id: string;
  name: string;
  defaultWindowTitle?: string;
  defaultBounds?: Partial<WindowBounds>;
  singleInstance?: boolean;
  launch?: (context: AppLaunchContext) => AppLaunchResult | Promise<AppLaunchResult | void> | void;
}

export interface LaunchAppInput {
  appId: string;
  args?: unknown;
  engine: DesktopEngine;
  findOpenWindowByAppId: (appId: string) => DesktopWindow | undefined;
  focusWindow: (windowId: string) => DesktopWindow;
  createWindow: (input: CreateWindowInput) => DesktopWindow;
}

export class AppRegistry {
  private readonly apps = new Map<string, AppDefinition>();

  register(app: AppDefinition): AppDefinition {
    if (!app.id.trim()) {
      throw new Error('App id cannot be empty.');
    }
    if (this.apps.has(app.id)) {
      throw new Error(`App "${app.id}" is already registered.`);
    }

    const storedApp = this.cloneApp(app);
    this.apps.set(storedApp.id, storedApp);
    return this.cloneApp(storedApp);
  }

  unregister(appId: string): boolean {
    return this.apps.delete(appId);
  }

  has(appId: string): boolean {
    return this.apps.has(appId);
  }

  get(appId: string): AppDefinition | undefined {
    const app = this.apps.get(appId);
    return app ? this.cloneApp(app) : undefined;
  }

  list(): AppDefinition[] {
    return Array.from(this.apps.values()).map((app) => this.cloneApp(app));
  }

  async launch(input: LaunchAppInput): Promise<DesktopWindow> {
    const app = this.apps.get(input.appId);
    if (!app) {
      throw new Error(`App "${input.appId}" is not registered.`);
    }

    if (app.singleInstance) {
      const existingWindow = input.findOpenWindowByAppId(input.appId);
      if (existingWindow) {
        return this.cloneWindow(input.focusWindow(existingWindow.id));
      }
    }

    const launchResult = app.launch
      ? await app.launch({
          engine: input.engine,
          app: this.cloneApp(app),
          args: input.args,
        })
      : undefined;

    const resolvedLaunchResult =
      launchResult && typeof launchResult === 'object' ? (launchResult as AppLaunchResult) : undefined;

    return this.cloneWindow(
      input.createWindow({
        appId: input.appId,
        title: resolvedLaunchResult?.title ?? app.defaultWindowTitle ?? app.name,
        bounds: {
          ...app.defaultBounds,
          ...resolvedLaunchResult?.bounds,
        },
        state: resolvedLaunchResult?.state,
        payload: resolvedLaunchResult?.payload,
      }),
    );
  }

  private cloneApp(app: AppDefinition): AppDefinition {
    return {
      ...app,
      defaultBounds: app.defaultBounds ? { ...app.defaultBounds } : undefined,
    };
  }

  private cloneWindow(window: DesktopWindow): DesktopWindow {
    return {
      ...window,
      bounds: { ...window.bounds },
    };
  }
}
