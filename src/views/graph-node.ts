import { MobxLitElement } from '@adobe/lit-mobx/lit-mobx';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { GridNode, AppController } from '../builder/state';
import { PointerDragOp } from '../utils/pointer-drag-op';

@customElement('graph-node')
export class GraphNode extends MobxLitElement {
  @property({ attribute: false })
  node!: GridNode;

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
    }

    .port {
      position: absolute;
      width: 20px;
      height: 20px;
      background-color: #555;
      border-radius: 50%;
      cursor: pointer;
    }

    .in-port {
      top: -10px;
      left: 30px;
    }

    .out-port {
      bottom: -10px;
      left: 30px;
    }
  `;

  private handlePointerDown(e: PointerEvent) {
    new PointerDragOp(e, this, {
      move: (e, delta) => {
        this.style.transform = `translate(${delta[0]}px, ${delta[1]}px)`;
      },
      accept: (e, delta) => {
        const dx = Math.round(delta[0] / 110);
        const dy = Math.round(delta[1] / 110);
        this.controller.moveNodes([this.node.id], dx, dy);
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

private handleClick() {
    this.dispatchEvent(new CustomEvent('node-click', {
      detail: {
        nodeId: this.node.id,
      },
      bubbles: true,
      composed: true,
    }));
  }

  render() {
    return html`
      <div class="port in-port" data-port="0" data-type="in" @click=${this.handlePortClick}></div>
      <div @pointerdown=${this.handlePointerDown} @click=${this.handleClick}>${this.node.config.typeId}</div>
      <div class="port out-port" data-port="0" data-type="out" @click=${this.handlePortClick}></div>
    `;
  }
}
