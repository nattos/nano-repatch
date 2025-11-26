import './nodes';
import { html } from 'lit';
import { defaultNodeRepository } from '../../structor/repository';

// Rhythmic Generator
const rhythmicGenerator = defaultNodeRepository.getNodeType('nicepattern:rhythmic_generator');
if (rhythmicGenerator) {
  rhythmicGenerator.renderInspector = (node, onchange) => html`
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
}

// Chaos Generator
const chaosGenerator = defaultNodeRepository.getNodeType('nicepattern:chaos_generator');
if (chaosGenerator) {
  chaosGenerator.renderInspector = (node, onchange) => html`
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
}

// Layer Nodes
const layerNodes = [
  'nicepattern:gate_layer',
  'nicepattern:exp_layer',
  'nicepattern:pwm_layer',
  'nicepattern:noise_layer',
  'nicepattern:tone_synth_layer'
];

layerNodes.forEach(id => {
  const nodeType = defaultNodeRepository.getNodeType(id);
  if (nodeType) {
    nodeType.renderInspector = (node, onchange) => html`
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
  }
});
