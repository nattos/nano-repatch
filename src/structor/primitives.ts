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
  StructorRecord
} from "./structor";

const numberType: AtomicType = { kind: 'atomic', type: 'number' };

export const primitive_add: PrimitiveNodeDefinition = {
  id: 'primitive:add',
  kind: 'primitive',
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
  id: 'primitive:clamp',
  kind: 'primitive',
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

export const primitive_fmod: PrimitiveNodeDefinition = {
  id: 'primitive:fmod',
  kind: 'primitive',
  computeOutputTypes: (inputType: RecordType, config: StructorType, context: AnalysisContext): RecordType => {
    const broadcastConfig: BroadcastConfig = {
      outputs: {
        'dividend': { fromFields: ['dividend'], fromUntagged: false, combine: { reduce: 'first' } },
        'divisor': { fromFields: ['divisor'], fromUntagged: false, combine: { reduce: 'first' } },
      },
      reshape: 'none',
    };
    context.broadcast(broadcastConfig, inputType);
    return { kind: 'record', fields: { 'div': numberType, 'mod': numberType }, untagged: [] };
  },
  execute: (input: StructorRecord, config: Structor, context: ExecutionContext) => {
    const broadcastConfig: BroadcastConfig = {
      outputs: {
        'dividend': { fromFields: ['dividend'], fromUntagged: false, combine: { reduce: 'first' } },
        'divisor': { fromFields: ['divisor'], fromUntagged: false, combine: { reduce: 'first' } },
      },
      reshape: 'none',
    };
    const broadcastResult = context.broadcast(broadcastConfig, input) as { fields: { dividend: number, divisor: number } };
    const { dividend, divisor } = broadcastResult.fields;
    const div = Math.floor(dividend / divisor);
    const mod = dividend % divisor;
    return { fields: { div, mod }, untagged: [] };
  }
};

export const primitive_literal: PrimitiveNodeDefinition = {
  id: 'primitive:literal',
  kind: 'primitive',
  configType: { kind: 'atomic', type: 'any' }, // This literal can hold any type of value
  computeOutputTypes: (inputType: RecordType, configType: StructorType, context: AnalysisContext) => {
    return { kind: 'record', fields: {}, untagged: [configType] };
  },
  execute: (input: StructorRecord, config: Structor, context: ExecutionContext) => {
    return { fields: {}, untagged: [config] };
  },
};

export const primitive_apply: PrimitiveNodeDefinition = {
  id: 'primitive:apply',
  kind: 'primitive',
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
  id: 'primitive:input',
  kind: 'primitive',
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
  id: 'primitive:output',
  kind: 'primitive',
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
  id: 'primitive:subgraph',
  kind: 'primitive',
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