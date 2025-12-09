import { NodeDefinition, Structor, StructorType } from './structor';
import {
  primitive_add, primitive_clamp, primitive_literal, primitive_apply, primitive_fmod, primitive_input, primitive_output, primitive_subgraph,
  primitive_subtract, primitive_multiply, primitive_divide, primitive_pow, primitive_min, primitive_max,
  primitive_abs, primitive_negate, primitive_ceil, primitive_floor, primitive_round, primitive_sin, primitive_cos, primitive_tan, primitive_sqrt,
  primitive_and, primitive_or, primitive_xor, primitive_equals, primitive_greater_than, primitive_less_than, primitive_not,
  primitive_pi, primitive_e,
  primitive_lerp, primitive_map, primitive_hub, primitive_float,
  primitive_pack, primitive_unpack,
  primitive_all_add, primitive_all_subtract, primitive_all_multiply, primitive_all_divide, primitive_all_pow, primitive_all_min, primitive_all_max,
  primitive_all_and, primitive_all_or, primitive_all_xor, primitive_all_equals, primitive_all_greater_than, primitive_all_less_than
} from './primitives';
import type { GraphState, GridNode } from '../builder/state';

import { AnyType, NumberType } from './type-helpers';
import { midiStreamType } from './std-types';

export interface PortHint {
  name: string; // Corresponds to tag. Empty string for default/untagged.
  type: StructorType;
  description?: string;
  // For "virtual inputs"
  defaultValue?: any;
  range?: [number, number];
  step?: number;
  redirect?: 'untagged';
  suppressInputEditor?: boolean;
  alwaysShowInputEditor?: boolean;
  suppressLabel?: boolean;
}

export type InspectorChangeHandler = (config: Partial<GridNode['config']>) => void;
export interface GraphNodeRenderHandlers {
  handleVirtualInputChange: (e: Event, portName: string) => void;
}

export interface NodeType {
  id: string;
  version: string;
  displayName: string;
  aliases?: string[];
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
   * Returns the exact pixel height required for the custom body.
   * Required if renderBody is defined and takes up space.
   */
  getBodyHeight?: (node: GridNode) => number;

  /**
   * A custom Lit-element renderer for the node's inspector content.
   */
  renderInspector?: (node: GridNode, onchange: InspectorChangeHandler) => unknown;

  /**
   * Returns the exact pixel height required for the custom inspector editor.
   */
  getInspectorHeight?: (node: GridNode) => number;

  /**
   * A custom Lit-element renderer for a specific input port.
   * Renders in place of the default virtual input when the port is disconnected.
   */
  renderInputEditor?: (node: GridNode, portName: string, handlers: GraphNodeRenderHandlers) => unknown;

  /**
   * Returns the exact pixel height required for the custom input editor.
   */
  getInputEditorHeight?: (node: GridNode, portName: string) => number;

  /**
   * A function to dynamically get the ports for a node, possibly using a cached compiled config.
   * Used for nodes like subgraphs or expressions where ports depend on internal state or code.
   */
  compilePorts?: (node: GridNode, context: { loadedSubgraphs: Map<string, GraphState>, compiledConfig?: Structor }) => {
    inputs: PortHint[];
    outputs: PortHint[];
    displayName?: string;
  } | null;

  /**
   * Lazy-loaded UI components.
   * If present, these functions return promises that resolve to the renderer functions.
   */
  ui?: {
    body?: () => Promise<(node: GridNode, handlers: GraphNodeRenderHandlers) => unknown>;
    getBodyHeight?: () => Promise<(node: GridNode) => number>;
    inspector?: () => Promise<(node: GridNode, onchange: InspectorChangeHandler) => unknown>;
    inputEditor?: () => Promise<(node: GridNode, portName: string, handlers: GraphNodeRenderHandlers) => unknown>;
    getInputEditorHeight?: () => Promise<(node: GridNode, portName: string) => number>;
  };

  /**
   * Whether to capture inputs for this node type in the executor.
   */
  inspectInputs?: boolean;
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
  id: 'math.add',
  version: '1.0.0',
  displayName: 'Add',
  aliases: ['plus', 'sum'],
  definition: primitive_add,
  inputs: [
    { name: 'a', type: NumberType, description: 'Value A' },
    { name: 'b', type: NumberType, description: 'Value B' }
  ],
  outputs: [
    { name: 'result', type: NumberType, description: 'Sum' }
  ]
});

defaultNodeRepository.register({
  id: 'math.lerp',
  version: '1.0.0',
  displayName: 'Lerp',
  definition: primitive_lerp,
  inputs: [
    { name: 'a', type: NumberType, description: 'Start Value' },
    { name: 'b', type: NumberType, description: 'End Value' },
    { name: 't', type: NumberType, description: 'Interpolant (0-1)' }
  ],
  outputs: [
    { name: 'result', type: NumberType, description: 'Interpolated Value' }
  ],
  compileConfig: (uiConfig) => ({ fields: { clamp: uiConfig.clamp ?? true }, untagged: [] }),
});

defaultNodeRepository.register({
  id: 'math.map',
  version: '1.0.0',
  displayName: 'Map',
  definition: primitive_map,
  inputs: [
    { name: 'value', type: NumberType, description: 'Input Value' },
    { name: 'inMin', type: NumberType, description: 'Input Min', defaultValue: 0 },
    { name: 'inMax', type: NumberType, description: 'Input Max', defaultValue: 1 },
    { name: 'outMin', type: NumberType, description: 'Output Min', defaultValue: 0 },
    { name: 'outMax', type: NumberType, description: 'Output Max', defaultValue: 1 }
  ],
  outputs: [
    { name: 'result', type: NumberType, description: 'Mapped Value' }
  ]
});

defaultNodeRepository.register({
  id: 'util.hub',
  version: '1.0.0',
  displayName: 'Hub',
  definition: primitive_hub,
  inputs: [
    { name: 'value', type: AnyType, description: 'Input', suppressInputEditor: true, suppressLabel: true }
  ],
  outputs: [
    { name: 'value', type: AnyType, description: 'Output', suppressLabel: true }
  ]
});

defaultNodeRepository.register({
  id: 'data.float',
  version: '1.0.0',
  displayName: 'Float',
  definition: primitive_float,
  inputs: [
    { name: 'value', type: NumberType, description: 'Value', defaultValue: 0 }
  ],
  outputs: [
    { name: 'value', type: NumberType, description: 'Value' }
  ],
  compileConfig: (uiConfig) => ({ values: { value: uiConfig.value ?? 0.0 }, fields: {}, untagged: [] }),
});

defaultNodeRepository.register({
  id: 'math.pi',
  version: '1.0.0',
  displayName: 'Pi',
  definition: primitive_pi,
  inputs: [],
  outputs: [
    { name: 'result', type: NumberType, description: 'Pi' }
  ]
});

defaultNodeRepository.register({
  id: 'math.e',
  version: '1.0.0',
  displayName: 'E',
  definition: primitive_e,
  inputs: [],
  outputs: [
    { name: 'result', type: NumberType, description: 'Euler\'s Number' }
  ]
});

defaultNodeRepository.register({
  id: 'math.subtract',
  version: '1.0.0',
  displayName: 'Subtract',
  aliases: ['minus', 'difference'],
  definition: primitive_subtract,
  inputs: [
    { name: 'a', type: NumberType, description: 'Minuend' },
    { name: 'b', type: NumberType, description: 'Subtrahend' }
  ],
  outputs: [
    { name: 'result', type: NumberType, description: 'Result' }
  ]
});

defaultNodeRepository.register({
  id: 'math.multiply',
  version: '1.0.0',
  displayName: 'Multiply',
  aliases: ['times', 'product'],
  definition: primitive_multiply,
  inputs: [
    { name: 'a', type: NumberType, description: 'Factor A' },
    { name: 'b', type: NumberType, description: 'Factor B' }
  ],
  outputs: [
    { name: 'result', type: NumberType, description: 'Product' }
  ]
});

defaultNodeRepository.register({
  id: 'math.divide',
  version: '1.0.0',
  displayName: 'Divide',
  aliases: ['div', 'quotient'],
  definition: primitive_divide,
  inputs: [
    { name: 'a', type: NumberType, description: 'Dividend' },
    { name: 'b', type: NumberType, description: 'Divisor' }
  ],
  outputs: [
    { name: 'result', type: NumberType, description: 'Quotient' }
  ]
});

defaultNodeRepository.register({
  id: 'math.pow',
  version: '1.0.0',
  displayName: 'Power',
  definition: primitive_pow,
  inputs: [
    { name: 'a', type: NumberType, description: 'Base' },
    { name: 'b', type: NumberType, description: 'Exponent' }
  ],
  outputs: [
    { name: 'result', type: NumberType, description: 'Result' }
  ]
});

defaultNodeRepository.register({
  id: 'math.min',
  version: '1.0.0',
  displayName: 'Min',
  definition: primitive_min,
  inputs: [
    { name: 'a', type: NumberType, description: 'Value A' },
    { name: 'b', type: NumberType, description: 'Value B' }
  ],
  outputs: [
    { name: 'result', type: NumberType, description: 'Minimum' }
  ]
});

defaultNodeRepository.register({
  id: 'math.max',
  version: '1.0.0',
  displayName: 'Max',
  definition: primitive_max,
  inputs: [
    { name: 'a', type: NumberType, description: 'Value A' },
    { name: 'b', type: NumberType, description: 'Value B' }
  ],
  outputs: [
    { name: 'result', type: NumberType, description: 'Maximum' }
  ]
});

defaultNodeRepository.register({
  id: 'math.clamp',
  version: '1.0.0',
  displayName: 'Clamp',
  definition: primitive_clamp,
  inputs: [
    { name: 'value', type: NumberType, description: 'Value to clamp.' },
    { name: 'min', type: NumberType, description: 'Minimum value.', defaultValue: 0, range: [0, 1] },
    { name: 'max', type: NumberType, description: 'Maximum value.', defaultValue: 1, range: [0, 1] }
  ],
  outputs: [
    { name: 'value', type: NumberType, description: 'The clamped value.' }
  ]
});

defaultNodeRepository.register({
  id: 'math.fmod',
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
  id: 'math.abs',
  version: '1.0.0',
  displayName: 'Abs',
  definition: primitive_abs,
  inputs: [
    { name: 'a', type: NumberType, description: 'Value' }
  ],
  outputs: [
    { name: 'result', type: NumberType, description: 'Absolute Value' }
  ]
});

defaultNodeRepository.register({
  id: 'math.negate',
  version: '1.0.0',
  displayName: 'Negate',
  definition: primitive_negate,
  inputs: [
    { name: 'a', type: NumberType, description: 'Value' }
  ],
  outputs: [
    { name: 'result', type: NumberType, description: 'Negated Value' }
  ]
});

defaultNodeRepository.register({
  id: 'math.ceil',
  version: '1.0.0',
  displayName: 'Ceil',
  definition: primitive_ceil,
  inputs: [
    { name: 'a', type: NumberType, description: 'Value' }
  ],
  outputs: [
    { name: 'result', type: NumberType, description: 'Ceiling' }
  ]
});

defaultNodeRepository.register({
  id: 'math.floor',
  version: '1.0.0',
  displayName: 'Floor',
  definition: primitive_floor,
  inputs: [
    { name: 'a', type: NumberType, description: 'Value' }
  ],
  outputs: [
    { name: 'result', type: NumberType, description: 'Floor' }
  ]
});

defaultNodeRepository.register({
  id: 'math.round',
  version: '1.0.0',
  displayName: 'Round',
  definition: primitive_round,
  inputs: [
    { name: 'a', type: NumberType, description: 'Value' }
  ],
  outputs: [
    { name: 'result', type: NumberType, description: 'Rounded Value' }
  ]
});

defaultNodeRepository.register({
  id: 'math.sin',
  version: '1.0.0',
  displayName: 'Sin',
  definition: primitive_sin,
  inputs: [
    { name: 'a', type: NumberType, description: 'Value (Radians)' }
  ],
  outputs: [
    { name: 'result', type: NumberType, description: 'Sine' }
  ]
});

defaultNodeRepository.register({
  id: 'math.cos',
  version: '1.0.0',
  displayName: 'Cos',
  definition: primitive_cos,
  inputs: [
    { name: 'a', type: NumberType, description: 'Value (Radians)' }
  ],
  outputs: [
    { name: 'result', type: NumberType, description: 'Cosine' }
  ]
});

defaultNodeRepository.register({
  id: 'math.tan',
  version: '1.0.0',
  displayName: 'Tan',
  definition: primitive_tan,
  inputs: [
    { name: 'a', type: NumberType, description: 'Value (Radians)' }
  ],
  outputs: [
    { name: 'result', type: NumberType, description: 'Tangent' }
  ]
});

defaultNodeRepository.register({
  id: 'math.sqrt',
  version: '1.0.0',
  displayName: 'Sqrt',
  definition: primitive_sqrt,
  inputs: [
    { name: 'a', type: NumberType, description: 'Value' }
  ],
  outputs: [
    { name: 'result', type: NumberType, description: 'Square Root' }
  ]
});

defaultNodeRepository.register({
  id: 'logic.and',
  version: '1.0.0',
  displayName: 'AND',
  definition: primitive_and,
  inputs: [
    { name: 'a', type: NumberType, description: 'Value A' },
    { name: 'b', type: NumberType, description: 'Value B' }
  ],
  outputs: [
    { name: 'result', type: NumberType, description: 'Result' }
  ]
});

defaultNodeRepository.register({
  id: 'logic.or',
  version: '1.0.0',
  displayName: 'OR',
  definition: primitive_or,
  inputs: [
    { name: 'a', type: NumberType, description: 'Value A' },
    { name: 'b', type: NumberType, description: 'Value B' }
  ],
  outputs: [
    { name: 'result', type: NumberType, description: 'Result' }
  ]
});

defaultNodeRepository.register({
  id: 'logic.xor',
  version: '1.0.0',
  displayName: 'XOR',
  definition: primitive_xor,
  inputs: [
    { name: 'a', type: NumberType, description: 'Value A' },
    { name: 'b', type: NumberType, description: 'Value B' }
  ],
  outputs: [
    { name: 'result', type: NumberType, description: 'Result' }
  ]
});

defaultNodeRepository.register({
  id: 'logic.equals',
  version: '1.0.0',
  displayName: 'Equals',
  definition: primitive_equals,
  inputs: [
    { name: 'a', type: NumberType, description: 'Value A' },
    { name: 'b', type: NumberType, description: 'Value B' }
  ],
  outputs: [
    { name: 'result', type: NumberType, description: 'Result' }
  ]
});

defaultNodeRepository.register({
  id: 'logic.greater_than',
  version: '1.0.0',
  displayName: 'Greater Than',
  definition: primitive_greater_than,
  inputs: [
    { name: 'a', type: NumberType, description: 'Value A' },
    { name: 'b', type: NumberType, description: 'Value B' }
  ],
  outputs: [
    { name: 'result', type: NumberType, description: 'Result' }
  ]
});

defaultNodeRepository.register({
  id: 'logic.less_than',
  version: '1.0.0',
  displayName: 'Less Than',
  definition: primitive_less_than,
  inputs: [
    { name: 'a', type: NumberType, description: 'Value A' },
    { name: 'b', type: NumberType, description: 'Value B' }
  ],
  outputs: [
    { name: 'result', type: NumberType, description: 'Result' }
  ]
});

defaultNodeRepository.register({
  id: 'logic.not',
  version: '1.0.0',
  displayName: 'NOT',
  definition: primitive_not,
  inputs: [
    { name: 'a', type: NumberType, description: 'Value' }
  ],
  outputs: [
    { name: 'result', type: NumberType, description: 'Result' }
  ]
});

defaultNodeRepository.register({
  id: 'functional.apply',
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
  id: 'data.literal',
  version: '1.0.0',
  displayName: 'Literal',
  definition: primitive_literal,
  outputs: [
    { name: '', type: AnyType, description: 'The literal value.' }
  ],
  compileConfig: (uiConfig) => uiConfig?.literal?.value ?? 0.0,
});


defaultNodeRepository.register({
  id: 'io.input',
  version: '1.0.0',
  displayName: 'Input',
  aliases: ['in', 'source'],
  definition: primitive_input,
  inputs: [],
  outputs: [
    { name: '0', type: AnyType, description: 'The input value.', suppressInputEditor: true, suppressLabel: true }
  ],
  compileConfig: (uiConfig) => uiConfig?.values?.['0'],
});

defaultNodeRepository.register({
  id: 'io.output',
  version: '1.0.0',
  displayName: 'Output',
  aliases: ['out', 'sink'],
  definition: primitive_output,
  inputs: [
    { name: '0', type: AnyType, description: 'The output value.', suppressInputEditor: true, suppressLabel: true }
  ],
  outputs: [],
});

defaultNodeRepository.register({
  id: 'core.subgraph',
  version: '1.0.0',
  displayName: 'Subgraph',
  definition: primitive_subgraph,
  inputs: [],
  outputs: [],
  compilePorts: (node, { loadedSubgraphs }) => {
    const subgraphId = node.config.subgraphId;
    const subgraph = loadedSubgraphs.get(subgraphId);
    if (subgraph) {
      const subgraphNodes = Object.values(subgraph.inner.nodes);
      const inputs = subgraphNodes
        .filter(n => n.config.typeId === 'io.input' || n.config.typeId === 'input') // Support both for now
        .sort((a, b) => a.y - b.y)
        .map(n => ({ name: n.config.name || '0', description: 'Subgraph Input', type: AnyType }));

      const outputs = subgraphNodes
        .filter(n => n.config.typeId === 'io.output' || n.config.typeId === 'output') // Support both for now
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


defaultNodeRepository.register({
  id: 'core.pack',
  version: '1.0.0',
  displayName: 'Pack',
  definition: primitive_pack,
  inputs: [],
  outputs: [
      { name: 'result', type: AnyType, description: 'Record' }
  ],
  // TODO: Add compilePorts usually for dynamic inputs?
  // Check primitive_subgraph for inspiration if needed.
});

defaultNodeRepository.register({
  id: 'core.unpack',
  version: '1.0.0',
  displayName: 'Unpack',
  definition: primitive_unpack,
  inputs: [
      { name: 'record', type: AnyType, description: 'Record to unpack' }
  ],
  outputs: [], // Dynamic outputs based on record
});

// --- All Variants ---

const registerAllNode = (id: string, displayName: string, def: any) => {
  defaultNodeRepository.register({
    id,
    version: '1.0.0',
    displayName,
    definition: def,
    inputs: [
      { name: '', type: { kind: 'array', element: NumberType, size: 'dynamic' }, description: 'Values to process.', suppressInputEditor: true, suppressLabel: true }
    ],
    outputs: [
      { name: 'result', type: NumberType, description: 'Result' }
    ]
  });
};

registerAllNode('math.all.add', 'Sum All', primitive_all_add);
registerAllNode('math.all.subtract', 'Subtract All', primitive_all_subtract);
registerAllNode('math.all.multiply', 'Multiply All', primitive_all_multiply);
registerAllNode('math.all.divide', 'Divide All', primitive_all_divide);
registerAllNode('math.all.pow', 'Power All', primitive_all_pow);
registerAllNode('math.all.min', 'Min All', primitive_all_min);
registerAllNode('math.all.max', 'Max All', primitive_all_max);

registerAllNode('logic.all.and', 'AND All', primitive_all_and);
registerAllNode('logic.all.or', 'OR All', primitive_all_or);
registerAllNode('logic.all.xor', 'XOR All', primitive_all_xor);
registerAllNode('logic.all.equals', 'Equals All', primitive_all_equals);
registerAllNode('logic.all.greater_than', 'Greater Than All', primitive_all_greater_than);
registerAllNode('logic.all.less_than', 'Less Than All', primitive_all_less_than);