import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { MobxLitElement } from './mobx-lit-element';
import { RuntimeManager } from '../runtime/manager';
import { globalStyles } from '../styles';

@customElement('debug-overlay')
export class DebugOverlay extends MobxLitElement {
  @property({ attribute: false })
  manager!: RuntimeManager;

  static styles = [
    globalStyles,
    css`
      :host {
        position: fixed;
        bottom: 10px;
        left: 10px;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 10px;
        border-radius: 5px;
        font-family: monospace;
        font-size: 12px;
        z-index: 1000;
        max-width: 300px;
        max-height: 400px;
        display: flex;
        flex-direction: column;
      }
      .stats {
        margin-bottom: 10px;
        flex-shrink: 0;
      }
      .outputs {
        overflow-y: auto;
        flex-grow: 1;
      }
      .output-item {
        white-space: pre-wrap;
      }
    `,
  ];

  render() {
    if (!this.manager) {
      return html``;
    }

    const stats = this.manager.stats;
    const outputs = Array.from(this.manager.outputs.entries());

    return html`
      <div class="stats">
        <div>
          Last Update: ${stats.nodeCount} nodes executed in
          ${stats.executionTime.toFixed(2)}ms
        </div>
      </div>
      <div class="outputs">
        ${outputs.map(
          ([id, value]) =>
            html`<div class="output-item">[${id}] ${String(value)}</div>`
        )}
      </div>
    `;
  }
}