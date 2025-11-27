import { MobxLitElement } from './mobx-lit-element';
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { appController, localController } from '../builder/controllers';
import './graph-connection';
import './graph-node';
import { PointerDragOp } from '../utils/pointer-drag-op';
import { Point } from '../utils/layout-utils';
import { styleMap } from 'lit/directives/style-map.js';

@customElement('graph-grid')
export class GraphGrid extends MobxLitElement {
  static readonly styles = css`
    :host {
      display: grid;
      grid-template-columns: 120px repeat(20, 110px) 120px;
      grid-template-rows: repeat(auto-fill, 110px);
      width: 100%;
      height: 100%;
      overflow: auto;
      gap: 0; /* Gap is handled by column sizing */
      position: relative;
      user-select: none;
    }

    .selection-box {
      position: absolute;
      background-color: rgba(0, 170, 255, 0.2);
      border: 1px solid rgba(0, 170, 255, 0.5);
      pointer-events: none;
      z-index: 100;
    }

    .cell {
      background-color: rgba(255, 255, 255, 0.05);
      border-radius: 4px;
      pointer-events: auto; /* Ensure clicks are captured */
      margin: 5px; /* Visual gap */
    }
  `;

  @property({ attribute: false })
  selectionBox: { x: number, y: number, w: number, h: number } | null = null;

  private handlePointerDown(e: PointerEvent) {
    // Ignore if clicking on a node or connection (handled by their own listeners)
    // But we are on the grid host, so we need to check composed path
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
        const selectedIds: string[] = [];
        const { nodes } = appController.observableState.graph.inner;

        for (const node of Object.values(nodes)) {
          // Node position in pixels (relative to grid origin)
          // Input: 10px padding
          // Main: 120 + (x-1)*110 + 10
          // Output: 120 + 50*110 + 10 = 5630

          let nodeX = 0;
          if (node.config.typeId === 'input') {
            nodeX = 10;
          } else if (node.config.typeId === 'output') {
            nodeX = 120 + 20 * 110 + 10;
          } else {
            nodeX = 120 + (node.x - 1) * 110 + 10;
          }

          const nodeY = node.y * 110 + 10;
          const nodeW = 100;
          const nodeH = 100;

          // Check intersection
          if (x < nodeX + nodeW && x + w > nodeX &&
            y < nodeY + nodeH && y + h > nodeY) {
            selectedIds.push(node.id);
          }
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
      const newNode = appController.createNode('literal', x, y);
      localController.queueSelectPaths([newNode.id]);
      return;
    }
    // Check if we clicked on a node
    // When clicking on a custom element in Shadow DOM, the event target is retargeted to the custom element itself
    const targetNode = target as HTMLElement;
    if (targetNode.tagName === 'GRAPH-NODE' && targetNode.dataset.id) {
      appController.deleteNode(targetNode.dataset.id);
      return;
    }

    // Also check composed path in case we clicked on something inside the node that didn't retarget (unlikely but safe)
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

    // Check if we clicked on the grid background (gaps) or pinned columns
    const rect = this.getBoundingClientRect();
    const clickX = e.clientX - rect.left; // Viewport relative
    const clickY = e.clientY - rect.top; // Viewport relative Y

    // Calculate grid row based on clickY + scrollTop
    const scrollTop = this.scrollTop;
    const gridY = Math.floor((clickY + scrollTop) / 110);

    // Input Column (Left) - Sticky
    if (clickX < 120) {
      const newNode = appController.createNode('input', 0, gridY);
      localController.queueSelectPaths([newNode.id]);
      return;
    }

    // Output Column (Right) - Sticky
    if (clickX > this.clientWidth - 120) {
      const newNode = appController.createNode('output', 0, gridY);
      localController.queueSelectPaths([newNode.id]);
      return;
    }

    // Main Grid
    // We need to account for scrollLeft and the left input column width (120px)
    const gridX = Math.floor((clickX + this.scrollLeft - 120) / 110) + 1;

    if (gridX >= 1 && gridX <= 20) {
      // Check for gap clicks if needed, but for now just create node or ignore
      // The original code had logic for inserting spaces.
      // Re-implementing gap logic might be tricky with the new layout.
      // Let's stick to simple creation for now or keep the gap logic if possible.

      // Gap logic was:
      // const modX = clickX % totalSize;
      // if (modX >= cellSize) ...

      // With fixed columns, we can check relative to the cell.
      const relativeX = (clickX + this.scrollLeft - 120) % 110;
      const relativeY = (clickY + scrollTop) % 110;

      if (relativeX > 100) { // Gap
        appController.insertSpace('x', gridX);
        return;
      }
      if (relativeY > 100) { // Gap
        appController.insertSpace('y', gridY);
        return;
      }
    }
  }

  private handleConnectionDelete(e: CustomEvent<{ connectionId: string }>) {
    appController.deleteConnection(e.detail.connectionId);
  }

  @property({ attribute: false })
  scrollLeft = 0;

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
    // Initial size
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
    const data = e.dataTransfer?.getData('application/json');
    if (!data) return;

    try {
      const parsed = JSON.parse(data);
      // Handle Resolume parameters specially:
      // If dropped on the left, create an input.
      // If dropped on the right, create an output.
      // Otherwise, default to input.
      if (parsed.type === 'resolume:parameter') {
        const rect = this.getBoundingClientRect();
        const dropX = e.clientX - rect.left;
        const dropY = e.clientY - rect.top;
        const gridY = Math.floor((dropY + this.scrollTop) / 110);

        let nodeType = 'resolume:input';
        let x = 0;

        // Determine type based on column
        if (dropX < 120) {
          // Input Column
          nodeType = 'resolume:input';
          x = 0;
        } else if (dropX > this.clientWidth - 120) {
          // Output Column
          nodeType = 'resolume:output';
          x = 0; // x is ignored for output/input types usually, but let's be consistent
        } else {
          // Main Grid
          nodeType = 'resolume:input';
          x = Math.floor((dropX + this.scrollLeft - 120) / 110) + 1;
        }

        const newNode = appController.createNode(nodeType, x, gridY, { path: parsed.path });
        localController.queueSelectPaths([newNode.id]);
      }
    } catch (err) {
      console.error('Failed to parse drop data', err);
    }
  }

  render() {
    const { nodes, connections } = appController.observableState.graph.inner;
    const nodePositions = new Set(Object.values(nodes).map(n => `${n.x},${n.y}`));

    const cells = [];
    // Render grid cells only for the main area (x >= 1)
    for (let y = 0; y < 20; y++) { // Render enough rows
      for (let x = 1; x <= 20; x++) {
        if (!nodePositions.has(`${x},${y}`)) {
          cells.push(html`
            <div
              class="cell"
              data-x=${x}
              data-y=${y}
              style="grid-column: ${x + 1}; grid-row: ${y + 1};"
            ></div>
          `);
        }
      }
    }

    const getNodeScreenPos = (node: any) => {
      if (node.config.typeId === 'input') {
        // Pinned to left (visual x=10px padding)
        // Sticky means it stays at 10px relative to viewport, so 10 + scrollLeft relative to grid origin
        return { x: (10 + this.scrollLeft) / 110, y: node.y };
      } else if (node.config.typeId === 'output') {
        // Pinned to right (visual x = clientWidth - 130px)
        // Sticky means it stays at clientWidth - 130 relative to viewport
        const targetPixelX = this.clientWidth - 130 + this.scrollLeft;
        return { x: targetPixelX / 110, y: node.y };
      } else {
        // Main grid: 120 + (x-1)*110 + 10
        // We need to return "grid units" for the connection line.
        // The connection line logic likely multiplies by 110.
        // So we need to return (pixelX / 110).
        const pixelX = 120 + (node.x - 1) * 110 + 10;
        return { x: pixelX / 110, y: node.y };
      }
    };

    return html`
      ${this.selectionBox ? html`
        <div class="selection-box" style="left: ${this.selectionBox.x}px; top: ${this.selectionBox.y}px; width: ${this.selectionBox.w}px; height: ${this.selectionBox.h}px;"></div>
      ` : ''}
      ${cells}
      ${Object.values(connections).map(conn => {
      const fromNode = nodes[conn.fromNodeId];
      const toNode = nodes[conn.toNodeId];
      if (!fromNode || !toNode) return '';

      const fromPos = getNodeScreenPos(fromNode);
      const toPos = getNodeScreenPos(toNode);

      return html`
          <graph-connection
            .connection=${conn}
            .from=${fromPos}
            .to=${toPos}
            style="grid-column: 1 / -1; grid-row: 1 / -1; position: relative; z-index: 0; pointer-events: none;"
          ></graph-connection>
        `;
    })}
      ${Object.values(nodes).map(node => {
      let style = `grid-row: ${node.y + 1};`;
      if (node.config.typeId === 'input') {
        style = `grid-column: 1; grid-row: ${node.y + 1}; position: sticky; left: 0; z-index: 10; margin-left: 10px;`;
      } else if (node.config.typeId === 'output') {
        style = `grid-column: 22; grid-row: ${node.y + 1}; position: sticky; right: 0; z-index: 10; margin-right: 10px;`;
      } else {
        style = `grid-column: ${node.x + 1}; grid-row: ${node.y + 1}; margin-left: 10px; z-index: 1; position: relative;`;
      }

      const isQueued = localController.observableState.queuedSelection.has(node.id);

      return html`
          <graph-node
            .node=${node}
            .isQueued=${isQueued}
            style="${style}"
          ></graph-node>
        `;
    })}
    `;
  }
}
