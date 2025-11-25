import { html, nothing } from 'lit';
import { NodeDefinition, Structor, StructorType } from './structor';
import { primitive_add, primitive_clamp, primitive_literal, primitive_apply, primitive_fmod, primitive_input, primitive_output, primitive_subgraph } from './primitives';
import type { GraphState, GridNode } from '../builder/state';
import { parseFloatOr } from '../utils/utils';

export const NumberType: StructorType = { kind: 'atomic', type: 'number' };
export const AnyType: StructorType = { kind: 'atomic', type: 'any' };

export interface PortHint {
  name: string; // Corresponds to tag. Empty string for default/untagged.
  type: StructorType;
  description?: string;
  // For "virtual inputs"
  defaultValue?: any;
  range?: [number, number];
}

export type InspectorChangeHandler = (config: Partial<GridNode['config']>) => void;
export interface GraphNodeRenderHandlers {
  handleVirtualInputChange: (e: Event, portName: string) => void;
}

export interface NodeType {
  id: string;
  version: string;
  displayName: string;
  definition: NodeDefinition;
  inputs?: PortHint[];
  outputs?: PortHint[];

  /**
   * A function that compiles the UI-friendly `GridNode.config` object
   * into the `Structor`-formatted `defaultConfig` for a `NodeInstance`.
   * If not provided, the config is assumed to be undefined.
   */
  compileConfig?: (uiConfig: any) => Structor;

  /**
   * A custom Lit-element renderer for the node's body.
   * If not provided, a default renderer is used.
   */
  renderBody?: (node: GridNode, handlers: GraphNodeRenderHandlers) => unknown;

  /**
   * A custom Lit-element renderer for the node's inspector content.
   */
  renderInspector?: (node: GridNode, onchange: InspectorChangeHandler) => unknown;

  /**
   * A function to dynamically get the ports for a node.
   * Used for nodes like subgraphs where ports depend on internal state.
   */
  getPorts?: (node: GridNode, loadedSubgraphs: Map<string, GraphState>) => {
    inputs: PortHint[];
    outputs: PortHint[];
    displayName?: string;
  } | null;
}

export class NodeRepository {
  private nodes = new Map<string, NodeType>();

  register(node: NodeType): void {
    this.nodes.set(node.id, node);
  }

  get(id: string): NodeDefinition | undefined {
    return this.nodes.get(id)?.definition;
  }

  getNodeType(id: string): NodeType | undefined {
    return this.nodes.get(id);
  }

  getAllNodeTypes(): IterableIterator<NodeType> {
    return this.nodes.values();
  }
}

export const defaultNodeRepository = new NodeRepository();

defaultNodeRepository.register({
  id: 'add',
  version: '1.0.0',
  displayName: 'Add',
  definition: primitive_add,
  inputs: [
    { name: '', type: NumberType, description: 'Value to add. Can receive multiple connections.' }
  ],
  outputs: [
    { name: '0', type: NumberType, description: 'The sum of all inputs.' }
  ]
});

defaultNodeRepository.register({
  id: 'clamp',
  version: '1.0.0',
  displayName: 'Clamp',
  definition: primitive_clamp,
  inputs: [
    { name: '', type: NumberType, description: 'Value to clamp. Can receive multiple connections.' },
    { name: 'min', type: NumberType, description: 'Minimum value.', defaultValue: 0, range: [0, 1] },
    { name: 'max', type: NumberType, description: 'Maximum value.', defaultValue: 1, range: [0, 1] }
  ],
  outputs: [
    { name: '0', type: NumberType, description: 'The clamped value.' }
  ]
});

defaultNodeRepository.register({
  id: 'fmod',
  version: '1.0.0',
  displayName: 'FMod',
  definition: primitive_fmod,
  inputs: [
    { name: 'dividend', type: NumberType, description: 'Dividend' },
    { name: 'divisor', type: NumberType, description: 'Divisor', defaultValue: 1, range: [0, 10] },
  ],
  outputs: [
    { name: 'div', type: NumberType, description: 'The integer division result.' },
    { name: 'mod', type: NumberType, description: 'The remainder.' }
  ]
});

defaultNodeRepository.register({
  id: 'apply',
  version: '1.0.0',
  displayName: 'Apply Functor',
  definition: primitive_apply,
  inputs: [
    { name: 'functor', type: { kind: 'functor', input: AnyType, output: AnyType }, description: 'The functor to apply.' },
    { name: 'value', type: AnyType, description: 'The value to apply the functor to.' }
  ],
  outputs: [
    { name: '0', type: AnyType, description: 'The result of the functor application.' }
  ]
});

defaultNodeRepository.register({
  id: 'literal',
  version: '1.0.0',
  displayName: 'Literal',
  definition: primitive_literal,
  outputs: [
    { name: '', type: AnyType, description: 'The literal value.' }
  ],
  compileConfig: (uiConfig) => uiConfig?.literal?.value ?? 0.0,
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

import { resolumeInputNode, resolumeOutputNode } from '../customnodes/resolume/nodes';

defaultNodeRepository.register({
  id: 'resolume:input',
  version: '1.0.0',
  displayName: 'Resolume Input',
  definition: resolumeInputNode,
  inputs: [],
  outputs: [
    { name: 'value', type: AnyType, description: 'Value from Resolume parameter' }
  ],
  compileConfig: (uiConfig) => ({ fields: { path: uiConfig.path }, untagged: [] }),
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

defaultNodeRepository.register({
  id: 'resolume:output',
  version: '1.0.0',
  displayName: 'Resolume Output',
  definition: resolumeOutputNode,
  inputs: [
    { name: 'value', type: AnyType, description: 'Value to send to Resolume' }
  ],
  outputs: [],
  compileConfig: (uiConfig) => ({ fields: { path: uiConfig.path }, untagged: [] }),
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

defaultNodeRepository.register({
  id: 'input',
  version: '1.0.0',
  displayName: 'Input',
  definition: primitive_input,
  inputs: [],
  outputs: [
    { name: '0', type: AnyType, description: 'The input value.' }
  ],
  compileConfig: (uiConfig) => uiConfig?.values?.['0'],
  renderBody: ioNodeBodyRenderer,
});

defaultNodeRepository.register({
  id: 'output',
  version: '1.0.0',
  displayName: 'Output',
  definition: primitive_output,
  inputs: [
    { name: '0', type: AnyType, description: 'The output value.' }
  ],
  outputs: [],
  renderBody: ioNodeBodyRenderer,
});

defaultNodeRepository.register({
  id: 'subgraph',
  version: '1.0.0',
  displayName: 'Subgraph',
  definition: primitive_subgraph,
  inputs: [],
  outputs: [],
  getPorts: (node, loadedSubgraphs) => {
    const subgraphId = node.config.subgraphId;
    const subgraph = loadedSubgraphs.get(subgraphId);
    if (subgraph) {
      const subgraphNodes = Object.values(subgraph.inner.nodes);
      const inputs = subgraphNodes
        .filter(n => n.config.typeId === 'input')
        .sort((a, b) => a.y - b.y)
        .map(n => ({ name: n.config.name || '0', description: 'Subgraph Input', type: AnyType }));

      const outputs = subgraphNodes
        .filter(n => n.config.typeId === 'output')
        .sort((a, b) => a.y - b.y)
        .map(n => ({ name: n.config.name || '0', description: 'Subgraph Output', type: AnyType }));

      return {
        inputs,
        outputs,
        displayName: `Subgraph: ${subgraphId}`
      };
    }
    return {
      inputs: [],
      outputs: [],
      displayName: `Subgraph (Not Found)`
    };
  },
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