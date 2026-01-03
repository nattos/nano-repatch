import { AppController, GridNode } from '../../builder/state';
import { LocalController } from '../../builder/local-state';
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

    // If interactive element, ignore
    const path = e.composedPath();
    const isInteractive = path.some(el => {
      const element = el as HTMLElement;
      if (!element.classList) return false;
      return element.tagName?.toLowerCase() === 'graph-port' ||
        element.classList.contains('virtual-inputs-container') ||
        element.tagName?.toLowerCase() === 'input' ||
        element.tagName?.toLowerCase() === 'select' ||
        element.tagName?.toLowerCase() === 'smart-input' ||
        element.tagName?.toLowerCase() === 'scalar-slider';
    });

    if (isInteractive && !path.some(el => (el as Element).tagName === 'GRAPH-PORT')) {
      return;
    }

    // Ensure selection
    if (!this.localController.observableState.selection.has(this.host.node.id)) {
      this.localController.queueSelectPaths([this.host.node.id], e.shiftKey || e.ctrlKey || e.metaKey);
    }

    // Capture initial Alt state
    this.localController.setAltKeyPressed(e.altKey);
    this.localController.setIsDraggingSelection(true);

    const gridHost = (this.host.getRootNode() as ShadowRoot)?.host as HTMLElement;

    new PointerDragOp(e, this.host.element, {
      move: (e, delta) => {
        // Dynamic Modifier Tracking
        this.localController.setAltKeyPressed(e.altKey);

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
        this.localController.setIsDraggingSelection(false);
        this.handleDragAccept(e, delta, gridHost);
      },
      cancel: () => {
        this.localController.setDragPreview(null);
        this.localController.setIsDraggingSelection(false);
        this.host.clearDragTransform();
      }
    });
  }

  private handleDragAccept(e: MouseEvent, delta: [number, number], gridHost: HTMLElement) {
    if (!gridHost) return;

    // Duplication Check (On Drop)
    // If Option/Alt is held at the end of the drag:
    // 1. DUPLICATE the selected nodes to the target location.
    // 2. DO NOT move the original nodes (they snap back to origin).
    if (e.altKey) {
      const selectedIds: string[] = [];
      const selection = this.localController.observableState.selection;
      for (const [path] of selection) {
        if (this.appController.getState().graph.inner.nodes[path]) {
          selectedIds.push(path);
        }
      }

      // Calculate Delta Grid Coords
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
      const targetCell = this.localController.getGridCellFromPixels(relativeX, relativeY);

      const originalX = this.host.node.x;
      const originalY = this.host.node.y;

      const dx = targetCell.x - originalX;
      const dy = targetCell.y - originalY;

      // Duplicate at offset
      const newIds = this.appController.duplicateNodes(selectedIds, { x: dx, y: dy });

      // Clear Transform on Originals (Snap Back)
      this.host.clearDragTransform();

      // Select New Nodes
      this.localController.queueSelectPaths(newIds);
      return;
    }

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
