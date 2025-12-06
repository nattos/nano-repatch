import { html, TemplateResult } from 'lit';
import { GridNode } from '../../builder/state';
import { InspectorChangeHandler, defaultNodeRepository } from '../../structor/repository';
import { ROW_HEIGHT } from '../../constants';
import { InspectorFieldDef } from '../../structor/node-helpers';

const getValue = (node: GridNode, path: string, fallback: any) => {
  // 1. Try config value
  const val = node.config?.[path];
  if (val !== undefined) return val;

  // 2. Try input definition defaultValue
  const nodeType = defaultNodeRepository.getNodeType(node.config.typeId);
  if (nodeType && nodeType.inputs) {
    const input = nodeType.inputs.find(i => i.name === path);
    if (input && input.defaultValue !== undefined) {
      return input.defaultValue;
    }
  }

  // 3. Fallback
  return fallback;
};

const renderStringField = (node: GridNode, field: Extract<InspectorFieldDef, { type: 'string' }>, onchange: InspectorChangeHandler) => html`
  <div class="field" style="height: ${ROW_HEIGHT}px; display: flex; align-items: center; justify-content: space-between;">
    <label style="color: var(--text-muted); font-size: 0.7em;">${field.label}</label>
    <input
      type="text"
      .value=${getValue(node, field.path, '')}
      placeholder=${field.placeholder || ''}
      @input=${(e: Event) => onchange({ [field.path]: (e.target as HTMLInputElement).value })}
      style="background: var(--input-bg); border: 1px solid var(--border-color); color: var(--text-color); border-radius: 4px; padding: 2px 4px; width: 120px; font-size: 0.8em;"
    />
  </div>
`;

const renderNumberField = (node: GridNode, field: Extract<InspectorFieldDef, { type: 'number' }>, onchange: InspectorChangeHandler) => html`
  <div class="field" style="height: ${ROW_HEIGHT}px; display: flex; align-items: center; justify-content: space-between;">
    <label style="color: var(--text-muted); font-size: 0.7em;">${field.label}</label>
    <input
      type="number"
      .value=${getValue(node, field.path, 0)}
      min=${field.min}
      max=${field.max}
      step=${field.step}
      @input=${(e: Event) => onchange({ [field.path]: parseFloat((e.target as HTMLInputElement).value) })}
      style="background: var(--input-bg); border: 1px solid var(--border-color); color: var(--text-color); border-radius: 4px; padding: 2px 4px; width: 60px; font-size: 0.8em;"
    />
  </div>
`;

import '../../views/scalar-slider';

const renderSliderField = (node: GridNode, field: Extract<InspectorFieldDef, { type: 'slider' }>, onchange: InspectorChangeHandler) => html`
  <div class="field" style="height: ${ROW_HEIGHT}px; display: flex; align-items: center; justify-content: space-between;">
    <label style="color: var(--text-muted); font-size: 0.7em;">${field.label}</label>
    <div style="flex: 1; margin-left: 8px; max-width: 120px;">
      <scalar-slider
        .value=${getValue(node, field.path, field.min)}
        .min=${field.min}
        .max=${field.max}
        .step=${field.step || 0.01}
        @change=${(e: CustomEvent) => onchange({ [field.path]: e.detail })}
        style="width: 100%;"
      ></scalar-slider>
    </div>
  </div>
`;

const renderBooleanField = (node: GridNode, field: Extract<InspectorFieldDef, { type: 'boolean' }>, onchange: InspectorChangeHandler) => html`
  <div class="field" style="height: ${ROW_HEIGHT}px; display: flex; align-items: center; justify-content: space-between;">
    <label style="color: var(--text-muted); font-size: 0.7em;">${field.label}</label>
    <input
      type="checkbox"
      .checked=${getValue(node, field.path, false)}
      @change=${(e: Event) => onchange({ [field.path]: (e.target as HTMLInputElement).checked })}
    />
  </div>
`;

const renderSelectField = (node: GridNode, field: Extract<InspectorFieldDef, { type: 'select' }>, onchange: InspectorChangeHandler) => html`
  <div class="field" style="height: ${ROW_HEIGHT}px; display: flex; align-items: center; justify-content: space-between;">
    <label style="color: var(--text-muted); font-size: 0.7em;">${field.label}</label>
    <select
      .value=${getValue(node, field.path, field.options[0]?.value)}
      @change=${(e: Event) => onchange({ [field.path]: (e.target as HTMLSelectElement).value })}
      style="background: var(--input-bg); border: 1px solid var(--border-color); color: var(--text-color); border-radius: 4px; padding: 2px 4px; font-size: 0.8em;"
    >
      ${field.options.map(opt => html`<option value=${opt.value}>${opt.label}</option>`)}
    </select>
  </div>
`;

export const createGenericInspector = (fields: InspectorFieldDef[]) => {
  return (node: GridNode, onchange: InspectorChangeHandler): TemplateResult => {
    return html`
      <div class="generic-inspector" style="display: flex; flex-direction: column;">
        ${fields.map(field => {
          switch (field.type) {
            case 'string': return renderStringField(node, field, onchange);
            case 'number': return renderNumberField(node, field, onchange);
            case 'slider': return renderSliderField(node, field, onchange);
            case 'boolean': return renderBooleanField(node, field, onchange);
            case 'select': return renderSelectField(node, field, onchange);
            default: return html``;
          }
        })}
      </div>
    `;
  };
};
