import './graph-node';
import { SmartInput } from '../components/smart-input';
import { MobxLitElement } from './mobx-lit-element';
import { html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { appController, localController } from '../builder/controllers';
import { LongEdit } from '../builder/state';
import { PointerDragOp } from '../utils/pointer-drag-op';
import { cssColorFromHash } from '../utils/layout-utils';
import { NodeCatalog } from '../structor/node-catalog';
import { defaultNodeRepository } from '../structor/repository';
import { globalStyles } from '../styles';

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
        repeat(12, [node] auto [gap] var(--grid-gap, 16px));

      min-width: 100%;
      min-height: 100%;
      gap: 0;
      position: relative;
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
      min-height: 80px;
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
    graph-connection {
      display: contents;
    }

    .wire-segment {
      background-color: var(--wire-color, #888);
      pointer-events: auto;
      transition: background-color 0.2s;
      z-index: 5; /* Below nodes (10) but above background */
      cursor: pointer;
      position: relative; /* For lane offsets */
    }

    .wire-segment:hover {
      filter: brightness(1.2);
    }

    graph-connection[selected] .wire-segment {
      background-color: #fff !important;
      z-index: 20;
    }

    /* Hit area for easier clicking */
    .wire-segment::after {
      content: '';
      position: absolute;
      top: -5px;
      left: -5px;
      right: -5px;
      bottom: -5px;
    }

    .popup-container {
        position: absolute;
        z-index: 1000;
        background: white;
        border-radius: 4px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    }
  `];

  @property({ attribute: false })
  selectionBox: { x: number, y: number, w: number, h: number } | null = null;

  @state()
  popup: { x: number, y: number, gridX: number, gridY: number, initialValue: string, nodeId?: string } | null = null;

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

    const path = e.composedPath();
    const isNode = path.some(el => (el as Element).tagName === 'GRAPH-NODE');
    const isConnection = path.some(el => (el as Element).tagName === 'GRAPH-CONNECTION');

    if (isNode || isConnection) return;

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
        } else {
          gridX = parseInt(rawX || '0');
          if (gridX === 0) {
            initialValue = 'io.input'; // Default for input column
          }
        }

        // Create node immediately
        const newNode = appController.createNode(initialValue, gridX, y);
        localController.queueSelectPaths([newNode.id]);

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
          nodeId: newNode.id // Track the created node ID
        };
        return;
      }
      return;
    }

    // Check if we clicked on a node
    const targetNode = target as HTMLElement;
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
      }
    });
  }

  private handleScroll(e: Event) {
    const target = e.target as HTMLElement;
    this.scrollLeft = target.scrollLeft;
  }

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('pointerdown', this.handlePointerDown);
    this.addEventListener('dblclick', this.handleDblClick);
    this.addEventListener('connection-delete', this.handleConnectionDelete as EventListener);
    this.addEventListener('scroll', this.handleScroll);
    this.resizeObserver.observe(this);
    this.clientWidth = this.offsetWidth;
    this.addEventListener('dragover', this.handleDragOver);
    this.addEventListener('drop', this.handleDrop);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('pointerdown', this.handlePointerDown);
    this.removeEventListener('dblclick', this.handleDblClick);
    this.removeEventListener('connection-delete', this.handleConnectionDelete as EventListener);
    this.removeEventListener('scroll', this.handleScroll);
    this.removeEventListener('dragover', this.handleDragOver);
    this.removeEventListener('drop', this.handleDrop);
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

    // If we have a nodeId, update it.
    if (this.popup.nodeId) {
      if (this.popupLongEdit) {
        this.popupLongEdit.accept();
        this.popupLongEdit = null;
      } else {
        appController.setNodeConfig(this.popup.nodeId, { typeId });
      }
    } else {
      // Fallback if somehow nodeId is missing (shouldn't happen with new flow)
      const { gridX, gridY } = this.popup;
      try {
        const newNode = appController.createNode(typeId, gridX, gridY);
        localController.queueSelectPaths([newNode.id]);
      } catch (e) {
        console.error("Failed to create node:", e);
      }
    }

    // Defer popup removal to ensure render cycle completes and prevents race conditions
    setTimeout(() => {
      this.popup = null;
    }, 0);
  }

  private handlePopupPreview(e: CustomEvent) {
    if (!this.popup || !this.popup.nodeId) return;
    const typeId = e.detail;

    if (!this.popupLongEdit) {
      this.popupLongEdit = appController.beginLongEdit({
        apply: (c) => {
          c.setNodeConfig(this.popup!.nodeId!, { typeId });
        },
        cancel: () => {
          this.popupLongEdit = null;
        }
      });
    } else {
      this.popupLongEdit.applyAgain((c) => {
        c.setNodeConfig(this.popup!.nodeId!, { typeId });
      });
    }
  }

  private handlePopupCancel() {
    if (this.popupLongEdit) {
      this.popupLongEdit.cancel();
      this.popupLongEdit = null;
    }

    if (this.popup && this.popup.nodeId) {
      // User cancelled creation, delete the temp node
      appController.deleteNode(this.popup.nodeId);
    }
    this.popup = null;
  }

  render() {
    const { nodes, connections } = appController.observableState.graph.inner;

    // Render Grid Cells
    const cells = [];

    // Calculate dynamic grid size
    let maxNodeX = 0;
    let maxNodeY = 0;

    for (const node of Object.values(nodes)) {
      if (node.x > maxNodeX) maxNodeX = node.x;
      if (node.y > maxNodeY) maxNodeY = node.y;
    }

    const rows = Math.max(maxNodeY + 3, 12);
    const cols = Math.max(maxNodeX + 3, 8);

    // Input Column (x=0)
    for (let y = 0; y < rows; y++) {
      cells.push(html`<div class="cell node-cell" data-x="0" data-y="${y}" style="grid-column: 1; grid-row: ${2 * y + 2};"></div>`);
      // Gap below input?
      cells.push(html`<div class="cell gap-cell gap-h" style="grid-column: 1; grid-row: ${2 * y + 3};"></div>`);
    }

    // Main Grid (x=1..cols)
    for (let x = 1; x <= cols; x++) {
      const colIdx = 2 * x + 1;

      for (let y = 0; y < rows; y++) {
        const rowIdx = 2 * y + 2;

        // Node Cell
        cells.push(html`<div class="cell node-cell" data-x="${x}" data-y="${y}" style="grid-column: ${colIdx}; grid-row: ${rowIdx};"></div>`);

        // Gap below Node (Row 2*y+3) -> Horizontal Line
        cells.push(html`<div class="cell gap-cell gap-h" style="grid-column: ${colIdx}; grid-row: ${rowIdx + 1};"></div>`);

        // Gap to the left (Col 2*x) -> Vertical Line
        cells.push(html`<div class="cell gap-cell gap-v" style="grid-column: ${colIdx - 1}; grid-row: ${rowIdx};"></div>`);

        // Corner (Gap left + Gap below) -> Cross
        cells.push(html`<div class="cell gap-cell gap-c" style="grid-column: ${colIdx - 1}; grid-row: ${rowIdx + 1};"></div>`);
      }
    }

    // Output Column
    const outputCol = 2 * cols + 3;
    for (let y = 0; y < rows; y++) {
      cells.push(html`<div class="cell node-cell" data-x="output" data-y="${y}" style="grid-column: ${outputCol}; grid-row: ${2 * y + 2};"></div>`);
      cells.push(html`<div class="cell gap-cell gap-h" style="grid-column: ${outputCol}; grid-row: ${2 * y + 3};"></div>`);
      // Gap to left of output
      cells.push(html`<div class="cell gap-cell gap-v" style="grid-column: ${outputCol - 1}; grid-row: ${2 * y + 2};"></div>`);
      cells.push(html`<div class="cell gap-cell gap-c" style="grid-column: ${outputCol - 1}; grid-row: ${2 * y + 3};"></div>`);
    }

    return html`
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

      <div class="grid-container">
        ${cells}

        ${Object.values(connections).flatMap(conn => {
      const wireLayout = localController.observableState.wireLayout.wires[conn.id];
      const isSelected = localController.observableState.selection.has(conn.id);
      const color = cssColorFromHash(`${conn.fromPort}-${conn.toPort}`);

      // Register selectable
      localController.defineSelectable({
        path: conn.id,
        renderInspectorContent: () => html`
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
            `
      });

      const elements = [];

      if (wireLayout && wireLayout.path.length > 0) {
        for (let i = 1; i < wireLayout.path.length - 1; i++) {
          const curr = wireLayout.path[i];
          const prev = i > 0 ? wireLayout.path[i - 1] : null;
          const next = i < wireLayout.path.length - 1 ? wireLayout.path[i + 1] : null;
          const col = Math.round(2 * curr.x + 1);
          const row = Math.round(2 * curr.y + 2);

          // Identify neighbors
          let leftNeighbor = null;
          let rightNeighbor = null;
          let topNeighbor = null;
          let bottomNeighbor = null;

          if (prev) {
            if (prev.x < curr.x) leftNeighbor = prev;
            else if (prev.x > curr.x) rightNeighbor = prev;
            else if (prev.y < curr.y) topNeighbor = prev;
            else if (prev.y > curr.y) bottomNeighbor = prev;
          } else {
            // Start of wire (From Node)
            // Assume standard flow: Output -> Input (Left -> Right)
            // So From Node is on the Left.
            leftNeighbor = { x: curr.x - 0.5, y: curr.y }; // Virtual neighbor
          }

          if (next) {
            if (next.x < curr.x) leftNeighbor = next;
            else if (next.x > curr.x) rightNeighbor = next;
            else if (next.y < curr.y) topNeighbor = next;
            else if (next.y > curr.y) bottomNeighbor = next;
          }

          // Lane Logic
          const getLane = (p1: { x: number, y: number }, p2: { x: number, y: number }) => {
            const k1 = `${p1.x},${p1.y}`;
            const k2 = `${p2.x},${p2.y}`;
            const key = k1 < k2 ? `${k1}:${k2}` : `${k2}:${k1}`;
            return wireLayout.lanes[key];
          };

          const getLaneOffset = (p1: { x: number, y: number }, p2: { x: number, y: number }) => {
            const lane = getLane(p1, p2);
            if (lane) return lane.index * 10 - (lane.count - 1) * 10 / 2;
            return 0;
          };

          // Calculate Intersection Point (laneX, laneY)
          // laneX comes from vertical neighbors (Top/Bottom)
          // laneY comes from horizontal neighbors (Left/Right)

          let laneX = 0;
          let laneY = 0;

          if (topNeighbor) laneX = getLaneOffset(curr, topNeighbor);
          else if (bottomNeighbor) laneX = getLaneOffset(curr, bottomNeighbor);

          if (leftNeighbor) {
            // Check if virtual
            if (leftNeighbor === prev || leftNeighbor === next) {
              laneY = getLaneOffset(curr, leftNeighbor);
            } else {
              // Virtual neighbor (start of wire). Use 0 or try to infer?
              // Usually 0 for port connection.
              laneY = 0;
            }
          } else if (rightNeighbor) {
            laneY = getLaneOffset(curr, rightNeighbor);
          }

          const commonStyle = `
                grid-column: ${col};
                grid-row: ${row};
                background-color: ${isSelected ? '#fff' : color};
                position: relative;
                z-index: ${isSelected ? 20 : 5};
              `;

          const handleClick = (e: MouseEvent) => {
            e.stopPropagation();
            localController.queueSelectPaths([conn.id], e.shiftKey || e.ctrlKey || e.metaKey);
          };

          const handleDblClick = (e: MouseEvent) => {
            e.stopPropagation();
            appController.deleteConnection(conn.id);
          };

          // Render Segments meeting at (center + laneX, center + laneY)

          if (leftNeighbor) {
            elements.push(html`<div class="wire-segment" style="${commonStyle} width: calc(50% + ${laneX}px); height: 2px; justify-self: start; align-self: center; transform: translateY(${laneY}px);" @click=${handleClick} @dblclick=${handleDblClick}></div>`);
          }
          if (rightNeighbor) {
            elements.push(html`<div class="wire-segment" style="${commonStyle} width: calc(50% - ${laneX}px); height: 2px; justify-self: end; align-self: center; transform: translateY(${laneY}px);" @click=${handleClick} @dblclick=${handleDblClick}></div>`);
          }
          if (topNeighbor) {
            elements.push(html`<div class="wire-segment" style="${commonStyle} width: 2px; height: calc(50% + ${laneY}px); justify-self: center; align-self: start; transform: translateX(${laneX}px);" @click=${handleClick} @dblclick=${handleDblClick}></div>`);
          }
          if (bottomNeighbor) {
            elements.push(html`<div class="wire-segment" style="${commonStyle} width: 2px; height: calc(50% - ${laneY}px); justify-self: center; align-self: end; transform: translateX(${laneX}px);" @click=${handleClick} @dblclick=${handleDblClick}></div>`);
          }

          // Center Cap (Optional, but good for smooth corners if gaps exist due to rendering)
          // With calc(), they should meet perfectly.
          // But let's add a small square at the intersection to be safe and cover sub-pixel artifacts?
          // elements.push(html`<div class="wire-segment" style="${commonStyle} width: 2px; height: 2px; justify-self: center; align-self: center; transform: translate(${laneX}px, ${laneY}px);" @click=${handleClick} @dblclick=${handleDblClick}></div>`);
        }
      }

      return elements;
    })}

        ${Object.values(nodes).map(node => {
      const isQueued = localController.observableState.queuedSelection.has(node.id);

      // Calculate grid position
      let col = 0;
      if (node.config.typeId === 'io.input' || node.config.typeId === 'resolume.input') col = 1;
      else if (node.config.typeId === 'io.output' || node.config.typeId === 'resolume.output') col = outputCol;
      else col = 2 * node.x + 1;

      const row = 2 * node.y + 2;

      return html`
            <graph-node
              .node=${node}
              .isQueued=${isQueued}
              .x=${node.x}
              .y=${node.y}
              style="grid-column: ${col}; grid-row: ${row}; z-index: 10;"
              data-id="${node.id}"
            ></graph-node>
          `;
    })}
      </div>
    `;
  }
}
