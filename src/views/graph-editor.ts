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
      display: flex;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
    }

    .grid-container {
      flex: 1;
      position: relative;
      overflow: hidden;
    }

    inspector-popup {
      width: 250px;
      position: relative; /* Override absolute positioning from inspector styles if needed, but better to let it be */
      /* Actually, inspector-popup has absolute positioning in its own styles.
         We should probably override it here or rely on it being absolute to the right.
         But since we want a flex layout, we should make inspector-popup behave nicely.
         However, inspector-popup styles set it to absolute top 0 right 0.
         If we want it to be part of the flex flow, we need to override that.
       */
      position: static;
      height: 100%;
      border-left: 1px solid #444;
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
    this.controller.selectNodes([e.detail.nodeId], e.detail.additive);
  }

  render() {
    const { selection, graph } = this.controller.observableState;
    // If multiple nodes are selected, we just show the first one for now, or null if empty
    const selectedNodeId = selection.size === 1 ? selection.values().next().value : null;
    const selectedNode = selectedNodeId ? graph.nodes[selectedNodeId] : null;

    return html`
      <div class="grid-container">
        <graph-grid
          .controller=${this.controller}
          .selectedPort=${this.selectedPort}
          @port-click=${this.handlePortClick}
          @node-click=${this.handleNodeClick}
        ></graph-grid>
      </div>
      <inspector-popup
        .controller=${this.controller}
        .node=${selectedNode}
      ></inspector-popup>
    `;
  }
}
