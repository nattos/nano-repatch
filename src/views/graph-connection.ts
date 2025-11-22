import { MobxLitElement } from './mobx-lit-element';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { Connection } from '../builder/state';
import { appController, localController } from '../builder/controllers';

@customElement('graph-connection')
export class GraphConnection extends MobxLitElement {
  @property({ attribute: false })
  connection!: Connection;

  @property({ attribute: false })
  from!: { x: number, y: number };

  @property({ attribute: false })
  to!: { x: number, y: number };

  static readonly styles = css`
    :host {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }

    path {
      transition: stroke 0.2s;
    }

    :host([selected]) path.visible-path {
      stroke: #00aaff;
      stroke-width: 4px;
    }
  `;

  private handleDblClick(e: MouseEvent) {
    e.stopPropagation(); // Prevent grid from catching this
    this.dispatchEvent(new CustomEvent('connection-delete', {
      detail: {
        connectionId: this.connection.id,
      },
      bubbles: true,
      composed: true,
    }));
  }

  private handleClick(e: MouseEvent) {
    e.stopPropagation();
    localController.queueSelectPaths([this.connection.id], e.shiftKey || e.ctrlKey || e.metaKey);
  }

  render() {
    const startX = this.from.x * 110 + 90;
    const startY = this.from.y * 110 + 50;

    const endX = this.to.x * 110 + 10;
    const endY = this.to.y * 110 + 50;

    let d = '';

    if (endX > startX) {
      const midX = startX + (endX - startX) / 2;
      d = `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${endY} L ${endX} ${endY}`;
    } else {
      const gapX1 = startX + 20;
      const gapX2 = endX - 20;
      if (endY < startY) {
        const gapY = endY - 60;
        d = `M ${startX} ${startY} L ${gapX1} ${startY} L ${gapX1} ${gapY} L ${gapX2} ${gapY} L ${gapX2} ${endY} L ${endX} ${endY}`;
      } else {
        const gapY = endY + 60;
        d = `M ${startX} ${startY} L ${gapX1} ${startY} L ${gapX1} ${gapY} L ${gapX2} ${gapY} L ${gapX2} ${endY} L ${endX} ${endY}`;
      }
    }

    const isSelected = localController.observableState.selection.has(this.connection.id);
    this.toggleAttribute('selected', isSelected);

    localController.defineSelectable({
      path: this.connection.id,
      renderInspectorContent: () => this.renderInspectorContent()
    });

    return html`
      <svg width="100%" height="100%" style="pointer-events: none;">
        <!-- Invisible wide stroke for easier clicking -->
        <path d=${d} stroke="transparent" stroke-width="15" fill="none" style="pointer-events: stroke; cursor: pointer;" @dblclick=${this.handleDblClick} @click=${this.handleClick} />
        <!-- Visible stroke -->
        <path class="visible-path" d=${d} stroke="white" stroke-width="2" fill="none" style="pointer-events: none;" />
      </svg>
    `;
  }

  private handlePortChange(e: Event, port: 'fromPort' | 'toPort') {
    const target = e.target as HTMLInputElement;
    appController.setConnectionPorts(this.connection.id, { [port]: target.value });
  }

  private renderInspectorContent() {
    return html`
      <h3>Connection</h3>
      <div class="field">
        <label>From Port:</label>
        <input
          type="text"
          .value=${this.connection.fromPort.toString()}
          @input=${(e: Event) => this.handlePortChange(e, 'fromPort')}
          data-testid="from-port-input"
        />
      </div>
      <div class="field">
        <label>To Port:</label>
        <input
          type="text"
          .value=${this.connection.toPort.toString()}
          @input=${(e: Event) => this.handlePortChange(e, 'toPort')}
          data-testid="to-port-input"
        />
      </div>
    `;
  }
}
