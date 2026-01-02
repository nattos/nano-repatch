import { AppController, LocalController, GridNode } from '../../builder/state';
import { PointerDragOp } from '../../utils/pointer-drag-op';

export interface NodeInteractionHost {
  element: HTMLElement;
  node: GridNode;
  getRootNode(): Node | ShadowRoot;
  getBoundingClientRect(): DOMRect;
  addDragTransform(x: number, y: number): void;
  clearDragTransform(): void;
  setDragState(isDragged: boolean): void;
}

export class NodeInteraction {
  constructor(
    private host: NodeInteractionHost,
    private appController: AppController,
    private localController: LocalController
  ) { }

  handlePointerDown(e: PointerEvent) {
    // Stop propagation to prevent Grid selection
    e.stopPropagation();

    // If interactive element, ignore (logic usually in Click, but also PointerDown for drag start prevention?)
    // GraphNode has check in handleClick. Drag starts on PointerDown.
    // We should check if target is interactive here too?
    // GraphNode handles `handleClick` for selection, but `handlePointerDown` for drag.
    // If I click input, I don't want to drag.
    const path = e.composedPath();
    const isInteractive = path.some(el => {
      const element = el as HTMLElement;
      if (!element.classList) return false;
      return element.tagName?.toLowerCase() === 'graph-port' ||
        element.classList.contains('virtual-inputs-container') || // Container? Maybe children?
        element.tagName?.toLowerCase() === 'input' ||
        element.tagName?.toLowerCase() === 'select' ||
        element.tagName?.toLowerCase() === 'smart-input' ||
        element.tagName?.toLowerCase() === 'scalar-slider';
    });

    if (isInteractive && !path.some(el => (el as Element).tagName === 'GRAPH-PORT')) {
      // Allow dragging from port? No, port drag is wire creation handled by Port?
      // GraphGrid handles Port drag.
      // If I click scalar slider, I don't want to drag node.
      return;
    }

    // Ensure selection
    if (!this.localController.observableState.selection.has(this.host.node.id)) {
      this.localController.queueSelectPaths([this.host.node.id], e.shiftKey || e.ctrlKey || e.metaKey);
    }

    const gridHost = (this.host.getRootNode() as ShadowRoot)?.host as HTMLElement;

    new PointerDragOp(e, this.host.element, {
      move: (e, delta) => {
        this.host.addDragTransform(delta[0], delta[1]);

        if (gridHost) {
          const rect = this.host.getBoundingClientRect();
          const gridRect = gridHost.getBoundingClientRect();
          const ANCHOR_BIAS = 40;

          let anchorX = rect.left + (rect.width / 2);
          if (delta[0] < 0) anchorX = rect.left + ANCHOR_BIAS;
          else if (delta[0] > 0) anchorX = rect.right - ANCHOR_BIAS;

          let anchorY = rect.top + (rect.height / 2);
          if (delta[1] < 0) anchorY = rect.top + ANCHOR_BIAS;
          else if (delta[1] > 0) anchorY = rect.bottom - ANCHOR_BIAS;

          const relativeX = anchorX - gridRect.left + gridHost.scrollLeft;
          const relativeY = anchorY - gridRect.top + gridHost.scrollTop;

          const cell = this.localController.getGridCellFromPixels(relativeX, relativeY);
          this.localController.setDragPreview({ x: cell.x, y: cell.y, w: 1, h: 1 });
        }
      },
      accept: (e, delta) => {
        this.localController.setDragPreview(null);
        this.handleDragAccept(e, delta, gridHost);
      },
      cancel: () => {
        this.localController.setDragPreview(null);
        this.host.clearDragTransform();
      }
    });
  }

  private handleDragAccept(e: MouseEvent, delta: [number, number], gridHost: HTMLElement) {
    if (!gridHost) return;

    const rect = this.host.getBoundingClientRect();
    const gridRect = gridHost.getBoundingClientRect();
    const ANCHOR_BIAS = 40;

    let anchorX = rect.left + (rect.width / 2);
    if (delta[0] < 0) anchorX = rect.left + ANCHOR_BIAS;
    else if (delta[0] > 0) anchorX = rect.right - ANCHOR_BIAS;

    let anchorY = rect.top + (rect.height / 2);
    if (delta[1] < 0) anchorY = rect.top + ANCHOR_BIAS;
    else if (delta[1] > 0) anchorY = rect.bottom - ANCHOR_BIAS;

    const relativeX = anchorX - gridRect.left + gridHost.scrollLeft;
    const relativeY = anchorY - gridRect.top + gridHost.scrollTop;

    // Get exact target cell using the SAME logic as the preview
    const targetCell = this.localController.getGridCellFromPixels(relativeX, relativeY);

    // Calculate Grid Delta
    const dx = targetCell.x - this.host.node.x;
    const dy = targetCell.y - this.host.node.y;

    const selectedNodeIds = Array.from(this.localController.observableState.selection.keys())
      .filter(id => id.startsWith('node-'));

    const { dx: constrainedDx, dy: constrainedDy } = this.appController.calculateConstrainedMove(selectedNodeIds, dx, dy);

    this.appController.moveNodes(selectedNodeIds, constrainedDx, constrainedDy);

    this.host.clearDragTransform();
    this.host.setDragState(true);
    setTimeout(() => this.host.setDragState(false), 0);
  }
}
