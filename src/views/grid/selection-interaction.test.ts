import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SelectionInteraction, SelectionHost, NodeElement } from './selection-interaction';

// Mock PointerDragOp
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

describe('SelectionInteraction', () => {
  let host: SelectionHost;
  let interaction: SelectionInteraction;
  let mockElement: HTMLElement;
  let nodes: NodeElement[];

  beforeEach(() => {
    nodes = [];
    mockElement = document.createElement('div');
    vi.spyOn(mockElement, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 800, height: 600, x: 0, y: 0, bottom: 600, right: 800, toJSON: () => { }
    });

    host = {
      element: mockElement,
      getScrollState: vi.fn().mockReturnValue({ scrollLeft: 0, scrollTop: 0 }),
      getNodes: vi.fn().mockImplementation(() => nodes),
      setSelectionBox: vi.fn(),
      onSelectionChange: vi.fn()
    };

    interaction = new SelectionInteraction(host);
  });

  it('calculates selection box correctly on move', () => {
    const startEvent = { clientX: 100, clientY: 100 } as PointerEvent;
    interaction.start(startEvent);

    // Simulate move to (200, 200)
    mockHandlers.move({ clientX: 200, clientY: 200 } as PointerEvent, [100, 100]);

    expect(host.setSelectionBox).toHaveBeenCalledWith({
      x: 100, y: 100, w: 100, h: 100
    });
  });

  it('identifies selected nodes intersecting the box', () => {
    // Setup a node at 150, 150 (50x50)
    const node = document.createElement('div');
    node.dataset.id = 'node-1';
    vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({
      left: 150, top: 150, width: 50, height: 50, x: 150, y: 150, bottom: 200, right: 200, toJSON: () => { }
    });
    nodes.push(node as NodeElement);

    const startEvent = { clientX: 100, clientY: 100 } as PointerEvent;
    interaction.start(startEvent);

    // Move to enclose the node (100,100 -> 300,300)
    mockHandlers.move({ clientX: 300, clientY: 300 } as PointerEvent, [0, 0]);

    expect(host.onSelectionChange).toHaveBeenCalledWith(['node-1'], false);
  });

  it('detects additive selection (Shift key)', () => {
    const node = document.createElement('div');
    node.dataset.id = 'node-1';
    vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({
      left: 150, top: 150, width: 50, height: 50, x: 150, y: 150, bottom: 200, right: 200, toJSON: () => { }
    });
    nodes.push(node as NodeElement);

    const startEvent = { clientX: 100, clientY: 100, shiftKey: true } as PointerEvent;
    interaction.start(startEvent);

    mockHandlers.move({ clientX: 300, clientY: 300 } as PointerEvent, [0, 0]);

    expect(host.onSelectionChange).toHaveBeenCalledWith(['node-1'], true);
  });

  it('clears selection box on accept', () => {
    const startEvent = { clientX: 100, clientY: 100 } as PointerEvent;
    interaction.start(startEvent);
    mockHandlers.accept();
    expect(host.setSelectionBox).toHaveBeenCalledWith(null);
  });

  it('clears selection box and selection on cancel', () => {
    const startEvent = { clientX: 100, clientY: 100 } as PointerEvent;
    interaction.start(startEvent);
    mockHandlers.cancel();
    expect(host.setSelectionBox).toHaveBeenCalledWith(null);
    expect(host.onSelectionChange).toHaveBeenCalledWith([], false);
  });
});
