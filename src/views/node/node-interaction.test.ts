import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NodeInteraction, NodeInteractionHost } from './node-interaction';

const mockHandlers = {
  move: vi.fn(),
  accept: vi.fn(),
  cancel: vi.fn()
};

vi.mock('../../utils/pointer-drag-op', () => {
  return {
    PointerDragOp: class {
      constructor(e: any, el: any, handlers: any) {
        mockHandlers.move = handlers.move;
        mockHandlers.accept = handlers.accept;
        mockHandlers.cancel = handlers.cancel;
      }
    }
  };
});

const mockAppController = {
  calculateConstrainedMove: vi.fn().mockReturnValue({ dx: 10, dy: 10 }),
  moveNodes: vi.fn(),
  duplicateNodes: vi.fn(),
  getState: vi.fn().mockReturnValue({
    graph: {
      inner: {
        nodes: {
          'node-1': { id: 'node-1', x: 0, y: 0 }
        }
      }
    }
  })
};

const mockLocalController = {
  observableState: {
    selection: new Map<string, boolean>()
  },
  queueSelectPaths: vi.fn(),
  getGridCellFromPixels: vi.fn().mockReturnValue({ x: 5, y: 5 }),
  setDragPreview: vi.fn(),
  setAltKeyPressed: vi.fn(),
  setIsDraggingSelection: vi.fn(),
  getViewportCenterGridCoordinates: vi.fn().mockReturnValue({ x: 5, y: 5 })
};

describe('NodeInteraction', () => {
  let interaction: NodeInteraction;
  let host: NodeInteractionHost;
  let mockElement: HTMLElement;
  let mockGridHost: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLocalController.observableState.selection.clear();
    mockElement = document.createElement('div');
    mockGridHost = document.createElement('div');
    vi.spyOn(mockGridHost, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 1000, right: 1000, bottom: 1000, x: 0, y: 0, toJSON: () => { } } as DOMRect);

    host = {
      element: mockElement,
      node: { id: 'node-1', x: 0, y: 0 } as any,
      getRootNode: vi.fn().mockReturnValue({ host: mockGridHost }),
      getBoundingClientRect: vi.fn().mockReturnValue({ left: 100, top: 100, width: 100, height: 100, right: 200, bottom: 200, x: 100, y: 100, toJSON: () => { } } as DOMRect),
      addDragTransform: vi.fn(),
      clearDragTransform: vi.fn(),
      setDragState: vi.fn()
    };

    interaction = new NodeInteraction(host, mockAppController as any, mockLocalController as any);
  });

  it('selects node on pointer down if not selected', () => {
    const e = {
      stopPropagation: vi.fn(),
      shiftKey: false, ctrlKey: false, metaKey: false, composedPath: () => []
    } as unknown as PointerEvent;

    interaction.handlePointerDown(e);

    expect(mockLocalController.queueSelectPaths).toHaveBeenCalledWith(['node-1'], false);
  });

  it('updates drag transform on move', () => {
    const e = { stopPropagation: vi.fn(), composedPath: () => [] } as unknown as PointerEvent;
    interaction.handlePointerDown(e);

    mockHandlers.move({ clientX: 200, clientY: 200 } as PointerEvent, [10, 20]);

    expect(host.addDragTransform).toHaveBeenCalledWith(10, 20);
    expect(mockLocalController.setDragPreview).toHaveBeenCalled();
  });

  it('moves nodes on accept', () => {
    const e = { stopPropagation: vi.fn(), composedPath: () => [] } as unknown as PointerEvent;
    interaction.handlePointerDown(e);

    // Setup selection
    mockLocalController.observableState.selection.set('node-1', true);

    mockHandlers.accept({} as MouseEvent, [100, 100]);

    expect(mockAppController.moveNodes).toHaveBeenCalledWith(['node-1'], 10, 10); // 10, 10 from calculateConstrainedMove mock
    expect(host.clearDragTransform).toHaveBeenCalled();
  });

  it('clears drag on cancel', () => {
    const e = { stopPropagation: vi.fn(), composedPath: () => [] } as unknown as PointerEvent;
    interaction.handlePointerDown(e);

    mockHandlers.cancel();

    expect(mockLocalController.setDragPreview).toHaveBeenCalledWith(null);
  });

  it('duplicates nodes on accept if alt key is held', () => {
    const e = { stopPropagation: vi.fn(), composedPath: () => [] } as unknown as PointerEvent;
    interaction.handlePointerDown(e);

    // Setup selection and Alt key
    mockLocalController.observableState.selection.set('node-1', true);
    mockLocalController.observableState.altKeyPressed = true;

    mockHandlers.accept({ altKey: true } as MouseEvent, [100, 100]);

    // Expected delta: target({x:5,y:5}) - original({x:0,y:0}) = {x:5,y:5}
    expect(mockAppController.duplicateNodes).toHaveBeenCalledWith(['node-1'], { x: 5, y: 5 });
    expect(mockAppController.moveNodes).not.toHaveBeenCalled();
    expect(host.clearDragTransform).toHaveBeenCalled();
  });
});
