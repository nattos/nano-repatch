import './graph-node';
import { WireRenderer, WireRendererContext } from './wire-renderer';
import { MobxLitElement } from './mobx-lit-element';
import { css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { GridPopupManager } from './grid/popup-manager';
import { SelectionInteraction } from './grid/selection-interaction';
import { GridInputLogic } from './grid/grid-input-logic';
import { repeat } from 'lit/directives/repeat.js';
import { appController, localController, runtimeManager, workspaceController } from '../builder/controllers';
import { reaction } from 'mobx';
import { GridNode } from '../builder/state';
import { Selectable } from '../builder/local-state';
import { cssColorFromHash } from '../utils/layout-utils';
import { isEditingText } from '../utils/utils';
import { NodeCatalog } from '../structor/node-catalog';
import { defaultNodeRepository } from '../structor/repository';
import { globalStyles } from '../styles';
import { GRID_MIN_COLS, GRID_OUTPUT_COL_PADDING } from '../constants';


interface WireInsert {
  wireId: string;
  x: number;
  y: number;
  gridX: number;
  gridY: number;
  orientation: 'vertical' | 'horizontal';
}

@customElement('graph-grid')
export class GraphGrid extends MobxLitElement {
  static readonly styles = [
    ...globalStyles,
    css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      overflow: auto;
      position: relative;
      user-select: none;
      background-color: var(--bg-color);
    }

    .grid-container {
      display: grid;
      /*
        Col 1: Input
        Col 2: Gap
        Col 3: Node 1
        Col 4: Gap
        ...
        Col 2*12+1: Node 12
        Col 2*12+2: Gap
        Col 2*12+3: Output
      */
      grid-template-columns:
        [input] minmax(80px, auto)
        [gap-start] var(--grid-gap, 16px)
        repeat(12, [node] auto [gap] minmax(0, auto))
        [output] minmax(80px, auto);

      grid-template-rows:
        [gap-top] var(--grid-gap, 16px)
        repeat(12, [node] minmax(0, auto) [gap] var(--grid-gap, 16px));

      /* Revert: Don't force 24px auto-rows */
      /* grid-auto-rows: 24px; */

      min-width: 100%;
      justify-content: start;
      align-content: start;
      /* min-height: 100%; Removed to prevent row stretching */
      gap: 0;
      position: relative;
      align-content: start;
      justify-content: start; /* CRITICAL: Prevent auto tracks from expanding to fill width */
      outline: none;
    }

    .selection-box {
      position: absolute;
      background-color: var(--selection-color);
      border: 1px solid var(--selection-border);
      pointer-events: none;
      z-index: 200;
    }

    .cell {
      /* background-color: rgba(255, 255, 255, 0.05); */
      border-radius: 4px;
      pointer-events: auto;
      box-sizing: border-box;
    }

    /* Region Visualization */
    .region-box {
      border-radius: 8px;
      z-index: 5;
      opacity: 0.8;
      margin: -4px; /* Expand slightly to encompass nodes */
      position: relative;
      cursor: move;
    }

    .region-box.selected {
      pointer-events: auto; /* Block clicks only if selected (for moving) */
    }

    .region-box:not(.selected) {
      pointer-events: none;
    }

    /* Collapsed Region (Read-Only) */
    .region-box.collapsed {
      pointer-events: none !important;
      cursor: default;
    }

    /* Resize Rails */
    .border-rail {
      position: absolute;
      pointer-events: auto;
    }

    .border-rail.n { top: 0; left: 0; right: 0; height: 6px; cursor: row-resize; }
    .border-rail.s { bottom: 0; left: 0; right: 0; height: 6px; cursor: row-resize; }
    .border-rail.w { top: 0; bottom: 0; left: 0; width: 6px; cursor: col-resize; }
    .border-rail.e { top: 0; bottom: 0; right: 0; width: 6px; cursor: col-resize; }

    /* Resize Handles (Corners) */
    .resize-handle {
      position: absolute;
      pointer-events: auto;
      z-index: 10;
    }

    .resize-handle.e { top: 50%; right: -8px; transform: translateY(-50%); width: 16px; height: 32px; cursor: col-resize; }
    .resize-handle.s { left: 50%; bottom: -8px; transform: translateX(-50%); height: 16px; width: 32px; cursor: row-resize; }
    .resize-handle.se { right: -8px; bottom: -8px; width: 24px; height: 24px; cursor: nwse-resize; z-index: 11; }

    .cell.node-cell {
      /* background-color: rgba(255, 255, 255, 0.05); */
      /* border: 1px dashed rgba(255, 255, 255, 0.15); */
      min-width: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* Force centering override */
    .cell.node-cell > graph-node {
        align-self: center;
        justify-self: center; /* For Grid situations */
        margin: auto;
    }

    .cell.gap-cell {
      position: relative;
    }

    .cell.gap-h::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 0;
      right: 0;
      border-bottom: 1px dashed var(--grid-line-color);
    }

    .cell.gap-v::after {
      content: '';
      position: absolute;
      left: 50%;
      top: 0;
      bottom: 0;
      border-left: 1px dashed var(--grid-line-color);
    }

    .wire-segment {
        position: absolute;
        inset: 0;
        pointer-events: none !important;
        z-index: 10;
        margin: auto;
        cursor: pointer;
    }

    /* Sticky IO Columns */
    .cell[data-x="input"],
    .cell[data-x="output"] {
      position: sticky;
      z-index: 90; /* Above wires (10), below nodes (100) */
      background-color: var(--bg-color); /* Opaque background */
      /* Ensure full coverage of the track */
      width: 100%;
      height: 100%;
      overflow: visible; /* Allow pseudo-elements to extend */
    }

    /* Extend Input Column to the right (half gap) */
    .cell[data-x="input"]::before {
      content: '';
      position: absolute;
      top: 0;
      right: -8px; /* extend 8px into the 16px gap */
      bottom: 0;
      width: 8px;
      background-color: var(--bg-color);
      border-right: 1px dashed rgba(255,255,255,0.1);
    }

    /* Extend Output Column to the left (half gap) */
    .cell[data-x="output"]::before {
      content: '';
      position: absolute;
      top: 0;
      left: -8px; /* extend 8px into the 16px gap */
      bottom: 0;
      width: 8px;
      background-color: var(--bg-color);
      border-left: 1px dashed rgba(255,255,255,0.1);
    }

    /* Remove old borders */
    .cell[data-x="input"] {
      left: 0;
    }

    .cell[data-x="output"] {
      right: 0;
    }

    /* Sticky Nodes */
    graph-node[data-io-type="input"],
    graph-node[data-io-type="output"] {
      position: sticky;
      z-index: 110; /* Above regular nodes (100) and cells (90) */
    }

    graph-node[data-io-type="input"] {
      left: 4px; /* Slight offset from edge */
    }

    graph-node[data-io-type="output"] {
      right: 4px;
    }

    /* Separators already handled by ::before extensions above */



    .wire-segment::after {
        content: '';
        position: absolute;
        background: transparent; /* Debug: cyan to see hitboxes if needed */
        inset: -8px; /* 16px extra girth, total 18px+ */
        z-index: 11;
        cursor: pointer;
    }

    .wire-hitbox {
        /* Legacy / Unused? */
        position: absolute;
        inset: 0;
        pointer-events: none;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 20;
    }

    .wire-line {
        position: relative; /* Relative to hitbox */
        background-color: var(--wire-color, #888);
    }

    .wire-segment.selected {
        z-index: 20;
    }

    /* Fatter wire rendering for selected state by manipulating children or SVG if present.
       Since we use border/background logic in wire-renderer:
       The wire itself is the Div or its children.
    */
    .wire-segment.selected > .wire-line {
         /* Lazy Fatter Strategy: Negative margin + Border */
         /* This effectively expands the box by 1px on all sides without layout shift */
         margin: -1px;
         border: 1px solid var(--wire-color);
         background-color: var(--wire-color) !important;
         z-index: 21;
    }

    /* Old Style Insert Marker: Two Slanted Lines (//) */
    .wire-insert-pip {
        position: absolute;
        width: 14px;
        height: 14px;
        background: transparent;
        transform: translate(-50%, -50%);
        pointer-events: none;
        z-index: 1000;
    }

    .wire-insert-pip::before,
    .wire-insert-pip::after {
        content: '';
        position: absolute;
        top: -2px; /* Extend slightly beyond wire */
        bottom: -2px;
        width: 2px;
        background-color: var(--pip-color, var(--accent-color));
        transform: skewX(-20deg);
    }

    .wire-insert-pip::before {
        left: 3px;
    }

    .wire-insert-pip::after {
        right: 3px;
    }

    /* Orientation adjustment if needed */
    .wire-insert-pip.vertical {
        /* On vertical wire, we might want lines to cross horizontally?
           "//" usually means cut perpendicular.
           If wire is vertical | , cut should be = or // rotated?
           Let's stick to standard // orientation regardless, strictly visual marker.
        */
    }
    .wire-hitbox[style*="width: 6px"] .wire-line {
        width: 1px;
        height: 100%;
    }

    /* Horizontal Line in Hitbox */
    .wire-hitbox[style*="height: 6px"] .wire-line {
        width: 100%;
        height: 1px;
    }

    /* Vertical Line in Hitbox */
    .wire-hitbox[style*="width: 6px"] .wire-line {
        width: 2px;
        height: 100%;
    }
    .wire-hitbox[style*="width: 6px"] .wire-line {
        width: 1px;
        height: 100%;
    }

    .wire-segment.h .wire-line {
        height: 1px;
        width: 100%;
        top: 50%;
    }

    .wire-segment.v .wire-line {
        width: 1px;
        height: 100%;
        left: 50%;
    }

    /* Corners - simple approach: Two lines? Or SVG inside div?
       User said "DO NOT construct an SVG to connect up paths", but using a static small SVG icon for a corner is standard?
       Or use borders.
    */
    .wire-corner {
        width: 50%;
        height: 50%;
        border: 1px solid var(--wire-color, #888);
        position: absolute;
        box-sizing: border-box;
    }
    /* TR: Bottom-Left Border? No.
       TR goes from Left (Horizontal) to Bottom (Vertical).
       So it occupies bottom-left quadrant?
       Wait, typical corner TR:
       Right and Top.
       My types: CornerTR meant "top-right of the L"?
       If coming from Left -> Down. That's a "7".
       Visual center is pivot.
       Line from Left-Center to Center.
       Line from Center to Bottom-Center.

       Let's just use two vars/divs for corners if pure DOM.
    */

    .wire-segment.tr .wire-line.h { width: 50%; left: 0; top: 50%; }
    .wire-segment.tr .wire-line.v { height: 50%; left: 50%; top: 50%; }

    .wire-segment.tl .wire-line.h { width: 50%; right: 0; top: 50%; }
    .wire-segment.tl .wire-line.v { height: 50%; left: 50%; top: 50%; }

    .wire-segment.br .wire-line.h { width: 50%; left: 0; top: 50%; }
    .wire-segment.br .wire-line.v { height: 50%; left: 50%; bottom: 50%; }

    .wire-segment.bl .wire-line.h { width: 50%; right: 0; top: 50%; }
    .wire-segment.bl .wire-line.v { height: 50%; left: 50%; bottom: 50%; }

    .cell.gap-c::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 0;
      right: 0;
      border-bottom: 1px dashed rgba(255, 255, 255, 0.15);
    }

    .cell.gap-c::before {
      content: '';
      position: absolute;
      left: 50%;
      top: 0;
      bottom: 0;
      border-left: 1px dashed rgba(255, 255, 255, 0.15);
    }

    /* Hit area for easier clicking */
    /* Hit area for easier clicking */
    /* Hit area attached to the visible lines themselves */
    .wire-line {
        pointer-events: auto !important;
        cursor: pointer;
    }

    .drag-preview {
      /* Slanted hashed pattern */
      background-image: repeating-linear-gradient(
        45deg,
        transparent 0px,
        transparent 3px,
        var(--selection-color, rgba(255, 69, 0, 0.1)) 3px,
        var(--selection-color, rgba(255, 69, 0, 0.1)) 4px
      );
      border-radius: 8px;
      pointer-events: none;
      z-index: 0;
      opacity: 0.8;
      /* Ensure it fills the grid cell */
      width: 100%;
      height: 100%;
    }

    .wire-line::after {
      content: '';
      position: absolute;
      inset: -8px; /* Hitbox extrusion */
      pointer-events: auto !important;
      z-index: 20;
    }

    .popup-container {
        position: absolute;
        z-index: 1000;
        background: white;
        border-radius: 4px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    }
  `];

  @state()
  private selectionBox: { x: number, y: number, w: number, h: number } | null = null;

  private popupManager = new GridPopupManager(appController);

  private selectionInteraction = new SelectionInteraction({
    element: this,
    getScrollState: () => ({ scrollLeft: this.scrollLeft, scrollTop: this.scrollTop }),
    getNodes: () => {
      return Array.from(this.shadowRoot?.querySelectorAll('graph-node') || []) as HTMLElement[];
    },
    setSelectionBox: (box) => { this.selectionBox = box; },
    onSelectionChange: (ids, isAdditive) => {
      if (isAdditive) {
        // If additive (Shift held), we keep the committed selection (handled by local-state logic)
        // and ONLY update the queued selection to match the current Rubberband set.
        // The visualizer usually shows (Selection U QueuedSelection).
        localController.setQueuedSelection(ids);
      } else {
        localController.queueSelectPaths(ids, false);
      }
    }
  });

  private inputLogic = new GridInputLogic({
    element: this,
    getScrollState: () => ({ scrollLeft: this.scrollLeft, scrollTop: this.scrollTop }),
    getBoundingClientRect: () => this.getBoundingClientRect(),
    closePopup: () => { this.popupManager.commit(); },
  }, appController, localController, runtimeManager, this.selectionInteraction, this.popupManager);
  @state()
  private pendingWireInsert: WireInsert | null = null;

  private catalog = new NodeCatalog(defaultNodeRepository, () => workspaceController.files.map(f => f.name));

  private handlePointerDown(e: PointerEvent) {
    this.pendingWireInsert = null;
    this.inputLogic.handlePointerDown(e);
  }

  private handleDblClick(e: MouseEvent) {
    this.inputLogic.handleDblClick(e);
  }



  private handleConnectionDelete(e: CustomEvent<{ connectionId: string }>) {
    appController.deleteConnection(e.detail.connectionId);
  }



  @property({ attribute: false })
  clientWidth = 0;

  private resizeObserver: ResizeObserver;
  private regionSelectables = new Map<string, Selectable>();

  constructor() {
    super();
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        this.clientWidth = entry.contentRect.width;
        this.updateViewport();
      }
    });

    // Make sure we observe selection changes so we re-render regions state
    reaction(
      () => localController.observableState.selection.keys(),
      () => {
        // Clear pending wire insert if the specific wire is no longer selected
        // This handles cases where selection changes via mechanisms that stop propagation (like clicking a node)
        if (this.pendingWireInsert && !localController.observableState.selection.has(this.pendingWireInsert.wireId)) {
          this.pendingWireInsert = null;
        }
        this.requestUpdate();
      }
    );
  }

  private handleScroll(e: Event) {
    const target = e.target as HTMLElement;
    this.scrollLeft = target.scrollLeft;
    this.scrollTop = target.scrollTop;
    this.updateViewport();
  }

  private updateViewport() {
    localController.setViewport(
      this.scrollLeft || 0,
      this.scrollTop || 0,
      this.clientWidth || this.offsetWidth,
      this.clientHeight || this.offsetHeight
    );
  }

  updated(changedProperties: Map<string, any>) {
    super.updated(changedProperties);
    this.registerRegionSelectables();
  }

  private registerRegionSelectables() {
    const nodes = appController.observableState.graph.inner.nodes;
    for (const node of Object.values(nodes)) {
      const def = defaultNodeRepository.getNodeType(node.config.typeId);
      if (def?.getRegion) {
        const regionId = `region-${node.id}`;

        let selectable = this.regionSelectables.get(regionId);
        if (!selectable) {
          selectable = { path: regionId };
          this.regionSelectables.set(regionId, selectable);
        }

        // Register/Promote if queued
        if (localController.observableState.queuedSelection.has(regionId)) {
          localController.defineSelectable(selectable);
        }
      }
    }
  }



  @property({ type: String })
  activeTool: 'select' | 'pan' = 'select';

  private ghostTarget: { x: number, y: number } | null = null;

  private _pointerMoveHandler: ((e: PointerEvent) => void) | null = null;
  private _pointerUpHandler: ((e: PointerEvent) => void) | null = null;
  private _keyDownHandler: ((e: KeyboardEvent) => void) | null = null;

  private disposers: (() => void)[] = [];

  private addDisposer(d: () => void) {
    this.disposers.push(d);
  }

  connectedCallback() {
    super.connectedCallback();

    // Watch for inflight connection to enable/disable ghost wire tracking
    this.addDisposer(reaction(
      () => localController.observableState.inflightPortConnectionOperation,
      (op) => {
        if (op) {
          requestAnimationFrame(() => {
            const nodeEl = this.shadowRoot?.querySelector(`graph-node[data-id="${op.nodeId}"]`) as HTMLElement;
            const lineEl = this.shadowRoot?.querySelector('#ghost-wire-line');

            if (nodeEl && lineEl) {
              const nodeRect = nodeEl.getBoundingClientRect();
              const gridRect = this.getBoundingClientRect();
              const nodeX = nodeRect.left - gridRect.left + this.scrollLeft;
              const nodeY = nodeRect.top - gridRect.top + this.scrollTop;
              const portY = this.getNodePortY(op.nodeId, op.port, op.type === 'in');

              let startX = nodeX;
              if (op.type === 'out') {
                startX += nodeRect.width;
              }
              const startY = nodeY + portY - 8;

              lineEl.setAttribute('x1', String(startX));
              lineEl.setAttribute('y1', String(startY));
              lineEl.setAttribute('x2', String(startX)); // Init to start
              lineEl.setAttribute('y2', String(startY));
            }
          });

          // Verify we have handlers attached
          if (!this._pointerMoveHandler) {
            this._pointerMoveHandler = (e: PointerEvent) => {
              const lineEl = this.shadowRoot?.querySelector('#ghost-wire-line');
              if (lineEl) {
                const rect = this.getBoundingClientRect();
                // Calculate target position relative to grid
                const targetX = (e.clientX - rect.left) + this.scrollLeft;
                const targetY = (e.clientY - rect.top) + this.scrollTop;

                lineEl.setAttribute('x2', String(targetX));
                lineEl.setAttribute('y2', String(targetY));
              }
            };
            this.addEventListener('pointermove', this._pointerMoveHandler);
          }

          if (!this._pointerUpHandler) {
            this._pointerUpHandler = (e: PointerEvent) => {
              // If this bubbles to grid, it means it wasn't handled by a port.
              // Cancel operation.
              localController.setInflightPortConnectionOperation(null);
              this.ghostTarget = null;
            };
            this.addEventListener('pointerup', this._pointerUpHandler);
          }

          if (!this._keyDownHandler) {
            this._keyDownHandler = this.handleKeyDown.bind(this);
            window.addEventListener('keydown', this._keyDownHandler);
          }
        } else {
          // Cleanup
          if (this._pointerMoveHandler) {
            this.removeEventListener('pointermove', this._pointerMoveHandler);
            this._pointerMoveHandler = null;
          }
          if (this._pointerUpHandler) {
            this.removeEventListener('pointerup', this._pointerUpHandler);
            this._pointerUpHandler = null;
          }
          // Keep keydown listener as it is global for the component, not just for inflight op?
          // So keydown should be attached PERMANENTLY when component is connected.
          this.ghostTarget = null;
        }
      },
      { fireImmediately: true }
    ));

    // Separate permanent keydown listener for wire interaction
    if (!this._keyDownHandler) {
      this._keyDownHandler = this.handleKeyDown.bind(this);
      window.addEventListener('keydown', this._keyDownHandler);
    }
    this.addEventListener('pointerdown', this.handlePointerDown);
    this.addEventListener('dblclick', this.handleDblClick);
    this.addEventListener('connection-delete', this.handleConnectionDelete as EventListener);
    this.addEventListener('scroll', this.handleScroll);
    this.resizeObserver.observe(this);
    this.clientWidth = this.offsetWidth;
    this.addEventListener('dragover', this.handleDragOver);


    // Initial positioning of viewport? handled by state?
    this.addEventListener('drop', this.handleDrop);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    // Run all disposers
    this.disposers.forEach(d => d());
    this.disposers = [];

    this.removeEventListener('pointerdown', this.handlePointerDown);
    this.removeEventListener('dblclick', this.handleDblClick);
    // But correctness is better.
    // I'll skip remove for now to keep diff small, or better, implement proper binding.
    // this._boundKeyDown = this.handleKeyDown.bind(this);
    // Let's do it properly next time or just fix it now if I can.

    this.removeEventListener('connection-delete', this.handleConnectionDelete as EventListener);
    this.removeEventListener('scroll', this.handleScroll);
    this.removeEventListener('dragover', this.handleDragOver);
    this.removeEventListener('drop', this.handleDrop);

    if (this._keyDownHandler) {
      window.removeEventListener('keydown', this._keyDownHandler);
      this._keyDownHandler = null;
    }

    this.resizeObserver.disconnect();
  }



  private handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
  }

  private handleDrop(e: DragEvent) {
    e.preventDefault();
    // Drop logic needs to be updated to map pixels to new grid
    // For now, let's leave it as is or disable it if it relies on fixed math.
    // The original logic used fixed 110px.
    // We can try to find the target cell from the event target.

    const path = e.composedPath();
    const cell = path.find(el => (el as HTMLElement).classList?.contains('node-cell')) as HTMLElement;

    if (cell) {
      const x = parseInt(cell.dataset.x || '0');
      const y = parseInt(cell.dataset.y || '0');
      const data = e.dataTransfer?.getData('application/json');
      if (data) {
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'resolume:parameter') {
            let nodeType = 'resolume.input';
            let targetX = x;

            const rawX = cell.dataset.x;
            if (rawX === 'output') {
              nodeType = 'resolume.output';
              targetX = 20; // Output column
            } else {
              targetX = parseInt(rawX || '0');
              if (targetX === 0) {
                nodeType = 'resolume.input';
              }
            }

            const newNode = appController.createNode(nodeType, targetX, y, { path: parsed.path });
            localController.queueSelectPaths([newNode.id]);
          }
        } catch (err) {
          console.error(err);
        }
      }
    }
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (this.popupManager.popup) return;

    // Check for Input/Textarea focus to avoid swallowing typing
    if (isEditingText(e)) {
      return;
    }

    // Toggle Region Expansion (Ableton Style 'A' key)
    if (e.key === 'a' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      localController.toggleRegionExpansion();
      e.preventDefault();
      return;
    }

    if (!this.pendingWireInsert) return;

    // Check if key is alphanumeric
    if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Resolve grid cell directly from pendingWireInsert
      // We now store gridX/gridY in the insert structure.
      const { gridX: foundX, gridY: foundY } = this.pendingWireInsert;

      if (foundX !== -1) {
        const cx = appController.observableState.graph.inner.connections[this.pendingWireInsert.wireId];
        if (!cx) {
          this.pendingWireInsert = null;
          return;
        }

        // Show Popup
        // We reuse popup struct but maybe need to extend it to carry connection info?
        const initialValue = e.key;
        const connectionId = this.pendingWireInsert.wireId;

        this.popupManager.startCreation(
          this.pendingWireInsert.x,
          this.pendingWireInsert.y - 40,
          foundX,
          foundY,
          initialValue,
          connectionId
        );

        this.pendingWireInsert = null;
      }
    }
  }

  private renderPendingWirePip() {
    if (!this.pendingWireInsert) return null;

    const { x, y, wireId } = this.pendingWireInsert;
    const isSelected = localController.observableState.selection.has(wireId);

    if (!isSelected) {
      return null;
    }

    let color = 'var(--accent-color)';
    const connections = appController.observableState.graph.inner.connections;
    const conn = connections[wireId];
    if (conn) {
      color = cssColorFromHash(`${conn.fromPort}-${conn.toPort}`);
    }

    const orientation = this.pendingWireInsert.orientation || 'vertical';

    return html`<div class="wire-insert-pip ${orientation}"
                     style="left: ${x}px; top: ${y}px; --pip-color: ${color};"></div>`;
  }

  private onWireClick(wireId: string, e: MouseEvent) {
    // 1. Select Wire
    localController.queueSelectPaths([wireId], e.shiftKey || e.ctrlKey || e.metaKey);

    // 2. Calculate Snap Point
    const gridRect = this.getBoundingClientRect();
    const px = e.clientX - gridRect.left + this.scrollLeft;
    const py = e.clientY - gridRect.top + this.scrollTop;

    // Find Closest Cell
    const cells = this.shadowRoot?.querySelectorAll('.cell');
    let bestDist = Infinity;
    let bestX = px;
    let bestY = py;
    let bestGridX = -1;
    let bestGridY = -1;

    // Prioritize "gap" cells for insertion?
    // Actually standard nodes are 80px wide. Gap 16px.
    // We usually want to splice comfortably.
    // If we blindly look for cells, we find closest center.

    cells?.forEach(cell => {
      const r = cell.getBoundingClientRect();
      // Relative to grid container (including scroll)
      const cx = r.left - gridRect.left + this.scrollLeft + r.width / 2;
      const cy = r.top - gridRect.top + this.scrollTop + r.height / 2;

      const dist = Math.sqrt(Math.pow(px - cx, 2) + Math.pow(py - cy, 2));
      if (dist < bestDist) {
        bestDist = dist;
        bestX = cx;
        bestY = cy;

        const ds = (cell as HTMLElement).dataset;
        // Extract grid coords
        // Note: Gaps might not have x/y set in dataset?
        // The render loop sets data-x/y on .node-cell only?
        // Let's check render loop:
        // .gap-cell doesn't have data-x/y.
        // So for splicing, if we snap to a gap, we might fail to find grid coords for a node?
        // But we can infer from style grids?
        // Or just default to "closest node cell logic"?
        // If we splice in a gap, we probably want to splice AT that gap location (insert row/col?)
        // No, user just inserts a node. It should push layout.

        if (ds.x !== undefined && ds.y !== undefined) {
          bestGridX = ds.x === 'output' ? 20 : parseInt(ds.x);
          bestGridY = parseInt(ds.y);
        } else {
          // Try to infer from style?
          // grid-column: N; grid-row: M;
          // But col idx != x idx.
          // let's rely on node-cell priority.
        }
      }
    });

    // Determine orientation based on wire segment aspect
    // Segment logic was in `onWireClick` (GraphGrid.old.ts).
    // Here we assume vertical bar cursor for Horizontal wire.
    const target = e.target as HTMLElement;
    const tRect = target.getBoundingClientRect();
    // Wire width > height = Horizontal Wire -> Vertical Bar to slice it.
    const isHorizontalWire = tRect.width > tRect.height;
    const orientation = isHorizontalWire ? 'vertical' : 'horizontal';

    this.pendingWireInsert = {
      x: bestX,
      y: bestY,
      gridX: bestGridX,
      gridY: bestGridY,
      wireId,
      orientation
    };
    // Force update
    this.requestUpdate();
  }

  private getRowHeight(gridY: number): number {
    // console.log('DEBUG: gridMetrics', localController.observableState?.gridMetrics);
    if (!localController.observableState?.gridMetrics) return 80;
    const h = localController.observableState.gridMetrics.rows.get(gridY);
    return h ?? 80;
  }

  private getColWidth(gridX: number): number {
    if (!localController.observableState?.gridMetrics) return 80;
    const w = localController.observableState.gridMetrics.columnWidths.get(gridX);
    return w ?? 80;
  }

  private getNodePortY(nodeId: string, portName: string, isInput: boolean): number {
    const node = appController.observableState.graph.inner.nodes[nodeId];
    if (!node) return 40; // Default center-ish

    const nodeType = defaultNodeRepository.getNodeType(node.config.typeId);
    // Use Effective Ports (Inferred > Repo)
    const effectiveType = localController.observableState.effectiveNodeTypes.get(nodeId);

    let ports = isInput ? (nodeType?.inputs || []) : (nodeType?.outputs || []);

    if (effectiveType) {
      ports = isInput ? effectiveType.inputs : effectiveType.outputs;
    }

    const index = ports.findIndex(p => p.name === portName);
    if (index === -1) return 40;

    // Metric calculation:
    // Header: 24
    // Padding Y: 8
    // Row Height: 24
    // Pip Offset Y (from row top): 12
    // Y = 24 + 8 + (index * 24) + 12
    return 24 + 8 + (index * 24) + 12;
    return 24 + 8 + (index * 24) + 12;
  }

  private connectionSelectables = new Map<string, Selectable>();

  private getConnectionSelectable(connectionId: string): Selectable {
    if (!this.connectionSelectables.has(connectionId)) {
      this.connectionSelectables.set(connectionId, {
        path: connectionId,
        renderInspectorContent: () => this.renderConnectionInspector(connectionId)
      });
    }
    return this.connectionSelectables.get(connectionId)!;
  }

  private renderConnectionInspector(connectionId: string) {
    // Look up connection dynamically to ensure fresh state
    const conn = appController.observableState.graph.inner.connections[connectionId];
    if (!conn) return undefined;

    return html`
              <h3>Connection</h3>
              <div class="field">
                  <label>From Port:</label>
                  <input
                      data-testid="from-port-input"
                      type="text"
                      .value=${conn.fromPort.toString()}
                      @input=${(e: Event) => {
        const target = e.target as HTMLInputElement;
        appController.setConnectionPorts(conn.id, { fromPort: target.value });
      }}
                  />
              </div>
              <div class="field">
                  <label>To Port:</label>
                  <input
                      data-testid="to-port-input"
                      type="text"
                      .value=${conn.toPort.toString()}
                      @input=${(e: Event) => {
        const target = e.target as HTMLInputElement;
        appController.setConnectionPorts(conn.id, { toPort: target.value });
      }}
                  />
              </div>
          `;
  }


  private renderGridCells() {
    const { nodes } = appController.observableState.graph.inner;
    const cells = [];

    // Calculate dynamic grid size
    // Use Pre-Calculated Grid Metrics
    const { boundingBox } = localController.observableState.gridMetrics;
    const maxNodeX = boundingBox.width;
    const maxNodeY = boundingBox.height;

    const rows = Math.max(maxNodeY + 3, 12);
    const cols = Math.max(maxNodeX + 3, 8);

    // Input Column (x=0)
    for (let y = 0; y < rows; y++) {
      const rowHeight = this.getRowHeight(y);
      cells.push(html`<div class="cell node-cell" data-x="input" data-y="${y}" style="grid-column: 1; grid-row: ${2 * y + 2}; height: ${rowHeight}px;"></div>`);
      // Gap below input?
      cells.push(html`<div class="cell gap-cell gap-h" data-x="input" style="grid-column: 1; grid-row: ${2 * y + 3};"></div>`);
    }

    // Main Grid (x=0..cols)
    for (let x = 0; x <= cols; x++) {
      const colIdx = 2 * x + 3;

      for (let y = 0; y < rows; y++) {
        const rowIdx = 2 * y + 2;
        const rowHeight = this.getRowHeight(y);
        const colWidth = this.getColWidth(x);

        // Node Cell
        const isOutput = x === cols;
        const cellDataX = isOutput ? 'output' : x.toString();
        cells.push(html`<div class="cell node-cell" data-x="${cellDataX}" data-y="${y}" style="grid-column: ${colIdx}; grid-row: ${rowIdx}; height: ${rowHeight}px; width: ${colWidth}px;"></div>`);

        // Gap below Node (Row 2*y+3) -> Horizontal Line. Tag it if Output.
        const gapDataX = isOutput ? 'output' : undefined;
        const gapHeight = rowHeight > 0 ? 16 : 0;
        const hStyle = gapHeight > 0 ? '' : 'display: none;';
        cells.push(html`<div class="cell gap-cell gap-h" data-x="${gapDataX}" style="grid-column: ${colIdx}; grid-row: ${rowIdx + 1}; width: ${colWidth}px; height: ${gapHeight}px; overflow: hidden; ${hStyle}"></div>`);

        // Gap to the left (Col 2*x) -> Vertical Line
        let gapWidth = 16;
        if (x > 0) {
          const prevColWidth = this.getColWidth(x - 1);
          gapWidth = prevColWidth > 0 ? 16 : 0;
        }
        const vStyle = gapWidth > 0 ? '' : 'display: none;';
        cells.push(html`<div class="cell gap-cell gap-v" style="grid-column: ${colIdx - 1}; grid-row: ${rowIdx}; height: ${rowHeight}px; width: ${gapWidth}px; overflow: hidden; ${vStyle}"></div>`);

        // Corner (Gap left + Gap below) -> Cross
        // Hide corner if EITHER dimension is 0
        const cStyle = (gapWidth > 0 && gapHeight > 0) ? '' : 'display: none;';
        cells.push(html`<div class="cell gap-cell gap-c" style="grid-column: ${colIdx - 1}; grid-row: ${rowIdx + 1}; width: ${gapWidth}px; height: ${gapHeight}px; overflow: hidden; ${cStyle}"></div>`);
      }
    }

    return cells;
  }

  private renderGhostWire() {
    const op = localController.observableState.inflightPortConnectionOperation;
    // Always render the container, but hide/show contents based on op
    // We update the line coordinates manually in _pointerMoveHandler for performance.

    // Initial start position calculation (done once per op start, or if op changes)
    // We can't easily do it "once" here because this is render loop.
    // But we can render the line visible if op exists.

    // Actually, to avoid calculating startX/Y in render loop, we should calculate it in the reaction?
    // But we need DOM Access to getBoundingClientRect.
    // Let's keep it simple: Render the SVG if op exists.
    // The Line attributes will be set by render initially?
    // No, if we stop re-rendering, we must set them manually.

    return html`
        <svg id="ghost-wire-svg" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 9999; overflow: visible; display: ${op ? 'block' : 'none'};">
            <line id="ghost-wire-line" x1="0" y1="0" x2="0" y2="0" stroke="rgba(255, 255, 255, 0.5)" stroke-width="2" stroke-dasharray="4" />
        </svg>
    `;
  }



  render() {
    const { nodes, connections } = appController.observableState.graph.inner;

    // Register selectables for all connections (Immediate Mode)
    Object.values(connections).forEach(conn => {
      localController.defineSelectable({
        path: conn.id,
        renderInspectorContent: () => html`
                <h3>Connection</h3>
                <div class="field">
                    <label>From Port:</label>
                    <input
                        type="text"
                        .value=${conn.fromPort.toString()}
                        @input=${(e: Event) => {
            const target = e.target as HTMLInputElement;
            appController.setConnectionPorts(conn.id, { fromPort: target.value });
          }}
                    />
                </div>
                <div class="field">
                    <label>To Port:</label>
                    <input
                        type="text"
                        .value=${conn.toPort.toString()}
                        @input=${(e: Event) => {
            const target = e.target as HTMLInputElement;
            appController.setConnectionPorts(conn.id, { toPort: target.value });
          }}
                    />
                </div>
            `
      });
    });

    // Output Column calculation for node placement
    let maxNodeX = 0;
    for (const node of Object.values(nodes)) {
      if (node.config.typeId === 'io.output' || node.config.typeId === 'resolume.output') continue;

      let extentX = node.x;
      // Check for regions
      const def = defaultNodeRepository.getNodeType(node.config.typeId);
      if (def?.getRegion) {
        const region = def.getRegion(node.config);
        if (region) {
          extentX = node.x + region.width - 1;
        }
      }

      if (extentX > maxNodeX) maxNodeX = extentX;
    }
    const cols = Math.max(maxNodeX + GRID_OUTPUT_COL_PADDING, GRID_MIN_COLS);
    const outputCol = 2 * cols + 3;

    // Dynamic Grid Template Columns
    const inputCol = 'minmax(80px, auto)';
    const gapStart = 'var(--grid-gap, 16px)';

    // Grid Width heuristic to avoid infinite loops or empty maps
    // We already calculated maxNodeX for placement, let's use it.
    // The static CSS uses repeat(12, ...). We should match or exceed that.
    // We can iterate up to cols.

    const trackDefinitions: string[] = [];
    trackDefinitions.push(`[input] ${inputCol}`);
    trackDefinitions.push(`[gap-start] ${gapStart}`);

    for (let c = 0; c < cols; c++) {
      const colWidth = this.getColWidth(c);
      const gapWidth = colWidth > 0 ? 16 : 0;

      trackDefinitions.push(`[node] ${colWidth}px`);
      trackDefinitions.push(`[gap] ${gapWidth}px`);
    }

    trackDefinitions.push(`[output] minmax(80px, auto)`);
    const gridTemplateColumns = trackDefinitions.join(' ');

    // Dynamic Grid Template Rows
    // Logic: If a row is hidden (height 0), its following gap should also be hidden (height 0).
    const rowTrackDefinitions: string[] = [];
    rowTrackDefinitions.push(`[gap-top] var(--grid-gap, 16px)`);

    // We assume rows go up to... how many?
    // We can infer max rows from maxNodeY.
    let maxNodeY = 0;
    for (const node of Object.values(nodes)) {
      let extentY = node.y;

      const def = defaultNodeRepository.getNodeType(node.config.typeId);
      if (def?.getRegion) {
        const region = def.getRegion(node.config);
        if (region) {
          extentY = node.y + region.height - 1;
        }
      }

      if (extentY > maxNodeY) maxNodeY = extentY;
    }
    // GraphGrid uses 12 loops traditionally, but we should cover all content.
    // Let's go up to Max(12, maxNodeY + 1).
    const numRows = Math.max(12, maxNodeY + 1);

    for (let r = 0; r < numRows; r++) {
      const rowHeight = this.getRowHeight(r);
      const gapHeight = rowHeight > 0 ? 16 : 0;

      rowTrackDefinitions.push(`[node] minmax(${rowHeight}px, auto)`);
      rowTrackDefinitions.push(`[gap] ${gapHeight}px`);
    }
    const gridTemplateRows = rowTrackDefinitions.join(' ');

    return html`
      ${this.renderGhostWire()}
      ${this.renderPendingWirePip()}
      ${this.selectionBox ? html`
        <div class="selection-box" style="left: ${this.selectionBox.x}px; top: ${this.selectionBox.y}px; width: ${this.selectionBox.w}px; height: ${this.selectionBox.h}px;"></div>
      ` : ''}

      ${this.popupManager.popup ? html`
        <div class="popup-container" style="left: ${this.popupManager.popup.x}px; top: ${this.popupManager.popup.y}px;">
            <smart-input
                .catalog=${this.catalog}
                .value=${this.popupManager.popup.initialValue}
                .autofocus=${true}
                @commit=${(e: CustomEvent) => {
          this.popupManager.updatePreview(e.detail);
          this.popupManager.commit();
        }}
                @preview-type=${(e: CustomEvent) => this.popupManager.updatePreview(e.detail)}
                @cancel=${() => this.popupManager.cancel()}
            ></smart-input>
        </div>
      ` : ''}

      <div class="grid-container" tabindex="-1" style="grid-template-columns: ${gridTemplateColumns}; grid-template-rows: ${gridTemplateRows};">
        ${this.renderGridCells()}


    ${Object.values(connections).map(conn => {
          // Register selectable for Inspector with caching to avoid infinite loops
          const selectable = this.getConnectionSelectable(conn.id);
          localController.defineSelectable(selectable);
          return '';
        })}

        ${(() => {
        const wireCtx: WireRendererContext = {
          nodes,
          connections,
          gridMetrics: localController.observableState.gridMetrics,
          inferredNodeTypes: localController.observableState.inferredNodeTypes,
          effectiveNodeTypes: localController.observableState.effectiveNodeTypes,
          incomingConnections: appController.observableState.graph.auxiliary.incomingConnections,
          selection: localController.observableState.selection,
          onWireClick: this.onWireClick.bind(this),
          onWireDblClick: (wireId, e) => {
            if (this.pendingWireInsert && this.pendingWireInsert.wireId === wireId) {
              this.pendingWireInsert = null;
            }
            this.dispatchEvent(new CustomEvent('connection-delete', { detail: { connectionId: wireId } }));
          }
        };
        const renderer = new WireRenderer(wireCtx);
        const segments = localController.observableState.wireLayout.segments || [];
        return renderer.render(segments);
      })()}




    ${this.renderRegions()}
    ${repeat(Object.values(nodes), node => node.id, node => this.renderGraphNode(node, outputCol))}
    ${this.renderGhosts(outputCol)}
    ${this.renderDragPreview(outputCol)}
      </div>
    `;
  }

  private renderDragPreview(outputCol: number) {
    const preview = localController.observableState.dragPreview;
    if (!preview) return '';

    // Calculate grid position for regular nodes
    const col = 2 * preview.x + 3;
    const row = 2 * preview.y + 2;

    return html`
      <div class="drag-preview" style="grid-column: ${col}; grid-row: ${row}; min-height: 80px;"></div>
    `;
  }

  private renderGhosts(outputCol: number) {
    const { selection, isDraggingSelection, altKeyPressed } = localController.observableState;
    if (!isDraggingSelection || !altKeyPressed) return '';

    const selectedNodes: GridNode[] = [];
    for (const [id] of selection) {
      const node = appController.observableState.graph.inner.nodes[id];
      if (node) {
        const metric = localController.observableState.gridMetrics.cells.get(`${node.x},${node.y}`);
        if (!metric?.isHidden) {
          selectedNodes.push(node);
        }
      }
    }

    return repeat(selectedNodes, n => n.id + '-ghost', node => {
      // Reuse renderGraphNode logic but force style
      // We can manually construct the element or factor out logic
      // Factoring out logic is cleaner but `renderGraphNode` is coupled to checks.
      // Let's copy-paste essential logic for safety or create a helper.

      const incomingConnections = appController.observableState.graph.auxiliary.incomingConnections.get(node.id) || [];

      // Calculate grid position
      let col = 0;
      let ioType: 'input' | 'output' | undefined;

      if (node.config.typeId === 'io.input' || node.config.typeId === 'resolume.input') {
        col = 1;
        ioType = 'input';
      } else if (node.config.typeId === 'io.output' || node.config.typeId === 'resolume.output') {
        col = outputCol;
        ioType = 'output';
      } else {
        col = 2 * node.x + 3;
      }

      const row = 2 * node.y + 2;
      const gridColStyle = `${col} / span 1`;
      const gridRowStyle = `${row}`;

      return html`
        <graph-node
          .node=${node}
          .incomingConnections=${incomingConnections}
          .isQueued=${false}
          .x=${node.x}
          .y=${node.y}
          .gridColumn=${gridColStyle}
          .gridRow=${gridRowStyle}
          .parentZIndex=${90}
          data-io-type=${ioType || ''}
          data-id=${node.id + '-ghost'}
          style="grid-column: ${gridColStyle}; grid-row: ${gridRowStyle}; opacity: 0.5; filter: grayscale(1); pointer-events: none;"
        ></graph-node>
      `;
    });
  }

  private renderRegions() {
    const { nodes } = appController.observableState.graph.inner;
    const regionElements: unknown[] = [];

    const cachedRegions = localController.observableState.gridMetrics.regions;

    for (const node of Object.values(nodes)) {
      const region = cachedRegions.get(node.id);
      if (region) {
        // Region bounds are already absolute and offset-corrected in cached metrics
        const absX = region.x;
        const absY = region.y;
        const absW = region.width;
        const absH = region.height;

        // Convert to Grid Tracks
        // Nodes start at Col 3, Row 2.
        // Col = 2*x + 3
        // Row = 2*y + 2

        const colStart = 2 * absX + 3;
        const rowStart = 2 * absY + 2;

        // Width in columns = 2 * W (nodes + gaps) - 1 (last gap is included in span? No).
        // Span logic:
        // 1 Node wide = span 1.
        // 2 Nodes wide = span 3 (Node + Gap + Node).
        // W Nodes wide = 2*W - 1.
        // Wait, gaps are columns too.
        // If W=1, we span 1 col.
        // If W=2, we span Col(Node), Col(Gap), Col(Node) -> Span 3.
        // Formula: span (2 * W - 1).
        // BUT, we want the BOX to cover gaps too?

        // Calculate Effective Span (Trim trailing collapsed/hidden tracks)
        // If the last N columns are hidden (0px), we shouldn't span the gap before them.
        let effectiveW = 1;
        for (let i = absW - 1; i >= 0; i--) {
          if (this.getColWidth(absX + i) > 0) {
            effectiveW = i + 1;
            break;
          }
        }
        const colSpan = Math.max(1, 2 * effectiveW - 1);

        let effectiveH = 1;
        for (let i = absH - 1; i >= 0; i--) {
          if (this.getRowHeight(absY + i) > 0) {
            effectiveH = i + 1;
            break;
          }
        }
        const rowSpan = Math.max(1, 2 * effectiveH - 1);

        const regionSelectionId = `region-${node.id}`;
        const isSelected = localController.observableState.selection.has(regionSelectionId);

        // Determine if region is effectively collapsed (visually)
        // It is collapsed if all NON-PARENT rows/cols have 0 size.
        let hasVisibleArea = false;

        // Check Columns (excluding parent node column if inside region)
        if (absW > 1) {
          for (let c = absX; c < absX + absW; c++) {
            if (c === node.x) continue; // Skip parent col
            if (this.getColWidth(c) > 0) {
              hasVisibleArea = true;
              break;
            }
          }
        }

        // Check Rows (excluding parent node row if inside region)
        if (!hasVisibleArea && absH > 1) {
          for (let r = absY; r < absY + absH; r++) {
            if (r === node.y) continue; // Skip parent row
            if (this.getRowHeight(r) > 0) {
              hasVisibleArea = true;
              break;
            }
          }
        }

        if (!hasVisibleArea) continue;

        let color = cssColorFromHash(node.config.name || node.config.typeId); // Hash title or type

        // Use cached collapse state from controller (populated via updateGridMetrics)
        const isCollapsed = region.isCollapsed;

        // User Request: If visible but collapsed ("hide"), show in grid-line gray.
        // We know hasVisibleArea is true here.
        if (isCollapsed) {
          color = 'var(--grid-line-color)'; // Standardized Grid Line Color
        }

        regionElements.push(html`
            <div class="region-box ${isSelected ? 'selected' : ''} ${isCollapsed ? 'collapsed' : ''}"
                 data-region-node-id="${node.id}"
                 style="
              grid-column: ${colStart} / span ${colSpan};
              grid-row: ${rowStart} / span ${rowSpan};
              background-color: ${isSelected ? color + '22' : color + '11'};
              --region-color: ${color};
            ">
              <!-- Render Rails and Handles ONLY if not collapsed -->
              ${!isCollapsed ? html`
                <div class="border-rail n" data-rail="n" data-node-id="${node.id}" style="border-top: ${isSelected ? '4px' : '2px'} dashed ${color};"></div>
                <div class="border-rail s" data-rail="s" data-node-id="${node.id}" style="border-bottom: ${isSelected ? '4px' : '2px'} dashed ${color};"></div>
                <div class="border-rail w" data-rail="w" data-node-id="${node.id}" style="border-left: ${isSelected ? '4px' : '2px'} dashed ${color};"></div>
                <div class="border-rail e" data-rail="e" data-node-id="${node.id}" style="border-right: ${isSelected ? '4px' : '2px'} dashed ${color};"></div>

                <div class="resize-handle e" data-handle="e" data-node-id="${node.id}"></div>
                <div class="resize-handle s" data-handle="s" data-node-id="${node.id}"></div>
                <div class="resize-handle se" data-handle="se" data-node-id="${node.id}"></div>
              ` : html`
                 <!-- Collapsed Region Border (Static) -->
                 <div style="position: absolute; inset: 0; pointer-events: none; border: 2px dashed ${color}; border-radius: 8px;"></div>
              `}
            </div>
          `);
      }
    }
    return regionElements;
  }

  private renderGraphNode(node: GridNode, outputCol: number) {
    const isQueued = localController.observableState.queuedSelection.has(node.id);
    const incomingConnections = appController.observableState.graph.auxiliary.incomingConnections.get(node.id) || [];

    // Calculate grid position
    let col = 0;
    let ioType: 'input' | 'output' | undefined;

    if (node.config.typeId === 'io.input' || node.config.typeId === 'resolume.input') {
      col = 1;
      ioType = 'input';
    } else if (node.config.typeId === 'io.output' || node.config.typeId === 'resolume.output') {
      col = outputCol;
      ioType = 'output';
    } else {
      col = 2 * node.x + 3;
    }

    const row = 2 * node.y + 2;
    const span = 1;
    const isSelected = localController.observableState.selection.has(node.id);
    const metric = localController.observableState.gridMetrics.cells.get(`${node.x},${node.y}`);
    const isHidden = metric?.isHidden;

    return html`
            <graph-node
              .node=${node}
              .incomingConnections=${incomingConnections}
              .isQueued=${isQueued}
              .x=${node.x}
              .y=${node.y}
              .gridColumn=${`${col} / span ${span}`}
              .gridRow=${`${row}`}
              .parentZIndex=${isSelected ? 110 : 100}
              data-io-type=${ioType || ''}
              data-id=${node.id}
              ?hidden=${isHidden}
            ></graph-node>
          `;
  }
}
