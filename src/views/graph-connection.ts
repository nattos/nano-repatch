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

  render() {
    const x1 = this.from.x * 110 + 50;
    const y1 = this.from.y * 110 + 50;
    const x2 = this.to.x * 110 + 50;
    const y2 = this.to.y * 110 + 50;

    return html`
      <svg width="100%" height="100%">
        <line x1=${x1} y1=${y1} x2=${x2} y2=${y2} stroke="white" />
      </svg>
    `;
  }
}
