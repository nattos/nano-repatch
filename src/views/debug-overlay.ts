import { css, html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { MobxLitElement } from '@adobe/lit-mobx';
import { runtimeManager } from '../runtime/manager';
import { appController } from '../builder/controllers';
import { GridNode } from '../builder/state';

@customElement('debug-overlay')
export class DebugOverlay extends MobxLitElement {
  static styles = css`
    :host {
      position: absolute;
      bottom: 10px;
      left: 10px;
      background: rgba(0, 0, 0, 0.8);
      color: #0f0;
      font-family: monospace;
      padding: 10px;
      border-radius: 4px;
      pointer-events: none;
      max-height: 300px;
      overflow-y: auto;
      z-index: 1000;
      font-size: 12px;
      width: 300px;
    }

    h3 {
      margin: 0 0 5px 0;
      font-size: 14px;
      border-bottom: 1px solid #333;
      padding-bottom: 5px;
    }

    .stats {
      margin-bottom: 10px;
      color: #fff;
    }

    .output-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .output-item {
      display: flex;
      justify-content: space-between;
    }

    .node-id {
      color: #888;
      margin-right: 10px;
    }

    .node-value {
      color: #0f0;
      white-space: pre-wrap;
      word-break: break-all;
    }
  `;

  render() {
    const { outputs, stats } = runtimeManager;

    return html`
      <h3>Debug Overlay</h3>
      <div class="stats">
        Nodes Executed: ${stats.nodeCount}
      </div>
      <div class="output-list">
        ${Array.from(outputs.entries()).map(([id, value]) => this.renderOutput(id, value))}
      </div>
    `;
  }

  private renderOutput(id: string, value: any) {
    const node: GridNode | undefined = appController.observableState.graph.inner.nodes[id];
    // Format value for display
    let displayName = node?.config?.name ?? id;
    let displayValue = '';
    try {
      // If it's a StructorRecord, show untagged[0] or fields
      if (value && typeof value === 'object') {
        if (Array.isArray(value.untagged) && value.untagged.length > 0) {
          displayValue = JSON.stringify(value.untagged[0]);
        } else if (value.fields && Object.keys(value.fields).length > 0) {
          displayValue = JSON.stringify(value.fields);
        } else {
          displayValue = JSON.stringify(value);
        }
      } else {
        displayValue = String(value);
      }
    } catch (e) {
      displayValue = '[Error formatting value]';
    }

    return html`
      <div class="output-item">
        <span class="node-id">${displayName}</span>
        <span class="node-value">${displayValue}</span>
      </div>
    `;
  }
}
