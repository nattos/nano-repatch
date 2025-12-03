import './nodes';
import { html } from 'lit';
import { GridNode } from '../../builder/state';
import { InspectorChangeHandler } from '../../structor/repository';

// Resolume Input
export const ResolumeInputInspector = (node: GridNode, onchange: InspectorChangeHandler) => html`
  <div class="field">
    <label>Path:</label>
    <input
      type="text"
      .value=${node.config.path || ''}
      @change=${(e: any) => onchange({ path: e.target.value })}
    />
  </div>
`;

// Resolume Output
export const ResolumeOutputInspector = (node: GridNode, onchange: InspectorChangeHandler) => html`
  <div class="field">
    <label>Path:</label>
    <input
      type="text"
      .value=${node.config.path || ''}
      @change=${(e: any) => onchange({ path: e.target.value })}
    />
  </div>
`;
