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

export const primitive_clamp = definePrimitiveNode({
  id: 'math.clamp',
  metadata: {
    category: NodeCategory.Math,
    keywords: ['limit', 'range'],
    description: 'Clamps a value between a minimum and maximum.'
  },
  inputs: { value: numberType, min: { ...numberType, defaultValue: 0 }, max: { ...numberType, defaultValue: 1 } },
  outputs: { result: numberType },
  autoBroadcast: {
    value: { combine: 'collect' },
    min: { combine: 'collect' },
    max: { combine: 'collect' }
  },
  reshape: 'vector',
  execute: (inputs) => {
    const { value, min, max } = inputs as { value: number, min: number, max: number };
    return { result: Math.max(min, Math.min(value, max)) };
  }
});

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
    return { kind: 'record', fields: { value: configType } };
  },
  execute: (input: StructorRecord, config: Structor, context: ExecutionContext) => {
    return { fields: { value: config } };
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
    return { kind: 'record', fields: { result: functorType.output } };
  },
  execute: (input: StructorRecord, config: Structor, context: ExecutionContext) => {
    const functor = input.fields['functor'] as Functor;
    const inputValue = input.fields['input'];
    return { fields: { result: functor(inputValue) } };
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
    return { kind: 'record', fields: { 'val': valType } };
  },
  execute: (input: StructorRecord, config: Structor, context: ExecutionContext) => {
    // Identity: Output value is input 'val' OR config value (from slider)
    const val = input.fields['val'] !== undefined ? input.fields['val'] : config;
    return { fields: { 'val': val } };
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
    const valType = inputType.fields['val'] || { kind: 'atomic', type: 'any' };
    return { kind: 'record', fields: { 'val': valType } };
  },
  execute: (input: StructorRecord, config: Structor, context: ExecutionContext) => {
    // Identity: Output value is input 'val'
    const val = input.fields['val'];
    return { fields: { 'val': val } };
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
    return { kind: 'record', fields: { output: { kind: 'atomic', type: 'any' } } };
  },
  execute: (input: StructorRecord, config: Structor, context: ExecutionContext) => {
    // Subgraph execution logic would go here.
    return { fields: {} };
  }
};

export const primitive_pack = definePrimitiveNode({
    id: 'core.pack',
    metadata: { category: NodeCategory.Core, keywords: ['pack', 'record', 'struct', 'vector'], description: 'Packs inputs into a record or vector.' },
    config: {
        targetType: { kind: 'atomic', type: 'string', defaultValue: 'infer' }
    },
    inputs: {}, // Dynamic
    outputs: { result: anyType }, // Dynamic

    // UI Configuration (manually attached for now to avoid circular deps)
    // @ts-ignore
    ui: {
        inspector: {
            fields: [
                {
                    type: 'tab-bar',
                    label: 'Target Type',
                    path: 'targetType',
                    options: [
                        { label: 'Infer', value: 'infer' },
                        { label: 'Vec2', value: 'float2' },
                        { label: 'Vec3', value: 'float3' },
                        { label: 'Vec4', value: 'float4' }
                    ]
                }
            ]
        }
    },

    computeBackwardPorts: (outputReqs, config, context) => {
        const targetType = (config as any)?.targetType || 'infer';
        let inferredType: 'float2' | 'float3' | 'float4' | null = null;

        if (targetType === 'infer') {
             // Look at output requirements on 'result' port
             const resultReq = outputReqs.fields['result'];

             if (resultReq && resultReq.kind === 'record') {
                 if (resultReq.fields['x'] && resultReq.fields['y'] && resultReq.fields['z'] && resultReq.fields['w']) {
                     inferredType = 'float4';
                 } else if (resultReq.fields['x'] && resultReq.fields['y'] && resultReq.fields['z']) {
                     inferredType = 'float3';
                 } else if (resultReq.fields['x'] && resultReq.fields['y']) {
                     inferredType = 'float2';
                 }
             }
        } else {
             inferredType = targetType as any;
        }

        const inputReqs: any = { kind: 'record', fields: {} };
        if (inferredType === 'float4') {
            inputReqs.fields = { x: numberType, y: numberType, z: numberType, w: numberType };
        } else if (inferredType === 'float3') {
            inputReqs.fields = { x: numberType, y: numberType, z: numberType };
        } else if (inferredType === 'float2') {
             inputReqs.fields = { x: numberType, y: numberType };
        }

        return {
            inputRequirements: inputReqs,
            backwardMetadata: { inferredType }
        };
    },

    computeForwardPorts: (inputs, config, context, meta) => {
        // Defensive read: check both root and fields
        const rawConfig = config as any;
        const targetType = rawConfig?.targetType || rawConfig?.fields?.targetType || 'infer';

        // console.log('primitive_pack: computeForwardPorts', { config, targetType });

        // If explicit config is set, usage that. Otherwise use inferred.
        let type = targetType !== 'infer' ? targetType : (meta?.inferredType || 'float2');

        // Finalize inputs based on type
        const inputFields: any = {};
        const outputFields: any = {};

        // If type is not one of the vectors (e.g. unknown inference), fallback to float2?
        // Or if we have inputs connected?
        // Let's default to float2 if nothing known.
        if (!['float2', 'float3', 'float4'].includes(type)) type = 'float2';

        if (type === 'float4') {
            inputFields.x = numberType;
            inputFields.y = numberType;
            inputFields.z = numberType;
            inputFields.w = numberType;
            outputFields.result = {
                kind: 'record',
                fields: { x: numberType, y: numberType, z: numberType, w: numberType },
                hint: 'vec4'
            };
        } else if (type === 'float3') {
            inputFields.x = numberType;
            inputFields.y = numberType;
            inputFields.z = numberType;
            outputFields.result = {
                kind: 'record',
                fields: { x: numberType, y: numberType, z: numberType },
                hint: 'vec3'
            };
        } else { // float2
            inputFields.x = numberType;
            inputFields.y = numberType;
            outputFields.result = {
                kind: 'record',
                fields: { x: numberType, y: numberType },
                hint: 'vec2'
            };
        }

        return {
            inputs: { kind: 'record', fields: inputFields },
            outputs: { kind: 'record', fields: outputFields }
        };
    },

    execute: (inputs) => {
        // Inputs are already collected into 'inputs' object by executor
        // We just need to pack them into 'result'
        // The forward pass ensures the output type matches the inputs we asked for.
        // We can just return the inputs object as the result record.
        return { result: inputs };
    }
});

export const primitive_unpack: PrimitiveNodeDefinition = {
    id: 'core.unpack',
    kind: 'primitive',
    metadata: { category: NodeCategory.Core, keywords: ['unpack', 'destructure', 'split'], description: 'Unpacks a record or fixed-length vector into outputs.' },
    configType: { kind: 'record', fields: {} },
    inputs: { record: anyType },
    // Outputs: Dynamic based on input record type
    computeOutputTypes: (inputType, config, context) => {
        const input = inputType.fields['record'];
        if (!input) return { kind: 'record', fields: {} };

        if (input.kind === 'record') {
            return input;
        }

        if (input.kind === 'array' && typeof input.size === 'number' && input.size <= 16) {
             const size = input.size;
             const fields: Record<string, StructorType> = {};

             if (size === 2) {
                 fields['x'] = input.element;
                 fields['y'] = input.element;
             } else if (size === 3) {
                 fields['x'] = input.element;
                 fields['y'] = input.element;
                 fields['z'] = input.element;
             } else if (size === 4) {
                 fields['x'] = input.element;
                 fields['y'] = input.element;
                 fields['z'] = input.element;
                 fields['w'] = input.element;
             } else {
                 for(let i=0; i<size; i++) {
                     fields[i.toString()] = input.element;
                 }
             }
             return { kind: 'record', fields };
        }

        return { kind: 'record', fields: {} };
    },
    execute: (input) => {
        const record = input.fields['record'];
        if (!record) return { fields: {} };

        // Handle Record
        if (typeof record === 'object' && 'fields' in record) {
             return record as StructorRecord;
        }

        // Handle Array (Vector)
        if (Array.isArray(record)) {
            const size = record.length;
            const fields: Record<string, any> = {};

            if (size === 2) {
                 fields['x'] = record[0];
                 fields['y'] = record[1];
            } else if (size === 3) {
                 fields['x'] = record[0];
                 fields['y'] = record[1];
                 fields['z'] = record[2];
            } else if (size === 4) {
                 fields['x'] = record[0];
                 fields['y'] = record[1];
                 fields['z'] = record[2];
                 fields['w'] = record[3];
            } else {
                 for(let i=0; i<size; i++) {
                     if (i < 16) fields[i.toString()] = record[i];
                 }
            }
            return { fields };
        }

        return { fields: {} };
    }
};


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
  ui: primitive_pack.ui,
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
    // console.log('Lerp execute:', inputs, config);
    const { a, b, t } = inputs as { a: number, b: number, t: number };
    const doClamp = config.clamp !== false; // if undefined, it's true. if true, it's true. if false, it's false.

    const val = a + (b - a) * t;

    const result = doClamp
      ? Math.max(Math.min(val, Math.max(a, b)), Math.min(a, b))
      : val;

    return { result };
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

// Helper for "all" nodes
const defineAllNode = (
  id: string,
  op: (a: number, b: number) => number,
  category: NodeCategory = NodeCategory.Math
) => {
  return definePrimitiveNode({
    id,
    metadata: { category, description: `Apply ${id.split('.').pop()} to all inputs.` },
    inputs: { values: { kind: 'array', element: numberType, size: 'dynamic' } },
    outputs: { result: numberType },
    autoBroadcast: { values: { combine: 'collect' } },
    execute: (inputs) => {
      const values = (inputs.values as any[]).flat();
      if (values.length === 0) return { result: 0 };
      return { result: values.reduce(op) };
    }
  });
};

export const primitive_all_add = defineAllNode('math.all.add', (a, b) => a + b);
export const primitive_all_subtract = defineAllNode('math.all.subtract', (a, b) => a - b);
export const primitive_all_multiply = defineAllNode('math.all.multiply', (a, b) => a * b);
export const primitive_all_divide = defineAllNode('math.all.divide', (a, b) => a / b);
export const primitive_all_pow = defineAllNode('math.all.pow', (a, b) => Math.pow(a, b));
export const primitive_all_min = defineAllNode('math.all.min', (a, b) => Math.min(a, b));
export const primitive_all_max = defineAllNode('math.all.max', (a, b) => Math.max(a, b));

export const primitive_all_and = defineAllNode('logic.all.and', (a, b) => (a && b ? 1 : 0), NodeCategory.Logic);
export const primitive_all_or = defineAllNode('logic.all.or', (a, b) => (a || b ? 1 : 0), NodeCategory.Logic);
export const primitive_all_xor = defineAllNode('logic.all.xor', (a, b) => ((!!a !== !!b) ? 1 : 0), NodeCategory.Logic);
export const primitive_all_equals = defineAllNode('logic.all.equals', (a, b) => (a === b ? 1 : 0), NodeCategory.Logic);
export const primitive_all_greater_than = defineAllNode('logic.all.greater_than', (a, b) => (a > b ? 1 : 0), NodeCategory.Logic);
export const primitive_all_less_than = defineAllNode('logic.all.less_than', (a, b) => (a < b ? 1 : 0), NodeCategory.Logic);

export const ALL_PRIMITIVES = [
  primitive_add, primitive_subtract, primitive_multiply, primitive_divide, primitive_pow, primitive_min, primitive_max,
  primitive_clamp, primitive_fmod, primitive_abs, primitive_negate, primitive_ceil, primitive_floor, primitive_round,
  primitive_sin, primitive_cos, primitive_tan, primitive_sqrt,
  primitive_and, primitive_or, primitive_xor, primitive_equals, primitive_greater_than, primitive_less_than, primitive_not,
  primitive_pi, primitive_e,
  primitive_lerp, primitive_map, primitive_hub, primitive_float,
  primitive_input, primitive_output, primitive_subgraph, primitive_literal, primitive_apply,
  primitive_pack, primitive_unpack,

  // All variants
  primitive_all_add, primitive_all_subtract, primitive_all_multiply, primitive_all_divide, primitive_all_pow, primitive_all_min, primitive_all_max,
  primitive_all_and, primitive_all_or, primitive_all_xor, primitive_all_equals, primitive_all_greater_than, primitive_all_less_than
];