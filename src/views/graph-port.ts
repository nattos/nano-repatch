import { MobxLitElement } from './mobx-lit-element';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { localController, appController } from '../builder/controllers';
import { reaction } from 'mobx';

@customElement('graph-port')
export class GraphPort extends MobxLitElement {
  @property({ type: String })
  nodeId!: string;

  @property({ type: String, reflect: true })
  name!: string;

  @property({ type: String, reflect: true })
  type!: 'in' | 'out';

  @property({ type: String })
  description: string = '';

  static readonly styles = css`
    :host {
      display: flex;
      align-items: center;
      height: 20px;
    }

    .port {
      width: 15px;
      height: 15px;
      background-color: var(--port-color);
      border-radius: 50%;
      cursor: pointer;
      transition: background-color 0.2s, transform 0.2s;
      z-index: 10;
    }

    .port:hover {
      background-color: var(--port-hover);
      transform: scale(1.2);
    }

    .port.connecting {
      background-color: var(--port-connected);
      box-shadow: 0 0 5px var(--port-connected);
    }

    .port-label {
      font-size: 0.7em;
      white-space: nowrap;
      color: var(--text-muted);
      margin: 0 5px;
    }
  `;

  private handlePortClick(e: MouseEvent) {
    e.stopPropagation(); // Prevent node drag/selection

    const currentInflightOp = localController.observableState.inflightPortConnectionOperation;

    if (!currentInflightOp) {
      // Start connection
      localController.setInflightPortConnectionOperation({
        nodeId: this.nodeId,
        port: this.name,
        type: this.type
      });

      // Select the port to allow cancellation
      const portPath = `port://${this.nodeId}/${this.type}/${this.name}`;
      const handle = localController.defineSelectable({
        path: portPath,
      });
      handle.select();

      // Watch for deselection to cancel
      const disposer = reaction(
        () => localController.observableState.selection.has(portPath),
        (isSelected) => {
          if (!isSelected) {
            const current = localController.observableState.inflightPortConnectionOperation;
            if (current && current.nodeId === this.nodeId && current.port === this.name && current.type === this.type) {
              localController.setInflightPortConnectionOperation(null);
            }
            disposer();
          }
        }
      );

    } else {
      // Complete connection
      if (currentInflightOp.nodeId !== this.nodeId && currentInflightOp.type !== this.type) {
        const from = currentInflightOp.type === 'out' ? currentInflightOp : { nodeId: this.nodeId, port: this.name, type: this.type };
        const to = currentInflightOp.type === 'in' ? currentInflightOp : { nodeId: this.nodeId, port: this.name, type: this.type };

        appController.createConnection(from.nodeId, from.port, to.nodeId, to.port);
      }
      localController.setInflightPortConnectionOperation(null);
      localController.queueSelectPaths([]);
    }
  }

  @property({ type: Boolean })
  hideLabel = false;

  // ... (styles)

  render() {
    const { inflightPortConnectionOperation } = localController.observableState;

    const isConnecting = inflightPortConnectionOperation?.type === this.type &&
      inflightPortConnectionOperation?.port === this.name &&
      inflightPortConnectionOperation?.nodeId === this.nodeId;

    return html`
      ${this.type === 'out' && this.name !== '0' && !this.hideLabel ? html`<span class="port-label">${this.name}</span>` : ''}
      <div
        class="port ${this.type}-port ${isConnecting ? 'connecting' : ''}"
        @click=${this.handlePortClick}
        title="${this.description}"
      ></div>
      ${this.type === 'in' && this.name && !this.hideLabel ? html`<span class="port-label">${this.name}</span>` : ''}
    `;
  }
}
