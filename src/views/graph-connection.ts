import { LitElement, html, css, svg } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { Connection } from '../builder/state';

@customElement('graph-connection')
export class GraphConnection extends LitElement {
  static styles = css`
    :host {
      display: contents; /* Allow SVG to be part of grid or overlay? */
      /* Actually, wires are usually overlay. If they are in grid cells, that's diff. */
      /* But my new layout uses absolute pixel coords? */
      /* No, the GridCoordinationSystem returns pixels. */
      /* So we should render an SVG overlay for all wires, OR individual SVGs? */
      /* Individual SVGs might be heavy if many. */
      /* A single SVG overlay is better for performance. */
    }
  `;

  @property({ type: Object })
  connection?: Connection;

  @property({ type: String })
  pathData: string = '';

  @property({ type: Boolean })
  selected: boolean = false;

  render() {
    // If we use individual SVGs, we need absolute positioning.
    // If we use a shared SVG in GraphGrid, this component might just render the <path>?
    // But Render method returns TemplateResult.
    // If this element is in the DOM, it needs to be an SVG element or contain one.

    // Let's assume GraphGrid renders a SINGLE <svg> overlay for all connections,
    // AND we use a heavier component for interaction?
    // Or we stick to the component-per-wire model?

    // Component-per-wire with absolute positioning SVG:
    // <graph-connection style="position: absolute; top:0; left:0; width:100%; height:100%; pointer-events: none;">
    //    <svg ...><path ... pointer-events="stroke" /></svg>
    // </graph-connection>

    // This stacks many SVGs. Browsers can handle it but it's not ideal z-index wise vs nodes.
    // Nodes are z-index 10. Wires z-index 5.

    return html`
      <svg style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none;">
        <path
          d="${this.pathData}"
          fill="none"
          stroke="${this.selected ? '#fff' : 'var(--wire-color, #888)'}"
          stroke-width="${this.selected ? 4 : 2}"
          style="pointer-events: stroke; cursor: pointer; transition: stroke 0.2s;"
        />
        <!-- Hit area -->
        <path
          d="${this.pathData}"
          fill="none"
          stroke="transparent"
          stroke-width="12"
          style="pointer-events: stroke; cursor: pointer;"
        />
      </svg>
    `;
  }
}
