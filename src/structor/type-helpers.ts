
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
   * If false (default), inputs are passed as raw StructorRecord.
   */
  autoBroadcast?: boolean;

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
        // context.broadcast returns { fields: ... }
        const broadcastFields = (broadcasted as any).fields || {};
        for (const [key, type] of Object.entries(options.inputs)) {
          unwrapped[key] = fromStructor(broadcastFields[key], type);
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

      // Handle State
      let state: TState = undefined as any;
      if (options.createState) {
        // We need a unique key for this node instance.
        // Currently, we don't have a stable instance ID passed to execute.
        // We have to rely on a hack using the config as a key, or assume the context provides a way to identify the node.
        // The user mentioned: "Let's add a way to get and set the current node's state in ExecutionContext, which will know how to lookup the current node."
        // But for now, let's assume we use the config-based key hack OR if context has a current node ID.
        // Since we don't have current node ID in context yet, let's stick to the config hack for now,
        // BUT ideally we should fix this in the executor.
        // Wait, the user said: "Clearly nodes will need state. Let's add a way to get and set the current node's state in ExecutionContext... An alternative we should explore is having nodes be able to declare the exact type of their state... Then their execute method will receive the state"
        // Use nodeId if available (stable), otherwise fallback to config hash (unstable but works for stateless/tests)
        const key = context.nodeId || `${options.id}-${JSON.stringify(rawConfig)}`;
        if (!context.nodeState.has(key)) {
          context.nodeState.set(key, options.createState(processedConfig, context));
        }
        state = context.nodeState.get(key);
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
  const rawFields = (rawResult as any).fields || {};

  for (const [key, def] of Object.entries(schema)) {
    if (def.type) {
      // If combine is collect, the result is an array of Structors
      if (def.combine === 'collect') {
        const arr = rawFields[key] as Structor[];
        processedResult[key] = arr.map(v => fromStructor(v, def.type!));
      } else {
        processedResult[key] = fromStructor(rawFields[key], def.type!);
      }
    } else {
      processedResult[key] = rawFields[key];
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
