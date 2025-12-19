import { html } from 'lit';
import { defaultNodeRepository, GraphNodeRenderHandlers, InspectorChangeHandler } from './repository';
import { GridNode } from '../builder/state';
import { parseFloatOr } from '../utils/utils';
import { GraphState } from '../builder/state';
import '../views/monaco-editor';

// Helper to attach UI handlers
function attachUI(id: string, ui: {
  renderBody?: (node: GridNode, handlers: GraphNodeRenderHandlers) => unknown;
  renderInspector?: (node: GridNode, onchange: InspectorChangeHandler) => unknown;
}) {
  const nodeType = defaultNodeRepository.getNodeType(id);
  if (nodeType) {
    if (ui.renderBody) nodeType.renderBody = ui.renderBody;
    if (ui.renderInspector) nodeType.renderInspector = ui.renderInspector;
  }
}

// Literal
attachUI('literal', {
  renderInspector: (node, onchange) => html`
    <div class="field">
      <label>Value:</label>
      <input
        type="text"
        .value=${node.config?.literal?.value || 0}
        @input=${(e: Event) => {
      const value = parseFloatOr((e.target as HTMLInputElement).value) ?? 0;
      onchange({ literal: { value } });
    }}
      />
    </div>
  `
});

// Resolume Input
attachUI('resolume:input', {
  renderInspector: (node, onchange) => html`
    <div class="field">
      <label>Path:</label>
      <input
        type="text"
        .value=${node.config.path || ''}
        @change=${(e: Event) => onchange({ path: (e.target as HTMLInputElement).value })}
      />
    </div>
  `
});

// Resolume Output
attachUI('resolume:output', {
  renderInspector: (node, onchange) => html`
    <div class="field">
      <label>Path:</label>
      <input
        type="text"
        .value=${node.config.path || ''}
        @change=${(e: Event) => onchange({ path: (e.target as HTMLInputElement).value })}
      />
    </div>
  `
});

// IO Node Body Renderer
const ioNodeBodyRenderer = (node: GridNode, { handleVirtualInputChange }: GraphNodeRenderHandlers) => html`
  <div class="virtual-input-field-wrapper">
    <label>Value:</label>
    <input
      type="text"
      .value=${(node.config.values && node.config.values['0']) || ''}
      @input=${(e: Event) => handleVirtualInputChange(e, '0')}
      class="virtual-input-field"
    />
  </div>
`;

// Input
attachUI('input', {
  renderBody: ioNodeBodyRenderer
});

// Output
attachUI('output', {
  renderBody: ioNodeBodyRenderer
});

// Subgraph
attachUI('subgraph', {
  renderInspector: (node, onchange) => html`
    <div class="field">
      <label>Subgraph ID:</label>
      <input
        type="text"
        .value=${node.config.subgraphId || ''}
        @change=${(e: Event) => onchange({ subgraphId: (e.target as HTMLInputElement).value })}
      />
    </div>
  `
});

// Expression Node
attachUI('logic.expression', {
  renderInspector: (node, onchange) => html`
  <monaco-editor-wrapper
    @change=${(e: CustomEvent) => onchange({ code: e.detail.value })}
    ></monaco-editor-wrapper>
  `
});
