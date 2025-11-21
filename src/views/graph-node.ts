import { MobxLitElement } from '@adobe/lit-mobx/lit-mobx';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { GridNode, AppController } from '../builder/state';
import { PointerDragOp } from '../utils/pointer-drag-op';

@customElement('graph-node')
export class GraphNode extends MobxLitElement {
  @property({ attribute: false })
  node!: GridNode;

  @property({ type: Boolean, reflect: true })
  selected = false;

  @property({ attribute: false })
  connectingPort: { port: string, type: 'in' | 'out' } | null = null;

  @property({ attribute: false })
  controller!: AppController;

  static readonly styles = css`
    :host {
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: #333;
      border-radius: 50%;
      width: 80px;
      height: 80px;
      color: white;
      cursor: grab;
      position: relative;
      border: 2px solid transparent;
      transition: border-color 0.2s;
    }

    :host([selected]) {
      border-color: #00aaff;
      box-shadow: 0 0 10px rgba(0, 170, 255, 0.5);
    }

    .port {
      position: absolute;
      width: 20px;
      height: 20px;
      background-color: #555;
      border-radius: 50%;
      cursor: pointer;
      transition: background-color 0.2s, transform 0.2s;
    }

    .port:hover {
      background-color: #777;
      transform: scale(1.2);
    }

    .port.connecting {
      background-color: #00ff00;
      box-shadow: 0 0 5px #00ff00;
    }

    .in-port {
      top: 30px;
      left: -10px;
    }

    .out-port {
      top: 30px;
      right: -10px;
    }
  `;

  private handlePointerDown(e: PointerEvent) {
    // Ignore if clicking on a port
    if ((e.target as HTMLElement).classList.contains('port')) {
      return;
    }

    // If the node is not selected, select it (replacing current selection)
    // This mimics standard behavior where dragging an unselected item selects it.
    if (!this.controller.observableState.selection.has(this.node.id)) {
      this.controller.selectNodes([this.node.id], e.shiftKey || e.ctrlKey || e.metaKey);
    }

    new PointerDragOp(e, this, {
      move: (e, delta) => {
        // Visual feedback for the dragged node
        this.style.transform = `translate(${delta[0]}px, ${delta[1]}px)`;
        // TODO: We should ideally show visual feedback for ALL selected nodes,
        // but for now we just show it for the one being dragged.
      },
      accept: (e, delta) => {
        const dx = Math.round(delta[0] / 110);
        const dy = Math.round(delta[1] / 110);

        // Move all selected nodes
        const nodesToMove = Array.from(this.controller.observableState.selection);
        this.controller.moveNodes(nodesToMove, dx, dy);

        this.style.transform = '';
      },
      cancel: () => {
        this.style.transform = '';
      },
    });
  }

  private handlePortClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    const port = target.dataset.port;
    const type = target.dataset.type;
    this.dispatchEvent(new CustomEvent('port-click', {
      detail: {
        nodeId: this.node.id,
        port,
        type,
      },
      bubbles: true,
      composed: true,
    }));
  }

  private handleClick(e: MouseEvent) {
    this.dispatchEvent(new CustomEvent('node-click', {
      detail: {
        nodeId: this.node.id,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
      },
      bubbles: true,
      composed: true,
    }));
  }

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('pointerdown', this.handlePointerDown);
    this.addEventListener('click', this.handleClick as EventListener);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('pointerdown', this.handlePointerDown);
    this.removeEventListener('click', this.handleClick as EventListener);
  }

  render() {
    const isConnectingIn = this.connectingPort?.type === 'in' && this.connectingPort?.port === '0';
    const isConnectingOut = this.connectingPort?.type === 'out' && this.connectingPort?.port === '0';

    return html`
      <div
        class="port in-port ${isConnectingIn ? 'connecting' : ''}"
        data-port="0"
        data-type="in"
        @click=${this.handlePortClick}
      ></div>
      <div>${this.node.config.typeId}</div>
      <div
        class="port out-port ${isConnectingOut ? 'connecting' : ''}"
        data-port="0"
        data-type="out"
        @click=${this.handlePortClick}
      ></div>
    `;
  }
}
