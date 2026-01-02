import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GridPopupManager } from './popup-manager';
import { AppController } from '../../builder/state';

// Mock Dependencies
const mockNodeType = {
  inputs: [{ name: 'in' }],
  outputs: [{ name: 'out' }]
};

vi.mock('../../structor/repository', () => ({
  defaultNodeRepository: {
    getNodeType: vi.fn((id) => {
      if (id === 'existing.type') return mockNodeType;
      return undefined;
    })
  }
}));

// Mock AppController
const mockLongEdit = {
  applyAgain: vi.fn(),
  cancel: vi.fn(),
  accept: vi.fn()
};

const mockAppController = {
  beginLongEdit: vi.fn(() => mockLongEdit),
  acceptLongEdit: vi.fn(),
  createNode: vi.fn(),
  setNodeConfig: vi.fn(),
  deleteConnection: vi.fn(),
  createConnection: vi.fn(),
  observableState: {
    graph: {
      inner: {
        connections: {
          'conn-1': { id: 'conn-1', fromNodeId: 'n1', fromPort: 'out', toNodeId: 'n2', toPort: 'in' }
        }
      }
    }
  }
};

describe('GridPopupManager', () => {
  let manager: GridPopupManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new GridPopupManager(mockAppController as any);
  });

  it('starts creation with long edit transaction', () => {
    manager.startCreation(100, 200, 5, 5, 'util.hub');

    expect(manager.popup).toEqual(expect.objectContaining({
      x: 100, y: 200, gridX: 5, gridY: 5, initialValue: 'util.hub', isNew: true
    }));
    expect(mockAppController.beginLongEdit).toHaveBeenCalled();

    // Check apply callback of beginLongEdit
    const applyFn = mockAppController.beginLongEdit.mock.calls[0][0].apply;
    applyFn({ createNode: mockAppController.createNode } as any);
    expect(mockAppController.createNode).toHaveBeenCalledWith('util.hub', 5, 5, expect.objectContaining({ id: expect.any(String) }));
  });

  it('updates preview and applies transaction again', () => {
    manager.startCreation(0, 0, 0, 0, 'util.hub');
    const nodeId = manager.popup!.nodeId;

    manager.updatePreview('existing.type');

    expect(mockLongEdit.applyAgain).toHaveBeenCalled();

    // Check the callback passed to applyAgain
    const applyFn = mockLongEdit.applyAgain.mock.calls[0][0];
    const mockController = {
      createNode: vi.fn(),
      setNodeConfig: vi.fn(),
      deleteConnection: vi.fn(),
      createConnection: vi.fn()
    };
    applyFn(mockController);

    // Since isNew=true, it should call createNode
    expect(mockController.createNode).toHaveBeenCalledWith('existing.type', 0, 0, expect.objectContaining({ id: nodeId }));
  });

  it('handles subgraph alias expansion', () => {
    manager.startCreation(0, 0, 0, 0, 'util.hub');
    const nodeId = manager.popup!.nodeId;

    manager.updatePreview('foo.bar.baz'); // Not in repo, but has dots

    const applyFn = mockLongEdit.applyAgain.mock.calls[0][0];
    const mockController = { createNode: vi.fn() };
    applyFn(mockController as any);

    expect(mockController.createNode).toHaveBeenCalledWith('core.subgraph', 0, 0, expect.objectContaining({
      id: nodeId,
      subgraphId: 'foo.bar.baz'
    }));
  });

  it('handles live rewire on connection', () => {
    manager.startCreation(0, 0, 0, 0, 'util.hub', 'conn-1');
    const nodeId = manager.popup!.nodeId!;

    manager.updatePreview('existing.type');

    const applyFn = mockLongEdit.applyAgain.mock.calls[0][0];
    const mockController = {
      createNode: vi.fn(),
      deleteConnection: vi.fn(),
      createConnection: vi.fn()
    };
    applyFn(mockController as any);

    expect(mockController.deleteConnection).toHaveBeenCalledWith('conn-1');
    expect(mockController.createConnection).toHaveBeenCalledWith('n1', 'out', nodeId, 'in');
    expect(mockController.createConnection).toHaveBeenCalledWith(nodeId, 'out', 'n2', 'in');
  });

  it('cancels transaction', () => {
    manager.startCreation(0, 0, 0, 0, 'util.hub');
    manager.cancel();

    expect(mockLongEdit.cancel).toHaveBeenCalled();
    expect(manager.popup).toBeNull();
  });

  it('commits transaction on success', () => {
    manager.startCreation(0, 0, 0, 0, 'util.hub');
    manager.commit();

    expect(mockLongEdit.accept).toHaveBeenCalled();
    expect(manager.popup).toBeNull();
  });
});
