import './nodes';
import { html } from 'lit';
import { defaultNodeRepository } from '../../structor/repository';

// Resolume Input
const resolumeInput = defaultNodeRepository.getNodeType('resolume:input');
if (resolumeInput) {
  resolumeInput.renderInspector = (node, onchange) => html`
    <div class="field">
      <label>Path:</label>
      <input
        type="text"
        .value=${node.config.path || ''}
        @change=${(e: any) => onchange({ path: e.target.value })}
      />
    </div>
  `;
}

// Resolume Output
const resolumeOutput = defaultNodeRepository.getNodeType('resolume:output');
if (resolumeOutput) {
  resolumeOutput.renderInspector = (node, onchange) => html`
    <div class="field">
      <label>Path:</label>
      <input
        type="text"
        .value=${node.config.path || ''}
        @change=${(e: any) => onchange({ path: e.target.value })}
      />
    </div>
  `;
}
