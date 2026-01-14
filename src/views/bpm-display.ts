
import { MobxLitElement } from './mobx-lit-element';
import { html, css } from 'lit';
import { customElement } from 'lit/decorators.js';
import { runtimeManager } from '../builder/controllers';

@customElement('bpm-display')
export class BpmDisplay extends MobxLitElement {
  static styles = css`
    :host {
      display: block;
    }

    .bpm-display {
      font-size: 9px;
      color: var(--accent-color);
      /* background: rgba(255, 255, 255, 0.1); */
      border: 1px solid var(--accent-color);
      border-radius: 4px;
      padding: 2px 0;
      width: 32px;
      text-align: center;
      margin-top: -6px;
      margin-bottom: 10px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: clip;
      cursor: default;
      font-family: 'JetBrains Mono', monospace;
    }
  `;

  render() {
    if (!runtimeManager.beatSyncManager.isMicActive) {
      return null;
    }

    return html`
      <div class="bpm-display" title="Detected BPM">
          ${runtimeManager.beatSyncManager.bestBpm.toFixed(1)}
      </div>
    `;
  }
}
