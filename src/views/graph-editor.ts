import { MobxLitElement } from '@adobe/lit-mobx/lit-mobx';
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { AppController, LocalController } from '../builder/state';
import './graph-grid';
import './inspector-popup';

interface PortClickEvent {
  nodeId: string;
  port: string;
  type: 'in' | 'out';
}

@customElement('graph-editor')
export class GraphEditor extends MobxLitElement {
  @property({ attribute: false })
  controller = new AppController();

  @property({ attribute: false })
  localController = new LocalController();

  @state()
  selectedPort: { nodeId: string, port: string, type: 'in' | 'out' } | null = null;

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
    }

    graph-grid {
      width: 100%;
      height: 100%;
    }
  `;

  private handlePortClick(e: CustomEvent<{ nodeId: string, port: string, type: 'in' | 'out' }>) {
    const { nodeId, port, type } = e.detail;

    if (!this.selectedPort) {
      // First click: select the port
      this.selectedPort = { nodeId, port, type };
    } else {
      // Second click: try to create a connection
      if (this.selectedPort.nodeId !== nodeId && this.selectedPort.type !== type) {
        const from = this.selectedPort.type === 'out' ? this.selectedPort : { nodeId, port, type };
        const to = this.selectedPort.type === 'in' ? this.selectedPort : { nodeId, port, type };

        this.controller.createConnection(from.nodeId, from.port, to.nodeId, to.port);
      }
      // Reset selection
      this.selectedPort = null;
    }
  }

  private handleNodeClick(e: CustomEvent<{ nodeId: string, additive: boolean }>) {
    this.localController.selectNodes([e.detail.nodeId], e.detail.additive);
  }

  render() {
    const { graph } = this.controller.observableState;
    const { selection } = this.localController.observableState;
    // If multiple nodes are selected, we just show the first one for now, or null if empty
    const selectedNodeId = selection.size === 1 ? selection.values().next().value : null;
    const selectedNode = selectedNodeId ? graph.nodes[selectedNodeId] : null;

    return html`
      <graph-grid
        .controller=${this.controller}
        .localController=${this.localController}
        .selectedPort=${this.selectedPort}
        @port-click=${this.handlePortClick}
        @node-click=${this.handleNodeClick}
      ></graph-grid>
      <inspector-popup
        .controller=${this.controller}
        .node=${selectedNode}
      ></inspector-popup>
    `;
  }
}
