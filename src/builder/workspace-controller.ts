import { makeObservable, observable, action, runInAction, reaction, toJS } from 'mobx';
import { AppController, GraphInnerState, buildGraphStateAuxiliary, GraphState } from './state';
import { LocalController } from './local-state';

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
  @observable isWaitingForPermission: boolean = false;

  constructor(private appController: AppController, private localController: LocalController) {
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
      runInAction(() => {
        this.currentGraphId = graphId;
      });
      // If we couldn't list files (no permission), we might still want to try loading this specific file
      // if the user grants permission later.
      if (handle) {
        try {
          const permission = await handle.queryPermission({ mode: 'readwrite' });
          if (permission !== 'granted') {
            runInAction(() => {
              this.isWaitingForPermission = true;
            });
          } else {
            await this.openFile(graphId);
          }
        } catch (e) {
          console.warn('Failed to query permission for graph load', e);
        }
      } else {
        // No handle at all, so we are definitely waiting for user to open a folder
        runInAction(() => {
          this.isWaitingForPermission = true;
        });
      }
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

      runInAction(() => {
        this.isWaitingForPermission = false;
      });
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

    const scanDirectory = async (dirHandle: FileSystemDirectoryHandle, pathPrefix: string = '') => {
      // @ts-ignore - Async iteration
      for await (const [name, handle] of dirHandle.entries()) {
        if (handle.kind === 'file' && name.endsWith('.json')) {
          entries.push({ name: pathPrefix + name, handle: handle as FileSystemFileHandle });
        } else if (handle.kind === 'directory') {
          // Skip dot folders (like .git, .gemini)
          if (!name.startsWith('.')) {
            await scanDirectory(handle as FileSystemDirectoryHandle, pathPrefix + name + '/');
          }
        }
      }
    };

    await scanDirectory(this.currentDirHandle);

    runInAction(() => {
      this.files = entries.sort((a, b) => a.name.localeCompare(b.name));
    });

    // If we have a pending graph ID from URL, try to load it
    if (this.currentGraphId) {
      await this.openFile(this.currentGraphId);
    }

    // Load all subgraphs into memory
    this.loadAllSubgraphs();
  }

  @action
  async loadAllSubgraphs() {
    if (!this.currentDirHandle) return;

    const subgraphs = new Map<string, GraphState>();

    // Process files in parallel
    await Promise.all(this.files.map(async (fileEntry) => {
      try {
        const file = await fileEntry.handle.getFile();
        const text = await file.text();
        const innerState = JSON.parse(text) as GraphInnerState;

        // Construct full GraphState
        const graphState: GraphState = {
          inner: innerState,
          auxiliary: buildGraphStateAuxiliary(innerState)
        };

        // Normalize ID: Remove .json extension if preferred, or keep as filename?
        // Let's use the filename as the ID for now.
        // User convention is likely just filename.
        // If primitive_subgraph uses "my-synth", and file is "my-synth.json".
        // Let's store both with and without .json? Or strip it.
        // Resolving: "my-synth" -> "my-synth.json" usually happening in file lookup.
        // The ID in primitive_subgraph is likely just the string.
        // Let's match how we handle ids.
        // "subgraphId" in primitive_subgraph is just a string.
        // Let's store by filename for simplicity first.
        // If user enters "foo", they likely mean "foo.json".
        // Let's strip ".json" for the ID key.
        const id = fileEntry.name.replace('.json', '').replace(/\//g, '.');
        subgraphs.set(id, graphState);

      } catch (e) {
        console.warn(`Failed to load subgraph ${fileEntry.name}`, e);
      }
    }));

    // optional chaining because localController might be undefined in tests
    this.localController?.setLoadedSubgraphs(subgraphs);
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

      // Update cache
      this.loadAllSubgraphs();
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
