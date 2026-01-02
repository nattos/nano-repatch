import {
  StructorType,
  AtomicType,
  ArrayType,
  RecordType,
  PrimitiveNodeDefinition,
  StructorRecord,
  ExecutionContext,
  Structor,
  BroadcastConfig,
  NodeMetadata,
  AnalysisContext
} from './structor';

export const NumberType = { kind: 'atomic' as const, type: 'number' as const, defaultValue: 0 };
export const StringType = { kind: 'atomic' as const, type: 'string' as const, defaultValue: '' };
export const AnyType: StructorType = { kind: 'atomic', type: 'any' };

// --- Type Inference Helpers ---

export type InferStructorType<T extends StructorType> =
  T extends { optional: true }
  ? InferStructorTypeBase<T> | undefined | null
  : InferStructorTypeBase<T>;

type InferStructorTypeBase<T extends StructorType> =
  T extends AtomicType ? InferAtomic<T> :
  T extends ArrayType ? Array<InferStructorType<T['element']>> :
  T extends RecordType ? InferRecord<T> :
  any;

type InferAtomic<T extends AtomicType> =
  T['type'] extends 'number' ? number :
  T['type'] extends 'string' ? string :
  T['type'] extends 'boolean' ? boolean :
  any;

export type InferRecord<T extends RecordType> =
  { [K in keyof T['fields']as T['fields'][K] extends { optional: true } ? K : never]?: InferStructorType<T['fields'][K]> } &
  { [K in keyof T['fields']as T['fields'][K] extends { optional: true } ? never : K]: InferStructorType<T['fields'][K]> };

// Helper to define a type while preserving its literal nature for inference
export function defineType<T extends StructorType>(t: T): T {
  return t;
}

// --- Type Enforcement Helpers ---

export type TypedStructorType<T> =
  T extends number ? { kind: 'atomic', type: 'number' } & Partial<AtomicType> :
  T extends string ? { kind: 'atomic', type: 'string' } & Partial<AtomicType> :
  T extends boolean ? { kind: 'atomic', type: 'boolean' } & Partial<AtomicType> :
  T extends (infer U)[] ? { kind: 'array', element: TypedStructorType<U> } & Partial<ArrayType> :
  T extends Record<string, any> ? TypedRecordType<T> :
  StructorType;

export type TypedRecordType<T> = {
  kind: 'record';
  fields: {
    [K in keyof T]-?: TypedStructorType<NonNullable<T[K]>> & (undefined extends T[K] ? { optional: true } : unknown)
  };
} & Partial<Omit<RecordType, 'fields'>>;

export function defineRecordType<T>(def: TypedRecordType<T>): RecordType {
  return def as unknown as RecordType;
}


// --- Marshalling Helpers ---

function fromStructor(value: Structor, type: StructorType): any {
  if (value === undefined || value === null) return value;

  if (type.kind === 'atomic') {
    if (value && typeof value === 'object' && 'kind' in value && (value as any).kind === 'atomic') {
      return (value as any).value;
    }
    return value;
  }

  if (type.kind === 'array') {
    if (Array.isArray(value)) {
      return value.map(v => fromStructor(v, type.element));
    }
    return []; // Should not happen if types match
  }

  if (type.kind === 'record') {
    // Value could be StructorRecord OR plain object (if system is loose)
    if (typeof value === 'object') {
      // Check if it's a StructorRecord (has fields)
      if ('fields' in value) {
        const rec = value as StructorRecord;
        const result: any = {};
        for (const [k, fieldType] of Object.entries(type.fields)) {
          if (k in rec.fields) {
            result[k] = fromStructor(rec.fields[k], fieldType);
          }
        }

        return result;
      }
      // Fallback: treat as plain object (already unwrapped or loose)
      // We still need to recursively unwrap fields if they are StructorRecords
      const result: any = {};
      for (const [k, fieldType] of Object.entries(type.fields)) {
        if (k in value) {
          result[k] = fromStructor((value as any)[k], fieldType);
        }
      }

      return result;
    }
    return value;
  }

  return value;
}

function toStructor(value: any, type: StructorType): Structor {
  if (value === undefined || value === null) return value; // Or throw?

  if (type.kind === 'atomic') return value;

  if (type.kind === 'array') {
    if (Array.isArray(value)) {
      const res = value.map(v => toStructor(v, type.element));
      // console.error('toStructor array res', res);
      return res;
    }
    console.error('toStructor array fail: not array', value);
    return [];
  }

  if (type.kind === 'record') {
    const fields: Record<string, Structor> = {};
    for (const [k, fieldType] of Object.entries(type.fields)) {
      if (value[k] !== undefined) {
        fields[k] = toStructor(value[k], fieldType);
      }
    }
    return { fields };
  }

  return value;
}

// --- Node Definition Helper ---

export type NodeInputsDef = Record<string, StructorType & { redirect?: string; defaultValue?: any }>;
export type NodeConfigDef = Record<string, StructorType>;
export type NodeOutputsDef = Record<string, StructorType>;

export interface TypedNodeOptions<
  TInputs extends NodeInputsDef,
  TConfig extends NodeConfigDef,
  TOutputs extends NodeOutputsDef,
  TState = undefined
> {
  id: string;
  metadata?: NodeMetadata;
  inputs?: TInputs;
  config?: TConfig;
  outputs: TOutputs;
  dynamicOutputType?: StructorType; // Allow dynamic keys with this type
  isRealtime?: (config: Structor) => boolean;

  /**
   * Optional factory for creating the initial state of the node.
   * If provided, the execute function will receive the state as the 4th argument.
   */
  createState?: (
    config: InferRecord<{ kind: 'record', fields: TConfig, untagged: [] }>,
    context: ExecutionContext
  ) => TState;

  /**
   * If true, inputs are automatically broadcasted to match the input definition.
   * Can also be a record to override specific input broadcast settings.
   */
  autoBroadcast?: boolean | Record<string, Partial<TypedBroadcastChannel>>;
  reshape?: 'none' | 'vector';
  onMessage?: (state: TState, message: any) => void;

  computeBackwardPorts?: (
    outputRequirements: RecordType,
    config: Structor,
    context: AnalysisContext,
  ) => {
    inputRequirements: RecordType;
    backwardMetadata?: any;
  };

  computeForwardPorts?: (
    inputTypes: RecordType,
    config: Structor,
    context: AnalysisContext,
    backwardMetadata?: any,
  ) => { inputs: RecordType; outputs: RecordType };

  shouldRecompileOnConfigChange?: (
    newConfig: InferRecord<{ kind: 'record', fields: TConfig, untagged: [] }>,
    oldConfig: InferRecord<{ kind: 'record', fields: TConfig, untagged: [] }>
  ) => boolean;

  ui?: any;

  execute: (
    inputs: InferRecord<{ kind: 'record', fields: TInputs, untagged: [] }>,
    config: InferRecord<{ kind: 'record', fields: TConfig, untagged: [] }>,
    context: ExecutionContext,
    state: TState
  ) => InferRecord<{ kind: 'record', fields: TOutputs, untagged: [] }> | { outputs: InferRecord<{ kind: 'record', fields: TOutputs, untagged: [] }>; ui?: any };

  getDisplayLabel?: (config: InferRecord<{ kind: 'record', fields: TConfig, untagged: [] }>) => string | undefined;

  subgraphExpansionTag?: string;
}

export function definePrimitiveNode<
  TInputs extends NodeInputsDef,
  TConfig extends NodeConfigDef,
  TOutputs extends NodeOutputsDef,
  TState = undefined
>(
  options: TypedNodeOptions<TInputs, TConfig, TOutputs, TState>
): PrimitiveNodeDefinition {
  const configType: RecordType = defineRecordType({
    kind: 'record',
    fields: (options.config || {}) as any
  });

  const outputType: RecordType = defineRecordType({
    kind: 'record',
    fields: options.outputs as any
  });

  return {
    id: options.id,
    kind: 'primitive',
    metadata: options.metadata,
    inputs: options.inputs, // Expose inputs for reflection
    outputs: options.outputs, // Expose outputs for reflection
    configType,
    isRealtime: options.isRealtime,
    onMessage: options.onMessage,
    getDisplayLabel: options.getDisplayLabel as any, // Cast to generic Structor type
    subgraphExpansionTag: options.subgraphExpansionTag,
    computeBackwardPorts: options.computeBackwardPorts,
    computeForwardPorts: (i, c, ctx, meta) => {
      if (options.computeForwardPorts) {
        return options.computeForwardPorts(i, c, ctx, meta);
      }
      const inputFields: RecordType = defineRecordType({
        kind: 'record',
        fields: (options.inputs || {}) as any
      });
      return { inputs: inputFields, outputs: outputType }; // Fallback using static inputs
    },
    shouldRecompileOnConfigChange: (newConfig, oldConfig) => {
      if (options.shouldRecompileOnConfigChange) {
        // Pass raw config through. Cast to 'any' to satisfy typed interface which expects unwrapped config.
        // In practice, primitives often handle raw config safely or the unwrap logic matches.
        return options.shouldRecompileOnConfigChange(newConfig as any, oldConfig as any);
      }
      return false;
    },
    ui: options.ui,
    createState: options.createState as any,
    execute: (rawInput, rawConfig, context) => {
      // Unwrap config
      const processedConfig = fromStructor(rawConfig, configType);

      // Handle State
      let state: TState = undefined as any;
      if (options.createState) {
        const key = context.nodeId || `${options.id}-${JSON.stringify(rawConfig)}`;
        if (!context.nodeState.has(key)) {
          context.nodeState.set(key, options.createState(processedConfig, context));
        }
        state = context.nodeState.get(key);
      }

      let processedInput: any = rawInput;

      if (options.autoBroadcast && options.inputs) {

        const broadcastConfig: BroadcastConfig = {
          outputs: {},
          reshape: options.reshape ?? 'none'
        };

        const overrides = typeof options.autoBroadcast === 'object' ? options.autoBroadcast : {};

        for (const [key, type] of Object.entries(options.inputs)) {
          const isArray = type.kind === 'array';
          const override = overrides[key];
          const defaultCombine = isArray ? 'collect' : { reduce: 'first' } as const;
          const combine = (override && 'combine' in override) ? override.combine : defaultCombine;

          broadcastConfig.outputs[key] = {
            fromFields: [key],
            combine: combine ?? undefined
          };
        }
        // console.error('Broadcast call:', { nodeId: options.id, configKeys: Object.keys(broadcastConfig.outputs) });
        const broadcasted = context.broadcast(broadcastConfig, rawInput);

        const result = broadcasted.apply((args: any) => {

          // Unwrap inputs
          const inputs: any = {};
          for (const [key, type] of Object.entries(options.inputs!)) {
            const isCollect = broadcastConfig.outputs[key]?.combine === 'collect';
            if (isCollect && Array.isArray(args[key])) {
              const mapped = args[key].map((v: any) => {
                // If v is a collected list of inputs (e.g. Reference<Sequence>[]), we needs to map each one.
                if (Array.isArray(v) && v.length > 0 && Array.isArray(v[0]) && type.kind === 'array' && type.element.kind === 'record') {
                  return v.map(item => fromStructor(item, type.element));
                }

                // Logic: If type is Nested (Array<Array>), we expect v to be Array.
                // If v is flat Array (Stream), and type is Nested, use type.element (Unwrap as Stream).
                // If type is Not Nested (Array), and v is Array (Stream), use type (Unwrap as Stream).
                const typeIsNested = type.element?.kind === 'array';
                const valueIsNested = Array.isArray(v) && v.length > 0 && Array.isArray(v[0]);

                if (typeIsNested && !valueIsNested) {
                  return fromStructor(v, type.element);
                }
                return fromStructor(v, type);
              });

              // Conditional flatten:
              // If we collected a single stream [Stream], flatten to Stream if type expects Stream (not Nested).
              // If type expects List of Streams (Nested), keep [Stream] (or [ [Seq1] ]).
              // We check type.element.kind to see if the NODE TYPE expects a nested array.
              const typeIsNested = type.element?.kind === 'array';
              if (mapped.length === 1 && Array.isArray(mapped[0]) && !typeIsNested) {
                inputs[key] = mapped[0];
              } else {
                inputs[key] = mapped;
              }
            } else {
              const val = args[key];
              // Heuristic: if type anticipates nesting (Wrapped Array) but value is flat (Scalar/Stream), unwrap using inner element.
              const typeIsNested = type.element?.kind === 'array';
              const valueIsNested = Array.isArray(val) && val.length > 0 && Array.isArray(val[0]);

              let unwrap;
              if (type.kind === 'array' && typeIsNested && !valueIsNested) {
                unwrap = fromStructor(val, type.element);
              } else {
                unwrap = fromStructor(val, type);
              }
              inputs[key] = unwrap !== undefined ? unwrap : (type as any).defaultValue;
            }
          }
          // console.error('Execute Inputs:', JSON.stringify(inputs));


          // Execute


          const execResult = options.execute(inputs, processedConfig, context, state);
          // console.error('Execute Result:', JSON.stringify(execResult));
          return execResult;
        });

        // Transpose result if it's an array (vector broadcast)
        if (Array.isArray(result)) {
          if (result.length > 0) {
            const fields: Record<string, Structor[]> = {};
            const first = result[0];
            for (const key of Object.keys(first)) {
              fields[key] = [];
            }

            for (const res of result) {
              for (const [key, val] of Object.entries(res)) {
                if (fields[key]) fields[key].push(val as Structor);
              }
            }

            // Wrap outputs
            const wrappedFields: Record<string, Structor> = {};
            for (const [key, val] of Object.entries(fields)) {
              const type = options.outputs[key] || options.dynamicOutputType;
              if (type) {
                wrappedFields[key] = toStructor(val, { kind: 'array', element: type, size: result.length });
              }
            }
            return { fields: wrappedFields };
          } else {
            return { fields: {} };
          }
        } else {
          // Scalar result
          let rawOutputs = result as any;
          let uiOutputs: any = undefined;

          // Check for { outputs, ui } pattern
          if (rawOutputs && typeof rawOutputs === 'object') {
            // Logic matches the non-broadcast handler below
            if ('outputs' in rawOutputs && ('ui' in rawOutputs || Object.keys(rawOutputs).length === 2)) {
              if (!('outputs' in options.outputs)) {
                uiOutputs = rawOutputs.ui;
                rawOutputs = rawOutputs.outputs;
              }
            }
          }

          const keys = new Set([...Object.keys(options.outputs), ...Object.keys(rawOutputs)]);
          const wrappedFields: Record<string, Structor> = {};
          for (const key of keys) {
            const type = options.outputs[key] || options.dynamicOutputType;
            if (type && rawOutputs[key] !== undefined) {
              wrappedFields[key] = toStructor(rawOutputs[key], type);
            }
          }

          const structorResult = { fields: wrappedFields };
          if (uiOutputs !== undefined) {
            return { outputs: structorResult, ui: uiOutputs };
          }
          return structorResult;
        }
      } else if (options.inputs && Object.keys(options.inputs).length > 0) {
        // Even if not broadcasting, we might want to unwrap the raw inputs if they match the schema
        const inputs: any = {};
        for (const [key, type] of Object.entries(options.inputs)) {
          if (rawInput.fields && rawInput.fields[key] !== undefined) {
            inputs[key] = fromStructor(rawInput.fields[key], type);
          } else if ((type as any).defaultValue !== undefined) {
            inputs[key] = (type as any).defaultValue;
          }
        }
        processedInput = inputs;
      }

      const result = options.execute(
        processedInput,
        processedConfig,
        context,
        state
      );

      // Handle ExecuteResult (with potential UI outputs)
      let rawOutputs: any = result;
      let uiOutputs: any = undefined;

      if (rawOutputs && typeof rawOutputs === 'object') {
        if ('outputs' in rawOutputs && ('ui' in rawOutputs || Object.keys(rawOutputs).length === 2)) {
          // It's likely an ExecuteResult
          // (We check strictly for 'outputs' property)
          // But wait, if the user returns { outputName: val }, 'outputs' is not a reserved output name usually.
          // However, `options.outputs` defines valid output names.
          // If 'outputs' is NOT in options.outputs, then we can assume it's the wrapper object.
          if (!('outputs' in options.outputs)) {
            uiOutputs = rawOutputs.ui;
            rawOutputs = rawOutputs.outputs;
          }
        }
      }

      // Wrap output
      const wrappedFields: Record<string, Structor> = {};
      const anyResult = rawOutputs as any;
      if (anyResult) {
        // combine static outputs and dynamic outputs
        const keys = new Set([...Object.keys(options.outputs), ...Object.keys(anyResult)]);

        for (const key of keys) {
          const type = options.outputs[key] || options.dynamicOutputType;
          // Only process if we have a type and a value
          if (type && anyResult[key] !== undefined) {
            wrappedFields[key] = toStructor(anyResult[key], type);
          }
        }
      }

      const structorResult: StructorRecord = {
        fields: wrappedFields
      };

      if (uiOutputs !== undefined) {
        return {
          outputs: structorResult,
          ui: uiOutputs
        };
      } else {
        return structorResult;
      }
    }
  };
}



export interface TypedBroadcastChannel {
  source?: string | string[]; // Default to channel name if omitted
  type?: StructorType; // Used for inference
  combine?: 'collect' | { reduce: 'min' | 'max' | 'add' | 'first' | 'flatten' } | null;
}

export type TypedBroadcastSchema = Record<string, TypedBroadcastChannel>;

export type InferBroadcastResult<TSchema extends TypedBroadcastSchema> = {
  [K in keyof TSchema]: TSchema[K]['combine'] extends 'collect'
  ? Array<InferStructorType<NonNullable<TSchema[K]['type']>>>
  : InferStructorType<NonNullable<TSchema[K]['type']>>
};

export function typedBroadcast<TSchema extends TypedBroadcastSchema>(
  context: ExecutionContext,
  schema: TSchema,
  inputs: StructorRecord
): InferBroadcastResult<TSchema> {
  const config: BroadcastConfig = {
    outputs: {},
    reshape: 'none'
  };

  for (const [key, def] of Object.entries(schema)) {
    config.outputs[key] = {
      fromFields: def.source ? (Array.isArray(def.source) ? def.source : [def.source]) : [key],
      combine: def.combine ?? { reduce: 'first' }
    };
  }

  const broadcasted = context.broadcast(config, inputs);

  // Use apply to get the data structure (AoS)
  const result = broadcasted.apply((args: any) => args);

  const processedResult: any = {};

  // Transpose if vector
  if (Array.isArray(result)) {
    // Initialize arrays
    for (const key of Object.keys(schema)) {
      processedResult[key] = [];
    }
    for (const item of result) {
      for (const key of Object.keys(schema)) {
        processedResult[key].push(item[key]);
      }
    }
  } else {
    // Scalar
    for (const key of Object.keys(schema)) {
      processedResult[key] = result[key];
    }
  }

  // Type conversion
  for (const [key, def] of Object.entries(schema)) {
    if (def.type) {
      if (def.combine === 'collect') {
        // If collect, the value is already an array (from broadcast logic)
        // But if we transposed a vector of collects, we have array of arrays?
        // Wait, if result is array (vector), then processedResult[key] is array of values.
        // If combine is collect, values are arrays.
        // So processedResult[key] is array of arrays.

        // typedBroadcast expects `Array<InferStructorType>`.
        // If it's a vector, it expects `Array<Array<...>>`?
        // The type definition says `Array<InferStructorType>`.

        // If typedBroadcast is used for manual handling, maybe it doesn't expect vectors?
        // Or maybe it expects the "column".

        // Let's assume processedResult[key] IS the column.
        const val = processedResult[key];
        if (Array.isArray(val)) {
          processedResult[key] = val.map((v: any) => fromStructor(v, def.type!));
        } else {
          processedResult[key] = fromStructor(val, def.type!);
        }
      } else {
        const val = processedResult[key];
        if (Array.isArray(val)) {
          processedResult[key] = val.map((v: any) => fromStructor(v, def.type!));
        } else {
          processedResult[key] = fromStructor(val, def.type!);
        }
      }
    }
  }

  return processedResult;
}
export function defineMathNode(
  id: string,
  metadata: NodeMetadata,
  op: (a: number, b: number) => number,
  arity: 'unary' | 'binary' = 'binary'
): PrimitiveNodeDefinition {
  const inputs: NodeInputsDef = arity === 'binary'
    ? { a: NumberType, b: NumberType }
    : { a: NumberType };

  return definePrimitiveNode({
    id,
    metadata,
    inputs,
    outputs: { result: NumberType },
    autoBroadcast: true,
    reshape: 'vector',
    execute: (inputs, config, context) => {
      if (arity === 'binary') {
        const { a, b } = inputs as { a: number, b: number };
        return { result: op(a, b) };
      } else {
        const { a } = inputs as { a: number };
        return { result: op(a, 0) };
      }
    }
  });
}
