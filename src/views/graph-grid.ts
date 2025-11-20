import { MobxLitElement } from '@adobe/lit-mobx/lit-mobx';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { AppController } from '../builder/state';
import './graph-connection';

@customElement('graph-grid')
export class GraphGrid extends MobxLitElement {
  @property({ attribute: false })
  controller!: AppController;

  static readonly styles = css`
    :host {
      display: grid;
      grid-template-columns: repeat(auto-fill, 100px);
      grid-template-rows: repeat(auto-fill, 100px);
      width: 100%;
      height: 100%;
      gap: 10px;
      position: relative;
    }

    .cell {
      border: 1px dashed #555;
    }
  `;

  private handleDblClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.classList.contains('cell')) {
      const x = parseInt(target.dataset.x || '0');
      const y = parseInt(target.dataset.y || '0');
      this.controller.createNode('literal', x, y);
    }
  }

  private handleNodeClick(e: CustomEvent<{ nodeId: string }>) {
    this.dispatchEvent(new CustomEvent('node-click', {
      detail: {
        nodeId: e.detail.nodeId,
        additive: (e.composedPath()[0] as HTMLElement).closest('graph-node')!.shadowRoot!.querySelector('div')!.matches(':active'),
      },
      bubbles: true,
      composed: true,
    }));
  }

  render() {
    const { nodes, connections } = this.controller.observableState.graph;
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
              @dblclick=${this.handleDblClick}
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
