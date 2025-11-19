import { MobxLitElement } from '@adobe/lit-mobx/lit-mobx';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { AppController } from '../builder/state';

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

  render() {
    const { nodes } = this.controller.observableState.graph;
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
        ></graph-node>
      `)}
    `;
  }
}
