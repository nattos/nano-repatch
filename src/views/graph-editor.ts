import { MobxLitElement } from './mobx-lit-element';
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { AppController, LocalController } from '../builder/state';
import './graph-grid';
import './inspector-popup';

@customElement('graph-editor')
export class GraphEditor extends MobxLitElement {
  @property({ attribute: false })
  controller = new AppController();

  @property({ attribute: false })
  localController = new LocalController();

  constructor() {
    super();
    // Add some initial nodes for testing
    this.controller.transaction(c => {
      const nodeA = c.createNode('add', 0, 0);
      const nodeB = c.createNode('literal', 1, 1);
      c.createConnection(nodeA.id, 0, nodeB.id, 0);
    });
  }

  static readonly styles = css`
    :host {
      display: block;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      position: relative;
      user-select: none;
    }

    graph-grid {
      width: 100%;
      height: 100%;
    }
  `;

  private handlePortClick(e: CustomEvent<{ nodeId: string, port: string, type: 'in' | 'out' }>) {
    const { nodeId, port, type } = e.detail;
    const currentInflightOp = this.localController.observableState.inflightPortConnectionOperation;

    if (!currentInflightOp) {
      // First click: select the port
      this.localController.setInflightPortConnectionOperation({ nodeId, port, type });
    } else {
      // Second click: try to create a connection
      if (currentInflightOp.nodeId !== nodeId && currentInflightOp.type !== type) {
        const from = currentInflightOp.type === 'out' ? currentInflightOp : { nodeId, port, type };
        const to = currentInflightOp.type === 'in' ? currentInflightOp : { nodeId, port, type };

        this.controller.createConnection(from.nodeId, from.port, to.nodeId, to.port);
      }
      // Reset selection
      this.localController.setInflightPortConnectionOperation(null);
    }
  }

  private handleNodeClick(e: CustomEvent<{ nodeId: string, additive: boolean }>) {
    this.localController.queueSelectPaths([e.detail.nodeId], e.detail.additive);
  }

  render() {
    return html`
      <graph-grid
        .controller=${this.controller}
        .localController=${this.localController}
        @port-click=${this.handlePortClick}
        @node-click=${this.handleNodeClick}
      ></graph-grid>
      <inspector-popup
        .controller=${this.controller}
        .localController=${this.localController}
      ></inspector-popup>
    `;
  }
}
