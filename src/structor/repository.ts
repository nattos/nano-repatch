import { NodeDefinition, Structor, StructorType } from './structor';
import { primitive_add, primitive_clamp, primitive_literal, primitive_apply, primitive_fmod, primitive_input, primitive_output, primitive_subgraph } from './primitives';
import type { GraphState, GridNode } from '../builder/state';

import { AnyType, NumberType } from './type-helpers';

export interface PortHint {
  name: string; // Corresponds to tag. Empty string for default/untagged.
  type: StructorType;
  description?: string;
  // For "virtual inputs"
  defaultValue?: any;
  range?: [number, number];
  redirect?: 'untagged';
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
});
import { expressionNode } from '../customnodes/expr/nodes';
import { GraphCompiler } from '../customnodes/expr/parser';
import { midiCcNode, midiNoteNode } from '../customnodes/midi/nodes';

const exprCompiler = new GraphCompiler();

defaultNodeRepository.register({
  id: 'midi_cc',
  version: '1.0.0',
  displayName: 'MIDI CC',
  definition: midiCcNode,
  inputs: [],
  outputs: [
    { name: 'value', type: NumberType, description: 'Normalized value (0-1)' }
  ],
  compileConfig: (uiConfig) => ({ fields: { channel: uiConfig.channel ?? 1, cc: uiConfig.cc ?? 0, deviceId: uiConfig.deviceId }, untagged: [] }),
});

defaultNodeRepository.register({
  id: 'midi_note',
  version: '1.0.0',
  displayName: 'MIDI Note',
  definition: midiNoteNode,
  inputs: [],
  outputs: [
    { name: 'note', type: NumberType, description: 'Note Number (when on)' },
    { name: 'velocity', type: NumberType, description: 'Velocity (0-1)' },
    { name: 'gate', type: NumberType, description: 'Gate (1 when on, 0 when off)' }
  ],
  compileConfig: (uiConfig) => ({ fields: { channel: uiConfig.channel ?? 1, note: uiConfig.note ?? 60, deviceId: uiConfig.deviceId }, untagged: [] }),
});

defaultNodeRepository.register({
  id: 'expression:script',
  version: '1.0.0',
  displayName: 'Expression',
  definition: expressionNode,
  inputs: [],
  outputs: [
    { name: 'result', type: AnyType, description: 'Result of the expression' }
  ],
  compileConfig: (uiConfig) => ({ fields: { code: uiConfig.code || '' }, untagged: [] }),
  getPorts: (node) => {
    const code = node.config.code || '';
    if (!code.trim()) {
      return { inputs: [], outputs: [{ name: 'result', type: AnyType }] };
    }

    try {
      // We need to parse the code to find external variables.
      // The GraphCompiler produces an ExecutionGraph.
      // Nodes with op='input' represent external variables.
      const graph = exprCompiler.compile(code);
      const inputs: PortHint[] = [];

      for (const node of Object.values(graph.nodes)) {
        if (node.op === 'input') {
          // Avoid duplicates
          if (!inputs.find(i => i.name === node.params.key)) {
            inputs.push({ name: node.params.key, type: AnyType, description: `Variable: ${node.params.key}` });
          }
        }
      }

      return {
        inputs,
        outputs: [{ name: 'result', type: AnyType }]
      };
    } catch (e) {
      // If parsing fails, just return default ports or maybe show error?
      // For now, return default.
      return { inputs: [], outputs: [{ name: 'result', type: AnyType }] };
    }
  }
});




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
});