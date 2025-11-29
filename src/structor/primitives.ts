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
import { definePrimitiveNode } from "./type-helpers";
import { numberType, anyType } from "./std-types";

export const primitive_add: PrimitiveNodeDefinition = {
  id: 'math.add',
  kind: 'primitive',
  metadata: {
    category: NodeCategory.Math,
    keywords: ['sum', 'plus'],
    description: 'Adds multiple numbers together.'
  },
  computeOutputTypes: (inputType: RecordType, config: StructorType, context: AnalysisContext): RecordType => {
    const inputNames = [...Object.keys(inputType.fields), ...inputType.untagged.map((_, i) => i)];
    const broadcastConfig: BroadcastConfig = { outputs: {}, reshape: 'vector' };
    for (const name of inputNames) {
      if (typeof name === 'number') {
        broadcastConfig.outputs[`untagged_${name}`] = { fromFields: [], fromUntagged: [name], combine: 'collect', coerceTo: 'number' };
      } else {
        broadcastConfig.outputs[name] = { fromFields: [name], fromUntagged: false, combine: 'collect', coerceTo: 'number' };
      }
    }
    const broadcastResultType = context.broadcast(broadcastConfig, inputType);
    if (broadcastResultType.kind === 'array' && broadcastResultType.size === 1) {
      return { kind: 'record', fields: {}, untagged: [broadcastResultType.element] };
    }
    return { kind: 'record', fields: {}, untagged: [broadcastResultType] };
  },
  execute: (input: StructorRecord, config: Structor, context: ExecutionContext) => {
    const inputNames = [...Object.keys(input.fields), ...input.untagged.map((_, i) => i)];
    const broadcastConfig: BroadcastConfig = { outputs: {}, reshape: 'vector' };
    for (const name of inputNames) {
      if (typeof name === 'number') {
        broadcastConfig.outputs[`untagged_${name}`] = { fromFields: [], fromUntagged: [name], combine: 'collect', coerceTo: 'number' };
      } else {
        broadcastConfig.outputs[name] = { fromFields: [name], fromUntagged: false, combine: 'collect', coerceTo: 'number' };
      }
    }
    const broadcastResult = context.broadcast(broadcastConfig, input);
    const sum = broadcastResult.broadcasted.map((tuple: number[]) => tuple.reduce((a, b) => a + b, 0));
    const result = sum.length === 1 && broadcastResult.broadcasted.length === 1 ? sum[0] : sum;
    return { fields: {}, untagged: [result] };
  }
};

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
    const broadcastResult = context.broadcast(broadcastConfig, input) as { fields: { value: number[], min: number, max: number } };
    const clamped = broadcastResult.fields.value.map(v =>
      Math.max(broadcastResult.fields.min, Math.min(v, broadcastResult.fields.max))
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