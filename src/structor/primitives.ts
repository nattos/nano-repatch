import {
  AtomicType,
  BroadcastConfig,
  ExecutionContext,
  PrimitiveNodeDefinition,
  RecordType,
  Structor,
  StructorType,
  AnalysisContext,
  Functor,
  FunctorType,
  StructorRecord,
  NodeCategory
} from "./structor";
import { definePrimitiveNode, defineMathNode } from "./type-helpers";
import { numberType, anyType } from "./std-types";

export const primitive_add = defineMathNode(
  'math.add',
  { category: NodeCategory.Math, keywords: ['sum', 'plus'], description: 'Adds a and b.' },
  (a, b) => a + b
);

export const primitive_clamp: PrimitiveNodeDefinition = {
  id: 'math.clamp',
  kind: 'primitive',
  metadata: {
    category: NodeCategory.Math,
    keywords: ['limit', 'range'],
    description: 'Clamps a value between a minimum and maximum.'
  },
  computeOutputTypes: (inputType: RecordType, config: StructorType, context: AnalysisContext) => {
    const broadcastConfig: BroadcastConfig = {
      outputs: {
        'value': { fromFields: ['value'], fromUntagged: true, combine: 'collect' },
        'min': { fromFields: ['min'], fromUntagged: false, combine: { reduce: 'min' } },
        'max': { fromFields: ['max'], fromUntagged: false, combine: { reduce: 'max' } },
      },
      reshape: 'none',
    };
    const broadcastResultType = context.broadcast(broadcastConfig, inputType);
    return { kind: 'record', fields: {}, untagged: [broadcastResultType.fields.value] };
  },
  execute: (input: StructorRecord, config: Structor, context: ExecutionContext) => {
    const broadcastConfig: BroadcastConfig = {
      outputs: {
        'value': { fromFields: ['value'], fromUntagged: true, combine: 'collect' },
        'min': { fromFields: ['min'], fromUntagged: false, combine: { reduce: 'min' } },
        'max': { fromFields: ['max'], fromUntagged: false, combine: { reduce: 'max' } },
      },
      reshape: 'none',
    };
    const broadcastResult = context.broadcast(broadcastConfig, input);
    const clamped = broadcastResult.apply((args: any) =>
      Math.max(args.min, Math.min(args.value, args.max))
    );
    return { fields: {}, untagged: [clamped] };
  }
};

export const primitive_fmod = definePrimitiveNode({
  id: 'math.fmod',
  metadata: {
    category: NodeCategory.Math,
    keywords: ['modulo', 'remainder'],
    description: 'Floating point modulo operation.'
  },
  inputs: { dividend: numberType, divisor: numberType },
  outputs: { div: numberType, mod: numberType },
  autoBroadcast: true,
  execute: (inputs, config, context) => {
    const { dividend, divisor } = inputs;
    const div = Math.floor(dividend / divisor);
    const mod = dividend % divisor;
    return { div, mod };
  }
});

export const primitive_literal: PrimitiveNodeDefinition = {
  id: 'data.literal',
  kind: 'primitive',
  metadata: {
    category: NodeCategory.Data,
    keywords: ['value', 'constant'],
    description: 'Outputs a constant value.'
  },
  configType: { kind: 'atomic', type: 'any' }, // This literal can hold any type of value
  computeOutputTypes: (inputType: RecordType, configType: StructorType, context: AnalysisContext) => {
    return { kind: 'record', fields: {}, untagged: [configType] };
  },
  execute: (input: StructorRecord, config: Structor, context: ExecutionContext) => {
    return { fields: {}, untagged: [config] };
  },
};

export const primitive_apply: PrimitiveNodeDefinition = {
  id: 'functional.apply',
  kind: 'primitive',
  metadata: {
    category: NodeCategory.Functional,
    keywords: ['call', 'invoke'],
    description: 'Applies a functor to an input value.'
  },
  computeOutputTypes: (inputType: RecordType, config: StructorType, context: AnalysisContext) => {
    const functorType = inputType.fields['functor'] as FunctorType;
    return { kind: 'record', fields: {}, untagged: [functorType.output] };
  },
  execute: (input: StructorRecord, config: Structor, context: ExecutionContext) => {
    const functor = input.fields['functor'] as Functor;
    const inputValue = input.fields['input'];
    return { fields: {}, untagged: [functor(inputValue)] };
  }
};

export const primitive_input: PrimitiveNodeDefinition = {
  id: 'io.input',
  kind: 'primitive',
  metadata: {
    category: NodeCategory.IO,
    keywords: ['source', 'in'],
    description: 'Graph input node.'
  },
  computeOutputTypes: (inputType: RecordType, config: StructorType, context: AnalysisContext) => {
    // Identity: Output type is same as input type of 'val' (injected by executor) or config type
    const valType = inputType.fields['val'] || config || { kind: 'atomic', type: 'any' };
    return { kind: 'record', fields: { 'val': valType }, untagged: [valType] };
  },
  execute: (input: StructorRecord, config: Structor, context: ExecutionContext) => {
    // Identity: Output value is input 'val' OR config value (from slider)
    const val = input.fields['val'] !== undefined ? input.fields['val'] : config;
    return { fields: { 'val': val }, untagged: [val] };
  }
};

export const primitive_output: PrimitiveNodeDefinition = {
  id: 'io.output',
  kind: 'primitive',
  metadata: {
    category: NodeCategory.IO,
    keywords: ['sink', 'out'],
    description: 'Graph output node.'
  },
  computeOutputTypes: (inputType: RecordType, config: StructorType, context: AnalysisContext) => {
    // Identity: Output type is same as input type of 'val'
    const valType = inputType.fields['val'] || inputType.untagged[0] || { kind: 'atomic', type: 'any' };
    return { kind: 'record', fields: { 'val': valType }, untagged: [valType] };
  },
  execute: (input: StructorRecord, config: Structor, context: ExecutionContext) => {
    // Identity: Output value is input 'val'
    const val = input.fields['val'] !== undefined ? input.fields['val'] : input.untagged[0];
    return { fields: { 'val': val }, untagged: [val] };
  }
};

export const primitive_subgraph: PrimitiveNodeDefinition = {
  id: 'core.subgraph',
  kind: 'primitive',
  metadata: {
    category: NodeCategory.Core,
    keywords: ['nested', 'graph'],
    description: 'Executes a nested subgraph.'
  },
  computeOutputTypes: (inputType: RecordType, config: StructorType, context: AnalysisContext) => {
    // In a real implementation, we would look up the subgraph definition and return its output types.
    // Since we can't access the config value (subgraphId) here, we return Any.
    return { kind: 'record', fields: {}, untagged: [{ kind: 'atomic', type: 'any' }] };
  },
  execute: (input: StructorRecord, config: Structor, context: ExecutionContext) => {
    // Subgraph execution logic would go here.
    return { fields: {}, untagged: [] };
  }
};

export const ALL_PRIMITIVES: PrimitiveNodeDefinition[] = [
  primitive_add,
  primitive_clamp,
  primitive_fmod,
  primitive_literal,
  primitive_apply,
  primitive_input,
  primitive_output,
  primitive_subgraph
];

// --- Math (Constants) ---

export const primitive_pi = definePrimitiveNode({
  id: 'math.pi',
  metadata: { category: NodeCategory.Math, keywords: ['pi', 'constant'], description: 'Returns the value of Pi.' },
  inputs: {},
  outputs: { result: numberType },
  execute: () => ({ result: Math.PI })
});

export const primitive_e = definePrimitiveNode({
  id: 'math.e',
  metadata: { category: NodeCategory.Math, keywords: ['e', 'euler', 'constant'], description: 'Returns the value of Euler\'s number.' },
  inputs: {},
  outputs: { result: numberType },
  execute: () => ({ result: Math.E })
});

export const primitive_lerp = definePrimitiveNode({
  id: 'math.lerp',
  metadata: { category: NodeCategory.Math, keywords: ['lerp', 'mix', 'interpolate'], description: 'Linear interpolation between a and b.' },
  inputs: {
    a: numberType,
    b: numberType,
    t: numberType
  },
  config: {
    clamp: { kind: 'atomic', type: 'boolean', optional: true }
  },
  outputs: { result: numberType },
  autoBroadcast: true,
  execute: (inputs, config) => {
    const { a, b, t } = inputs as { a: number, b: number, t: number };
    const doClamp = config.clamp !== false; // Default to true
    let tClamped = t;
    if (doClamp) {
      tClamped = Math.max(0, Math.min(1, t));
    }
    return { result: a * (1 - tClamped) + b * tClamped };
  }
});

export const primitive_map = definePrimitiveNode({
  id: 'math.map',
  metadata: { category: NodeCategory.Math, keywords: ['map', 'remap', 'range'], description: 'Maps a value from one range to another.' },
  inputs: {
    value: numberType,
    inMin: numberType,
    inMax: numberType,
    outMin: numberType,
    outMax: numberType
  },
  outputs: { result: numberType },
  autoBroadcast: true,
  execute: (inputs) => {
    const { value, inMin, inMax, outMin, outMax } = inputs as { value: number, inMin: number, inMax: number, outMin: number, outMax: number };
    return { result: outMin + (value - inMin) * (outMax - outMin) / (inMax - inMin) };
  }
});

// --- Math (Binary) ---

export const primitive_subtract = defineMathNode(
  'math.subtract',
  { category: NodeCategory.Math, keywords: ['minus', 'difference'], description: 'Subtracts b from a.' },
  (a, b) => a - b
);

export const primitive_multiply = defineMathNode(
  'math.multiply',
  { category: NodeCategory.Math, keywords: ['times', 'product'], description: 'Multiplies a and b.' },
  (a, b) => a * b
);

export const primitive_divide = defineMathNode(
  'math.divide',
  { category: NodeCategory.Math, keywords: ['div', 'quotient'], description: 'Divides a by b.' },
  (a, b) => a / b
);

export const primitive_pow = defineMathNode(
  'math.pow',
  { category: NodeCategory.Math, keywords: ['power', 'exponent'], description: 'Raises a to the power of b.' },
  (a, b) => Math.pow(a, b)
);

export const primitive_min = defineMathNode(
  'math.min',
  { category: NodeCategory.Math, keywords: ['minimum', 'smallest'], description: 'Returns the smaller of a and b.' },
  (a, b) => Math.min(a, b)
);

export const primitive_max = defineMathNode(
  'math.max',
  { category: NodeCategory.Math, keywords: ['maximum', 'largest'], description: 'Returns the larger of a and b.' },
  (a, b) => Math.max(a, b)
);

// --- Math (Unary) ---

export const primitive_abs = defineMathNode(
  'math.abs',
  { category: NodeCategory.Math, keywords: ['absolute', 'magnitude'], description: 'Returns the absolute value of a.' },
  (a) => Math.abs(a),
  'unary'
);

export const primitive_negate = defineMathNode(
  'math.negate',
  { category: NodeCategory.Math, keywords: ['negative', 'invert'], description: 'Negates a.' },
  (a) => -a,
  'unary'
);

export const primitive_ceil = defineMathNode(
  'math.ceil',
  { category: NodeCategory.Math, keywords: ['ceiling', 'round up'], description: 'Rounds a up to the nearest integer.' },
  (a) => Math.ceil(a),
  'unary'
);

export const primitive_floor = defineMathNode(
  'math.floor',
  { category: NodeCategory.Math, keywords: ['floor', 'round down'], description: 'Rounds a down to the nearest integer.' },
  (a) => Math.floor(a),
  'unary'
);

export const primitive_round = defineMathNode(
  'math.round',
  { category: NodeCategory.Math, keywords: ['round', 'nearest'], description: 'Rounds a to the nearest integer.' },
  (a) => Math.round(a),
  'unary'
);

export const primitive_sin = defineMathNode(
  'math.sin',
  { category: NodeCategory.Math, keywords: ['sine'], description: 'Returns the sine of a (radians).' },
  (a) => Math.sin(a),
  'unary'
);

export const primitive_cos = defineMathNode(
  'math.cos',
  { category: NodeCategory.Math, keywords: ['cosine'], description: 'Returns the cosine of a (radians).' },
  (a) => Math.cos(a),
  'unary'
);

export const primitive_tan = defineMathNode(
  'math.tan',
  { category: NodeCategory.Math, keywords: ['tangent'], description: 'Returns the tangent of a (radians).' },
  (a) => Math.tan(a),
  'unary'
);

export const primitive_sqrt = defineMathNode(
  'math.sqrt',
  { category: NodeCategory.Math, keywords: ['square root'], description: 'Returns the square root of a.' },
  (a) => Math.sqrt(a),
  'unary'
);

// --- Logic (Binary) ---

export const primitive_and = defineMathNode(
  'logic.and',
  { category: NodeCategory.Logic, keywords: ['boolean', '&&'], description: 'Logical AND (1 if both non-zero, else 0).' },
  (a, b) => (a !== 0 && b !== 0) ? 1 : 0
);

export const primitive_or = defineMathNode(
  'logic.or',
  { category: NodeCategory.Logic, keywords: ['boolean', '||'], description: 'Logical OR (1 if either non-zero, else 0).' },
  (a, b) => (a !== 0 || b !== 0) ? 1 : 0
);

export const primitive_xor = defineMathNode(
  'logic.xor',
  { category: NodeCategory.Logic, keywords: ['boolean', '^'], description: 'Logical XOR (1 if different truthiness, else 0).' },
  (a, b) => ((a !== 0) !== (b !== 0)) ? 1 : 0
);

export const primitive_equals = defineMathNode(
  'logic.equals',
  { category: NodeCategory.Logic, keywords: ['==', 'equality'], description: 'Returns 1 if a equals b, else 0.' },
  (a, b) => (a === b) ? 1 : 0
);

export const primitive_greater_than = defineMathNode(
  'logic.greater_than',
  { category: NodeCategory.Logic, keywords: ['>', 'gt'], description: 'Returns 1 if a > b, else 0.' },
  (a, b) => (a > b) ? 1 : 0
);

export const primitive_less_than = defineMathNode(
  'logic.less_than',
  { category: NodeCategory.Logic, keywords: ['<', 'lt'], description: 'Returns 1 if a < b, else 0.' },
  (a, b) => (a < b) ? 1 : 0
);

// --- Logic (Unary) ---

export const primitive_not = defineMathNode(
  'logic.not',
  { category: NodeCategory.Logic, keywords: ['!', 'invert'], description: 'Logical NOT (1 if zero, 0 if non-zero).' },
  (a) => (a === 0) ? 1 : 0,
  'unary'
);

export const primitive_hub = definePrimitiveNode({
  id: 'util.hub',
  metadata: { category: NodeCategory.Utility, keywords: ['hub', 'reroute'], description: 'Passes input to output.' },
  inputs: { value: anyType },
  outputs: { value: anyType },
  autoBroadcast: true,
  execute: (inputs) => ({ value: inputs.value })
});

export const primitive_float = definePrimitiveNode({
  id: 'data.float',
  metadata: { category: NodeCategory.Data, keywords: ['float', 'number', 'slider'], description: 'Float value with slider.' },
  inputs: { value: numberType },
  outputs: { value: numberType },
  autoBroadcast: true,
  execute: (inputs) => ({ value: inputs.value })
});

ALL_PRIMITIVES.push(
  primitive_subtract,
  primitive_multiply,
  primitive_divide,
  primitive_pow,
  primitive_min,
  primitive_max,
  primitive_abs,
  primitive_negate,
  primitive_ceil,
  primitive_floor,
  primitive_round,
  primitive_sin,
  primitive_cos,
  primitive_tan,
  primitive_sqrt,
  primitive_and,
  primitive_or,
  primitive_xor,
  primitive_equals,
  primitive_greater_than,
  primitive_less_than,
  primitive_not,
  primitive_pi,
  primitive_e
);