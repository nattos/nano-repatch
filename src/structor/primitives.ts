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
import type { GraphState } from "../builder/state";

// Helper to infer type from value (simple version)
function inferType(value: any): StructorType {
  if (typeof value === 'number') return numberType;
  if (typeof value === 'string') return { kind: 'atomic', type: 'string' };
  if (typeof value === 'boolean') return { kind: 'atomic', type: 'boolean' };
  if (Array.isArray(value)) {
    const elType = value.length > 0 ? inferType(value[0]) : anyType;
    return { kind: 'array', element: elType, size: value.length };
  }
  if (typeof value === 'object' && value !== null) {
    return anyType;
  }
  return anyType;
}

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
  computeForwardPorts: (inputType, config, context) => {
    return {
      inputs: { kind: 'record', fields: {} },
      outputs: { kind: 'record', fields: { value: inferType(config) } }
    };
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
  computeForwardPorts: (inputType, config, context) => {
    const functorType = inputType.fields['functor'] as FunctorType;
    return {
      inputs: inputType,
      outputs: { kind: 'record', fields: { result: functorType ? functorType.output : { kind: 'atomic', type: 'any' } } }
    };
  },
  execute: (input: StructorRecord, config: Structor, context: ExecutionContext) => {
    const functor = input.fields['functor'] as Functor;
    const inputValue = input.fields['input'];
    return { fields: { result: functor(inputValue) } };
  }
};

// Helper to infer type from io.input config
function inferTypeFromConfig(config: any): StructorType | undefined {
  if (!config) return undefined;
  const typeStr = config.type as string;
  if (!typeStr || typeStr === 'any') return undefined;

  if (typeStr === 'float') return { kind: 'atomic', type: 'number' };
  if (typeStr === 'string') return { kind: 'atomic', type: 'string' };
  if (typeStr.startsWith('float')) {
    const size = parseInt(typeStr.slice(5));
    if (!isNaN(size)) {
      return { kind: 'array', size, element: { kind: 'atomic', type: 'number' } };
    }
  }
  return undefined;
}

export const primitive_input: PrimitiveNodeDefinition = {
  id: 'io.input',
  kind: 'primitive',
  metadata: {
    category: NodeCategory.IO,
    keywords: ['source', 'in'],
    description: 'Graph input node.'
  },
  config: {
    type: { kind: 'atomic', type: 'string', defaultValue: 'any', optional: true },
    name: { kind: 'atomic', type: 'string', defaultValue: 'value', optional: true }
  },
  ui: {
    inspector: {
      fields: [
        {
          type: 'structor-type',
          label: 'Type',
          path: 'type',
          default: 'any'
        },
        { type: 'string', label: 'Name', path: 'name' }
      ]
    }
  },
  computeForwardPorts: (inputType, config, context) => {
    // Identity: Output type is same as input type of 'value' (connected) or inferred from 'type' config
    let valType = inputType.fields['value'];
    if (!valType) {
      valType = inferTypeFromConfig(config);
    }

    if (!valType) valType = { kind: 'atomic', type: 'any' };
    return {
      inputs: { kind: 'record', fields: { value: anyType } },
      outputs: { kind: 'record', fields: { 'value': valType } }
    };
  },
  execute: (input: StructorRecord, config: Structor, context: ExecutionContext) => {
    const val = input.fields['value'];
    return { fields: { 'value': val } };
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
  computeForwardPorts: (inputType, config, context) => {
    // Identity: Output type is same as input type of 'val'
    const valType = inputType.fields['value'] || { kind: 'atomic', type: 'any' };
    return {
      inputs: { kind: 'record', fields: { value: valType } },
      outputs: { kind: 'record', fields: { 'value': valType } }
    };
  },
  execute: (input: StructorRecord, config: Structor, context: ExecutionContext) => {
    // Identity: Output value is input 'val'
    const val = input.fields['value'];
    return { fields: { 'value': val } };
  }
};

interface SubgraphConfig {
  subgraphId: string;
}

interface SubgraphAnalysisContext extends AnalysisContext {
  loadedSubgraphs?: Map<string, GraphState>;
}

// Helper for dynamic port naming (replacing #)
export function resolvePortName(name: string, index: number, total: number, kind: 'input' | 'output'): string {
  if (!name || !name.includes('#')) return name;

  let replacement = '';
  if (total === 1) {
    replacement = kind === 'input' ? 'in' : 'out';
  } else if (total <= 4) {
    replacement = ['x', 'y', 'z', 'w'][index];
  } else {
    replacement = index.toString();
  }

  return name.replace(/#/g, replacement);
}

export const primitive_subgraph = definePrimitiveNode({
  id: 'core.subgraph',
  metadata: {
    category: NodeCategory.Core,
    keywords: ['nested', 'graph'],
    description: 'Executes a nested subgraph.'
  },
  config: { subgraphId: { kind: 'atomic', type: 'string' } },
  inputs: {},
  outputs: {},
  ui: {
    inspector: {
      fields: [
        {
          type: 'string',
          label: 'Subgraph ID',
          path: 'subgraphId'
        }
      ]
    }
  },
  computeForwardPorts: (inputType, config, context) => {
    // Access loadedSubgraphs from context (injected by compiler)
    const ctx = context as SubgraphAnalysisContext;
    const loadedSubgraphs = ctx.loadedSubgraphs;

    if (!loadedSubgraphs) {
      return { inputs: { kind: 'record', fields: {} }, outputs: { kind: 'record', fields: {} } };
    }

    // FIXME: There's a widespread problem where configs are typed as Structors, but they aren't actually.
    const subgraphId = (config as any as SubgraphConfig).subgraphId;
    const subgraph = loadedSubgraphs.get(subgraphId);

    if (subgraph) {
      const subgraphNodes = Object.values(subgraph.inner.nodes);

      // Compute Inputs from Subgraph Inputs
      const inputFields: Record<string, StructorType> = {};
      const inputNodes = subgraphNodes
        .filter(n => n.config.typeId === 'io.input' || n.config.typeId === 'input')
        .sort((a, b) => a.y - b.y);

      inputNodes.forEach((n, i) => {
        let name = (n.config as any).name || 'value';
        name = resolvePortName(name, i, inputNodes.length, 'input');
        const inferred = inferTypeFromConfig(n.config);
        inputFields[name] = inferred || { kind: 'atomic', type: 'any' };
      });

      // Compute Outputs from Subgraph Outputs
      const outputFields: Record<string, StructorType> = {};
      const outputNodes = subgraphNodes
        .filter(n => n.config.typeId === 'io.output' || n.config.typeId === 'output')
        .sort((a, b) => a.y - b.y);

      outputNodes.forEach((n, i) => {
        let name = (n.config as any).name || 'value';
        name = resolvePortName(name, i, outputNodes.length, 'output');
        outputFields[name] = { kind: 'atomic', type: 'any' };
      });

      // TODO: We should probably infer better types by looking at what's connected INSIDE the subgraph.
      // E.g. if input node is connected to a math node, we know it's a number.
      // But for now 'any' allows connections.

      // Merge user-defined inputs/outputs if they exist using spread (though currently inputs field is empty)
      return {
        inputs: { kind: 'record', fields: inputFields },
        outputs: { kind: 'record', fields: outputFields }
      };
    }

    return { inputs: { kind: 'record', fields: {} }, outputs: { kind: 'record', fields: {} } };
  },
  execute: (input: StructorRecord, config: Structor, context: ExecutionContext) => {
    // Subgraph execution logic would go here.
    return { fields: {} };
  }
});


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
        kind: 'array',
        size: 4,
        element: numberType,
        hint: 'vec4'
      };
    } else if (type === 'float3') {
      inputFields.x = numberType;
      inputFields.y = numberType;
      inputFields.z = numberType;
      outputFields.result = {
        kind: 'array',
        size: 3,
        element: numberType,
        hint: 'vec3'
      };
    } else { // float2
      inputFields.x = numberType;
      inputFields.y = numberType;
      outputFields.result = {
        kind: 'array',
        size: 2,
        element: numberType,
        hint: 'vec2'
      };
    }

    return {
      inputs: { kind: 'record', fields: inputFields },
      outputs: { kind: 'record', fields: outputFields }
    };
  },

  shouldRecompileOnConfigChange: (newConfig, oldConfig) => {
    return newConfig?.targetType !== oldConfig?.targetType;
  },

  execute: (inputs, config) => {
    // pack receives raw inputs because it has dynamic ports and no autoBroadcast
    // inputs is { fields: { x: val, y: val ... } }
    const fields = (inputs as any)?.fields || {};
    let type = (config?.targetType) || 'infer';

    if (type === 'infer') {
      if (fields.w !== undefined) type = 'float4';
      else if (fields.z !== undefined) type = 'float3';
      else if (fields.y !== undefined && fields.x !== undefined) type = 'float2';
      else type = 'record';
    }

    if (type === 'float4') {
      return { result: [fields.x ?? 0, fields.y ?? 0, fields.z ?? 0, fields.w ?? 0] };
    } else if (type === 'float3') {
      return { result: [fields.x ?? 0, fields.y ?? 0, fields.z ?? 0] };
    } else if (type === 'float2') {
      return { result: [fields.x ?? 0, fields.y ?? 0] };
    } else {
      // Generic Record Packing
      // Must return a StructorRecord structure (without kind, per test expectation)
      return { result: { fields: fields } };
    }
  }
});

export const primitive_unpack: PrimitiveNodeDefinition = {
  id: 'core.unpack',
  kind: 'primitive',
  metadata: { category: NodeCategory.Core, keywords: ['unpack', 'destructure', 'split'], description: 'Unpacks a record or fixed-length vector into outputs.' },
  configType: { kind: 'record', fields: {} },
  inputs: { record: anyType },
  // Outputs: Dynamic based on input record type
  computeForwardPorts: (inputType, config, context) => {
    // console.log('UNPACK computeForwardPorts (350):', JSON.stringify(inputType, null, 2));
    const input = inputType.fields['record'];

    // Default outputs empty
    let outputFields: Record<string, StructorType> = {};

    if (input) {
      if (input.kind === 'record') {
        outputFields = input.fields;
      } else if (input.kind === 'array' && typeof input.size === 'number' && input.size <= 16) {
        const size = input.size;

        if (size === 2) {
          outputFields['x'] = input.element;
          outputFields['y'] = input.element;
        } else if (size === 3) {
          outputFields['x'] = input.element;
          outputFields['y'] = input.element;
          outputFields['z'] = input.element;
        } else if (size === 4) {
          outputFields['x'] = input.element;
          outputFields['y'] = input.element;
          outputFields['z'] = input.element;
          outputFields['w'] = input.element;
        } else {
          for (let i = 0; i < size; i++) {
            outputFields[i.toString()] = input.element;
          }
        }
      }
    }

    return {
      inputs: { kind: 'record', fields: { record: input || anyType } },
      outputs: { kind: 'record', fields: outputFields }
    };
  },
  execute: (input) => {
    let record = input.fields['record'];
    if (!record) return { fields: {} };

    // Standardize Input:
    // GraphExecutor (or any type inputs) might wrap single objects in an array.
    // If it's a single-element array containing a Record/Object, unwrap it first.
    if (Array.isArray(record) && record.length === 1 && typeof record[0] === 'object' && record[0] !== null) {
      const item = record[0];
      // Check if it's a candidate for unpacking (has keys)
      if ('x' in item || 'fields' in item || Object.keys(item).length > 0) {
        record = item;
      }
    }

    // PATH 1: Array (Vector [x, y, z...])
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
        for (let i = 0; i < size; i++) {
          if (i < 16) fields[i.toString()] = record[i];
        }
      }
      return { fields };
    }

    // PATH 2: Record (Structor Record or Plain Object)
    if (typeof record === 'object' && record !== null) {
      if ('fields' in record) {
        return record as StructorRecord;
      }
      // Plain object -> map keys to fields
      return { fields: record };
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
    // Allow multi-connection to collect multiple inputs into an array
    inputs: { values: { kind: 'array', element: anyType, size: 'dynamic', allowMultiConnection: true } },
    outputs: { result: numberType }, // Output is dynamic (scalar or vector)
    computeForwardPorts: (inputTypes, config, context) => {
      const valuesInput = inputTypes.fields['values'];
      let outputType: StructorType = numberType;

      // Check if we have an array of inputs (because of reduce/collect)
      if (valuesInput && valuesInput.kind === 'array') {
        // The element of the 'values' array represents the types of the connected cables.
        const elementType = valuesInput.element;

        if (elementType.kind === 'array') {
          // Collection of Arrays (e.g. [Array<Number>])
          outputType = elementType;
        } else if (elementType.kind === 'record') {
          // Collection of Records (e.g. [{x,y,z,w}])
          // Propagate the record type!
          outputType = elementType;
        }
      }

      return {
        inputs: { kind: 'record', fields: { values: valuesInput } },
        outputs: { kind: 'record', fields: { result: outputType } }
      };
    },
    execute: (inputs) => {
      const values = inputs.values as any[];
      if (!values || values.length === 0) return { result: 0 };

      // Check if first element is array or Record Vector
      const first = values[0];
      const firstIsArray = Array.isArray(first);
      let firstIsRecordVec = false;
      let vecKeys: string[] = [];

      if (!firstIsArray && typeof first === 'object' && first !== null) {
        if (typeof first.x === 'number' && typeof first.y === 'number') {
          firstIsRecordVec = true;
          vecKeys = ['x', 'y'];
          if (typeof first.z === 'number') vecKeys.push('z');
          if (typeof first.w === 'number') vecKeys.push('w');
        }
      }

      if (firstIsArray || firstIsRecordVec || typeof first === 'number') {
        // Vector mode (Scalar is treated as 1D vector)
        const length = firstIsArray ? first.length : (firstIsRecordVec ? vecKeys.length : 1);
        const result = new Array(length);

        for (let i = 0; i < length; i++) {
          // Extract accumulator (first value)
          let val = firstIsArray ? first[i] : (firstIsRecordVec ? first[vecKeys[i]] : first);


          for (let j = 1; j < values.length; j++) {
            const rawOperand = values[j];
            let operand: number;

            // Handle mixed types by broadcasting or extracting
            if (Array.isArray(rawOperand)) {
              operand = rawOperand[i] ?? 0; // Fallback? or NaN
            } else if (typeof rawOperand === 'object' && rawOperand !== null && 'x' in rawOperand) {
              // Assuming compatible record
              // If rawOperand is shorter (e.g. vec2 vs vec4), what to do?
              // Just try to access the key. If undefined, NaN or 0?
              // JS generic access:
              const key = vecKeys[i];
              operand = (rawOperand as any)[key];
              if (operand === undefined) operand = 0; // Safe fallback?
            } else {
              // Scalar broadcast
              operand = rawOperand as number;
            }

            val = op(val, operand);
          }
          result[i] = val;
        }

        if (firstIsRecordVec) {
          const resRecord: any = {};
          vecKeys.forEach((k, i) => resRecord[k] = result[i]);
          return { result: resRecord };
        } else if (!firstIsArray) {
          // Scalar input -> Scalar output
          return { result: result[0] };
        }

        return { result: result };

        return { result };
      } else {
        // Scalar mode (or mixed starting with scalar)
        // ... (existing scalar logic) ...
        // Note: Existing scalar logic supports [scalar, vector]. outputting vector.
        // We might want to update it to support [scalar, record] too?
        // Let's copy-paste existing logic but enhance it slightly for records?
        // Actually, the existing logic (lines 744-771) specifically checks Array.isArray.
        // It should be updated to handle Records too if we want full robustness.
        // But the primary case "vector input" is handled by the block above.
        // Let's patch the "Accumulator is scalar, B is vector" case.

        let accumulator: any = values[0];

        for (let i = 1; i < values.length; i++) {
          const b = values[i];

          // Helper to check if item is vector-like (Array or Record)
          const isVec = (v: any) => Array.isArray(v) || (typeof v === 'object' && v !== null && typeof v.x === 'number');

          const accIsVec = isVec(accumulator);
          const bIsVec = isVec(b);

          if (accIsVec) {
            // (Logic handled by recursion/normalization? No, we are in loop)
            // If Accumulator BECAME a vector (from previous step), we need to iterate it.
            // Converting to unified format (Array) might be easier.
          }

          // REWRITE: Simplified Universal Logic
          // If ANY input is a vector, we should upgrade to vector mode?
          // But strict left-associative reduction:
          // 1 + [2,2] -> [3,3]
          // [3,3] + 4 -> [7,7]
          // The previous code handled this manually.

          // Let's stick to modifying the EXISTING scalar block to just support Records in 'b'.
          if (Array.isArray(accumulator)) {
            // ...
            // Update this block?
          }
          // Honestly, if the FIRST element was scalar, we fall here.
          // If we encounter a Record later, we should broadcast the scalar accumulator to it.
        }

        // To minimize risk, I will just REPLACE the execution body with a unified version
        // that converts everything to "Generic Vector Accessor" view?

        // Re-implementing strictly:

        let acc = values[0];

        for (let i = 1; i < values.length; i++) {
          const b = values[i];

          const isAccVec = Array.isArray(acc) || (typeof acc === 'object' && acc !== null && typeof acc.x === 'number');
          const isBVec = Array.isArray(b) || (typeof b === 'object' && b !== null && typeof b.x === 'number');

          if (!isAccVec && !isBVec) {
            acc = op(acc, b);
          } else {
            // Vector operation
            // Normalize both to Arrays for operation
            const getComp = (v: any, idx: number, keys: string[]) => {
              if (typeof v === 'number') return v;
              if (Array.isArray(v)) return v[idx];
              if (keys.length > 0) return v[keys[idx]];
              return 0;
            };

            const getKeys = (v: any) => {
              if (typeof v === 'object' && v !== null && !Array.isArray(v) && typeof v.x === 'number') {
                const ks = ['x', 'y'];
                if (typeof v.z === 'number') ks.push('z');
                if (typeof v.w === 'number') ks.push('w');
                return ks;
              }
              return [];
            };

            const getLen = (v: any, keys: string[]) => {
              if (Array.isArray(v)) return v.length;
              if (keys.length > 0) return keys.length;
              return 1;
            };

            const accKeys = getKeys(acc);
            const bKeys = getKeys(b);
            const keys = accKeys.length > bKeys.length ? accKeys : bKeys; // Take larger record def

            const len = Math.max(getLen(acc, accKeys), getLen(b, bKeys));
            const next = new Array(len);

            for (let k = 0; k < len; k++) {
              const vA = getComp(acc, k, keys); // keys might be empty if Array
              const vB = getComp(b, k, keys);
              next[k] = op(vA, vB);
            }

            // If we started with a Record accumulator, try to maintain Record?
            // Or if B was Record and Acc was scalar?
            // Should return Record if 'keys' is valid?
            if (keys.length > 0) {
              const rec: any = {};
              keys.forEach((key, idx) => rec[key] = next[idx]);
              acc = rec;
            } else {
              acc = next;
            }
          }
        }
        return { result: acc };
      }
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
  // primitive_input, primitive_output, primitive_subgraph, // Registered manually in repository.ts with enhanced defs
  primitive_literal, primitive_apply,
  primitive_pack, primitive_unpack,

  // All variants
  primitive_all_add, primitive_all_subtract, primitive_all_multiply, primitive_all_divide, primitive_all_pow, primitive_all_min, primitive_all_max,
  primitive_all_and, primitive_all_or, primitive_all_xor, primitive_all_equals, primitive_all_greater_than, primitive_all_less_than
];