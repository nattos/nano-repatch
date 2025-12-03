import { html, css, svg, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('scope-widget')
export class ScopeWidget extends LitElement {
  @property({ type: Number }) value = 0;
  @property({ type: Number }) min = -1;
  @property({ type: Number }) max = 1;
  @property({ type: Number }) historySize = 100;

  private history: number[] = [];

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      background: #222;
      border-radius: 4px;
      overflow: hidden;
      position: relative;
    }
    svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    path {
      fill: none;
      stroke: #00ff88;
      stroke-width: 2;
      vector-effect: non-scaling-stroke;
    }
    .grid {
      stroke: rgba(255, 255, 255, 0.1);
      stroke-width: 1;
    }
    .zero-line {
      stroke: rgba(255, 255, 255, 0.3);
      stroke-width: 1;
      stroke-dasharray: 4 4;
    }
  `;

  updated(changedProperties: Map<string, any>) {
    if (changedProperties.has('value')) {
      this.history.push(this.value);
      if (this.history.length > this.historySize) {
        this.history.shift();
      }
      // Force re-render if only value changed (Lit might optimize away if we mutate history)
      // But we are pushing to history, which is not a property.
      // However, 'value' property change triggers update, and render() uses history.
    }
  }

  render() {
    const width = 100; // SVG coordinate space
    const height = 100;

    // Normalize values to 0-100 range
    // y = height - ((val - min) / (max - min)) * height
    const normalizeY = (val: number) => {
      const normalized = (val - this.min) / (this.max - this.min);
      return height - (Math.max(0, Math.min(1, normalized)) * height);
    };

    const points = this.history.map((val, i) => {
      const x = (i / (this.historySize - 1)) * width;
      const y = normalizeY(val);
      return `${x},${y}`;
    });

    const pathData = points.length > 0 ? `M ${points.join(' L ')}` : '';
    const zeroY = normalizeY(0);

    return html`
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <line class="zero-line" x1="0" y1="${zeroY}" x2="100" y2="${zeroY}" />
        <path d="${pathData}" />
      </svg>
    `;
  }
}
