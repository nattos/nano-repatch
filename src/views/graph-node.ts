import { MobxLitElement } from './mobx-lit-element';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { GridNode, AppController, LocalController } from '../builder/state';
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

  @property({ attribute: false })
  localController!: LocalController;

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
    if (!this.localController.observableState.selection.has(this.node.id)) {
      this.localController.queueSelectPaths([this.node.id], e.shiftKey || e.ctrlKey || e.metaKey);
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
        // We need to filter selection to only include nodes (since selection can contain anything)
        // But for now, we assume all selected items are nodes if we are dragging a node.
        // Or we can check if the ID starts with 'node-'
        const nodesToMove = Array.from(this.localController.observableState.selection.keys())
          .filter(id => id.startsWith('node-'));

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

  private handleTypeChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    this.controller.setNodeConfig(this.node.id, { typeId: target.value });
  }

  private handleValueChange(e: Event) {
    const target = e.target as HTMLInputElement;
    this.controller.setNodeConfig(this.node.id, { value: target.value });
  }

  renderInspectorContent() {
    return html`
      <h3>Inspector</h3>
      <div class="field">
        <label>Type:</label>
        <select .value=${this.node.config.typeId} @change=${this.handleTypeChange.bind(this)}>
          <option value="add">Add</option>
          <option value="literal">Literal</option>
          <option value="clamp">Clamp</option>
          <option value="apply">Apply</option>
        </select>
      </div>
      ${this.node.config.typeId === 'literal' ? html`
        <div class="field">
          <label>Value:</label>
          <input
            type="text"
            .value=${this.node.config.value || ''}
            @input=${this.handleValueChange.bind(this)}
          />
        </div>
      ` : ''}
    `;
  }

  render() {
    const isConnectingIn = this.connectingPort?.type === 'in' && this.connectingPort?.port === '0';
    const isConnectingOut = this.connectingPort?.type === 'out' && this.connectingPort?.port === '0';

    this.localController.defineSelectable({
      path: this.node.id,
      renderInspectorContent: () => this.renderInspectorContent()
    });

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
