import { MobxLitElement } from './mobx-lit-element';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { localController, appController } from '../builder/controllers';
import { reaction } from 'mobx';
import { PORT_LABEL_PADDING } from '../constants';

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
      height: var(--row-height, 24px);
    }

    .port {
      width: 15px;
      height: 15px;
      background-color: var(--port-color);
      border-radius: 50%;
      cursor: pointer;
      transition: background-color 0.2s, transform 0.2s;
      z-index: 10;
      position: relative; /* Ensure pseudo-element positioning */
    }

    .port::after {
        content: '';
        position: absolute;
        top: -2px;
        left: -4px;
        right: -4px;
        bottom: -6px;
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
      padding: 0 ${PORT_LABEL_PADDING}px;
    }
  `;

  private handlePointerDown(e: PointerEvent) {
    if (e.button !== 0) return; // Left click only
    e.stopPropagation(); // Prevent node drag

    // Start connection or toggle if already active?
    // For drag, we always start a new one if none exists.
    const currentInflightOp = localController.observableState.inflightPortConnectionOperation;
    if (!currentInflightOp) {
       localController.setInflightPortConnectionOperation({
        nodeId: this.nodeId,
        port: this.name,
        type: this.type
      });
      // We don't need to select/watch connection if we rely on global pointer up to cancel.
      // But preserving existing "click-click" behavior is nice.
      // Let's rely on GraphGrid to clear if dropped on nothing.
    }
  }

  private handlePointerUp(e: PointerEvent) {
    e.stopPropagation();
    const currentInflightOp = localController.observableState.inflightPortConnectionOperation;

    if (currentInflightOp) {
       // Check if this is a valid completion
       if (currentInflightOp.nodeId !== this.nodeId && currentInflightOp.type !== this.type) {
         // Complete connection
         const from = currentInflightOp.type === 'out' ? currentInflightOp : { nodeId: this.nodeId, port: this.name, type: this.type };
         const to = currentInflightOp.type === 'in' ? currentInflightOp : { nodeId: this.nodeId, port: this.name, type: this.type };

         appController.createConnection(from.nodeId, from.port, to.nodeId, to.port);
         localController.setInflightPortConnectionOperation(null);
       } else if (currentInflightOp.nodeId === this.nodeId && currentInflightOp.port === this.name) {
         // Released on self.
         // If this was a pure click (no drag), we want to KEEP it open for click-click workflow.
         // If it was a drag loopback, maybe cancel?
         // For now, let's just keep it open.
       }
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
      ${this.type === 'out' && this.name !== '0' && !this.hideLabel ? html`<div class="port-label">${this.name}</div>` : ''}
      <div
        class="port ${this.type}-port ${isConnecting ? 'connecting' : ''}"
        @pointerdown=${this.handlePointerDown}
        @pointerup=${this.handlePointerUp}
        title="${this.description}"
      ></div>
      ${this.type === 'in' && this.name && !this.hideLabel ? html`<div class="port-label">${this.name}</div>` : ''}
    `;
  }
}
