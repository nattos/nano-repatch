import { MobxLitElement } from './mobx-lit-element';

import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { AppController, LocalController } from '../builder/state';
import './graph-connection';
import './graph-node';

@customElement('graph-grid')
export class GraphGrid extends MobxLitElement {
  @property({ attribute: false })
  controller!: AppController;

  @property({ attribute: false })
  localController!: LocalController;

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
      this.controller.createNode('literal', x, y);
      return;
    }

    // Check if we clicked on the grid background (gaps)
    const rect = this.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Grid settings
    const cellSize = 100;
    const gapSize = 10;
    const totalSize = cellSize + gapSize;

    const modX = clickX % totalSize;
    const modY = clickY % totalSize;

    // Check for vertical gap click (insert horizontal space)
    if (modX >= cellSize) {
      const colIndex = Math.floor(clickX / totalSize);
      this.controller.insertSpace('x', colIndex);
    }

    // Check for horizontal gap click (insert vertical space)
    if (modY >= cellSize) {
      const rowIndex = Math.floor(clickY / totalSize);
      this.controller.insertSpace('y', rowIndex);
    }
  }

  private handleNodeClick(e: CustomEvent<{ nodeId: string, shiftKey: boolean, ctrlKey: boolean, metaKey: boolean }>) {
    e.stopPropagation();
    this.dispatchEvent(new CustomEvent('node-click', {
      detail: {
        nodeId: e.detail.nodeId,
        additive: e.detail.shiftKey || e.detail.ctrlKey || e.detail.metaKey,
      },
      bubbles: true,
      composed: true,
    }));
  }

  private handleConnectionDelete(e: CustomEvent<{ connectionId: string }>) {
    this.controller.deleteConnection(e.detail.connectionId);
  }

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('dblclick', this.handleDblClick);
    this.addEventListener('connection-delete', this.handleConnectionDelete as EventListener);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('dblclick', this.handleDblClick);
    this.removeEventListener('connection-delete', this.handleConnectionDelete as EventListener);
  }

  render() {
    const { nodes, connections } = this.controller.observableState.graph;
    const { selection } = this.localController.observableState;
    const nodePositions = new Set(Object.values(nodes).map(n => `${n.x},${n.y}`));

    const cells = [];
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
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

    return html`
      ${cells}
      ${Object.values(nodes).map(node => html`
        <graph-node
          .controller=${this.controller}
          .localController=${this.localController}
          .node=${node}
          style="grid-column: ${node.x + 1}; grid-row: ${node.y + 1};"
          @node-click=${this.handleNodeClick}
        ></graph-node>
      `)}
      ${Object.values(connections).map(conn => {
      const fromNode = nodes[conn.fromNodeId];
      const toNode = nodes[conn.toNodeId];
      if (!fromNode || !toNode) return '';
      return html`
          <graph-connection
            .connection=${conn}
            .from=${{ x: fromNode.x, y: fromNode.y }}
            .to=${{ x: toNode.x, y: toNode.y }}
          ></graph-connection>
        `;
    })}
    `;
  }
}
