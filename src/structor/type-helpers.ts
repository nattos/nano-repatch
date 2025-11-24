import {
  StructorType,
  AtomicType,
  ArrayType,
  RecordType,
  PrimitiveNodeDefinition,
  StructorRecord,
  ExecutionContext,
  AnalysisContext,
  Structor,
  BroadcastConfig
} from './structor';

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
  if (value === undefined || value === null) return value; // Or throw?

  if (type.kind === 'atomic') return value;

  if (type.kind === 'array') {
    if (Array.isArray(value)) {
      return value.map(v => toStructor(v, type.element));
    }
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
  TOutputs extends NodeOutputsDef
> {
  id: string;
  inputs?: TInputs;
  config?: TConfig;
  outputs: TOutputs;
  isRealtime?: (config: Structor) => boolean;

  /**
   * If true, inputs are automatically broadcasted to match the input definition.
   * If false (default), inputs are passed as raw StructorRecord.
   */
  autoBroadcast?: boolean;

  execute: (
    inputs: InferRecord<{ kind: 'record', fields: TInputs, untagged: [] }>,
    config: InferRecord<{ kind: 'record', fields: TConfig, untagged: [] }>,
    context: ExecutionContext
  ) => InferRecord<{ kind: 'record', fields: TOutputs, untagged: [] }>;
}

export function definePrimitiveNode<
  TInputs extends NodeInputsDef,
  TConfig extends NodeConfigDef,
  TOutputs extends NodeOutputsDef
>(
  options: TypedNodeOptions<TInputs, TConfig, TOutputs>
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
    configType,
    isRealtime: options.isRealtime,
    computeOutputTypes: () => outputType,
    execute: (rawInput, rawConfig, context) => {
      let processedInput: any = rawInput;

      if (options.autoBroadcast && options.inputs) {
        const broadcastConfig: BroadcastConfig = {
          outputs: {},
          reshape: 'none'
        };

        for (const [key, type] of Object.entries(options.inputs)) {
          const isArray = type.kind === 'array';
          broadcastConfig.outputs[key] = {
            fromFields: [key],
            fromUntagged: false,
            combine: isArray ? 'collect' : { reduce: 'first' }
          };
        }

        const broadcasted = context.broadcast(broadcastConfig, rawInput);

        // Unwrap broadcast results
        const unwrapped: any = {};
        for (const [key, type] of Object.entries(options.inputs)) {
          unwrapped[key] = fromStructor(broadcasted[key], type);
        }
        processedInput = unwrapped;
      } else if (options.inputs) {
        // Even if not broadcasting, we might want to unwrap the raw inputs if they match the schema
        // But rawInput is a StructorRecord.
        // If autoBroadcast is false, we pass rawInput (as any) which matches the loose typing
        // BUT if we want to be nice, we should probably unwrap it too?
        // For now, let's respect the flag: false means "I want raw StructorRecord"
      }

      // Unwrap config
      // Config is also a StructorRecord (or plain object?)
      // Usually config comes from the graph and is a StructorRecord.
      const processedConfig = fromStructor(rawConfig, configType);

      const result = options.execute(
        processedInput,
        processedConfig,
        context
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

// --- Typed Broadcast Helper ---

export interface TypedBroadcastChannel {
  source?: string | string[]; // Default to channel name if omitted
  type?: StructorType; // Used for inference
  combine?: 'collect' | { reduce: 'min' | 'max' | 'add' | 'first' };
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

  const rawResult = context.broadcast(config, inputs);
  const processedResult: any = {};

  for (const [key, def] of Object.entries(schema)) {
    if (def.type) {
      // If combine is collect, the result is an array of Structors
      if (def.combine === 'collect') {
        const arr = rawResult[key] as Structor[];
        processedResult[key] = arr.map(v => fromStructor(v, def.type!));
      } else {
        processedResult[key] = fromStructor(rawResult[key], def.type!);
      }
    } else {
      processedResult[key] = rawResult[key];
    }
  }

  return processedResult;
}
