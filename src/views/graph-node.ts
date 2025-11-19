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

  render() {
    return html`
      <div @pointerdown=${this.handlePointerDown}>${this.node.config.typeId}</div>
    `;
  }
}
