import { css, html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { MobxLitElement } from './mobx-lit-element';
import { appController, localController, runtimeManager } from '../builder/controllers';
import { globalStyles } from '../styles';
import { formatType, formatValue } from './formatters';
import { defaultNodeRepository } from '../structor/repository';

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

      .chip.cached {
        border-style: dashed;
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

      .chip.midi {
        background: #4a3a2a;
        color: #e3c18d;
        border-color: #7a5f3a;
      }

      .chip.midi-stream {
        background: #2a4a3a;
        color: #8de3c1;
        border-color: #3a7a5f;
      }

      .type-hint {
        font-size: 10px;
        color: #555;
        margin-right: 6px;
        font-family: 'JetBrains Mono', monospace;
      }
    `,
  ];

  render() {
    const stats = runtimeManager.stats;
    const outputs = Array.from(runtimeManager.outputs.entries());

    return html`
      <div class="header" style="display: flex; justify-content: space-between; align-items: center;">
        <span>Debug Output</span>
        <label style="display: flex; align-items: center; cursor: pointer; font-size: 10px; text-transform: none; color: #888; user-select: none;">
          <input
            type="checkbox"
            .checked=${localController.observableState.localSettings.showDebugValues}
            @change=${(e: Event) => localController.setShowDebugValues((e.target as HTMLInputElement).checked)}
            style="margin-right: 4px;"
          >
          Show on Graph
        </label>
      </div>
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
    const definition = node ? defaultNodeRepository.get(node.config.typeId) : undefined;

    // Attempt to get output types
    // This is tricky without AnalysisContext.
    // For now, we look at the static definition if available.
    // Or we can try to infer from the value? No, we want the type hint.

    // If it's a primitive node, we might have static outputs.
    let outputDef: any = undefined;
    if (definition && definition.kind === 'primitive') {
      // We can't easily run computeOutputTypes here.
      // But we can check if 'outputs' property exists on the definition object (it's in the repo entry).
      // The repo entry has 'outputs' which is PortHint[].
      // PortHint has 'type'.
      const repoEntry = defaultNodeRepository.get(node.config.typeId); // This returns NodeDefinition? No, repo returns NodeType (wrapper).
      // Wait, repository.get returns NodeType | undefined.
      // NodeType has 'outputs' which is PortHint[].
    }

    const repoEntry = node ? defaultNodeRepository.getNodeType(node.config.typeId) : undefined;
    const displayName = node ? (node.config.name || node.config.typeId) : id;
    const typeName = node ? node.config.typeId : 'Unknown';

    return html`
      <div class="node-item">
        <div class="node-header">
          <span class="node-name">${displayName}${suffix}</span>
          <span class="node-type">${typeName}</span>
        </div>
        ${this.renderValues(output, repoEntry, nodeId)}
      </div>
    `;
  }

  private midiCache = new Map<string, any[]>();

  private renderValues(output: any, repoEntry?: any, nodeId?: string) {
    if (!output) return html`<div class="value-row"><span class="chip">null</span></div>`;

    const elements = [];

    // Handle Fields
    if (output.fields) {
      for (const [key, val] of Object.entries(output.fields)) {
        // Find type for this field
        let type: any = undefined;
        if (repoEntry && repoEntry.outputs) {
          const port = repoEntry.outputs.find((p: any) => p.name === key);
          if (port) type = port.type;
        }

        let valueToRender = val;
        let isCached = false;

        // Cache MIDI streams
        if (type?.kind === 'array' && type.hint === 'midi-stream' && nodeId) {
          const cacheKey = `${nodeId}:${key}`;
          const currentStream = val as any[];

          if (currentStream && currentStream.length > 0) {
            this.midiCache.set(cacheKey, currentStream);
          } else {
            const cached = this.midiCache.get(cacheKey);
            if (cached) {
              valueToRender = cached;
              isCached = true;
            }
          }
        }

        elements.push(html`
          <div class="value-row">
            <span class="field-name">${key}:</span>
            <span class="type-hint">${formatType(type)}</span>
            ${formatValue(valueToRender, type, { extraClasses: { 'cached': isCached } })}
          </div>
        `);
      }
    }

    // Handle Untagged
    if (output.untagged && Array.isArray(output.untagged)) {
      output.untagged.forEach((val: any, index: number) => {
        // Find type for untagged?
        // Usually untagged outputs are uniform or defined by index.
        // For now, we don't have easy mapping for untagged indices in PortHint unless name matches?
        // Or maybe we assume 'untagged' type if available?

        elements.push(html`
          <div class="value-row">
            <span class="field-name">[${index}]:</span>
            ${formatValue(val)}
          </div>
        `);
      });
    }

    if (elements.length === 0) {
      return html`<div class="value-row" style="color: #666; font-style: italic;">No output</div>`;
    }

    return elements;
  }
}
