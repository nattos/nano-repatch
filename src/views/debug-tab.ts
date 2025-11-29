import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { MobxLitElement } from './mobx-lit-element';
import { RuntimeManager } from '../runtime/manager';
import { AppController } from '../builder/state';
import { appController, runtimeManager } from '../builder/controllers';
import { globalStyles } from '../styles';

@customElement('debug-tab')
export class DebugTab extends MobxLitElement {
  static styles = [
    globalStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        background-color: #252526;
        color: #ccc;
        font-family: 'Inter', sans-serif;
        overflow: hidden;
      }

      .header {
        padding: 10px;
        background-color: #2d2d2d;
        border-bottom: 1px solid #3d3d3d;
        font-size: 12px;
        font-weight: 600;
        color: #aaa;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .stats {
        padding: 10px;
        font-size: 12px;
        color: #888;
        border-bottom: 1px solid #3d3d3d;
      }

      .output-list {
        flex: 1;
        overflow-y: auto;
        padding: 10px;
      }

      .node-item {
        margin-bottom: 12px;
        padding-bottom: 12px;
        border-bottom: 1px solid #333;
      }

      .node-item:last-child {
        border-bottom: none;
      }

      .node-header {
        display: flex;
        align-items: center;
        margin-bottom: 6px;
      }

      .node-name {
        font-weight: 600;
        color: #eee;
        font-size: 13px;
        margin-right: 8px;
      }

      .node-type {
        font-size: 11px;
        color: #666;
        background: #1e1e1e;
        padding: 2px 6px;
        border-radius: 4px;
      }

      .value-row {
        display: flex;
        align-items: center;
        margin-top: 4px;
        font-size: 12px;
      }

      .field-name {
        color: #888;
        margin-right: 6px;
        min-width: 40px;
      }

      .chip {
        display: inline-flex;
        align-items: center;
        background: #333;
        color: #ddd;
        padding: 2px 8px;
        border-radius: 12px;
        font-family: 'JetBrains Mono', monospace;
        font-size: 11px;
        border: 1px solid #444;
      }

      .chip.vector {
        background: #2a3f4a;
        color: #8dc1e3;
        border-color: #3a5f7a;
      }

      .chip.struct {
        background: #3a2a4a;
        color: #c18de3;
        border-color: #5f3a7a;
      }
    `,
  ];

  render() {
    const stats = runtimeManager.stats;
    const outputs = Array.from(runtimeManager.outputs.entries());

    return html`
      <div class="header">Debug Output</div>
      <div class="stats">
        Last Update: ${stats.nodeCount} nodes in ${stats.executionTime.toFixed(2)}ms
      </div>
      <div class="output-list">
        ${outputs.map(([id, value]) => this.renderNodeOutput(id, value))}
      </div>
    `;
  }

  private renderNodeOutput(id: string, output: any) {
    // Resolve node name via AppController
    // Note: ID might have suffixes like "-virtual-value"
    let nodeId = id;
    let suffix = '';

    if (id.endsWith('-virtual-value')) {
      nodeId = id.replace('-virtual-value', '');
      suffix = ' (Virtual)';
    }

    const node = appController.getState().graph.inner.nodes[nodeId];
    const displayName = node ? (node.config.name || node.config.typeId) : id;
    const typeName = node ? node.config.typeId : 'Unknown';

    return html`
      <div class="node-item">
        <div class="node-header">
          <span class="node-name">${displayName}${suffix}</span>
          <span class="node-type">${typeName}</span>
        </div>
        ${this.renderValues(output)}
      </div>
    `;
  }

  private renderValues(output: any) {
    if (!output) return html`<div class="value-row"><span class="chip">null</span></div>`;

    const elements = [];

    // Handle Fields
    if (output.fields) {
      for (const [key, val] of Object.entries(output.fields)) {
        elements.push(html`
          <div class="value-row">
            <span class="field-name">${key}:</span>
            ${this.renderChip(val)}
          </div>
        `);
      }
    }

    // Handle Untagged
    if (output.untagged && Array.isArray(output.untagged)) {
      output.untagged.forEach((val: any, index: number) => {
        elements.push(html`
          <div class="value-row">
            <span class="field-name">[${index}]:</span>
            ${this.renderChip(val)}
          </div>
        `);
      });
    }

    if (elements.length === 0) {
      return html`<div class="value-row" style="color: #666; font-style: italic;">No output</div>`;
    }

    return elements;
  }

  private renderChip(value: any) {
    if (typeof value === 'number') {
      return html`<span class="chip">${value.toFixed(2)}</span>`;
    }

    if (typeof value === 'string') {
      return html`<span class="chip">"${value}"</span>`;
    }

    if (Array.isArray(value)) {
      // Vector
      return html`<span class="chip vector">vector(${value.length})</span>`;
    }

    if (typeof value === 'object' && value !== null) {
      // Struct
      return html`<span class="chip struct">struct</span>`;
    }

    return html`<span class="chip">${String(value)}</span>`;
  }
}
