import { MobxLitElement } from '@adobe/lit-mobx/lit-mobx';
import { css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { AppController } from '../builder/state';
import './graph-grid';
import './graph-node';
import './inspector-popup';

interface PortClickEvent {
  nodeId: string;
  port: string;
  type: 'in' | 'out';
}

@customElement('graph-editor')
export class GraphEditor extends MobxLitElement {
  @state()
  private controller = new AppController();

  @state()
  private selectedPort: PortClickEvent | null = null;

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
      width: 100%;
      height: 100%;
    }
  `;

  private handlePortClick(e: CustomEvent<PortClickEvent>) {
    const { detail } = e;
    if (this.selectedPort) {
      if (this.selectedPort.type === 'out' && detail.type === 'in') {
        this.controller.createConnection(this.selectedPort.nodeId, this.selectedPort.port, detail.nodeId, detail.port);
      } else if (this.selectedPort.type === 'in' && detail.type === 'out') {
        this.controller.createConnection(detail.nodeId, detail.port, this.selectedPort.nodeId, this.selectedPort.port);
      }
      this.selectedPort = null;
    } else {
      this.selectedPort = detail;
    }
  }

  private handleNodeClick(e: CustomEvent<{ nodeId: string, additive: boolean }>) {
    this.controller.selectNodes([e.detail.nodeId], e.detail.additive);
  }

  render() {
    const selectedNodeId = this.controller.observableState.selection.values().next().value;
    const selectedNode = selectedNodeId ? this.controller.observableState.graph.nodes[selectedNodeId] : null;

    return html`
      <graph-grid
        .controller=${this.controller}
        .selectedPort=${this.selectedPort}
        @port-click=${this.handlePortClick}
        @node-click=${this.handleNodeClick}
      ></graph-grid>
      <inspector-popup
        .controller=${this.controller}
        .node=${selectedNode}
        ?active=${selectedNode}
      ></inspector-popup>
    `;
  }
}
