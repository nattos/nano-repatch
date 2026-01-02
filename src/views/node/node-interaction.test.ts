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
  moveNodes: vi.fn()
};

const mockLocalController = {
  observableState: {
    selection: new Set<string>()
  },
  queueSelectPaths: vi.fn(),
  getGridCellFromPixels: vi.fn().mockReturnValue({ x: 5, y: 5 }),
  setDragPreview: vi.fn()
};

describe('NodeInteraction', () => {
  let interaction: NodeInteraction;
  let host: NodeInteractionHost;
  let mockElement: HTMLElement;
  let mockGridHost: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mockElement = document.createElement('div');
    mockGridHost = document.createElement('div');
    vi.spyOn(mockGridHost, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 1000 } as DOMRect);

    host = {
      element: mockElement,
      node: { id: 'node-1', x: 0, y: 0 } as any,
      getRootNode: vi.fn().mockReturnValue({ host: mockGridHost }),
      getBoundingClientRect: vi.fn().mockReturnValue({ left: 100, top: 100, width: 100, height: 100 } as DOMRect),
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
    mockLocalController.observableState.selection.add('node-1');

    mockHandlers.accept({} as MouseEvent, [100, 100]);

    expect(mockAppController.moveNodes).toHaveBeenCalledWith(['node-1'], 10, 10); // 10, 10 from calculateConstrainedMove mock
    expect(host.clearDragTransform).toHaveBeenCalled();
  });

  it('clears drag on cancel', () => {
    const e = { stopPropagation: vi.fn(), composedPath: () => [] } as unknown as PointerEvent;
    interaction.handlePointerDown(e);

    mockHandlers.cancel();

    expect(host.clearDragTransform).toHaveBeenCalled();
    expect(mockLocalController.setDragPreview).toHaveBeenCalledWith(null);
  });
});
