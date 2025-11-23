import { vi } from 'vitest';

// Mock IndexedDB
if (!globalThis.indexedDB) {
  const mockTransaction = {
    objectStore: vi.fn().mockReturnValue({
      put: vi.fn(),
      get: vi.fn().mockReturnValue({
        onsuccess: null,
        result: null,
        error: null,
      }),
    }),
    oncomplete: null,
    onerror: null,
  };

  const mockDb = {
    objectStoreNames: { contains: vi.fn().mockReturnValue(false) },
    createObjectStore: vi.fn(),
    transaction: vi.fn().mockReturnValue(mockTransaction),
  };

  const mockRequest = {
    onupgradeneeded: null,
    onsuccess: null,
    onerror: null,
    result: mockDb,
    error: null,
  };

  // Simulate async success
  const openMock = vi.fn().mockImplementation(() => {
    setTimeout(() => {
      if (typeof mockRequest.onsuccess === 'function') {
        (mockRequest.onsuccess as Function)({ target: mockRequest });
      }
    }, 0);
    return mockRequest;
  });

  (globalThis as any).indexedDB = {
    open: openMock,
  };
}

// Mock File System Access API
if (!(globalThis as any).showDirectoryPicker) {
  (globalThis as any).showDirectoryPicker = vi.fn();
}
