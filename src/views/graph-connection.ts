import { MobxLitElement } from '@adobe/lit-mobx/lit-mobx';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { Connection } from '../builder/state';

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

  render() {
    // Calculate port positions
    // Node size 80x80. Center 40,40.
    // Out port (Right): x + 90 (10 margin + 80 width), y + 50 (10 margin + 40 height)
    // In port (Left): x + 10 (10 margin), y + 50 (10 margin + 40 height)

    const startX = this.from.x * 110 + 90;
    const startY = this.from.y * 110 + 50;

    const endX = this.to.x * 110 + 10;
    const endY = this.to.y * 110 + 50;

    let d = '';

    if (endX > startX) {
      // Target is to the right
      const midX = startX + (endX - startX) / 2;
      d = `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${endY} L ${endX} ${endY}`;
    } else {
      // Loop back case (Target is to the left)
      const midX1 = startX + 20; // Go right a bit
      const midY = (startY + endY) / 2; // Go up/down
      // Actually, for loop back, we should go around.
      // Go right, go down/up to clear node, go left, go to target.
      // Let's try a simple channel routing:
      // Right -> Down/Up -> Left -> Target

      // If nodes are close vertically, we might need to go further out.
      // Let's use gaps.

      const gapX1 = startX + 20; // Gap to the right of source
      const gapX2 = endX - 20; // Gap to the left of target

      // If target is above source
      if (endY < startY) {
        const gapY = endY - 60; // Go above target row
        d = `M ${startX} ${startY} L ${gapX1} ${startY} L ${gapX1} ${gapY} L ${gapX2} ${gapY} L ${gapX2} ${endY} L ${endX} ${endY}`;
      } else {
        const gapY = endY + 60; // Go below target row
        d = `M ${startX} ${startY} L ${gapX1} ${startY} L ${gapX1} ${gapY} L ${gapX2} ${gapY} L ${gapX2} ${endY} L ${endX} ${endY}`;
      }
    }

    return html`
      <svg width="100%" height="100%" style="pointer-events: none;">
        <!-- Invisible wide stroke for easier clicking -->
        <path d=${d} stroke="transparent" stroke-width="15" fill="none" style="pointer-events: stroke; cursor: pointer;" @dblclick=${this.handleDblClick} />
        <!-- Visible stroke -->
        <path d=${d} stroke="white" stroke-width="2" fill="none" style="pointer-events: none;" />
      </svg>
    `;
  }
}
