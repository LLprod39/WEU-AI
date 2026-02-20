export type VirtualFileSystemBackend = 'auto' | 'indexeddb' | 'localstorage';

export interface VirtualFileSystemOptions {
  backend?: VirtualFileSystemBackend;
  indexedDbName?: string;
  indexedDbStoreName?: string;
  localStorageKey?: string;
}

export interface VirtualFileSystemMkdirOptions {
  recursive?: boolean;
}

export interface VirtualFileSystemWriteFileOptions {
  createParents?: boolean;
}

export interface VirtualFileSystemDeleteOptions {
  recursive?: boolean;
}

export interface VirtualFileSystemMoveOptions {
  overwrite?: boolean;
}

export interface VirtualFileSystemDirectoryEntry {
  name: string;
  path: string;
  type: VirtualFileSystemEntryType;
}

export interface VirtualFileSystemStat {
  path: string;
  type: VirtualFileSystemEntryType;
  createdAt: number;
  updatedAt: number;
  size: number;
}

export type VirtualFileSystemEntryType = 'file' | 'directory';

interface VirtualFileSystemEntryBase {
  type: VirtualFileSystemEntryType;
  createdAt: number;
  updatedAt: number;
}

interface VirtualFileSystemFileEntry extends VirtualFileSystemEntryBase {
  type: 'file';
  content: string;
}

interface VirtualFileSystemDirectoryNode extends VirtualFileSystemEntryBase {
  type: 'directory';
}

type VirtualFileSystemEntry = VirtualFileSystemFileEntry | VirtualFileSystemDirectoryNode;

interface VirtualFileSystemSnapshot {
  version: 1;
  entries: Record<string, VirtualFileSystemEntry>;
}

interface VirtualFileSystemStorage {
  load(): Promise<VirtualFileSystemSnapshot | null>;
  save(snapshot: VirtualFileSystemSnapshot): Promise<void>;
}

const ROOT_PATH = '/';
const DEFAULT_INDEXED_DB_NAME = 'virtual-file-system';
const DEFAULT_INDEXED_DB_STORE_NAME = 'vfs';
const DEFAULT_LOCAL_STORAGE_KEY = 'virtual-file-system:snapshot';
const SNAPSHOT_RECORD_KEY = 'snapshot';

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function openDatabase(name: string, storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB.'));
  });
}

class IndexedDbVirtualFileSystemStorage implements VirtualFileSystemStorage {
  private readonly dbName: string;
  private readonly storeName: string;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(dbName: string, storeName: string) {
    this.dbName = dbName;
    this.storeName = storeName;
  }

  async load(): Promise<VirtualFileSystemSnapshot | null> {
    const db = await this.getDb();
    const tx = db.transaction(this.storeName, 'readonly');
    const store = tx.objectStore(this.storeName);
    const data = await requestToPromise(store.get(SNAPSHOT_RECORD_KEY));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB read transaction failed.'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB read transaction aborted.'));
    });
    return this.parseSnapshot(data);
  }

  async save(snapshot: VirtualFileSystemSnapshot): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction(this.storeName, 'readwrite');
    const store = tx.objectStore(this.storeName);
    store.put(snapshot, SNAPSHOT_RECORD_KEY);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write transaction failed.'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write transaction aborted.'));
    });
  }

  private async getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDatabase(this.dbName, this.storeName);
    }
    return this.dbPromise;
  }

  private parseSnapshot(data: unknown): VirtualFileSystemSnapshot | null {
    if (!data || typeof data !== 'object') {
      return null;
    }
    const parsed = data as Partial<VirtualFileSystemSnapshot>;
    if (parsed.version !== 1 || !parsed.entries || typeof parsed.entries !== 'object') {
      return null;
    }
    return {
      version: 1,
      entries: parsed.entries as Record<string, VirtualFileSystemEntry>,
    };
  }
}

class LocalStorageVirtualFileSystemStorage implements VirtualFileSystemStorage {
  private readonly key: string;

  constructor(key: string) {
    this.key = key;
  }

  async load(): Promise<VirtualFileSystemSnapshot | null> {
    const storage = this.getStorage();
    if (!storage) {
      return null;
    }
    const rawValue = storage.getItem(this.key);
    if (!rawValue) {
      return null;
    }
    try {
      const parsed = JSON.parse(rawValue) as Partial<VirtualFileSystemSnapshot>;
      if (parsed.version !== 1 || !parsed.entries || typeof parsed.entries !== 'object') {
        return null;
      }
      return {
        version: 1,
        entries: parsed.entries as Record<string, VirtualFileSystemEntry>,
      };
    } catch {
      return null;
    }
  }

  async save(snapshot: VirtualFileSystemSnapshot): Promise<void> {
    const storage = this.getStorage();
    if (!storage) {
      throw new Error('localStorage is not available in this environment.');
    }
    storage.setItem(this.key, JSON.stringify(snapshot));
  }

  private getStorage(): Storage | null {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    return localStorage;
  }
}

export class VirtualFileSystem {
  private readonly storage: VirtualFileSystemStorage;
  private snapshot: VirtualFileSystemSnapshot | null = null;
  private initPromise: Promise<void> | null = null;
  private mutationChain: Promise<void> = Promise.resolve();

  constructor(options: VirtualFileSystemOptions = {}) {
    const backend = options.backend ?? 'auto';
    const indexedDbName = options.indexedDbName ?? DEFAULT_INDEXED_DB_NAME;
    const indexedDbStoreName = options.indexedDbStoreName ?? DEFAULT_INDEXED_DB_STORE_NAME;
    const localStorageKey = options.localStorageKey ?? DEFAULT_LOCAL_STORAGE_KEY;

    const canUseIndexedDb = typeof indexedDB !== 'undefined';
    if (backend === 'indexeddb' && canUseIndexedDb) {
      this.storage = new IndexedDbVirtualFileSystemStorage(indexedDbName, indexedDbStoreName);
      return;
    }

    if (backend === 'indexeddb' && !canUseIndexedDb) {
      throw new Error('IndexedDB is not available in this environment.');
    }

    if (backend === 'auto' && canUseIndexedDb) {
      this.storage = new IndexedDbVirtualFileSystemStorage(indexedDbName, indexedDbStoreName);
      return;
    }

    this.storage = new LocalStorageVirtualFileSystemStorage(localStorageKey);
  }

  async init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.loadSnapshot();
    }
    await this.initPromise;
  }

  async exists(path: string): Promise<boolean> {
    await this.ensureInitialized();
    return this.getEntry(this.normalizePath(path)) !== undefined;
  }

  async stat(path: string): Promise<VirtualFileSystemStat> {
    await this.ensureInitialized();
    const normalizedPath = this.normalizePath(path);
    const entry = this.getRequiredEntry(normalizedPath);
    return {
      path: normalizedPath,
      type: entry.type,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      size: entry.type === 'file' ? entry.content.length : this.countChildren(normalizedPath),
    };
  }

  async mkdir(path: string, options: VirtualFileSystemMkdirOptions = {}): Promise<void> {
    await this.mutate(async () => {
      const normalizedPath = this.normalizePath(path);
      this.mkdirInternal(normalizedPath, options.recursive ?? false);
    });
  }

  async writeFile(path: string, content: string, options: VirtualFileSystemWriteFileOptions = {}): Promise<void> {
    await this.mutate(async () => {
      const normalizedPath = this.normalizePath(path);
      if (normalizedPath === ROOT_PATH) {
        throw new Error('Cannot write to root path "/".');
      }

      const createParents = options.createParents ?? true;
      const parentPath = this.getParentPath(normalizedPath);
      if (!parentPath) {
        throw new Error(`Cannot resolve parent directory for "${normalizedPath}".`);
      }

      const parent = this.getEntry(parentPath);
      if (!parent) {
        if (!createParents) {
          throw new Error(`Directory "${parentPath}" does not exist.`);
        }
        this.mkdirInternal(parentPath, true);
      } else if (parent.type !== 'directory') {
        throw new Error(`Cannot write file "${normalizedPath}" because parent "${parentPath}" is a file.`);
      }

      const existing = this.getEntry(normalizedPath);
      const now = Date.now();
      if (existing && existing.type === 'directory') {
        throw new Error(`Cannot overwrite directory "${normalizedPath}" with a file.`);
      }

      this.getEntries()[normalizedPath] = {
        type: 'file',
        content,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
    });
  }

  async readFile(path: string): Promise<string> {
    await this.ensureInitialized();
    const normalizedPath = this.normalizePath(path);
    const entry = this.getRequiredEntry(normalizedPath);
    if (entry.type !== 'file') {
      throw new Error(`Path "${normalizedPath}" is not a file.`);
    }
    return entry.content;
  }

  async readDirectory(path: string): Promise<VirtualFileSystemDirectoryEntry[]> {
    await this.ensureInitialized();
    const normalizedPath = this.normalizePath(path);
    const entry = this.getRequiredEntry(normalizedPath);
    if (entry.type !== 'directory') {
      throw new Error(`Path "${normalizedPath}" is not a directory.`);
    }

    const entries = this.getEntries();
    const result: VirtualFileSystemDirectoryEntry[] = [];
    for (const [entryPath, childEntry] of Object.entries(entries)) {
      if (entryPath === normalizedPath) {
        continue;
      }
      if (this.getParentPath(entryPath) !== normalizedPath) {
        continue;
      }
      result.push({
        name: this.basename(entryPath),
        path: entryPath,
        type: childEntry.type,
      });
    }

    result.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    return result;
  }

  async delete(path: string, options: VirtualFileSystemDeleteOptions = {}): Promise<void> {
    await this.mutate(async () => {
      const normalizedPath = this.normalizePath(path);
      this.deleteInternal(normalizedPath, options.recursive ?? false);
    });
  }

  async move(sourcePath: string, destinationPath: string, options: VirtualFileSystemMoveOptions = {}): Promise<void> {
    await this.mutate(async () => {
      const fromPath = this.normalizePath(sourcePath);
      const toPath = this.normalizePath(destinationPath);

      if (fromPath === ROOT_PATH) {
        throw new Error('Cannot move root path "/".');
      }
      if (toPath === ROOT_PATH) {
        throw new Error('Cannot overwrite root path "/".');
      }
      if (fromPath === toPath) {
        return;
      }

      const entry = this.getRequiredEntry(fromPath);
      const overwrite = options.overwrite ?? false;

      const destinationParentPath = this.getParentPath(toPath);
      if (!destinationParentPath) {
        throw new Error(`Cannot resolve destination parent for "${toPath}".`);
      }
      const destinationParent = this.getEntry(destinationParentPath);
      if (!destinationParent || destinationParent.type !== 'directory') {
        throw new Error(`Destination parent "${destinationParentPath}" does not exist.`);
      }

      const targetEntry = this.getEntry(toPath);
      if (targetEntry && !overwrite) {
        throw new Error(`Path "${toPath}" already exists.`);
      }

      if (entry.type === 'directory' && this.isDescendantPath(toPath, fromPath)) {
        throw new Error(`Cannot move directory "${fromPath}" into its own descendant "${toPath}".`);
      }

      if (targetEntry) {
        this.deleteInternal(toPath, true);
      }

      const sourceEntries = [fromPath, ...this.getDescendantPaths(fromPath)];
      sourceEntries.sort((a, b) => a.length - b.length);

      const replacements: Array<{ from: string; to: string; entry: VirtualFileSystemEntry }> = [];
      for (const pathKey of sourceEntries) {
        const childEntry = this.getRequiredEntry(pathKey);
        const nextPath = pathKey === fromPath ? toPath : `${toPath}${pathKey.slice(fromPath.length)}`;
        replacements.push({
          from: pathKey,
          to: nextPath,
          entry: { ...childEntry, updatedAt: Date.now() },
        });
      }

      for (const replacement of replacements) {
        delete this.getEntries()[replacement.from];
      }
      for (const replacement of replacements) {
        this.getEntries()[replacement.to] = replacement.entry;
      }
    });
  }

  private async loadSnapshot(): Promise<void> {
    const loaded = await this.storage.load();
    if (!loaded) {
      this.snapshot = this.createInitialSnapshot();
      await this.storage.save(this.snapshot);
      return;
    }
    this.snapshot = this.sanitizeSnapshot(loaded);
  }

  private createInitialSnapshot(): VirtualFileSystemSnapshot {
    const now = Date.now();
    return {
      version: 1,
      entries: {
        [ROOT_PATH]: {
          type: 'directory',
          createdAt: now,
          updatedAt: now,
        },
      },
    };
  }

  private sanitizeSnapshot(snapshot: VirtualFileSystemSnapshot): VirtualFileSystemSnapshot {
    const sanitizedEntries: Record<string, VirtualFileSystemEntry> = {};
    for (const [path, entry] of Object.entries(snapshot.entries)) {
      const normalizedPath = this.normalizePath(path);
      if (entry.type === 'file') {
        sanitizedEntries[normalizedPath] = {
          type: 'file',
          content: typeof entry.content === 'string' ? entry.content : '',
          createdAt: this.normalizeTimestamp(entry.createdAt),
          updatedAt: this.normalizeTimestamp(entry.updatedAt),
        };
      } else if (entry.type === 'directory') {
        sanitizedEntries[normalizedPath] = {
          type: 'directory',
          createdAt: this.normalizeTimestamp(entry.createdAt),
          updatedAt: this.normalizeTimestamp(entry.updatedAt),
        };
      }
    }

    if (!sanitizedEntries[ROOT_PATH] || sanitizedEntries[ROOT_PATH].type !== 'directory') {
      const now = Date.now();
      sanitizedEntries[ROOT_PATH] = {
        type: 'directory',
        createdAt: now,
        updatedAt: now,
      };
    }

    return {
      version: 1,
      entries: sanitizedEntries,
    };
  }

  private normalizeTimestamp(value: number): number {
    if (Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
    return Date.now();
  }

  private async ensureInitialized(): Promise<void> {
    await this.init();
  }

  private async mutate(operation: () => Promise<void>): Promise<void> {
    await this.ensureInitialized();

    const run = this.mutationChain.then(async () => {
      await operation();
      await this.persistSnapshot();
    });

    this.mutationChain = run.then(
      () => undefined,
      () => undefined,
    );

    await run;
  }

  private async persistSnapshot(): Promise<void> {
    if (!this.snapshot) {
      throw new Error('VirtualFileSystem is not initialized.');
    }
    await this.storage.save(this.snapshot);
  }

  private getEntries(): Record<string, VirtualFileSystemEntry> {
    if (!this.snapshot) {
      throw new Error('VirtualFileSystem is not initialized.');
    }
    return this.snapshot.entries;
  }

  private getEntry(path: string): VirtualFileSystemEntry | undefined {
    return this.getEntries()[path];
  }

  private getRequiredEntry(path: string): VirtualFileSystemEntry {
    const entry = this.getEntry(path);
    if (!entry) {
      throw new Error(`Path "${path}" does not exist.`);
    }
    return entry;
  }

  private ensureDirectoryEntry(path: string, now: number): void {
    this.getEntries()[path] = {
      type: 'directory',
      createdAt: now,
      updatedAt: now,
    };
  }

  private mkdirInternal(path: string, recursive: boolean): void {
    if (path === ROOT_PATH) {
      return;
    }

    const pathParts = this.splitPath(path);
    let currentPath = ROOT_PATH;
    for (const part of pathParts) {
      currentPath = this.joinPath(currentPath, part);
      const existing = this.getEntry(currentPath);
      if (existing) {
        if (existing.type !== 'directory') {
          throw new Error(`Cannot create directory "${path}" because "${currentPath}" is a file.`);
        }
        continue;
      }
      if (!recursive && currentPath !== path) {
        throw new Error(`Missing parent directory "${this.getParentPath(currentPath)}".`);
      }
      this.ensureDirectoryEntry(currentPath, Date.now());
    }
  }

  private deleteInternal(path: string, recursive: boolean): void {
    if (path === ROOT_PATH) {
      throw new Error('Cannot delete root path "/".');
    }

    const entry = this.getRequiredEntry(path);
    if (entry.type === 'file') {
      delete this.getEntries()[path];
      return;
    }

    const childPaths = this.getDescendantPaths(path);
    if (childPaths.length > 0 && !recursive) {
      throw new Error(`Directory "${path}" is not empty. Use recursive delete.`);
    }

    for (const childPath of childPaths) {
      delete this.getEntries()[childPath];
    }
    delete this.getEntries()[path];
  }

  private countChildren(path: string): number {
    let count = 0;
    for (const entryPath of Object.keys(this.getEntries())) {
      if (entryPath === path) {
        continue;
      }
      if (this.getParentPath(entryPath) === path) {
        count += 1;
      }
    }
    return count;
  }

  private getDescendantPaths(parentPath: string): string[] {
    const descendantPaths: string[] = [];
    for (const path of Object.keys(this.getEntries())) {
      if (path !== parentPath && this.isDescendantPath(path, parentPath)) {
        descendantPaths.push(path);
      }
    }
    descendantPaths.sort((a, b) => b.length - a.length);
    return descendantPaths;
  }

  private isDescendantPath(path: string, parentPath: string): boolean {
    if (parentPath === ROOT_PATH) {
      return path !== ROOT_PATH;
    }
    return path.startsWith(`${parentPath}/`);
  }

  private normalizePath(path: string): string {
    const value = path.trim();
    if (!value) {
      throw new Error('Path cannot be empty.');
    }

    const withRootPrefix = value.startsWith('/') ? value : `/${value}`;
    const segments = withRootPrefix
      .split('/')
      .filter((segment) => segment.length > 0)
      .reduce<string[]>((parts, segment) => {
        if (segment === '.') {
          return parts;
        }
        if (segment === '..') {
          if (parts.length > 0) {
            parts.pop();
          }
          return parts;
        }
        parts.push(segment);
        return parts;
      }, []);

    if (segments.length === 0) {
      return ROOT_PATH;
    }
    return `/${segments.join('/')}`;
  }

  private splitPath(path: string): string[] {
    if (path === ROOT_PATH) {
      return [];
    }
    return path.slice(1).split('/');
  }

  private joinPath(basePath: string, childName: string): string {
    if (basePath === ROOT_PATH) {
      return `/${childName}`;
    }
    return `${basePath}/${childName}`;
  }

  private getParentPath(path: string): string | null {
    if (path === ROOT_PATH) {
      return null;
    }
    const lastSlash = path.lastIndexOf('/');
    if (lastSlash <= 0) {
      return ROOT_PATH;
    }
    return path.slice(0, lastSlash);
  }

  private basename(path: string): string {
    if (path === ROOT_PATH) {
      return ROOT_PATH;
    }
    const segments = path.split('/');
    return segments[segments.length - 1] ?? path;
  }
}
