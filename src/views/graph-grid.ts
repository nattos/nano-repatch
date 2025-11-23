import { MobxLitElement } from './mobx-lit-element';
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { appController, localController } from '../builder/controllers';
import './graph-connection';
import './graph-node';

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

    .cell {
      border: 1px dashed #555;
    }
  `;

  private handleDblClick(e: MouseEvent) {
    const path = e.composedPath();
    const target = path[0] as HTMLElement;

    // Check if we clicked on a cell
    if (target.classList.contains('cell')) {
      const x = parseInt(target.dataset.x || '0');
      const y = parseInt(target.dataset.y || '0');
      appController.createNode('literal', x, y);
      return;
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
      appController.createNode('input', 0, gridY);
      return;
    }

    // Output Column (Right)
    if (clickX > this.clientWidth - 130) {
      appController.createNode('output', 0, gridY);
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
    this.addEventListener('dblclick', this.handleDblClick);
    this.addEventListener('connection-delete', this.handleConnectionDelete as EventListener);
    this.addEventListener('scroll', this.handleScroll);
    this.resizeObserver.observe(this);
    // Initial size
    this.clientWidth = this.offsetWidth;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
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
      ${cells}
      ${Object.values(nodes).map(node => {
      let style = `grid-row: ${node.y + 1};`;
      if (node.config.typeId === 'input') {
        style += ` grid-column: 1; position: sticky; left: 10px; z-index: 10;`;
      } else if (node.config.typeId === 'output') {
        // For output, we want it pinned to right.
        // Since it's a grid item, 'right: 10px' sticks to the right edge of the scrollport.
        // But we need to place it in a column that is guaranteed to be on the right?
        // Or just use position: sticky and a high column index?
        // If we use grid-column: 1000, it will be far right.
        style += ` grid-column: 1000; position: sticky; right: 10px; z-index: 10;`;
      } else {
        style += ` grid-column: ${node.x + 1};`;
      }

      return html`
          <graph-node
            .node=${node}
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
