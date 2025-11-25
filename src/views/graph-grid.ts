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
      grid-template-columns: repeat(auto-fill, 100px);
      grid-template-rows: repeat(auto-fill, 100px);
      width: 100%;
      height: 100%;
      gap: 10px;
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
          const nodeX = node.x * 110;
          const nodeY = node.y * 110;
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
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top; // Viewport relative Y

    // Calculate grid row based on clickY + scrollTop
    const scrollTop = this.scrollTop;
    const gridY = Math.floor((clickY + scrollTop) / 110);

    // Input Column (Left)
    if (clickX < 130) {
      const newNode = appController.createNode('input', 0, gridY);
      localController.queueSelectPaths([newNode.id]);
      return;
    }

    // Output Column (Right)
    if (clickX > this.clientWidth - 130) {
      const newNode = appController.createNode('output', 0, gridY);
      localController.queueSelectPaths([newNode.id]);
      return;
    }

    // Grid settings
    const cellSize = 100;
    const gapSize = 10;
    const totalSize = cellSize + gapSize;

    const modX = clickX % totalSize;
    const modY = clickY % totalSize;

    // Check for vertical gap click (insert horizontal space)
    if (modX >= cellSize) {
      const colIndex = Math.floor(clickX / totalSize);
      appController.insertSpace('x', colIndex);
    }

    // Check for horizontal gap click (insert vertical space)
    if (modY >= cellSize) {
      const rowIndex = Math.floor(clickY / totalSize);
      appController.insertSpace('y', rowIndex);
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
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('pointerdown', this.handlePointerDown);
    this.removeEventListener('dblclick', this.handleDblClick);
    this.removeEventListener('connection-delete', this.handleConnectionDelete as EventListener);
    this.removeEventListener('scroll', this.handleScroll);
    this.resizeObserver.disconnect();
  }

  render() {
    const { nodes, connections } = appController.observableState.graph.inner;
    const nodePositions = new Set(Object.values(nodes).map(n => `${n.x},${n.y}`));

    const cells = [];
    // Render grid cells only for the main area (x >= 1)
    // We can render a background for the input/output columns if needed
    for (let y = 0; y < 10; y++) {
      for (let x = 1; x < 10; x++) {
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
        // In grid coords (relative to origin): 10 + scrollLeft
        // But we want grid units for connection.
        // Connection expects pixels? No, GraphConnection takes grid units and multiplies by 110.
        // Let's pass raw pixels to GraphConnection instead?
        // No, GraphConnection logic is: startX = this.from.x * 110 + 90;
        // So we need to reverse-engineer the "grid x" that would result in the correct pixel position.
        // Target Pixel X = 10 + scrollLeft.
        // (GridX * 110) = Target Pixel X.
        // GridX = (10 + scrollLeft) / 110.
        return { x: (10 + this.scrollLeft) / 110, y: node.y };
      } else if (node.config.typeId === 'output') {
        // Pinned to right (visual x = clientWidth - 130px) (120px width + 10px padding)
        const targetPixelX = this.clientWidth - 130 + this.scrollLeft;
        return { x: targetPixelX / 110, y: node.y };
      } else {
        return { x: node.x, y: node.y };
      }
    };

    return html`
      ${this.selectionBox ? html`
        <div class="selection-box" style="left: ${this.selectionBox.x}px; top: ${this.selectionBox.y}px; width: ${this.selectionBox.w}px; height: ${this.selectionBox.h}px;"></div>
      ` : ''}
      ${cells}
      ${Object.values(nodes).map(node => {
      let style = `grid-row: ${node.y + 1};`;
      if (node.config.typeId === 'input') {
        style = `grid-column: 1; grid-row: ${node.y + 1};`;
      } else if (node.config.typeId === 'output') {
        style = `grid-column: 3; grid-row: ${node.y + 1};`;
      } else {
        style = `grid-column: 2; grid-row: ${node.y + 1}; grid-column-start: ${node.x + 1};`;
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
          ></graph-connection>
        `;
    })}
    `;
  }
}
