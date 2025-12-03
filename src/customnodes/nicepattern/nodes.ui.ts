import './nodes';
import { html } from 'lit';
import { GridNode } from '../../builder/state';
import { InspectorChangeHandler } from '../../structor/repository';

// Rhythmic Generator
export const RhythmicInspector = (node: GridNode, onchange: InspectorChangeHandler) => html`
  <div class="field">
    <label>Target Note:</label>
    <input
      type="number"
      .value=${node.config?.targetNote ?? 0}
      @input=${(e: Event) =>
    onchange({ targetNote: parseInt((e.target as HTMLInputElement).value) })}
    />
  </div>
  <div class="field">
    <label>Density:</label>
    <input
      type="range"
      min="0"
      max="1"
      step="0.05"
      .value=${node.config?.density ?? 0.5}
      @input=${(e: Event) =>
    onchange({ density: parseFloat((e.target as HTMLInputElement).value) })}
    />
  </div>
`;

// Chaos Generator
export const ChaosInspector = (node: GridNode, onchange: InspectorChangeHandler) => html`
  <div class="field">
    <label>Min Note:</label>
    <input
      type="number"
      .value=${node.config?.minNote ?? 0}
      @input=${(e: Event) =>
    onchange({ minNote: parseInt((e.target as HTMLInputElement).value) })}
    />
  </div>
  <div class="field">
    <label>Max Note:</label>
    <input
      type="number"
      .value=${node.config?.maxNote ?? 12}
      @input=${(e: Event) =>
    onchange({ maxNote: parseInt((e.target as HTMLInputElement).value) })}
    />
  </div>
  <div class="field">
    <label>Density:</label>
    <input
      type="range"
      min="0"
      max="1"
      step="0.05"
      .value=${node.config?.density ?? 0.5}
      @input=${(e: Event) =>
    onchange({ density: parseFloat((e.target as HTMLInputElement).value) })}
    />
  </div>
`;

// Layer Nodes
export const LayerInspector = (node: GridNode, onchange: InspectorChangeHandler) => html`
  <div class="field">
    <label>Target Note:</label>
    <input
      type="number"
      .value=${node.config?.targetNote ?? 0}
      @input=${(e: Event) =>
    onchange({ targetNote: parseInt((e.target as HTMLInputElement).value) })}
    />
  </div>
`;
