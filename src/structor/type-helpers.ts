
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
  NodeMetadata
} from './structor';

export const NumberType: StructorType = { kind: 'atomic', type: 'number' };
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

type InferRecord<T extends RecordType> =
  { [K in keyof T['fields']as T['fields'][K] extends { optional: true } ? K : never]?: InferStructorType<T['fields'][K]> } &
  { [K in keyof T['fields']as T['fields'][K] extends { optional: true } ? never : K]: InferStructorType<T['fields'][K]> };

// Helper to define a type while preserving its literal nature for inference
export function defineType<T extends StructorType>(t: T): T {
  return t;
}

// --- Marshalling Helpers ---

function fromStructor(value: Structor, type: StructorType): any {
  if (value === undefined || value === null) return value;

  if (type.kind === 'atomic') return value;

  if (type.kind === 'array') {
    if (Array.isArray(value)) {
      return value.map(v => fromStructor(v, type.element));
    }
    return []; // Should not happen if types match
  }

  if (type.kind === 'record') {
    // Value could be StructorRecord OR plain object (if system is loose)
    if (typeof value === 'object') {
      // Check if it's a StructorRecord (has fields/untagged)
      if ('fields' in value && 'untagged' in value) {
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
  // console.error('toStructor', value, type.kind);
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
    return { fields, untagged: [] };
  }

  return value;
}

// --- Node Definition Helper ---

export type NodeInputsDef = Record<string, StructorType>;
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

  execute: (
    inputs: InferRecord<{ kind: 'record', fields: TInputs, untagged: [] }>,
    config: InferRecord<{ kind: 'record', fields: TConfig, untagged: [] }>,
    context: ExecutionContext,
    state: TState
  ) => InferRecord<{ kind: 'record', fields: TOutputs, untagged: [] }>;
}

export function definePrimitiveNode<
  TInputs extends NodeInputsDef,
  TConfig extends NodeConfigDef,
  TOutputs extends NodeOutputsDef,
  TState = undefined
>(
  options: TypedNodeOptions<TInputs, TConfig, TOutputs, TState>
): PrimitiveNodeDefinition {
  const configType: RecordType = {
    kind: 'record',
    fields: options.config || {},
    untagged: []
  };

  const outputType: RecordType = {
    kind: 'record',
    fields: options.outputs,
    untagged: []
  };

  return {
    id: options.id,
    kind: 'primitive',
    metadata: options.metadata,
    configType,
    isRealtime: options.isRealtime,
    computeOutputTypes: () => outputType,
    execute: (rawInput, rawConfig, context) => {
      // throw new Error('EXECUTION REACHED');
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
            fromUntagged: override?.fromUntagged ?? false,
            combine: combine ?? undefined
          };
        }

        const broadcasted = context.broadcast(broadcastConfig, rawInput);

        const result = broadcasted.apply((args: any) => {
          // Unwrap inputs
          const inputs: any = {};
          for (const [key, type] of Object.entries(options.inputs!)) {
            inputs[key] = fromStructor(args[key], type);
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
              if (options.outputs[key]) {
                wrappedFields[key] = toStructor(val, { kind: 'array', element: options.outputs[key], size: result.length });
              }
            }
            return { fields: wrappedFields, untagged: [] };
          } else {
            return { fields: {}, untagged: [] };
          }
        } else {
          // Scalar result
          const anyResult = result as any;
          const wrappedFields: Record<string, Structor> = {};
          for (const [key, type] of Object.entries(options.outputs)) {
            if (anyResult[key] !== undefined) {
              wrappedFields[key] = toStructor(anyResult[key], type);
            }
          }
          return { fields: wrappedFields, untagged: [] };
        }
      } else if (options.inputs && Object.keys(options.inputs).length > 0) {
        // Even if not broadcasting, we might want to unwrap the raw inputs if they match the schema
        const inputs: any = {};
        for (const [key, type] of Object.entries(options.inputs)) {
          if (rawInput.fields && rawInput.fields[key] !== undefined) {
            inputs[key] = fromStructor(rawInput.fields[key], type);
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

      // Wrap output
      const wrappedFields: Record<string, Structor> = {};
      const anyResult = result as any;
      for (const [key, type] of Object.entries(options.outputs)) {
        if (anyResult[key] !== undefined) {
          wrappedFields[key] = toStructor(anyResult[key], type);
        }
      }

      return {
        fields: wrappedFields,
        untagged: []
      };
    }
  };
}



export interface TypedBroadcastChannel {
  source?: string | string[]; // Default to channel name if omitted
  type?: StructorType; // Used for inference
  combine?: 'collect' | { reduce: 'min' | 'max' | 'add' | 'first' } | null;
  fromUntagged?: boolean | number[];
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
      fromUntagged: def.fromUntagged ?? false,
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
