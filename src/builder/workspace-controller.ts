import { makeObservable, observable, action, runInAction, reaction, toJS } from 'mobx';
import { AppController, GraphInnerState } from './state';

const DB_NAME = 'nano-repatch-db';
const STORE_NAME = 'handles';
const WORKSPACE_KEY = 'workspace-handle';

// Minimal type definitions for File System Access API
interface FileSystemHandle {
  kind: 'file' | 'directory';
  name: string;
  isSameEntry(other: FileSystemHandle): Promise<boolean>;
}

interface FileSystemFileHandle extends FileSystemHandle {
  kind: 'file';
  getFile(): Promise<File>;
  createWritable(options?: any): Promise<FileSystemWritableFileStream>;
}

interface FileSystemDirectoryHandle extends FileSystemHandle {
  kind: 'directory';
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>;
  queryPermission(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

interface FileSystemWritableFileStream extends WritableStream {
  write(data: any): Promise<void>;
  seek(position: number): Promise<void>;
  truncate(size: number): Promise<void>;
}

declare global {
  interface Window {
    showDirectoryPicker(options?: any): Promise<FileSystemDirectoryHandle>;
  }
}

export interface FileEntry {
  name: string;
  handle: FileSystemFileHandle;
}

export class WorkspaceController {
  @observable currentDirHandle: FileSystemDirectoryHandle | null = null;
  @observable files: FileEntry[] = [];
  @observable currentGraphId: string | null = null;

  constructor(private appController: AppController) {
    makeObservable(this);
    this.init();

    // Auto-save reaction
    reaction(
      () => toJS(this.appController.observableState.graph.inner),
      () => {
        this.saveCurrentGraph();
      },
      { delay: 1000 } // Debounce save by 1s
    );
  }

  private async init() {
    await this.initDB();
    const handle = await this.loadHandle();
    if (handle) {
      runInAction(() => {
        this.currentDirHandle = handle;
      });

      // Try to refresh files if we have permission
      try {
        const permission = await handle.queryPermission({ mode: 'readwrite' });
        if (permission === 'granted') {
          await this.refreshFiles();
        }
      } catch (e) {
        console.warn('Failed to query permission on init', e);
      }
    }

    // Check URL for graph ID
    const params = new URLSearchParams(window.location.search);
    const graphId = params.get('graph');
    if (graphId) {
      this.currentGraphId = graphId;
      // If we couldn't list files (no permission), we might still want to try loading this specific file
      // if the user grants permission later.
    }
  }

  private initDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  private async saveHandle(handle: FileSystemDirectoryHandle): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(handle, WORKSPACE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  }

  private async loadHandle(): Promise<FileSystemDirectoryHandle | null> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const getRequest = store.get(WORKSPACE_KEY);
        getRequest.onsuccess = () => resolve(getRequest.result || null);
        getRequest.onerror = () => reject(getRequest.error);
      };
      request.onerror = () => reject(request.error);
    });
  }

  @action
  async openFolder() {
    try {
      console.log('Calling showDirectoryPicker');
      const handle = await window.showDirectoryPicker({
        mode: 'readwrite',
      });

      runInAction(() => {
        this.currentDirHandle = handle;
      });

      await this.saveHandle(handle);
      await this.refreshFiles();
    } catch (e) {
      console.error('Error opening folder:', e);
    }
  }

  @action
  async refreshFiles() {
    if (!this.currentDirHandle) return;

    // Verify permission
    const permission = await this.currentDirHandle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') {
      const request = await this.currentDirHandle.requestPermission({ mode: 'readwrite' });
      if (request !== 'granted') return;
    }

    const entries: FileEntry[] = [];
    // @ts-ignore - Async iteration on entries
    for await (const [name, handle] of this.currentDirHandle.entries()) {
      if (handle.kind === 'file' && name.endsWith('.json')) {
        entries.push({ name, handle: handle as FileSystemFileHandle });
      }
    }

    runInAction(() => {
      this.files = entries.sort((a, b) => a.name.localeCompare(b.name));
    });

    // If we have a pending graph ID from URL, try to load it
    if (this.currentGraphId) {
      await this.openFile(this.currentGraphId);
    }
  }

  @action
  async openFile(filename: string) {
    if (!this.currentDirHandle) return;

    const fileEntry = this.files.find(f => f.name === filename);
    if (!fileEntry) {
      // Try to find it if it's not in the list yet (e.g. on initial load)
      try {
        const handle = await this.currentDirHandle.getFileHandle(filename);
        await this.loadFileHandle(handle, filename);
      } catch (e) {
        console.error(`File ${filename} not found`, e);
      }
      return;
    }

    await this.loadFileHandle(fileEntry.handle, filename);
  }

  private async loadFileHandle(handle: FileSystemFileHandle, filename: string) {
    const file = await handle.getFile();
    const text = await file.text();
    try {
      const json = JSON.parse(text) as GraphInnerState;
      this.appController.loadGraph(json);

      runInAction(() => {
        this.currentGraphId = filename;
      });

      // Update URL
      const url = new URL(window.location.href);
      url.searchParams.set('graph', filename);
      window.history.replaceState({}, '', url.toString());
    } catch (e) {
      console.error('Error parsing graph JSON:', e);
    }
  }

  @action
  async saveCurrentGraph() {
    if (!this.currentDirHandle || !this.currentGraphId) return;

    const state = this.appController.getState().graph.inner;
    const json = JSON.stringify(state, null, 2);

    try {
      const handle = await this.currentDirHandle.getFileHandle(this.currentGraphId, { create: true });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
    } catch (e) {
      console.error('Error saving graph:', e);
    }
  }

  @action
  async createNewGraph(filename: string) {
    if (!this.currentDirHandle) return;

    if (!filename.endsWith('.json')) {
      filename += '.json';
    }

    // Check if exists
    if (this.files.some(f => f.name === filename)) {
      throw new Error('File already exists');
    }

    // Create empty graph
    const emptyGraph: GraphInnerState = { nodes: {}, connections: {} };

    try {
      const handle = await this.currentDirHandle.getFileHandle(filename, { create: true });
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify(emptyGraph, null, 2));
      await writable.close();

      await this.refreshFiles();
      await this.openFile(filename);
    } catch (e) {
      console.error('Error creating new graph:', e);
      throw e;
    }
  }
}
