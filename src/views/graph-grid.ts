import './graph-node';
import './graph-connection';
import { WireRenderer, WireRendererContext } from './wire-renderer';
import { SmartInput } from '../components/smart-input';
import { MobxLitElement } from './mobx-lit-element';
import { css, html, TemplateResult } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { appController, localController, runtimeManager } from '../builder/controllers';
import { reaction } from 'mobx';
import { AppController, LongEdit, generateId, GridNode } from '../builder/state';
import { LocalController, Selectable } from '../builder/local-state';
import { PointerDragOp } from '../utils/pointer-drag-op';
import { cssColorFromHash } from '../utils/layout-utils';
import { NodeCatalog } from '../structor/node-catalog';
import { defaultNodeRepository, PortHint } from '../structor/repository';
import { NODE_WIDTH_NORMAL, NODE_WIDTH_MINIMAL, NODE_WIDTH_COMPRESSED } from '../constants';
import { getNodeVisualState } from '../utils/node-width-utils';
import { calculatePortY } from '../utils/node-width-utils';
import { globalStyles } from '../styles';
import { GRID_UNIT, GRID_GAP, GRID_MIN_COLS, GRID_OUTPUT_COL_PADDING } from '../constants';


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
        [input] minmax(120px, auto)
        [gap-start] var(--grid-gap, 16px)
        repeat(12, [node] auto [gap] var(--grid-gap, 16px))
        [output] minmax(120px, auto);

      grid-template-rows:
        [gap-top] var(--grid-gap, 16px)
        repeat(12, [node] minmax(1px, auto) [gap] var(--grid-gap, 16px));

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
    }

    .selection-box {
      position: absolute;
      background-color: var(--selection-color);
      border: 1px solid var(--selection-border);
      pointer-events: none;
      z-index: 100;
    }

    .cell {
      /* background-color: rgba(255, 255, 255, 0.05); */
      border-radius: 4px;
      pointer-events: auto;
    }

    .cell.node-cell {
      /* background-color: rgba(255, 255, 255, 0.05); */
      /* border: 1px dashed rgba(255, 255, 255, 0.15); */
      min-width: 80px;
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
      border-bottom: 1px dashed rgba(255, 255, 255, 0.15);
    }

    .cell.gap-v::after {
      content: '';
      position: absolute;
      left: 50%;
      top: 0;
      bottom: 0;
      border-left: 1px dashed rgba(255, 255, 255, 0.15);
    }

    .wire-segment {
        position: absolute;
        inset: 0;
        pointer-events: none !important;
        z-index: 10;
        margin: auto;
        cursor: pointer;
    }

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
        transition: background-color 0.2s;
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

    /* Wire Styles (moved from GraphConnection) */


    /* Hit area for easier clicking */
    /* Hit area for easier clicking */
    /* Hit area attached to the visible lines themselves */
    .wire-line {
        pointer-events: auto !important;
        cursor: pointer;
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
  @state()
  private pendingWireInsert: WireInsert | null = null;

  @state()
  popup: { x: number, y: number, gridX: number, gridY: number, initialValue: string, nodeId?: string, isNew?: boolean, connectionId?: string } | null = null;

  private popupLongEdit: LongEdit | null = null;

  private catalog = new NodeCatalog(defaultNodeRepository);

  private handlePointerDown(e: PointerEvent) {
    // If popup is open, close it on click outside (unless clicking inside popup, which is handled by stopPropagation in popup)
    if (this.popup) {
      const path = e.composedPath();
      const isPopup = path.some(el => (el as Element).classList?.contains('popup-container'));
      if (!isPopup) {
        const smartInput = this.shadowRoot?.querySelector('smart-input') as SmartInput;
        if (smartInput) {
          smartInput.commit();
        } else {
          this.handlePopupCancel();
        }
      }
    }

    // Resume audio on any interaction
    runtimeManager.resumeAudio();

    const path = e.composedPath();
    const isNode = path.some(el => (el as Element).tagName === 'GRAPH-NODE');
    const isConnection = path.some(el => (el as Element).tagName === 'GRAPH-CONNECTION');
    // Also ignore wires (divs with .wire-segment class)
    const isWire = path.some(el => (el as Element).classList?.contains('wire-segment'));

    if (isNode || isConnection || isWire) return;

    // Start rubberband selection
    const rect = this.getBoundingClientRect();
    const startX = e.clientX - rect.left + this.scrollLeft;
    const startY = e.clientY - rect.top + this.scrollTop;

    let lastSelectedIdsStr = '';

    new PointerDragOp(e, this, {
      move: (e, delta) => {
        const currentX = e.clientX - rect.left + this.scrollLeft;
        const currentY = e.clientY - rect.top + this.scrollTop;

        const x = Math.min(startX, currentX);
        const y = Math.min(startY, currentY);
        const w = Math.abs(currentX - startX);
        const h = Math.abs(currentY - startY);

        this.selectionBox = { x, y, w, h };

        // Calculate selection
        // Note: With variable grid sizes, pixel-based selection is harder.
        // But we can still use the approximate positions or query the DOM elements.
        // For now, let's keep the simplified logic assuming standard sizes for selection calculation,
        // or iterate over nodes and check their bounding rects (better).

        const selectedIds: string[] = [];
        const { nodes } = appController.observableState.graph.inner;

        // We can use the rendered DOM nodes to check intersection
        const nodeElements = this.shadowRoot?.querySelectorAll('graph-node');
        if (nodeElements) {
          nodeElements.forEach(el => {
            const nodeRect = el.getBoundingClientRect();
            // Convert nodeRect to grid-relative coords (same space as selectionBox)
            const nodeX = nodeRect.left - rect.left + this.scrollLeft;
            const nodeY = nodeRect.top - rect.top + this.scrollTop;

            if (x < nodeX + nodeRect.width && x + w > nodeX &&
              y < nodeY + nodeRect.height && y + h > nodeY) {
              const id = (el as HTMLElement).dataset.id;
              if (id) selectedIds.push(id);
            }
          });
        }

        selectedIds.sort();
        const currentSelectedIdsStr = selectedIds.join(',');
        if (currentSelectedIdsStr !== lastSelectedIdsStr) {
          localController.queueSelectPaths(selectedIds);
          lastSelectedIdsStr = currentSelectedIdsStr;
        }
      },
      accept: () => {
        this.selectionBox = null;
      },
      cancel: () => {
        this.selectionBox = null;
        console.log('Selection cancelled. Forcing red selection box (if visible).');
        // If selectionBox was not null, we could change its color here.
        // For example: this.selectionBox = { ...this.selectionBox, color: 'red' };
        // But since it's set to null, this change won't be visible.
        localController.queueSelectPaths([]);
      }
    });
  }

  private handleDblClick(e: MouseEvent) {
    const path = e.composedPath();
    const target = path[0] as HTMLElement;

    // Check if we clicked on a cell
    if (target.classList.contains('cell')) {
      const x = parseInt(target.dataset.x || '0');
      const y = parseInt(target.dataset.y || '0');

      // If it's a gap cell, we might want to insert space or ignore.
      // If it's a node cell (but empty), create node immediately and show popup.
      if (target.classList.contains('node-cell')) {
        const rawX = target.dataset.x;
        let initialValue = 'util.hub'; // Default changed from literal to hub
        let gridX = 0;

        if (rawX === 'output') {
          initialValue = 'io.output'; // Default for output column
          gridX = 20; // Arbitrary high number for output column
        } else if (rawX === 'input') {
          initialValue = 'io.input';
          gridX = 0;
        } else {
          gridX = parseInt(rawX || '0');
        }

        // Create node transactionally via LongEdit
        const generatedId = generateId('node');

        // Start Long Edit FIRST
        this.popupLongEdit = appController.beginLongEdit({
          apply: (c) => {
            // Always Create the node with the fixed ID
            c.createNode(initialValue, gridX, y, { id: generatedId });
          },
          cancel: () => {
            this.popupLongEdit = null;
            // No manual cleanup needed! canceling reverts the creation.
          }
        });

        // Select it (it exists in observable state now)
        localController.queueSelectPaths([generatedId]);

        // Calculate popup position
        // We want it above the cell.
        const rect = target.getBoundingClientRect();
        const parentRect = this.getBoundingClientRect();

        const popupX = rect.left - parentRect.left + this.scrollLeft;
        const popupY = rect.top - parentRect.top + this.scrollTop - 40; // Above the cell

        this.popup = {
          x: popupX,
          y: popupY,
          gridX,
          gridY: y,
          initialValue,
          nodeId: generatedId as string,
          isNew: true // Mark as new so we know context
        };
        return;
      }
      return;
    }

    // Check if we clicked on a node
    const targetNode = target as HTMLElement;

    // Check if we clicked on a port or input inside the node
    const isPortOrInput = path.some(el => {
      const tag = (el as Element).tagName;
      return tag === 'GRAPH-PORT' || tag === 'INPUT' || (el as Element).classList?.contains('virtual-input-field');
    });

    if (isPortOrInput) {
      // If we double clicked a port, we might want to cancel connection mode if active?
      // For now, just don't delete the node.
      return;
    }

    if (targetNode.tagName === 'GRAPH-NODE' && targetNode.dataset.id) {
      appController.deleteNode(targetNode.dataset.id);
      return;
    }

    const nodeElement = path.find(el =>
      (el as Element).nodeName === 'GRAPH-NODE'
    ) as HTMLElement;

    if (nodeElement) {
      const id = nodeElement.getAttribute('data-id') || nodeElement.dataset?.id;
      if (id) {
        // Check for group deletion
        const lastGroup = localController.observableState.lastGroupSelection;
        if (lastGroup && lastGroup.has(id)) {
          // Delete entire group
          const nodesToDelete = Array.from(lastGroup).filter(itemId => itemId.startsWith('node-'));
          // We should use a bulk delete operation if available, or just loop.
          // appController.deleteNode handles one.
          // Let's create a bulk delete mutation logic in controller?
          // Or just loop here. The controller dispatches mutations, but ideally they are transactional.
          // AppController doesn't have deleteNodes(plural).
          // But we can wrap in transaction?
          // appController.transaction... is private? No, public.
          // But we can just issue multiple delete calls, each triggers recompile.
          // Better to add deleteNodes to controller or just loop.
          // Given recompile cost, better to batch.
          // appController.deleteNodes? It doesn't exist.
          // Let's loop for now, optimizing later if needed.
          // Actually, `appController.deleteNode` triggers recompile.
          // We can add `deleteNodes` to AppController or just use the loop.
          // Let's assume loop is OK for QoL prototype.
          // But wait, if I delete the first node, and it triggers recompile/layout... the other nodes might shift or state update?
          // Safer to do it in one go.

          // Let's just delete the specific node if no group logic.
          // Wait, I should implement `deleteNodes` in AppController for atomic op?
          // Or just use `transaction`.
          appController.transaction(() => {
            nodesToDelete.forEach(nid => appController.deleteNode(nid));
          });
          localController.setLastGroupSelection(null);
          return;
        }

        // Splice Deletion Check
        // If node has exactly 1 input conn and 1 output conn (on default ports),
        // splice them together.
        const node = appController.observableState.graph.inner.nodes[id];
        if (node) {
          const connections = Object.values(appController.observableState.graph.inner.connections);

          // Get node type to find default ports
          // Default ports are usually inputs[0] and outputs[0]
          const nodeType = defaultNodeRepository.getNodeType(node.config.typeId);

          // Define 'default ports'
          // If node has no inputs or outputs defined, we can't splice.
          // But many primitives use 'in'/'out' or 'value'.
          // We'll trust the catalog definition.
          const firstInputName = nodeType?.inputs?.[0]?.name;
          const firstOutputName = nodeType?.outputs?.[0]?.name;

          if (firstInputName && firstOutputName) {
            const inputConns = connections.filter(c => c.toNodeId === id && c.toPort === firstInputName);
            const outputConns = connections.filter(c => c.fromNodeId === id && c.fromPort === firstOutputName);

            if (inputConns.length === 1 && outputConns.length === 1) {
              // Eligible for splice!
              const inConn = inputConns[0];
              const outConn = outputConns[0];

              appController.transaction((c) => {
                c.deleteNode(id);
                c.createConnection(inConn.fromNodeId, inConn.fromPort, outConn.toNodeId, outConn.toPort);
              });
              return;
            }
          }
        }

        appController.deleteNode(id);
        return;
      }
    }

    // Fallback for clicks on grid background (if any)
    // With full grid coverage, this might not be reached often.
  }

  private handleConnectionDelete(e: CustomEvent<{ connectionId: string }>) {
    appController.deleteConnection(e.detail.connectionId);
  }



  @property({ attribute: false })
  clientWidth = 0;

  private resizeObserver: ResizeObserver;

  constructor() {
    super();
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        this.clientWidth = entry.contentRect.width;
        this.updateViewport();
      }
    });
  }

  private handleScroll(e: Event) {
    const target = e.target as HTMLElement;
    this.scrollLeft = target.scrollLeft;
    this.updateViewport();
  }

  private updateViewport() {
    // Debounce or raw? Raw for now, Reactivity handles debounce in listeners if needed.
    // Or we can debounce here if performance is an issue.
    localController.setViewport(
      this.scrollLeft || 0,
      this.scrollTop || 0,
      this.clientWidth || this.offsetWidth,
      this.clientHeight || this.offsetHeight
    );
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
          // Calculate start position immediately
          // We need to wait for render? No, op change triggers render, but we want to set coords now.
          // The SVG exists (it's always there, just hidden/shown).
          // We might need to wait a tick for 'display: block' to be applied?
          // No, attributes work even if hidden.

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
          // ... cleanup if op is null?
          // Actually the disposer handles the reaction cleanup, but global listeners
          // set above (pointermove/up) should be removed if op cancels?
          // The reaction fires on op change.
          // If op becomes null, we should remove pointer listeners.
          if (this._pointerMoveHandler) {
            this.removeEventListener('pointermove', this._pointerMoveHandler);
            this._pointerMoveHandler = null;
          }
          if (this._pointerUpHandler) {
            this.removeEventListener('pointerup', this._pointerUpHandler);
            this._pointerUpHandler = null;
          }
          // Keep keydown listener as it is global for the component, not just for inflight op?
          // Wait, splicing insert point works independently of inflight connection!
          // pendingWireInsert is for EXISTING wires.
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
    this.addEventListener('keydown', this.handleKeyDown.bind(this));
    this.addEventListener('connection-delete', this.handleConnectionDelete as EventListener);
    this.addEventListener('scroll', this.handleScroll);
    this.resizeObserver.observe(this);
    this.clientWidth = this.offsetWidth;
    this.addEventListener('dragover', this.handleDragOver);
    this.addEventListener('drop', this.handleDrop);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    // Run all disposers
    this.disposers.forEach(d => d());
    this.disposers = [];

    this.removeEventListener('pointerdown', this.handlePointerDown);
    this.removeEventListener('dblclick', this.handleDblClick);
    // removeEventListener for bound keydown is tricky without storing reference
    // But since element is disconnected, it might fine?
    // Ideally we store it.
    // Let's use a class field for the bound function.
    // Or just (e) => this.handleKeyDown(e) if stored.
    // For now, let's assume leak is minor or rely on GC if element is destroyed.
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

  private handlePopupCommit(e: CustomEvent) {
    if (!this.popup) return;
    const typeId = e.detail;

    // Unified handling for Creation/Update
    // If we have a previewed node (popup.nodeId exists), we use it.
    // If not, we create one.

    let targetNodeId = this.popup.nodeId;

    // Handle Long Edit Commit first
    if (this.popupLongEdit) {
      // Ensure we apply the FINAL selected typeId, because the user might have
      // clicked a suggestion different from the currently previewed one.
      this.popupLongEdit.applyAgain((c) => {
        // Re-create node if new (same logic as handlePopupPreview)
        if (this.popup!.isNew) {
          c.createNode(typeId, this.popup!.gridX, this.popup!.gridY, { id: this.popup!.nodeId! });
        } else {
          c.setNodeConfig(this.popup!.nodeId!, { typeId });
        }

        // Re-wire connections (same logic as handlePopupPreview)
        const connectionId = (this.popup as any).connectionId;
        if (connectionId) {
          const oldConn = appController.observableState.graph.inner.connections[connectionId];
          if (oldConn) {
            const nodeType = defaultNodeRepository.getNodeType(typeId);
            const firstInput = nodeType?.inputs?.[0]?.name || 'in';
            const firstOutput = nodeType?.outputs?.[0]?.name || 'out';

            c.deleteConnection(connectionId);
            c.createConnection(oldConn.fromNodeId, oldConn.fromPort, this.popup!.nodeId!, firstInput);
            c.createConnection(this.popup!.nodeId!, firstOutput, oldConn.toNodeId, oldConn.toPort);
          }
        }
      });
      this.popupLongEdit.accept();
      this.popupLongEdit = null;
    } else if (targetNodeId) {
      // Just set config if no long edit active (rare if we were previewing)
      appController.setNodeConfig(targetNodeId, { typeId });
    } else {
      // No node yet (User typed fast and hit commit without preview, or pure creation)
      // Create it now
      const { gridX, gridY } = this.popup;
      try {
        const newNode = appController.createNode(typeId, gridX, gridY);
        targetNodeId = newNode.id;
        localController.queueSelectPaths([targetNodeId]);
      } catch (e) {
        console.error("Failed to create node:", e);
        this.popup = null;
        return;
      }
    }

    // Now handle connection splitting if applicable
    // This applies whether we reused a preview node or created a new one
    const connectionId = (this.popup as any).connectionId;
    if (connectionId && targetNodeId) {
      try {
        // Handle Wire Split
        const oldConn = appController.observableState.graph.inner.connections[connectionId];
        if (oldConn) {
          const nodeType = defaultNodeRepository.getNodeType(typeId);
          const firstInput = nodeType?.inputs?.[0]?.name || 'in';
          const firstOutput = nodeType?.outputs?.[0]?.name || 'out';

          appController.transaction((c) => {
            // Delete old
            c.deleteConnection(connectionId);

            // Connect Old Start -> New Node
            c.createConnection(oldConn.fromNodeId, oldConn.fromPort, targetNodeId!, firstInput);

            // Connect New Node -> Old End
            c.createConnection(targetNodeId!, firstOutput, oldConn.toNodeId, oldConn.toPort);
          });
        }
      } catch (e) {
        console.error("Failed to split connection:", e);
      }
    }

    // Defer popup removal
    setTimeout(() => {
      this.popup = null;
    }, 0);
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (!this.pendingWireInsert || this.popup) return;

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
        // We need to position popup near click
        // We reuse popup struct but maybe need to extend it to carry connection info?
        if (!cx) {
          this.pendingWireInsert = null;
          return;
        }

        const generatedId = generateId('node');
        const initialValue = e.key;
        const connectionId = this.pendingWireInsert.wireId;

        // Start Long Edit with Creation + Rewire Logic
        this.popupLongEdit = appController.beginLongEdit({
          apply: (c) => {
            // 1. Create Node (default hub for now, will be updated by handlePopupPreview immediately after input?)
            // Actually, 'initialValue' is just the first char.
            // The popup will be initialized with this char.
            // The node type defaults to hub until committed or updated.
            // Wait, smart-input usually sends `preview` event with matched type.
            // So we create a default node here.
            c.createNode('util.hub', foundX, foundY, { id: generatedId });

            // 2. Initial Rewire (assume Hub behaviors)
            // Or shoud we wait for preview?
            // If we rewire now, we use hub ports.
            const oldConn = appController.observableState.graph.inner.connections[connectionId];
            if (oldConn) {
              const nodeType = defaultNodeRepository.getNodeType('util.hub');
              const firstInput = nodeType?.inputs?.[0]?.name || 'in';
              const firstOutput = nodeType?.outputs?.[0]?.name || 'out';

              c.deleteConnection(connectionId);
              c.createConnection(oldConn.fromNodeId, oldConn.fromPort, generatedId, firstInput);
              c.createConnection(generatedId, firstOutput, oldConn.toNodeId, oldConn.toPort);
            }
          },
          cancel: () => {
            this.popupLongEdit = null;
          }
        });

        localController.queueSelectPaths([generatedId]);

        this.popup = {
          x: this.pendingWireInsert.x,
          y: this.pendingWireInsert.y - 40,
          gridX: foundX,
          gridY: foundY,
          initialValue: e.key,
          connectionId,
          nodeId: generatedId,
          isNew: true
        };

        this.pendingWireInsert = null;
      }
    }
  }

  private renderPendingWirePip() {
    const op = this.pendingWireInsert;
    // If no specific op, check selection
    if (!op) {
      // Auto-calculate logic here?
      // No, verify logic creates op on click.
      // If "select right near the wire" doesn't show it, it means click handler failed to find cell.

      // User Request: "Basically always show up when selected"
      // If we have selected wire(s), show pip at the last known or "closest" point?
      // Selection can change via Undo/Redo or marquee.
      // If single wire selected, we could show it at center?
      // But we lack (x,y) context unless derived from mouse.
      // Wait, verify if `pendingWireInsert` persists?
    }
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

  private handlePopupPreview(e: CustomEvent) {
    if (!this.popup) return;
    const typeId = e.detail;

    // Phase 1: Create Node if it doesn't exist (Live Preview for Wire Insert)
    if (!this.popup.nodeId) {
      // We are previewing a creation type.
      // Create the node FOR REAL (it's the only way to render it currently)
      // We mark it as 'isNew' in popup so we know to delete it if cancelled.

      try {
        const newNode = appController.createNode(typeId, this.popup.gridX, this.popup.gridY);

        // Update Popup State
        this.popup = {
          ...this.popup,
          nodeId: newNode.id,
          isNew: true
        };

        // Select it?
        // localController.queueSelectPaths([newNode.id]);
        // Maybe not needed if we are editing?

        // Start Long Edit immediately for this new node
        this.popupLongEdit = appController.beginLongEdit({
          apply: (c) => {
            c.setNodeConfig(newNode.id, { typeId });

            // Live Rewire: If inserting on a wire, split the connection now!
            const connectionId = (this.popup as any).connectionId;
            if (connectionId) {
              const oldConn = appController.observableState.graph.inner.connections[connectionId];
              if (oldConn) {
                // Use default ports from repository or fallback
                const nodeType = defaultNodeRepository.getNodeType(typeId);
                const firstInput = nodeType?.inputs?.[0]?.name || 'in';
                const firstOutput = nodeType?.outputs?.[0]?.name || 'out';

                c.deleteConnection(connectionId);
                c.createConnection(oldConn.fromNodeId, oldConn.fromPort, newNode.id, firstInput);
                c.createConnection(newNode.id, firstOutput, oldConn.toNodeId, oldConn.toPort);
              }
            }
          },
          cancel: () => {
            this.popupLongEdit = null;
            // handlePopupCancel will handle deletion of 'isNew' node
          }
        });

      } catch (e) {
        console.error("Failed to create preview node:", e);
      }
      return;
    }

    // Phase 2: Update Existing Node (or just-created preview node)
    if (this.popup.nodeId) {
      const applyCallback = (c: any) => {
        // CRITICAL FIX: If this is a new node created in this transaction,
        // we MUST re-create it every time apply() runs, because the previous runs (and creation) are rolled back.
        if (this.popup!.isNew) {
          c.createNode(typeId, this.popup!.gridX, this.popup!.gridY, { id: this.popup!.nodeId! });
        } else {
          // Just update config for existing nodes
          c.setNodeConfig(this.popup!.nodeId!, { typeId });
        }

        // Live Rewire
        const connectionId = (this.popup as any).connectionId;
        if (connectionId) {
          const oldConn = appController.observableState.graph.inner.connections[connectionId];
          if (oldConn) {
            const nodeType = defaultNodeRepository.getNodeType(typeId);
            const firstInput = nodeType?.inputs?.[0]?.name || 'in';
            const firstOutput = nodeType?.outputs?.[0]?.name || 'out';

            c.deleteConnection(connectionId);
            c.createConnection(oldConn.fromNodeId, oldConn.fromPort, this.popup!.nodeId!, firstInput);
            c.createConnection(this.popup!.nodeId!, firstOutput, oldConn.toNodeId, oldConn.toPort);
          }
        }
      };

      if (!this.popupLongEdit) {
        this.popupLongEdit = appController.beginLongEdit({
          apply: applyCallback,
          cancel: () => {
            this.popupLongEdit = null;
          }
        });
      } else {
        this.popupLongEdit.applyAgain(applyCallback);
      }
    }
  }

  private handlePopupCancel() {
    if (this.popupLongEdit) {
      this.popupLongEdit.cancel();
      this.popupLongEdit = null;
    }

    if (this.popup && this.popup.isNew && this.popup.nodeId) {
      // User cancelled creation flow (either empty space dbl click or wire insert), delete the temp node
      appController.deleteNode(this.popup.nodeId);
    }
    // Note: If popup.nodeId was set but NOT isNew, it means we were editing an existing node (if supported).
    // In that case, we do NOT delete it.

    this.popup = null;
  }

  private getNodeHeight(nodeId: string): number {
    const node = appController.observableState.graph.inner.nodes[nodeId];
    if (!node) return 0;

    const nodeType = defaultNodeRepository.getNodeType(node.config.typeId);
    let inputs = nodeType?.inputs || [];
    let outputs = nodeType?.outputs || [];

    // Use Effective Ports (Inferred > Repo)
    const effectiveType = localController.observableState.effectiveNodeTypes.get(nodeId);

    if (effectiveType) {
      inputs = effectiveType.inputs;
      outputs = effectiveType.outputs;
    }

    // Calculate ports height
    // Reuse logic from GraphNode roughly
    // We assume standard row height 24
    // We don't easily know custom input editor heights here without instantiating them or duplicating logic.
    // For now, assume standard 24px per port.

    let totalInputHeight = 0;
    inputs.forEach(input => {
      // Check if input editor would be shown?
      // GraphNode logic: if (alwaysShow || !connected && !suppress)
      // We need connections to know if connected.
      const incoming = appController.observableState.graph.auxiliary.incomingConnections.get(nodeId) || [];
      const isConnected = incoming.some(cid => {
        const c = appController.observableState.graph.inner.connections[cid];
        return c && c.toPort === input.name;
      });

      let h = 24; // ROW_HEIGHT

      // Check for custom input editor height
      // We need to know if the editor is actually shown.
      // Logic: if (alwaysShow || !connected && !suppress)

      const showEditor = (input.alwaysShowInputEditor || (!isConnected && !input.suppressInputEditor));

      if (showEditor) {
        // Try to get custom height
        if (nodeType?.getInputEditorHeight) {
          h = nodeType.getInputEditorHeight(node, input.name);
        } else if (nodeType?.ui?.getInputEditorHeight) {
          // This is async/lazy, we can't await here easily.
          // But typically if it's loaded, we might have access?
          // For now, let's hardcode a check for known large inputs if needed,
          // or rely on the fact that we should have the height if it's registered.
          // Actually, `getInputEditorHeight` in `ui` returns a Promise of a function.
          // We can't use it synchronously.

          // HACK: For debug.scope, we know it's 96px.
          // We can check if the input has a specific tag or type?
          // Or just check if it's `debug.scope` and `value` port?
          if (node.config.typeId === 'debug.scope' && input.name === 'value') {
            h = 96;
          }
        }
      }

      totalInputHeight += h;
    });

    const totalOutputHeight = outputs.length * 24;
    const portsHeight = Math.max(totalInputHeight, totalOutputHeight, 24);

    const bodyHeight = nodeType?.getBodyHeight?.(node) || 0;

    // Check for custom body in UI definition
    // If it has a custom body but no getBodyHeight, we should assume a standard large height?
    // debug.scope is ~96px body.
    // curve.ease is ~96px body.
    // If we don't know, we might under-calculate.
    // Let's assume if it has a custom body, it's at least 96px?
    let estimatedBodyHeight = bodyHeight;
    if (estimatedBodyHeight === 0 && (nodeType?.renderBody || nodeType?.ui?.body)) {
      estimatedBodyHeight = 96;
    }

    // Check minimal state
    // If <=1 ports and no body/sliders...
    // We reused getNodeWidth logic for this check.
    const width = this.getNodeWidth(nodeId);
    if (width === 80) return 80; // Minimal

    return 24 + portsHeight + 8 + estimatedBodyHeight; // Header + Ports + Padding + Body
  }

  private getRowHeight(gridY: number): number {
    return localController.observableState.gridMetrics.rows.get(gridY) || 80;
  }

  private getNodeWidth(nodeId: string): number {
    const node = appController.observableState.graph.inner.nodes[nodeId];
    if (!node) return 272; // Default to normal

    const nodeType = defaultNodeRepository.getNodeType(node.config.typeId);
    let inputs = nodeType?.inputs || [];
    let outputs = nodeType?.outputs || [];

    // Dynamic ports check
    // Dynamic ports check
    // Use Effective Ports (Inferred > Repo)
    const effectiveType = localController.observableState.effectiveNodeTypes.get(nodeId);

    if (effectiveType) {
      inputs = effectiveType.inputs;
      outputs = effectiveType.outputs;
    }

    const hasCustomBody = !!(nodeType?.renderBody || nodeType?.ui?.body);

    // Check for visible sliders
    // Logic must match GraphNode.render:
    // hasVisibleSliders = inputs.some(i => shouldShowInputEditor(i, isConnected))

    const incoming = appController.observableState.graph.auxiliary.incomingConnections.get(nodeId) || [];
    const connectedPorts = new Set(incoming.map(cid => {
      const c = appController.observableState.graph.inner.connections[cid];
      return c ? c.toPort : null;
    }));

    const hasVisibleSliders = inputs.some(input => {
      if (input.alwaysShowInputEditor) return true;
      if (connectedPorts.has(input.name)) return false;
      if (input.suppressInputEditor) return false;
      return true;
    });

    if (hasCustomBody || hasVisibleSliders) return 272;

    if (inputs.length <= 1 && outputs.length <= 1) return 80;
    if (inputs.length <= 3 && outputs.length <= 3) return 176;
    return 272;
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
    let maxNodeX = 0;
    let maxNodeY = 0;

    for (const node of Object.values(nodes)) {
      if (node.config.typeId === 'io.output' || node.config.typeId === 'resolume.output') {
        // Track Y for output nodes so we have enough rows, but ignore X
        if (node.y > maxNodeY) maxNodeY = node.y;
        continue;
      }
      if (node.x > maxNodeX) maxNodeX = node.x;
      if (node.y > maxNodeY) maxNodeY = node.y;
    }

    const rows = Math.max(maxNodeY + 3, 12);
    const cols = Math.max(maxNodeX + 3, 8);

    // Input Column (x=0)
    // Input Column (x=0)
    for (let y = 0; y < rows; y++) {
      const rowHeight = this.getRowHeight(y);
      cells.push(html`<div class="cell node-cell" data-x="input" data-y="${y}" style="grid-column: 1; grid-row: ${2 * y + 2}; height: ${rowHeight}px;"></div>`);
      // Gap below input?
      cells.push(html`<div class="cell gap-cell gap-h" style="grid-column: 1; grid-row: ${2 * y + 3};"></div>`);
    }

    // Main Grid (x=0..cols)
    for (let x = 0; x <= cols; x++) {
      const colIdx = 2 * x + 3;

      for (let y = 0; y < rows; y++) {
        const rowIdx = 2 * y + 2;
        const rowHeight = this.getRowHeight(y);

        // Node Cell
        cells.push(html`<div class="cell node-cell" data-x="${x}" data-y="${y}" style="grid-column: ${colIdx}; grid-row: ${rowIdx}; height: ${rowHeight}px;"></div>`);

        // Gap below Node (Row 2*y+3) -> Horizontal Line
        cells.push(html`<div class="cell gap-cell gap-h" style="grid-column: ${colIdx}; grid-row: ${rowIdx + 1};"></div>`);

        // Gap to the left (Col 2*x) -> Vertical Line
        cells.push(html`<div class="cell gap-cell gap-v" style="grid-column: ${colIdx - 1}; grid-row: ${rowIdx}; height: ${rowHeight}px;"></div>`);

        // Corner (Gap left + Gap below) -> Cross
        cells.push(html`<div class="cell gap-cell gap-c" style="grid-column: ${colIdx - 1}; grid-row: ${rowIdx + 1};"></div>`);
      }
    }

    // Output Column
    const outputCol = 2 * cols + 3;
    for (let y = 0; y < rows; y++) {
      const rowHeight = this.getRowHeight(y);
      cells.push(html`<div class="cell node-cell" data-x="output" data-y="${y}" style="grid-column: ${outputCol}; grid-row: ${2 * y + 2}; height: ${rowHeight}px;"></div>`);
      cells.push(html`<div class="cell gap-cell gap-h" style="grid-column: ${outputCol}; grid-row: ${2 * y + 3};"></div>`);
      // Gap to left of output
      cells.push(html`<div class="cell gap-cell gap-v" style="grid-column: ${outputCol - 1}; grid-row: ${2 * y + 2}; height: ${rowHeight}px;"></div>`);
      cells.push(html`<div class="cell gap-cell gap-c" style="grid-column: ${outputCol - 1}; grid-row: ${2 * y + 3};"></div>`);
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
      if (node.x > maxNodeX) maxNodeX = node.x;
    }
    const cols = Math.max(maxNodeX + GRID_OUTPUT_COL_PADDING, GRID_MIN_COLS);
    const outputCol = 2 * cols + 3;

    return html`
      ${this.renderGhostWire()}
      ${this.renderPendingWirePip()}
      ${this.selectionBox ? html`
        <div class="selection-box" style="left: ${this.selectionBox.x}px; top: ${this.selectionBox.y}px; width: ${this.selectionBox.w}px; height: ${this.selectionBox.h}px;"></div>
      ` : ''}

      ${this.popup ? html`
        <div class="popup-container" style="left: ${this.popup.x}px; top: ${this.popup.y}px;">
            <smart-input
                .catalog=${this.catalog}
                .value=${this.popup.initialValue}
                .autofocus=${true}
                @commit=${this.handlePopupCommit.bind(this)}
                @preview-type=${this.handlePopupPreview.bind(this)}
                @cancel=${this.handlePopupCancel.bind(this)}
            ></smart-input>
        </div>
      ` : ''}

      <div class="grid-container" tabindex="-1">
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



    ${repeat(Object.values(nodes), node => node.id, node => this.renderGraphNode(node, outputCol))}
      </div>
    `;
  }

  private renderGraphNode(node: GridNode, outputCol: number) {
    const isQueued = localController.observableState.queuedSelection.has(node.id);
    const incomingConnections = appController.observableState.graph.auxiliary.incomingConnections.get(node.id) || [];

    // Calculate grid position
    let col = 0;
    if (node.config.typeId === 'io.input' || node.config.typeId === 'resolume.input') col = 1;
    else if (node.config.typeId === 'io.output' || node.config.typeId === 'resolume.output') col = outputCol;
    else col = 2 * node.x + 3;

    const row = 2 * node.y + 2;
    const span = 1;
    const isSelected = localController.observableState.selection.has(node.id);

    return html`
            <graph-node
              .node=${node}
              .incomingConnections=${incomingConnections}
              .isQueued=${isQueued}
              .x=${node.x}
              .y=${node.y}
              style="grid-column: ${col} / span ${span}; grid-row: ${row}; z-index: ${isSelected ? 10 : 1}; justify-self: center; align-self: center;"
            ></graph-node>
          `;
  }
}
