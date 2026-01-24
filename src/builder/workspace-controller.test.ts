import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkspaceController } from './workspace-controller';
import { AppController } from './state';

// Mock File System Access API
const mockFileHandle = {
  kind: 'file',
  name: 'test.json',
  getFile: vi.fn().mockResolvedValue({
    text: vi.fn().mockResolvedValue('{"nodes":{},"connections":{}}'),
  }),
  createWritable: vi.fn().mockResolvedValue({
    write: vi.fn(),
    close: vi.fn(),
  }),
};

const mockDirHandle = {
  kind: 'directory',
  name: 'test-dir',
  entries: vi.fn().mockImplementation(async function* () {
    yield ['test.json', mockFileHandle];
  }),
  getFileHandle: vi.fn().mockResolvedValue(mockFileHandle),
  queryPermission: vi.fn().mockResolvedValue('granted'),
  requestPermission: vi.fn().mockResolvedValue('granted'),
};

Object.defineProperty(window, 'showDirectoryPicker', {
  value: vi.fn().mockResolvedValue(mockDirHandle),
});
Object.defineProperty(window, 'location', {
  value: { search: '', href: 'http://localhost/' },
  writable: true,
});
Object.defineProperty(window, 'history', {
  value: { replaceState: vi.fn() },
});

vi.stubGlobal('indexedDB', {
  open: vi.fn().mockImplementation(() => {
    const request: any = {
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
      result: {
        objectStoreNames: { contains: vi.fn().mockReturnValue(true) },
        createObjectStore: vi.fn(),
        transaction: vi.fn().mockImplementation(() => {
          const tx: any = {
            objectStore: vi.fn().mockReturnValue({
              put: vi.fn(),
              get: vi.fn().mockImplementation(() => {
                const req: any = { result: null, onsuccess: null, onerror: null };
                setTimeout(() => req.onsuccess && req.onsuccess(), 0);
                return req;
              }),
            }),
            oncomplete: null,
            onerror: null,
          };
          setTimeout(() => tx.oncomplete && tx.oncomplete(), 0);
          return tx;
        }),
      },
    };
    setTimeout(() => {
      if (request.onupgradeneeded) request.onupgradeneeded({ target: request });
      if (request.onsuccess) request.onsuccess({ target: request });
    }, 0);
    return request;
  }),
});

describe('WorkspaceController', () => {
  let appController: AppController;
  let workspaceController: WorkspaceController;

  beforeEach(() => {
    appController = new AppController();
    workspaceController = new WorkspaceController(appController);
  });

  it('should initialize with empty state', () => {
    expect(workspaceController.currentDirHandle).toBeNull();
    expect(workspaceController.files).toEqual([]);
  });

  it('should open folder and list files', async () => {
    await workspaceController.openFolder();
    expect(workspaceController.currentDirHandle?.name).toBe(mockDirHandle.name);
    expect(workspaceController.files.length).toBe(1);
    expect(workspaceController.files[0].name).toBe('test.json');
  });

  it('should open file and load graph', async () => {
    await workspaceController.openFolder();
    await workspaceController.openFile('test.json');

    expect(workspaceController.currentGraphId).toBe('test.json');
    // Check if appController loaded the graph (empty in this case)
    expect(appController.getState().graph.inner.nodes).toEqual({});
  });

  it('should auto-save when graph changes', async () => {
    await workspaceController.openFolder();
    await workspaceController.openFile('test.json');

    // Mock createWritable
    const mockWritable = {
      write: vi.fn(),
      close: vi.fn(),
    };
    mockFileHandle.createWritable.mockResolvedValue(mockWritable);

    vi.useFakeTimers();

    // Trigger change
    appController.createNode('test-node', 0, 0);

    // Fast-forward debounce
    vi.runAllTimers();

    // We need to wait for the async saveCurrentGraph to complete
    // Since runAllTimers is synchronous, the async promise resolution happens after
    // We can use a small real delay or flush promises
    vi.useRealTimers();
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockFileHandle.createWritable).toHaveBeenCalled();
    expect(mockWritable.write).toHaveBeenCalled();
  });
});
