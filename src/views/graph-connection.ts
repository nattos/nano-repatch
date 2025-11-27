import { MobxLitElement } from './mobx-lit-element';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { Connection } from '../builder/state';
import { appController, localController } from '../builder/controllers';
import { cssColorFromHash } from '../utils/layout-utils';

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
    const wireLayout = localController.observableState.wireLayout.wires[this.connection.id];
    let d = '';

    if (wireLayout && wireLayout.path.length > 0) {
      // Convert grid points to pixel coordinates
      // Grid cell size = 100, gap = 10. Total pitch = 110.
      // Node is at x*110, y*110.
      // Ports are inside the node.
      // The layout engine gives us a path of grid cells.
      // We need to draw lines between the centers of these cells, but offset by lane.

      const points = wireLayout.path.map((p, i) => {
        // Skip the first and last points (node centers)
        // We want to draw from Port -> Neighbor -> ... -> Neighbor -> Port
        if (i === 0 || i === wireLayout.path.length - 1) {
          return null;
        }

        let x = p.x * 110 + 10; // Center of cell
        let y = p.y * 110 + 55;

        // Apply lane offset if we have a next point (defining a segment)
        if (i < wireLayout.path.length - 1) {
          const next = wireLayout.path[i + 1];
          // Determine segment key
          const k1 = `${p.x},${p.y}`;
          const k2 = `${next.x},${next.y}`;
          const key = k1 < k2 ? `${k1}:${k2}` : `${k2}:${k1}`;

          const lane = wireLayout.lanes[key];
          if (lane) {
            // Offset perpendicular to the segment
            const spacing = 10; // Pixels between wires
            const totalWidth = (lane.count - 1) * spacing;
            const offset = lane.index * spacing - totalWidth / 2;

            if (p.x !== next.x) {
              // Horizontal segment, offset y
              y += offset;
            } else {
              // Vertical segment, offset x
              x += offset;
            }
          }
        } else if (i > 0) {
          // For the last point (which we are skipping anyway, but logic remains for intermediate points),
          // use the lane of the previous segment to align
          const prev = wireLayout.path[i - 1];
          const k1 = `${prev.x},${prev.y}`;
          const k2 = `${p.x},${p.y}`;
          const key = k1 < k2 ? `${k1}:${k2}` : `${k2}:${k1}`;
          const lane = wireLayout.lanes[key];
          if (lane) {
            const spacing = 10;
            const totalWidth = (lane.count - 1) * spacing;
            const offset = lane.index * spacing - totalWidth / 2;
            if (prev.x !== p.x) {
              y += offset;
            } else {
              x += offset;
            }
          }
        }
        return { x, y };
      }).filter(p => p !== null) as { x: number, y: number }[];

      // Construct SVG path
      // Start at actual port position (this.from)
      const startX = this.from.x * 110;
      const startY = this.from.y * 110;
      const endX = this.to.x * 110;
      const endY = this.to.y * 110;

      d = `M ${startX} ${startY}`;

      // Connect start port to first path point
      if (points.length > 0) {
        d += ` L ${points[0].x} ${points[0].y}`;
        for (let i = 1; i < points.length; i++) {
          d += ` L ${points[i].x} ${points[i].y}`;
        }
        // Connect last path point to end port
        d += ` L ${endX} ${endY}`;
      } else {
        d += ` L ${endX} ${endY}`;
      }

    } else {
      // Fallback to simple elbow
      const startX = this.from.x * 110;
      const startY = this.from.y * 110;
      const endX = this.to.x * 110;
      const endY = this.to.y * 110;

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
    }

    const isSelected = localController.observableState.selection.has(this.connection.id);
    const color = cssColorFromHash(`${this.connection.fromPort}-${this.connection.toPort}`);
    this.toggleAttribute('selected', isSelected);

    localController.defineSelectable({
      path: this.connection.id,
      renderInspectorContent: () => this.renderInspectorContent()
    });

    return html`
      <svg class="connection ${isSelected ? 'selected' : ''}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible;">
        <path
          d="${d}"
          stroke="${isSelected ? '#fff' : color}"
          stroke-width="${isSelected ? 4 : 2}"
          fill="none"
          pointer-events="stroke"
          @click=${this.handleClick}
          @dblclick=${this.handleDblClick}
        />
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
