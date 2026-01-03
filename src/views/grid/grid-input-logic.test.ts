import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GridInputLogic, GridInputHost } from './grid-input-logic';

// Mocks
const mockAppController = {
  observableState: {
    graph: {
      inner: {
        nodes: {},
        connections: {}
      }
    }
  },
  transaction: vi.fn((fn) => fn(mockAppController)),
  deleteNode: vi.fn(),
  createConnection: vi.fn()
};

const mockLocalController = {
  observableState: {
    lastGroupSelection: null
  },
  setLastGroupSelection: vi.fn()
};

const mockRuntimeManager = {
  resumeAudio: vi.fn()
};

const mockSelectionManager = {
  start: vi.fn()
};

const mockPopupManager = {
  startCreation: vi.fn()
};

vi.mock('../../structor/repository', () => ({
  defaultNodeRepository: {
    getNodeType: vi.fn(() => ({ inputs: [{ name: 'in' }], outputs: [{ name: 'out' }] }))
  }
}));

describe('GridInputLogic', () => {
  let logic: GridInputLogic;
  let host: GridInputHost;
  let mockElement: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mockElement = document.createElement('div');

    host = {
      element: mockElement,
      getScrollState: vi.fn().mockReturnValue({ scrollLeft: 0, scrollTop: 0 }),
      getBoundingClientRect: vi.fn().mockReturnValue({ left: 0, top: 0, width: 800, height: 600 }),
      closePopup: vi.fn()
    };

    logic = new GridInputLogic(
      host,
      mockAppController as any,
      mockLocalController as any,
      mockRuntimeManager as any,
      mockSelectionManager as any,
      mockPopupManager as any
    );
  });

  it('starts selection on background pointer down', () => {
    const e = {
      composedPath: () => [mockElement],
      clientX: 100,
      clientY: 100
    } as unknown as PointerEvent;

    logic.handlePointerDown(e);

    expect(host.closePopup).toHaveBeenCalled();
    expect(mockRuntimeManager.resumeAudio).toHaveBeenCalled();
    expect(mockSelectionManager.start).toHaveBeenCalledWith(e);
  });

  it('ignores selection on node click', () => {
    const node = document.createElement('graph-node');
    const e = {
      composedPath: () => [node, mockElement],
      clientX: 100,
      clientY: 100
    } as unknown as PointerEvent;

    logic.handlePointerDown(e);

    expect(mockRuntimeManager.resumeAudio).toHaveBeenCalled();
    expect(mockSelectionManager.start).not.toHaveBeenCalled();
  });

  it('starts creation popup on cell double click', () => {
    const cell = document.createElement('div');
    cell.classList.add('cell', 'node-cell');
    cell.dataset.x = '5';
    cell.dataset.y = '10';
    vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 100 } as DOMRect);

    const e = {
      composedPath: () => [cell],
      clientX: 100,
      clientY: 100
    } as unknown as MouseEvent;

    logic.handleDblClick(e);

    expect(mockPopupManager.startCreation).toHaveBeenCalledWith(100, 60, 5, 10, 'util.hub'); // 100 - (0 host left) + 0 scroll = 100. 100 - (0 host top) + 0 scroll - 40 = 60.
  });

  it('does NOT start creation popup if cell is occupied', () => {
    // Occupy the target cell
    mockAppController.observableState.graph.inner.nodes = {
      'existing-node': { x: 5, y: 10, config: { typeId: 'test.type' } }
    };

    const cell = document.createElement('div');
    cell.classList.add('cell', 'node-cell');
    cell.dataset.x = '5';
    cell.dataset.y = '10';
    vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 100 } as DOMRect);

    const e = {
      composedPath: () => [cell],
      clientX: 100,
      clientY: 100
    } as unknown as MouseEvent;

    logic.handleDblClick(e);

    expect(mockPopupManager.startCreation).not.toHaveBeenCalled();

    // Reset state
    mockAppController.observableState.graph.inner.nodes = {};
  });

  it('deletes node on double click', () => {
    const node = document.createElement('graph-node');
    node.setAttribute('data-id', 'test-node');

    const e = {
      composedPath: () => [node]
    } as unknown as MouseEvent;

    logic.handleDblClick(e);

    expect(mockAppController.deleteNode).toHaveBeenCalledWith('test-node');
  });

  it('splices node on deletion if eligible', () => {
    // Setup state for splice
    mockAppController.observableState.graph.inner.nodes = {
      'splice-node': { config: { typeId: 'test.type' } }
    };
    mockAppController.observableState.graph.inner.connections = {
      'c1': { id: 'c1', fromNodeId: 'n1', fromPort: 'out', toNodeId: 'splice-node', toPort: 'in' },
      'c2': { id: 'c2', fromNodeId: 'splice-node', fromPort: 'out', toNodeId: 'n2', toPort: 'in' }
    };

    const node = document.createElement('graph-node');
    node.setAttribute('data-id', 'splice-node');

    const e = {
      composedPath: () => [node]
    } as unknown as MouseEvent;

    logic.handleDblClick(e);

    expect(mockAppController.deleteNode).toHaveBeenCalledWith('splice-node');
    expect(mockAppController.createConnection).toHaveBeenCalledWith('n1', 'out', 'n2', 'in');
  });
});
