import { DesktopEngine, type DesktopWindow, type WindowBounds } from '../core/DesktopEngine.ts';
import { VirtualFileSystem, type VirtualFileSystemDirectoryEntry } from '../core/VirtualFileSystem.ts';

type DesktopAppKind = 'generic' | 'file-manager' | 'text-editor';

export interface DesktopIcon {
  id: string;
  label: string;
  glyph: string;
  tint?: string;
  appKind?: DesktopAppKind;
  startPath?: string;
}

export interface DesktopUIOptions {
  wallpaperUrl?: string;
  icons?: DesktopIcon[];
}

const DEFAULT_ICONS: DesktopIcon[] = [
  { id: 'explorer', label: 'Explorer', glyph: 'FM', tint: '#4ec8ff', appKind: 'file-manager', startPath: '/' },
  {
    id: 'notepad',
    label: 'Text Editor',
    glyph: 'TX',
    tint: '#ffd07f',
    appKind: 'text-editor',
    startPath: '/Users/Guest/Documents/Untitled.txt',
  },
  { id: 'browser', label: 'Browser', glyph: 'WE', tint: '#78ffb5' },
  { id: 'terminal', label: 'Terminal', glyph: '>_', tint: '#ffcf6d' },
  { id: 'mail', label: 'Mail', glyph: '@@', tint: '#ff9fb6' },
  { id: 'store', label: 'Store', glyph: 'ST', tint: '#cba7ff' },
  { id: 'notes', label: 'Notes', glyph: 'NT', tint: '#ffd07f' },
];

const DESKTOP_STYLE_ID = 'desktop-ui-style';
const WINDOW_CASCADE_STEP_X = 28;
const WINDOW_CASCADE_STEP_Y = 24;
const WINDOW_CASCADE_COLUMNS = 7;
const WINDOW_CASCADE_ROWS = 5;
const DEFAULT_TEXT_EDITOR_PATH = '/Users/Guest/Documents/Untitled.txt';

type ResizeVector = -1 | 0 | 1;

interface WindowInteractionSession {
  windowId: string;
  mode: 'move' | 'resize';
  edgeX: ResizeVector;
  edgeY: ResizeVector;
  startPointerX: number;
  startPointerY: number;
  startBounds: WindowBounds;
}

interface WindowVisualPayload {
  glyph?: string;
  tint?: string;
  appKind?: DesktopAppKind;
  startPath?: string;
}

interface FileManagerViewState {
  path: string;
  status: 'loading' | 'ready' | 'error';
  entries: VirtualFileSystemDirectoryEntry[];
  errorMessage: string | null;
}

interface TextEditorViewState {
  path: string;
  content: string;
  status: 'loading' | 'ready' | 'saving' | 'error';
  errorMessage: string | null;
  dirty: boolean;
  lastSavedAt: number | null;
}

export class DesktopUI {
  private timerId: number | null = null;
  private mounted = false;
  private readonly host: HTMLElement;
  private readonly options: DesktopUIOptions;
  private readonly engine = new DesktopEngine();
  private readonly fileSystem = new VirtualFileSystem();
  private readonly icons: DesktopIcon[];
  private readonly iconById = new Map<string, DesktopIcon>();
  private readonly fileManagerAppIds = new Set<string>();
  private readonly textEditorAppIds = new Set<string>();
  private readonly fileManagerViews = new Map<string, FileManagerViewState>();
  private readonly textEditorViews = new Map<string, TextEditorViewState>();
  private fileSystemInitPromise: Promise<void> | null = null;
  private interaction: WindowInteractionSession | null = null;
  private windowSequence = 0;
  private unsubscribeSnapshot: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeHandler: (() => void) | null = null;

  private readonly handleHostClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const closeButton = target.closest<HTMLButtonElement>('[data-window-close]');
    if (closeButton) {
      const windowElement = closeButton.closest<HTMLElement>('[data-window-id]');
      if (!windowElement) {
        return;
      }
      this.engine.closeWindow(windowElement.dataset.windowId ?? '');
      return;
    }

    const launchButton = target.closest<HTMLButtonElement>('[data-launch-app]');
    if (launchButton) {
      void this.launchIconApp(launchButton.dataset.launchApp ?? '');
      return;
    }

    const taskButton = target.closest<HTMLButtonElement>('[data-task-window-id]');
    if (taskButton) {
      this.activateWindowFromTaskbar(taskButton.dataset.taskWindowId ?? '');
      return;
    }

    const openPathButton = target.closest<HTMLButtonElement>('[data-fm-open-path]');
    if (openPathButton) {
      const windowElement = openPathButton.closest<HTMLElement>('[data-window-id]');
      if (!windowElement) {
        return;
      }
      void this.openFileManagerPath(windowElement.dataset.windowId ?? '', openPathButton.dataset.fmOpenPath ?? '');
      return;
    }

    const openFileButton = target.closest<HTMLButtonElement>('[data-fm-open-file]');
    if (openFileButton) {
      void this.openFileInTextEditor(openFileButton.dataset.fmOpenFile ?? '');
      return;
    }

    const breadcrumbButton = target.closest<HTMLButtonElement>('[data-fm-breadcrumb-path]');
    if (breadcrumbButton) {
      const windowElement = breadcrumbButton.closest<HTMLElement>('[data-window-id]');
      if (!windowElement) {
        return;
      }
      void this.openFileManagerPath(
        windowElement.dataset.windowId ?? '',
        breadcrumbButton.dataset.fmBreadcrumbPath ?? '',
      );
      return;
    }

    const upButton = target.closest<HTMLButtonElement>('[data-fm-up-path]');
    if (upButton) {
      const windowElement = upButton.closest<HTMLElement>('[data-window-id]');
      if (!windowElement) {
        return;
      }
      void this.openFileManagerPath(windowElement.dataset.windowId ?? '', upButton.dataset.fmUpPath ?? '');
      return;
    }

    const editorOpenButton = target.closest<HTMLButtonElement>('[data-editor-open]');
    if (editorOpenButton) {
      const windowElement = editorOpenButton.closest<HTMLElement>('[data-window-id]');
      if (!windowElement) {
        return;
      }
      const pathInput = windowElement.querySelector<HTMLInputElement>('[data-editor-path]');
      const nextPath = pathInput?.value ?? '';
      void this.openTextEditorPath(windowElement.dataset.windowId ?? '', nextPath);
      return;
    }

    const editorSaveButton = target.closest<HTMLButtonElement>('[data-editor-save]');
    if (editorSaveButton) {
      const windowElement = editorSaveButton.closest<HTMLElement>('[data-window-id]');
      if (!windowElement) {
        return;
      }
      void this.saveTextEditorWindow(windowElement.dataset.windowId ?? '');
      return;
    }

    const iconButton = target.closest<HTMLButtonElement>('[data-icon-id]');
    if (iconButton) {
      this.setSelectedIcon(iconButton.dataset.iconId ?? null);
      return;
    }

    if (target.closest('[data-window-id]')) {
      return;
    }

    this.setSelectedIcon(null);
  };

  private readonly handleHostDoubleClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const iconButton = target.closest<HTMLButtonElement>('[data-icon-id]');
    if (!iconButton) {
      return;
    }
    void this.launchIconApp(iconButton.dataset.iconId ?? '');
  };

  private readonly handleHostPointerDown = (event: PointerEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const windowElement = target.closest<HTMLElement>('[data-window-id]');
    if (!windowElement) {
      return;
    }

    const windowId = windowElement.dataset.windowId ?? '';
    if (!windowId) {
      return;
    }

    this.focusWindow(windowId);

    const closeButton = target.closest('[data-window-close]');
    if (closeButton) {
      return;
    }

    const resizeHandle = target.closest<HTMLElement>('[data-resize-x][data-resize-y]');
    if (resizeHandle) {
      const edgeX = this.parseResizeVector(resizeHandle.dataset.resizeX);
      const edgeY = this.parseResizeVector(resizeHandle.dataset.resizeY);
      if (edgeX === 0 && edgeY === 0) {
        return;
      }
      this.beginInteraction(event, windowId, 'resize', edgeX, edgeY);
      return;
    }

    const dragger = target.closest('[data-window-dragger]');
    if (!dragger) {
      return;
    }
    this.beginInteraction(event, windowId, 'move', 0, 0);
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.interaction) {
      return;
    }

    const { windowId, mode, edgeX, edgeY, startBounds, startPointerX, startPointerY } = this.interaction;
    const deltaX = event.clientX - startPointerX;
    const deltaY = event.clientY - startPointerY;

    if (mode === 'move') {
      this.engine.moveWindow(windowId, {
        x: startBounds.x + deltaX,
        y: startBounds.y + deltaY,
      });
      return;
    }

    const nextBounds: Partial<WindowBounds> = {};
    if (edgeX === -1) {
      nextBounds.x = startBounds.x + deltaX;
      nextBounds.width = startBounds.width - deltaX;
    } else if (edgeX === 1) {
      nextBounds.width = startBounds.width + deltaX;
    }

    if (edgeY === -1) {
      nextBounds.y = startBounds.y + deltaY;
      nextBounds.height = startBounds.height - deltaY;
    } else if (edgeY === 1) {
      nextBounds.height = startBounds.height + deltaY;
    }

    this.engine.resizeWindow(windowId, nextBounds);
  };

  private readonly handlePointerStop = (): void => {
    this.endInteraction();
  };

  private readonly handleHostInput = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const editorContent = target.closest<HTMLTextAreaElement>('[data-editor-content]');
    if (editorContent) {
      const windowId = editorContent.dataset.editorContent ?? '';
      const view = this.getTextEditorViewByWindowId(windowId);
      if (!view) {
        return;
      }
      view.content = editorContent.value;
      view.dirty = true;
      if (view.status === 'error') {
        view.status = 'ready';
        view.errorMessage = null;
      }
      return;
    }

    const editorPath = target.closest<HTMLInputElement>('[data-editor-path]');
    if (editorPath) {
      const windowId = editorPath.dataset.editorPath ?? '';
      const view = this.getTextEditorViewByWindowId(windowId);
      if (!view) {
        return;
      }
      view.path = editorPath.value;
    }
  };

  constructor(host: HTMLElement, options: DesktopUIOptions = {}) {
    this.host = host;
    this.options = options;
    this.icons = (this.options.icons ?? DEFAULT_ICONS).map((icon) => ({ ...icon }));
    for (const icon of this.icons) {
      if (icon.id.trim() && !this.iconById.has(icon.id)) {
        this.iconById.set(icon.id, icon);
      }
    }
  }

  mount(): void {
    if (this.mounted) {
      return;
    }

    this.injectStyles();
    this.host.innerHTML = this.renderMarkup();
    this.host.classList.add('desktop-ui-host');
    this.syncDesktopSize();
    void this.ensureFileSystemReady();
    this.registerIconApps();
    this.bindEvents();
    this.trackDesktopResize();
    this.unsubscribeSnapshot = this.engine.on('snapshotChanged', () => {
      this.renderWindows();
      this.renderRunningWindows();
    });
    this.renderWindows();
    this.renderRunningWindows();
    this.startClock();
    this.mounted = true;
  }

  destroy(): void {
    if (!this.mounted) {
      return;
    }

    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }

    this.endInteraction();
    this.unbindEvents();
    if (this.unsubscribeSnapshot) {
      this.unsubscribeSnapshot();
      this.unsubscribeSnapshot = null;
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }

    this.fileManagerViews.clear();
    this.textEditorViews.clear();
    this.fileManagerAppIds.clear();
    this.textEditorAppIds.clear();
    this.fileSystemInitPromise = null;

    this.host.classList.remove('desktop-ui-host');
    this.host.innerHTML = '';
    this.mounted = false;
  }

  private injectStyles(): void {
    if (document.getElementById(DESKTOP_STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = DESKTOP_STYLE_ID;
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Manrope:wght@400;500;700&family=Space+Grotesk:wght@500;700&display=swap');

      .desktop-ui-host {
        width: 100%;
        height: 100%;
      }

      .desktop-ui {
        --desk-text: #f8fbff;
        --desk-subtle: #c2d3f3;
        --desk-taskbar-bg: rgba(12, 23, 44, 0.7);
        --desk-taskbar-border: rgba(255, 255, 255, 0.18);
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
        color: var(--desk-text);
        font-family: 'Manrope', 'Segoe UI', 'Tahoma', sans-serif;
        background: radial-gradient(circle at 18% 16%, #5a7dff 0%, transparent 44%),
          radial-gradient(circle at 86% 22%, #2fcbff 0%, transparent 38%),
          linear-gradient(150deg, #091935 0%, #0e1f46 44%, #1a2f6b 100%);
      }

      .desktop-ui__wallpaper {
        position: absolute;
        inset: 0;
        background-size: cover;
        background-position: center;
        opacity: 0.34;
      }

      .desktop-ui__glass {
        position: absolute;
        inset: 0;
        background:
          linear-gradient(120deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.01)),
          repeating-linear-gradient(
            90deg,
            rgba(255, 255, 255, 0.03) 0px,
            rgba(255, 255, 255, 0.03) 1px,
            transparent 1px,
            transparent 120px
          );
        pointer-events: none;
      }

      .desktop-ui__icons {
        position: absolute;
        top: 1.35rem;
        left: 1.2rem;
        display: grid;
        grid-template-columns: repeat(2, minmax(88px, 96px));
        gap: 0.9rem;
        z-index: 2;
      }

      .desktop-ui__icon {
        border: 0;
        background: transparent;
        color: var(--desk-text);
        display: grid;
        justify-items: center;
        align-content: start;
        gap: 0.42rem;
        cursor: pointer;
        border-radius: 14px;
        padding: 0.44rem 0.28rem;
        opacity: 0;
        transform: translateY(16px);
        animation: desktop-ui-enter 440ms ease forwards;
      }

      .desktop-ui__icon:hover,
      .desktop-ui__icon:focus-visible,
      .desktop-ui__icon.is-selected {
        background: rgba(255, 255, 255, 0.12);
        outline: none;
      }

      .desktop-ui__icon-tile {
        width: 50px;
        height: 50px;
        border-radius: 13px;
        display: grid;
        place-items: center;
        font-family: 'Space Grotesk', 'Trebuchet MS', sans-serif;
        font-size: 0.94rem;
        font-weight: 700;
        letter-spacing: 0.03em;
        color: #071225;
        background:
          radial-gradient(circle at 30% 25%, rgba(255, 255, 255, 0.82), rgba(255, 255, 255, 0.2) 62%),
          linear-gradient(150deg, var(--icon-tint), #ffffff);
        box-shadow: 0 8px 20px rgba(7, 20, 41, 0.32);
      }

      .desktop-ui__icon-label {
        font-size: 0.77rem;
        color: var(--desk-subtle);
        line-height: 1.16;
        text-align: center;
      }

      .desktop-ui__windows {
        position: absolute;
        inset: 0;
        z-index: 3;
        pointer-events: none;
      }

      .desktop-ui__window {
        position: absolute;
        display: flex;
        flex-direction: column;
        border-radius: 14px;
        border: 1px solid rgba(144, 203, 255, 0.34);
        background:
          linear-gradient(180deg, rgba(13, 31, 60, 0.96), rgba(9, 22, 48, 0.96));
        backdrop-filter: blur(12px);
        box-shadow: 0 16px 34px rgba(5, 16, 36, 0.52);
        overflow: hidden;
        pointer-events: auto;
      }

      .desktop-ui__window.is-focused {
        border-color: rgba(116, 214, 255, 0.88);
        box-shadow: 0 20px 44px rgba(2, 13, 30, 0.68);
      }

      .desktop-ui__window.is-maximized {
        border-radius: 0;
      }

      .desktop-ui__window-titlebar {
        height: 42px;
        padding: 0 0.5rem 0 0.7rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.65rem;
        background: linear-gradient(180deg, rgba(191, 226, 255, 0.16), rgba(79, 153, 214, 0.06));
        border-bottom: 1px solid rgba(162, 206, 255, 0.24);
        cursor: move;
        user-select: none;
      }

      .desktop-ui__window-title {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        min-width: 0;
        font-size: 0.82rem;
        font-weight: 600;
      }

      .desktop-ui__window-glyph {
        width: 22px;
        height: 22px;
        border-radius: 7px;
        display: grid;
        place-items: center;
        font-size: 0.65rem;
        font-weight: 700;
        color: #071225;
        background: linear-gradient(160deg, var(--window-tint), #ffffff);
      }

      .desktop-ui__window-title-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .desktop-ui__window-controls {
        display: flex;
        align-items: center;
        gap: 0.3rem;
      }

      .desktop-ui__window-close {
        width: 27px;
        height: 27px;
        border-radius: 8px;
        border: 0;
        color: #f7faff;
        font-size: 1rem;
        line-height: 1;
        background: rgba(255, 122, 152, 0.34);
        cursor: pointer;
      }

      .desktop-ui__window-close:hover,
      .desktop-ui__window-close:focus-visible {
        background: rgba(255, 88, 128, 0.88);
        outline: none;
      }

      .desktop-ui__window-content {
        flex: 1;
        padding: 0.9rem 1rem 1.1rem;
        display: grid;
        align-content: start;
        gap: 0.52rem;
        font-size: 0.83rem;
        color: #d2e8ff;
        user-select: text;
      }

      .desktop-ui__window-content p {
        margin: 0;
      }

      .desktop-ui__window-label {
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.07em;
        color: #9fc4ed;
      }

      .desktop-ui__window-content.is-file-manager {
        padding: 0;
        gap: 0;
      }

      .desktop-ui__fm {
        display: grid;
        grid-template-rows: auto auto 1fr;
        height: 100%;
        min-height: 0;
      }

      .desktop-ui__fm-toolbar {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.62rem 0.72rem;
        border-bottom: 1px solid rgba(140, 197, 246, 0.22);
        background: rgba(6, 17, 36, 0.55);
      }

      .desktop-ui__fm-button {
        height: 30px;
        min-width: 34px;
        border-radius: 9px;
        border: 1px solid rgba(161, 212, 255, 0.3);
        background: rgba(255, 255, 255, 0.08);
        color: #e5f6ff;
        font-size: 0.74rem;
        cursor: pointer;
      }

      .desktop-ui__fm-button:disabled {
        opacity: 0.45;
        cursor: default;
      }

      .desktop-ui__fm-button:not(:disabled):hover,
      .desktop-ui__fm-button:not(:disabled):focus-visible {
        background: rgba(122, 204, 255, 0.28);
        border-color: rgba(150, 227, 255, 0.74);
        outline: none;
      }

      .desktop-ui__fm-path {
        padding: 0.5rem 0.72rem;
        border-bottom: 1px solid rgba(151, 202, 246, 0.2);
        display: flex;
        align-items: center;
        gap: 0.3rem;
        flex-wrap: wrap;
        background: rgba(6, 17, 36, 0.35);
      }

      .desktop-ui__fm-crumb {
        border: 0;
        border-radius: 8px;
        padding: 0.16rem 0.46rem;
        background: rgba(255, 255, 255, 0.1);
        color: #e4f6ff;
        font-size: 0.72rem;
        cursor: pointer;
      }

      .desktop-ui__fm-crumb:hover,
      .desktop-ui__fm-crumb:focus-visible {
        background: rgba(124, 201, 255, 0.3);
        outline: none;
      }

      .desktop-ui__fm-sep {
        color: rgba(196, 221, 255, 0.8);
        font-size: 0.68rem;
      }

      .desktop-ui__fm-list {
        margin: 0;
        padding: 0.5rem 0.46rem 0.8rem;
        list-style: none;
        overflow: auto;
        display: grid;
        align-content: start;
        gap: 0.28rem;
      }

      .desktop-ui__fm-item {
        display: flex;
      }

      .desktop-ui__fm-entry {
        width: 100%;
        border: 1px solid rgba(170, 213, 255, 0.16);
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.04);
        padding: 0.44rem 0.56rem;
        color: #e9f8ff;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        font-size: 0.78rem;
        text-align: left;
      }

      .desktop-ui__fm-entry {
        cursor: pointer;
      }

      .desktop-ui__fm-entry:hover,
      .desktop-ui__fm-entry:focus-visible {
        border-color: rgba(152, 222, 255, 0.78);
        background: rgba(126, 199, 255, 0.22);
        outline: none;
      }

      .desktop-ui__fm-name {
        display: inline-flex;
        align-items: center;
        gap: 0.38rem;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .desktop-ui__fm-kind {
        font-size: 0.68rem;
        color: #9bc4f2;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      .desktop-ui__fm-state {
        padding: 1.1rem 1rem;
        color: #c7dff9;
        font-size: 0.8rem;
      }

      .desktop-ui__window-content.is-text-editor {
        padding: 0;
        gap: 0;
      }

      .desktop-ui__editor {
        display: grid;
        grid-template-rows: auto auto 1fr;
        height: 100%;
        min-height: 0;
      }

      .desktop-ui__editor-toolbar {
        display: grid;
        grid-template-columns: 1fr auto auto;
        gap: 0.48rem;
        padding: 0.66rem 0.72rem;
        border-bottom: 1px solid rgba(140, 197, 246, 0.22);
        background: rgba(6, 17, 36, 0.55);
      }

      .desktop-ui__editor-path {
        min-width: 0;
        height: 32px;
        border: 1px solid rgba(161, 212, 255, 0.3);
        border-radius: 9px;
        background: rgba(255, 255, 255, 0.1);
        color: #eef7ff;
        padding: 0 0.6rem;
        font-size: 0.76rem;
        font-family: 'Manrope', 'Segoe UI', sans-serif;
      }

      .desktop-ui__editor-path:focus-visible {
        outline: 1px solid rgba(149, 219, 255, 0.75);
        border-color: rgba(149, 219, 255, 0.75);
      }

      .desktop-ui__editor-button {
        height: 32px;
        min-width: 66px;
        border-radius: 9px;
        border: 1px solid rgba(161, 212, 255, 0.3);
        background: rgba(255, 255, 255, 0.08);
        color: #e5f6ff;
        font-size: 0.74rem;
        cursor: pointer;
      }

      .desktop-ui__editor-button:hover,
      .desktop-ui__editor-button:focus-visible {
        background: rgba(122, 204, 255, 0.28);
        border-color: rgba(150, 227, 255, 0.74);
        outline: none;
      }

      .desktop-ui__editor-button:disabled {
        opacity: 0.45;
        cursor: default;
      }

      .desktop-ui__editor-button.is-save {
        background: rgba(145, 242, 190, 0.2);
        border-color: rgba(145, 242, 190, 0.54);
      }

      .desktop-ui__editor-meta {
        min-height: 26px;
        padding: 0.42rem 0.72rem;
        border-bottom: 1px solid rgba(151, 202, 246, 0.2);
        background: rgba(6, 17, 36, 0.35);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.4rem;
      }

      .desktop-ui__editor-status {
        font-size: 0.73rem;
        color: #cbe4ff;
      }

      .desktop-ui__editor-status.is-error {
        color: #ffb4c2;
      }

      .desktop-ui__editor-label {
        font-size: 0.68rem;
        color: #95b8dd;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      .desktop-ui__editor-content {
        resize: none;
        width: 100%;
        height: 100%;
        min-height: 0;
        border: 0;
        margin: 0;
        padding: 0.92rem 0.96rem;
        color: #ecf7ff;
        background: rgba(4, 13, 29, 0.74);
        font-family: 'IBM Plex Mono', 'Fira Code', 'Consolas', monospace;
        font-size: 0.79rem;
        line-height: 1.5;
        box-sizing: border-box;
      }

      .desktop-ui__editor-content:focus-visible {
        outline: 1px solid rgba(122, 204, 255, 0.5);
      }

      .desktop-ui__resize-handle {
        position: absolute;
      }

      .desktop-ui__resize-handle.is-n,
      .desktop-ui__resize-handle.is-s {
        left: 12px;
        right: 12px;
        height: 10px;
      }

      .desktop-ui__resize-handle.is-n {
        top: -5px;
        cursor: n-resize;
      }

      .desktop-ui__resize-handle.is-s {
        bottom: -5px;
        cursor: s-resize;
      }

      .desktop-ui__resize-handle.is-e,
      .desktop-ui__resize-handle.is-w {
        top: 12px;
        bottom: 12px;
        width: 10px;
      }

      .desktop-ui__resize-handle.is-e {
        right: -5px;
        cursor: e-resize;
      }

      .desktop-ui__resize-handle.is-w {
        left: -5px;
        cursor: w-resize;
      }

      .desktop-ui__resize-handle.is-ne,
      .desktop-ui__resize-handle.is-nw,
      .desktop-ui__resize-handle.is-se,
      .desktop-ui__resize-handle.is-sw {
        width: 14px;
        height: 14px;
      }

      .desktop-ui__resize-handle.is-ne {
        top: -6px;
        right: -6px;
        cursor: ne-resize;
      }

      .desktop-ui__resize-handle.is-nw {
        top: -6px;
        left: -6px;
        cursor: nw-resize;
      }

      .desktop-ui__resize-handle.is-se {
        right: -6px;
        bottom: -6px;
        cursor: se-resize;
      }

      .desktop-ui__resize-handle.is-sw {
        left: -6px;
        bottom: -6px;
        cursor: sw-resize;
      }

      .desktop-ui__taskbar {
        position: absolute;
        left: 50%;
        bottom: 0.72rem;
        transform: translateX(-50%);
        z-index: 4;
        width: min(840px, calc(100% - 1rem));
        border-radius: 20px;
        border: 1px solid var(--desk-taskbar-border);
        background: var(--desk-taskbar-bg);
        backdrop-filter: blur(12px);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.72rem;
        padding: 0.5rem 0.66rem;
        box-shadow: 0 16px 30px rgba(4, 14, 32, 0.4);
        animation: desktop-ui-taskbar-enter 500ms ease;
      }

      .desktop-ui__start {
        width: 42px;
        height: 42px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.24);
        background: linear-gradient(150deg, rgba(99, 156, 255, 0.88), rgba(99, 238, 255, 0.88));
        color: #06213f;
        font-family: 'Space Grotesk', 'Trebuchet MS', sans-serif;
        font-size: 0.74rem;
        font-weight: 700;
        cursor: pointer;
      }

      .desktop-ui__taskbar-mid {
        display: flex;
        align-items: center;
        flex: 1;
        gap: 0.72rem;
        min-width: 0;
      }

      .desktop-ui__pinned {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .desktop-ui__pin {
        width: 36px;
        height: 36px;
        border-radius: 11px;
        border: 0;
        cursor: pointer;
        color: #dff3ff;
        background: rgba(255, 255, 255, 0.14);
      }

      .desktop-ui__running {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        min-width: 0;
        overflow-x: auto;
      }

      .desktop-ui__running::-webkit-scrollbar {
        display: none;
      }

      .desktop-ui__task-item {
        height: 33px;
        max-width: 170px;
        border-radius: 10px;
        border: 1px solid rgba(178, 215, 255, 0.3);
        background: rgba(255, 255, 255, 0.1);
        color: #e4f4ff;
        font-size: 0.72rem;
        padding: 0 0.6rem;
        cursor: pointer;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .desktop-ui__task-item.is-active {
        border-color: rgba(126, 220, 255, 0.82);
        background: rgba(132, 195, 255, 0.25);
      }

      .desktop-ui__tray {
        min-width: 94px;
        text-align: right;
      }

      .desktop-ui__clock {
        font-size: 0.75rem;
        color: var(--desk-text);
        font-weight: 600;
        line-height: 1.25;
      }

      @keyframes desktop-ui-enter {
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @keyframes desktop-ui-taskbar-enter {
        from {
          opacity: 0;
          transform: translate(-50%, 24px);
        }
        to {
          opacity: 1;
          transform: translate(-50%, 0);
        }
      }

      @media (max-width: 760px) {
        .desktop-ui__icons {
          grid-template-columns: repeat(2, minmax(78px, 1fr));
          top: 0.95rem;
          left: 0.75rem;
          gap: 0.62rem;
        }

        .desktop-ui__taskbar {
          width: calc(100% - 0.7rem);
          bottom: 0.36rem;
          padding: 0.44rem;
        }

        .desktop-ui__taskbar-mid {
          gap: 0.4rem;
        }

        .desktop-ui__pinned {
          gap: 0.36rem;
        }

        .desktop-ui__pin {
          width: 34px;
          height: 34px;
        }

        .desktop-ui__task-item {
          max-width: 120px;
        }

        .desktop-ui__fm-toolbar {
          padding: 0.54rem;
        }

        .desktop-ui__fm-path {
          padding: 0.44rem 0.54rem;
        }

        .desktop-ui__fm-entry {
          padding: 0.4rem 0.46rem;
          font-size: 0.74rem;
        }

        .desktop-ui__editor-toolbar {
          grid-template-columns: 1fr;
        }

        .desktop-ui__editor-button {
          width: 100%;
        }
      }
    `;
    document.head.append(style);
  }

  private renderMarkup(): string {
    const iconNodes = this.icons
      .map(
        (icon, index) => `
        <button class="desktop-ui__icon" data-icon-id="${this.escapeAttribute(icon.id)}" style="animation-delay:${index * 70}ms" type="button">
          <span class="desktop-ui__icon-tile" style="--icon-tint:${this.escapeAttribute(icon.tint ?? '#87c4ff')}">${this.escapeHtml(icon.glyph)}</span>
          <span class="desktop-ui__icon-label">${this.escapeHtml(icon.label)}</span>
        </button>
      `,
      )
      .join('');

    const pinnedNodes = this.icons
      .slice(0, 4)
      .map(
        (icon) => `
          <button class="desktop-ui__pin" type="button" data-launch-app="${this.escapeAttribute(icon.id)}" aria-label="Launch ${this.escapeAttribute(icon.label)}">
            ${this.escapeHtml(icon.glyph)}
          </button>
        `,
      )
      .join('');

    const wallpaperStyle = this.options.wallpaperUrl
      ? `style="background-image:url('${this.escapeAttribute(this.options.wallpaperUrl)}')"`
      : '';

    return `
      <section class="desktop-ui" aria-label="Desktop">
        <div class="desktop-ui__wallpaper" ${wallpaperStyle}></div>
        <div class="desktop-ui__glass"></div>
        <div class="desktop-ui__icons" role="list">
          ${iconNodes}
        </div>
        <div class="desktop-ui__windows" data-window-layer aria-live="polite"></div>
        <footer class="desktop-ui__taskbar" aria-label="Taskbar">
          <button class="desktop-ui__start" type="button" aria-label="Open Start">WIN</button>
          <div class="desktop-ui__taskbar-mid">
            <div class="desktop-ui__pinned">
              ${pinnedNodes}
            </div>
            <div class="desktop-ui__running" data-running-windows></div>
          </div>
          <div class="desktop-ui__tray">
            <div class="desktop-ui__clock" data-desktop-clock></div>
          </div>
        </footer>
      </section>
    `;
  }

  private bindEvents(): void {
    this.host.addEventListener('click', this.handleHostClick);
    this.host.addEventListener('dblclick', this.handleHostDoubleClick);
    this.host.addEventListener('pointerdown', this.handleHostPointerDown);
    this.host.addEventListener('input', this.handleHostInput);
  }

  private unbindEvents(): void {
    this.host.removeEventListener('click', this.handleHostClick);
    this.host.removeEventListener('dblclick', this.handleHostDoubleClick);
    this.host.removeEventListener('pointerdown', this.handleHostPointerDown);
    this.host.removeEventListener('input', this.handleHostInput);
  }

  private startClock(): void {
    const clock = this.host.querySelector<HTMLElement>('[data-desktop-clock]');
    if (!clock) {
      return;
    }

    const render = () => {
      const now = new Date();
      const time = new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      }).format(now);
      const date = new Intl.DateTimeFormat(undefined, {
        day: '2-digit',
        month: 'short',
      }).format(now);
      clock.textContent = `${time} · ${date}`;
    };

    render();
    this.timerId = window.setInterval(render, 1000 * 30);
  }

  private async ensureFileSystemReady(): Promise<void> {
    if (!this.fileSystemInitPromise) {
      this.fileSystemInitPromise = (async () => {
        await this.fileSystem.init();
        await this.seedVirtualFileSystem();
      })();
    }
    await this.fileSystemInitPromise;
  }

  private async seedVirtualFileSystem(): Promise<void> {
    await this.createDirectoryIfMissing('/Users/Guest');
    await this.createDirectoryIfMissing('/Users/Guest/Desktop');
    await this.createDirectoryIfMissing('/Users/Guest/Documents');
    await this.createDirectoryIfMissing('/Users/Guest/Downloads');
    await this.createDirectoryIfMissing('/Projects/WebWindows11');

    await this.createFileIfMissing(
      '/Users/Guest/Documents/Readme.txt',
      'Welcome to the virtual file system.\nUse the File Manager to navigate folders.',
    );
    await this.createFileIfMissing('/Users/Guest/Documents/Tasks.md', '- Build file manager UI\n- Add folder navigation');
    await this.createFileIfMissing('/Users/Guest/Downloads/wallpaper.jpg', 'binary-preview-disabled');
    await this.createFileIfMissing('/Projects/WebWindows11/notes.txt', 'Desktop simulator prototype workspace');
  }

  private async createDirectoryIfMissing(path: string): Promise<void> {
    if (await this.fileSystem.exists(path)) {
      return;
    }
    await this.fileSystem.mkdir(path, { recursive: true });
  }

  private async createFileIfMissing(path: string, content: string): Promise<void> {
    if (await this.fileSystem.exists(path)) {
      return;
    }
    await this.fileSystem.writeFile(path, content, { createParents: true });
  }

  private registerIconApps(): void {
    for (const icon of this.iconById.values()) {
      const appKind = this.resolveAppKind(icon);
      const startPath = this.resolveStartPath(icon, appKind);
      if (appKind === 'file-manager') {
        this.fileManagerAppIds.add(icon.id);
      }
      if (appKind === 'text-editor') {
        this.textEditorAppIds.add(icon.id);
      }

      this.engine.registerApp({
        id: icon.id,
        name: icon.label,
        defaultWindowTitle: icon.label,
        launch: (context) => {
          const launchPath =
            appKind === 'text-editor'
              ? this.resolveTextEditorLaunchPath(context.args, startPath ?? DEFAULT_TEXT_EDITOR_PATH)
              : startPath;
          return {
            title: appKind === 'text-editor' ? this.getTextEditorWindowTitle(icon.label, launchPath) : icon.label,
            bounds: this.nextWindowBounds(),
            payload: { glyph: icon.glyph, tint: icon.tint, appKind, startPath: launchPath },
          };
        },
      });
    }
  }

  private resolveAppKind(icon: DesktopIcon): DesktopAppKind {
    if (icon.appKind) {
      return icon.appKind;
    }
    if (icon.id === 'explorer') {
      return 'file-manager';
    }
    if (icon.id === 'notepad') {
      return 'text-editor';
    }
    return 'generic';
  }

  private resolveStartPath(icon: DesktopIcon, appKind: DesktopAppKind): string | undefined {
    if (appKind === 'file-manager') {
      return icon.startPath ?? '/';
    }
    if (appKind === 'text-editor') {
      return icon.startPath ?? DEFAULT_TEXT_EDITOR_PATH;
    }
    return undefined;
  }

  private nextWindowBounds(): Partial<WindowBounds> {
    const column = this.windowSequence % WINDOW_CASCADE_COLUMNS;
    const row = Math.floor(this.windowSequence / WINDOW_CASCADE_COLUMNS) % WINDOW_CASCADE_ROWS;
    this.windowSequence = (this.windowSequence + 1) % (WINDOW_CASCADE_COLUMNS * WINDOW_CASCADE_ROWS);
    return {
      x: 86 + column * WINDOW_CASCADE_STEP_X,
      y: 74 + row * WINDOW_CASCADE_STEP_Y,
      width: 760,
      height: 460,
    };
  }

  private async launchIconApp(appId: string): Promise<void> {
    if (!this.iconById.has(appId)) {
      return;
    }
    await this.engine.launchApp(appId);
    this.setSelectedIcon(appId);
  }

  private activateWindowFromTaskbar(windowId: string): void {
    const desktopWindow = this.engine.getWindow(windowId);
    if (!desktopWindow || desktopWindow.state === 'closed') {
      return;
    }
    if (desktopWindow.state === 'minimized') {
      this.engine.restoreWindow(windowId);
      return;
    }
    this.engine.focusWindow(windowId);
  }

  private focusWindow(windowId: string): void {
    const desktopWindow = this.engine.getWindow(windowId);
    if (!desktopWindow || desktopWindow.state === 'closed') {
      return;
    }
    if (desktopWindow.state === 'minimized') {
      this.engine.restoreWindow(windowId);
      return;
    }
    if (desktopWindow.isFocused) {
      return;
    }
    this.engine.focusWindow(windowId);
  }

  private beginInteraction(
    event: PointerEvent,
    windowId: string,
    mode: WindowInteractionSession['mode'],
    edgeX: ResizeVector,
    edgeY: ResizeVector,
  ): void {
    const desktopWindow = this.engine.getWindow(windowId);
    if (!desktopWindow || desktopWindow.state !== 'normal') {
      return;
    }

    this.interaction = {
      windowId,
      mode,
      edgeX,
      edgeY,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      startBounds: desktopWindow.bounds,
    };

    document.addEventListener('pointermove', this.handlePointerMove);
    document.addEventListener('pointerup', this.handlePointerStop);
    document.addEventListener('pointercancel', this.handlePointerStop);
    event.preventDefault();
  }

  private endInteraction(): void {
    if (!this.interaction) {
      return;
    }
    this.interaction = null;
    document.removeEventListener('pointermove', this.handlePointerMove);
    document.removeEventListener('pointerup', this.handlePointerStop);
    document.removeEventListener('pointercancel', this.handlePointerStop);
  }

  private parseResizeVector(value: string | undefined): ResizeVector {
    if (value === '-1') {
      return -1;
    }
    if (value === '1') {
      return 1;
    }
    return 0;
  }

  private renderWindows(): void {
    const layer = this.host.querySelector<HTMLElement>('[data-window-layer]');
    if (!layer) {
      return;
    }

    const allWindows = this.engine.listWindows();
    this.cleanupWindowViews(allWindows);
    const visibleWindows = allWindows.filter((window) => window.state !== 'minimized');
    layer.innerHTML = visibleWindows.map((window) => this.renderWindow(window)).join('');
  }

  private cleanupWindowViews(windows: DesktopWindow[]): void {
    const activeWindowIds = new Set(windows.map((window) => window.id));
    for (const windowId of this.fileManagerViews.keys()) {
      if (!activeWindowIds.has(windowId)) {
        this.fileManagerViews.delete(windowId);
      }
    }
    for (const windowId of this.textEditorViews.keys()) {
      if (!activeWindowIds.has(windowId)) {
        this.textEditorViews.delete(windowId);
      }
    }
  }

  private renderWindow(windowEntry: DesktopWindow): string {
    const icon = this.iconById.get(windowEntry.appId);
    const payload = this.readWindowPayload(windowEntry);
    const glyph = payload.glyph ?? icon?.glyph ?? windowEntry.appId.slice(0, 2).toUpperCase();
    const tint = payload.tint ?? icon?.tint ?? '#8cc7ff';
    const focusedClass = windowEntry.isFocused ? ' is-focused' : '';
    const maximizedClass = windowEntry.state === 'maximized' ? ' is-maximized' : '';
    const style = [
      `left:${windowEntry.bounds.x}px`,
      `top:${windowEntry.bounds.y}px`,
      `width:${windowEntry.bounds.width}px`,
      `height:${windowEntry.bounds.height}px`,
      `z-index:${windowEntry.zIndex + 12}`,
    ].join(';');
    const resizeHandles = windowEntry.state === 'normal' ? this.renderResizeHandles() : '';
    let content: string;
    if (this.isTextEditorWindow(windowEntry)) {
      content = this.renderTextEditorContent(windowEntry, icon?.label ?? windowEntry.appId);
    } else if (this.isFileManagerWindow(windowEntry)) {
      content = this.renderFileManagerContent(windowEntry, icon?.label ?? windowEntry.appId);
    } else {
      content = this.renderGenericWindowContent(windowEntry, icon?.label ?? windowEntry.appId);
    }

    return `
      <article class="desktop-ui__window${focusedClass}${maximizedClass}" data-window-id="${this.escapeAttribute(windowEntry.id)}" style="${style}">
        <header class="desktop-ui__window-titlebar" data-window-dragger>
          <div class="desktop-ui__window-title">
            <span class="desktop-ui__window-glyph" style="--window-tint:${this.escapeAttribute(tint)}">${this.escapeHtml(glyph)}</span>
            <span class="desktop-ui__window-title-text">${this.escapeHtml(windowEntry.title)}</span>
          </div>
          <div class="desktop-ui__window-controls">
            <button class="desktop-ui__window-close" type="button" data-window-close aria-label="Close window">&times;</button>
          </div>
        </header>
        ${content}
        ${resizeHandles}
      </article>
    `;
  }

  private renderGenericWindowContent(windowEntry: DesktopWindow, label: string): string {
    return `
      <div class="desktop-ui__window-content">
        <span class="desktop-ui__window-label">${this.escapeHtml(label)}</span>
        <p>Window id: ${this.escapeHtml(windowEntry.id)}</p>
        <p>Drag the title bar to move, pull edges to resize.</p>
      </div>
    `;
  }

  private renderFileManagerContent(windowEntry: DesktopWindow, label: string): string {
    const view = this.getOrCreateFileManagerView(windowEntry);
    const breadcrumbNodes = this.renderFileManagerBreadcrumbs(view.path);
    const upPath = this.getPathParent(view.path);
    const stateMarkup = this.renderFileManagerState(view);

    return `
      <div class="desktop-ui__window-content is-file-manager">
        <section class="desktop-ui__fm" aria-label="File Manager">
          <header class="desktop-ui__fm-toolbar">
            <button class="desktop-ui__fm-button" type="button" data-fm-up-path="${this.escapeAttribute(
              upPath ?? '',
            )}" ${upPath ? '' : 'disabled'}>Up</button>
            <span class="desktop-ui__window-label">${this.escapeHtml(label)}</span>
          </header>
          <nav class="desktop-ui__fm-path" aria-label="Path">
            ${breadcrumbNodes}
          </nav>
          ${stateMarkup}
        </section>
      </div>
    `;
  }

  private renderTextEditorContent(windowEntry: DesktopWindow, label: string): string {
    const view = this.getOrCreateTextEditorView(windowEntry);
    const statusClass = view.status === 'error' ? ' is-error' : '';
    const statusText = this.getTextEditorStatusText(view);
    const controlsDisabled = view.status === 'loading' || view.status === 'saving';

    return `
      <div class="desktop-ui__window-content is-text-editor">
        <section class="desktop-ui__editor" aria-label="Text Editor">
          <header class="desktop-ui__editor-toolbar">
            <input
              class="desktop-ui__editor-path"
              type="text"
              data-editor-path="${this.escapeAttribute(windowEntry.id)}"
              value="${this.escapeAttribute(view.path)}"
              spellcheck="false"
              aria-label="File path"
            />
            <button class="desktop-ui__editor-button" type="button" data-editor-open ${controlsDisabled ? 'disabled' : ''}>Open</button>
            <button class="desktop-ui__editor-button is-save" type="button" data-editor-save ${controlsDisabled ? 'disabled' : ''}>Save</button>
          </header>
          <div class="desktop-ui__editor-meta">
            <span class="desktop-ui__editor-label">${this.escapeHtml(label)}</span>
            <span class="desktop-ui__editor-status${statusClass}">${this.escapeHtml(statusText)}</span>
          </div>
          <textarea
            class="desktop-ui__editor-content"
            data-editor-content="${this.escapeAttribute(windowEntry.id)}"
            spellcheck="false"
            aria-label="Editor content"
            ${controlsDisabled ? 'disabled' : ''}
          >${this.escapeHtml(view.content)}</textarea>
        </section>
      </div>
    `;
  }

  private renderFileManagerState(view: FileManagerViewState): string {
    if (view.status === 'loading') {
      return '<div class="desktop-ui__fm-state">Loading folder...</div>';
    }

    if (view.status === 'error') {
      return `<div class="desktop-ui__fm-state">${this.escapeHtml(view.errorMessage ?? 'Cannot open folder.')}</div>`;
    }

    if (view.entries.length === 0) {
      return '<div class="desktop-ui__fm-state">Folder is empty.</div>';
    }

    const items = view.entries.map((entry) => this.renderFileManagerEntry(entry)).join('');
    return `<ul class="desktop-ui__fm-list">${items}</ul>`;
  }

  private renderFileManagerEntry(entry: VirtualFileSystemDirectoryEntry): string {
    const isDirectory = entry.type === 'directory';
    const entryClass = isDirectory ? 'desktop-ui__fm-entry is-dir' : 'desktop-ui__fm-entry';
    const kind = isDirectory ? 'Folder' : 'File';
    const icon = isDirectory ? '&#128193;' : '&#128196;';

    if (isDirectory) {
      return `
        <li class="desktop-ui__fm-item">
          <button class="${entryClass}" type="button" data-fm-open-path="${this.escapeAttribute(entry.path)}">
            <span class="desktop-ui__fm-name">${icon} ${this.escapeHtml(entry.name)}</span>
            <span class="desktop-ui__fm-kind">${kind}</span>
          </button>
        </li>
      `;
    }

    return `
      <li class="desktop-ui__fm-item">
        <button class="${entryClass}" type="button" data-fm-open-file="${this.escapeAttribute(entry.path)}">
          <span class="desktop-ui__fm-name">${icon} ${this.escapeHtml(entry.name)}</span>
          <span class="desktop-ui__fm-kind">${kind}</span>
        </button>
      </li>
    `;
  }

  private renderFileManagerBreadcrumbs(path: string): string {
    const crumbs = this.getPathBreadcrumbs(path);
    return crumbs
      .map((crumb, index) => {
        const separator = index > 0 ? '<span class="desktop-ui__fm-sep">/</span>' : '';
        return `${separator}<button class="desktop-ui__fm-crumb" type="button" data-fm-breadcrumb-path="${this.escapeAttribute(
          crumb.path,
        )}">${this.escapeHtml(crumb.label)}</button>`;
      })
      .join('');
  }

  private getOrCreateFileManagerView(windowEntry: DesktopWindow): FileManagerViewState {
    const existing = this.fileManagerViews.get(windowEntry.id);
    if (existing) {
      return existing;
    }

    const initialPath = this.resolveFileManagerStartPath(windowEntry);
    const view: FileManagerViewState = {
      path: initialPath,
      status: 'loading',
      entries: [],
      errorMessage: null,
    };
    this.fileManagerViews.set(windowEntry.id, view);
    void this.loadFileManagerPath(windowEntry.id, initialPath, false);
    return view;
  }

  private getOrCreateTextEditorView(windowEntry: DesktopWindow): TextEditorViewState {
    const existing = this.textEditorViews.get(windowEntry.id);
    if (existing) {
      return existing;
    }

    const initialPath = this.resolveTextEditorStartPath(windowEntry);
    const view: TextEditorViewState = {
      path: initialPath,
      content: '',
      status: 'loading',
      errorMessage: null,
      dirty: false,
      lastSavedAt: null,
    };
    this.textEditorViews.set(windowEntry.id, view);
    void this.loadTextEditorPath(windowEntry.id, initialPath, false);
    return view;
  }

  private getTextEditorViewByWindowId(windowId: string): TextEditorViewState | null {
    if (!windowId) {
      return null;
    }

    const existing = this.textEditorViews.get(windowId);
    if (existing) {
      return existing;
    }

    const desktopWindow = this.engine.getWindow(windowId);
    if (!desktopWindow || !this.isTextEditorWindow(desktopWindow)) {
      return null;
    }
    return this.getOrCreateTextEditorView(desktopWindow);
  }

  private readWindowPayload(windowEntry: DesktopWindow): WindowVisualPayload {
    if (!windowEntry.payload || typeof windowEntry.payload !== 'object') {
      return {};
    }
    const rawPayload = windowEntry.payload as Record<string, unknown>;
    const payload: WindowVisualPayload = {};

    if (typeof rawPayload.glyph === 'string') {
      payload.glyph = rawPayload.glyph;
    }
    if (typeof rawPayload.tint === 'string') {
      payload.tint = rawPayload.tint;
    }
    if (
      rawPayload.appKind === 'generic' ||
      rawPayload.appKind === 'file-manager' ||
      rawPayload.appKind === 'text-editor'
    ) {
      payload.appKind = rawPayload.appKind;
    }
    if (typeof rawPayload.startPath === 'string') {
      payload.startPath = rawPayload.startPath;
    }

    return payload;
  }

  private isFileManagerWindow(windowEntry: DesktopWindow): boolean {
    const payload = this.readWindowPayload(windowEntry);
    if (payload.appKind) {
      return payload.appKind === 'file-manager';
    }
    return this.fileManagerAppIds.has(windowEntry.appId);
  }

  private isTextEditorWindow(windowEntry: DesktopWindow): boolean {
    const payload = this.readWindowPayload(windowEntry);
    if (payload.appKind) {
      return payload.appKind === 'text-editor';
    }
    return this.textEditorAppIds.has(windowEntry.appId);
  }

  private resolveFileManagerStartPath(windowEntry: DesktopWindow): string {
    const payload = this.readWindowPayload(windowEntry);
    const startPath = payload.startPath?.trim();
    return startPath && startPath.length > 0 ? startPath : '/';
  }

  private resolveTextEditorStartPath(windowEntry: DesktopWindow): string {
    const payload = this.readWindowPayload(windowEntry);
    const startPath = payload.startPath?.trim();
    return startPath && startPath.length > 0 ? startPath : DEFAULT_TEXT_EDITOR_PATH;
  }

  private async openFileManagerPath(windowId: string, path: string): Promise<void> {
    await this.loadFileManagerPath(windowId, path, true);
  }

  private async openFileInTextEditor(path: string): Promise<void> {
    const textEditorAppId = this.findTextEditorAppId();
    if (!textEditorAppId) {
      return;
    }
    const normalizedPath = path.trim();
    await this.engine.launchApp(textEditorAppId, { path: normalizedPath });
    this.setSelectedIcon(textEditorAppId);
  }

  private async openTextEditorPath(windowId: string, path: string): Promise<void> {
    await this.loadTextEditorPath(windowId, path, true);
  }

  private async loadFileManagerPath(windowId: string, path: string, renderLoadingState: boolean): Promise<void> {
    if (!windowId) {
      return;
    }

    const desktopWindow = this.engine.getWindow(windowId);
    if (!desktopWindow || !this.isFileManagerWindow(desktopWindow)) {
      return;
    }

    const nextPath = path.trim() || '/';
    const view = this.fileManagerViews.get(windowId) ?? {
      path: nextPath,
      status: 'loading',
      entries: [],
      errorMessage: null,
    };
    view.path = nextPath;
    view.status = 'loading';
    view.entries = [];
    view.errorMessage = null;
    this.fileManagerViews.set(windowId, view);

    if (renderLoadingState) {
      this.renderWindows();
    }

    try {
      await this.ensureFileSystemReady();
      const directoryStat = await this.fileSystem.stat(nextPath);
      if (directoryStat.type !== 'directory') {
        throw new Error(`Path "${nextPath}" is not a directory.`);
      }
      const entries = await this.fileSystem.readDirectory(nextPath);
      const currentView = this.fileManagerViews.get(windowId);
      if (!currentView || currentView.path !== nextPath) {
        return;
      }
      currentView.status = 'ready';
      currentView.entries = entries;
      currentView.errorMessage = null;
    } catch (error) {
      const currentView = this.fileManagerViews.get(windowId);
      if (!currentView || currentView.path !== nextPath) {
        return;
      }
      currentView.status = 'error';
      currentView.entries = [];
      currentView.errorMessage = this.toErrorMessage(error);
    }

    this.renderWindows();
  }

  private async loadTextEditorPath(windowId: string, path: string, renderLoadingState: boolean): Promise<void> {
    if (!windowId) {
      return;
    }

    const desktopWindow = this.engine.getWindow(windowId);
    if (!desktopWindow || !this.isTextEditorWindow(desktopWindow)) {
      return;
    }

    const nextPath = path.trim() || DEFAULT_TEXT_EDITOR_PATH;
    const view = this.textEditorViews.get(windowId) ?? {
      path: nextPath,
      content: '',
      status: 'loading',
      errorMessage: null,
      dirty: false,
      lastSavedAt: null,
    };
    view.path = nextPath;
    view.status = 'loading';
    view.errorMessage = null;
    this.textEditorViews.set(windowId, view);

    if (renderLoadingState) {
      this.renderWindows();
    }

    try {
      await this.ensureFileSystemReady();
      const exists = await this.fileSystem.exists(nextPath);
      if (exists) {
        const fileStat = await this.fileSystem.stat(nextPath);
        if (fileStat.type !== 'file') {
          throw new Error(`Path "${nextPath}" is not a file.`);
        }
        const content = await this.fileSystem.readFile(nextPath);
        const currentView = this.textEditorViews.get(windowId);
        if (!currentView || currentView.path !== nextPath) {
          return;
        }
        currentView.content = content;
        currentView.status = 'ready';
        currentView.errorMessage = null;
        currentView.dirty = false;
        currentView.lastSavedAt = null;
      } else {
        const currentView = this.textEditorViews.get(windowId);
        if (!currentView || currentView.path !== nextPath) {
          return;
        }
        currentView.content = '';
        currentView.status = 'ready';
        currentView.errorMessage = null;
        currentView.dirty = false;
        currentView.lastSavedAt = null;
      }
    } catch (error) {
      const currentView = this.textEditorViews.get(windowId);
      if (!currentView || currentView.path !== nextPath) {
        return;
      }
      currentView.status = 'error';
      currentView.errorMessage = this.toErrorMessage(error, 'Cannot open file.');
      currentView.dirty = false;
    }

    this.renderWindows();
  }

  private async saveTextEditorWindow(windowId: string): Promise<void> {
    if (!windowId) {
      return;
    }

    const desktopWindow = this.engine.getWindow(windowId);
    if (!desktopWindow || !this.isTextEditorWindow(desktopWindow)) {
      return;
    }

    const view = this.textEditorViews.get(windowId) ?? this.getOrCreateTextEditorView(desktopWindow);
    const nextPath = view.path.trim() || DEFAULT_TEXT_EDITOR_PATH;
    view.path = nextPath;
    view.status = 'saving';
    view.errorMessage = null;
    this.renderWindows();

    try {
      await this.ensureFileSystemReady();
      const exists = await this.fileSystem.exists(nextPath);
      if (exists) {
        const fileStat = await this.fileSystem.stat(nextPath);
        if (fileStat.type !== 'file') {
          throw new Error(`Path "${nextPath}" is not a file.`);
        }
      }
      await this.fileSystem.writeFile(nextPath, view.content, { createParents: true });

      const currentView = this.textEditorViews.get(windowId);
      if (!currentView || currentView.path !== nextPath) {
        return;
      }
      currentView.status = 'ready';
      currentView.errorMessage = null;
      currentView.dirty = false;
      currentView.lastSavedAt = Date.now();
    } catch (error) {
      const currentView = this.textEditorViews.get(windowId);
      if (!currentView || currentView.path !== nextPath) {
        return;
      }
      currentView.status = 'error';
      currentView.errorMessage = this.toErrorMessage(error, 'Cannot save file.');
    }

    this.renderWindows();
  }

  private findTextEditorAppId(): string | null {
    for (const appId of this.textEditorAppIds) {
      if (this.iconById.has(appId)) {
        return appId;
      }
    }
    return null;
  }

  private getPathBreadcrumbs(path: string): Array<{ label: string; path: string }> {
    const cleanPath = path.trim() || '/';
    const segments = cleanPath.split('/').filter((segment) => segment.length > 0);
    const breadcrumbs: Array<{ label: string; path: string }> = [{ label: 'Root', path: '/' }];
    let currentPath = '';

    for (const segment of segments) {
      currentPath += `/${segment}`;
      breadcrumbs.push({ label: segment, path: currentPath });
    }

    return breadcrumbs;
  }

  private getPathParent(path: string): string | null {
    const cleanPath = path.trim() || '/';
    if (cleanPath === '/') {
      return null;
    }
    const segments = cleanPath.split('/').filter((segment) => segment.length > 0);
    if (segments.length <= 1) {
      return '/';
    }
    return `/${segments.slice(0, -1).join('/')}`;
  }

  private getTextEditorStatusText(view: TextEditorViewState): string {
    if (view.status === 'loading') {
      return 'Loading file...';
    }
    if (view.status === 'saving') {
      return 'Saving...';
    }
    if (view.status === 'error') {
      return view.errorMessage ?? 'Cannot complete file action.';
    }
    if (view.dirty) {
      return 'Unsaved changes';
    }
    if (view.lastSavedAt) {
      const savedTime = new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date(view.lastSavedAt));
      return `Saved at ${savedTime}`;
    }
    return 'Ready';
  }

  private getTextEditorWindowTitle(appName: string, path: string | undefined): string {
    if (!path) {
      return appName;
    }
    const basename = this.getPathBasename(path);
    return basename.length > 0 ? `${basename} - ${appName}` : appName;
  }

  private getPathBasename(path: string): string {
    const cleanPath = path.trim();
    if (!cleanPath || cleanPath === '/') {
      return '';
    }
    const segments = cleanPath.split('/').filter((segment) => segment.length > 0);
    return segments[segments.length - 1] ?? '';
  }

  private resolveTextEditorLaunchPath(args: unknown, fallbackPath: string): string {
    if (!args || typeof args !== 'object') {
      return fallbackPath;
    }
    const payload = args as Record<string, unknown>;
    if (typeof payload.path !== 'string') {
      return fallbackPath;
    }
    const path = payload.path.trim();
    return path.length > 0 ? path : fallbackPath;
  }

  private toErrorMessage(error: unknown, fallback = 'Unknown error while loading directory.'): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return fallback;
  }

  private renderResizeHandles(): string {
    return `
      <span class="desktop-ui__resize-handle is-n" data-resize-x="0" data-resize-y="-1"></span>
      <span class="desktop-ui__resize-handle is-ne" data-resize-x="1" data-resize-y="-1"></span>
      <span class="desktop-ui__resize-handle is-e" data-resize-x="1" data-resize-y="0"></span>
      <span class="desktop-ui__resize-handle is-se" data-resize-x="1" data-resize-y="1"></span>
      <span class="desktop-ui__resize-handle is-s" data-resize-x="0" data-resize-y="1"></span>
      <span class="desktop-ui__resize-handle is-sw" data-resize-x="-1" data-resize-y="1"></span>
      <span class="desktop-ui__resize-handle is-w" data-resize-x="-1" data-resize-y="0"></span>
      <span class="desktop-ui__resize-handle is-nw" data-resize-x="-1" data-resize-y="-1"></span>
    `;
  }

  private renderRunningWindows(): void {
    const runningContainer = this.host.querySelector<HTMLElement>('[data-running-windows]');
    if (!runningContainer) {
      return;
    }

    const windows = this.engine.listWindows();
    runningContainer.innerHTML = windows
      .map((windowEntry) => {
        const isActive = windowEntry.isFocused ? ' is-active' : '';
        return `
          <button class="desktop-ui__task-item${isActive}" data-task-window-id="${this.escapeAttribute(windowEntry.id)}" type="button">
            ${this.escapeHtml(windowEntry.title)}
          </button>
        `;
      })
      .join('');
  }

  private setSelectedIcon(iconId: string | null): void {
    const iconButtons = this.host.querySelectorAll<HTMLButtonElement>('[data-icon-id]');
    for (const button of iconButtons) {
      button.classList.toggle('is-selected', iconId !== null && button.dataset.iconId === iconId);
    }
  }

  private syncDesktopSize(): void {
    const rect = this.host.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    this.engine.setDesktopSize(width, height);
  }

  private trackDesktopResize(): void {
    if (typeof ResizeObserver === 'undefined') {
      this.resizeHandler = () => this.syncDesktopSize();
      window.addEventListener('resize', this.resizeHandler);
      return;
    }

    this.resizeObserver = new ResizeObserver(() => {
      this.syncDesktopSize();
    });
    this.resizeObserver.observe(this.host);
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private escapeAttribute(value: string): string {
    return this.escapeHtml(value);
  }
}
