
// Based on README.md
/* ===================================================================
 * 1. Core Static Types (The "Shape")
 * =================================================================== */

export interface AtomicType {
  readonly kind: 'atomic';
  readonly type: 'number' | 'string' | 'boolean' | 'any';
  readonly optional?: boolean;
  readonly defaultValue?: any;
  readonly description?: string;
}

export interface FunctorType {
  readonly kind: 'functor';
  readonly input: StructorType;
  readonly output: StructorType;
  readonly optional?: boolean;
}

export interface ArrayType {
  readonly kind: 'array';
  readonly size: number | 'dynamic'; // 'dynamic' for runtime-sized/ragged arrays
  readonly element: StructorType;
  readonly optional?: boolean;
  readonly hint?: string;
  readonly description?: string;
}

export interface RecordType {
  readonly kind: 'record';
  readonly fields: Record<string, StructorType>; // Named/tagged inputs
  readonly optional?: boolean;
  readonly hint?: string;
  readonly untagged?: readonly StructorType[];
  readonly description?: string;
}

export interface GraphType {
  readonly kind: 'graph';
  readonly inputs: RecordType;
  readonly outputs: RecordType;
  readonly optional?: boolean;
}

export type StructorType =
  | AtomicType
  | FunctorType
  | ArrayType
  | RecordType
  | GraphType;

/* ===================================================================
 * 2. Core Runtime Types (The "Data")
 * =================================================================== */

export type Functor = (input: Structor) => Structor;
export interface StructorArray extends Array<Structor> { }
export interface StructorRecord {
  fields: Record<string, Structor>;
}

export type Structor =
  | number
  | string
  | boolean
  | Functor
  | StructorArray
  | StructorRecord;

import type { NodeRepository } from './repository';

/* ===================================================================
 * 3. Node Definitions
 * =================================================================== */

export type NodeDefinition = PrimitiveNodeDefinition | GraphDefinition;

export interface BroadcastResult {
  apply(lambda: (args: any) => any): any;
}

// Faking the contexts for now
export interface AnalysisContext {
  broadcast: (config: BroadcastConfig, inputs: RecordType) => any;
  repository: NodeRepository;
};
export interface ExecutionContext {
  broadcast: (config: BroadcastConfig, inputs: StructorRecord) => BroadcastResult;
  repository: NodeRepository;
  clock: {
    beat: number;
    dt: number;
  };
  audio?: {
    context: any;
  };
  // Access to the global node state cache
  // In a real implementation, this would be scoped to the graph instance
  nodeState: Map<string, any>;
  nodeId?: string;
  midi?: {
    values: Map<string, number>;
    events?: any[]; // Typed as MidiEvent[] in implementation
  };
  resolume?: any; // Injected ResolumeManager
  requestUiOutputs?: boolean;
  time?: number; // Absolute time in seconds
  markSelfDirty?: () => void;
  executeSubgraph?: (tag: string) => void;
};



export enum NodeCategory {
  IO = 'IO',
  Math = 'Math',
  Logic = 'Logic',
  Data = 'Data',
  Functional = 'Functional',
  Core = 'Core',
  Custom = 'Custom',
  Utility = 'Utility',
  Debug = 'Debug',
}

export interface NodeMetadata {
  category: NodeCategory | string;
  keywords?: string[];
  description?: string;
  deprecated?: boolean;
}

export type ExecuteResult = StructorRecord | { outputs: StructorRecord; ui?: any };

/**
 * A "black box" operation implemented in native TypeScript.
 */
export interface PrimitiveNodeDefinition {
  id: string;
  kind: 'primitive';
  metadata?: NodeMetadata;
  configType?: StructorType;
  inputs?: Record<string, StructorType & { redirect?: string }>; // Exposed for reflection (e.g. tests)
  outputs?: Record<string, StructorType>; // Exposed for reflection (e.g. registration)

  /**
   * BACKWARD PASS: Computes the constraints this node places on its inputs,
   * based on the requirements placed on its outputs by downstream nodes.
   * @param outputRequirements The types/constraints expected by downstream nodes.
   */
  computeBackwardPorts?: (
    outputRequirements: RecordType,
    config: Structor,
    context: AnalysisContext,
  ) => {
    inputRequirements: RecordType;
    // Arbitrary data to pass to the forward pass (e.g. "I decided to be float3")
    backwardMetadata?: any;
  };

  /**
   * FORWARD PASS: Computes the final canonical input and output types.
   * Can use the metadata from the backward pass.
   */
  /**
   * FORWARD PASS: Computes the final canonical input and output types.
   * Can use the metadata from the backward pass.
   */
  computeForwardPorts?: (
    inputTypes: RecordType,
    config: Structor,
    context: AnalysisContext,
    backwardMetadata?: any,
  ) => { inputs: RecordType; outputs: RecordType };

  shouldRecompileOnConfigChange?: (
    newConfig: StructorRecord,
    oldConfig: StructorRecord
  ) => boolean;

  /** Runtime execution function: computes output data from input data. */
  execute: (
    input: StructorRecord,
    config: Structor,
    context: ExecutionContext,
    state?: any // State is allowed in Enhanced definition
  ) => ExecuteResult;

  isRealtime?: (config: Structor) => boolean;

  /** Optional handler for realtime messages from UI */
  onMessage?: (state: any, message: any) => void;

  /**
   * Optional UI definition for the node.
   * Can contain inspector fields, body renderers, etc.
   */
  /**
   * Optional UI definition for the node.
   * Can contain inspector fields, body renderers, etc.
   */
  ui?: any;

  /**
   * Optional factory for creating the initial state of the node.
   * Used by the executor to initialize state before execution.
   */
  createState?: (
    config: Structor,
    context: ExecutionContext
  ) => any;

  getDisplayLabel?: (config: Structor) => string | undefined;

  /**
   * Defines a tag for subgraph expansion.
   * If present, the compiler will expand this node as a subgraph.
   * "inline" means standard inline expansion.
   * Any other string means the nodes are expanded but deferred/conditional.
   */
  subgraphExpansionTag?: string;
}

/**
 * A composite node implemented as a nested graph.
 */
export interface GraphDefinition {
  id: string;
  kind: 'graph';
  metadata?: NodeMetadata;
  type: GraphType; // The pre-computed I/O signature of this graph
  nodes: Record<string, NodeInstance>;
  connections: { fromNode: string; fromPort: string | number; toNode: string; toPort: string | number; }[];
  // Simplified for test purposes
  inputs: Record<string, { nodeId: string; port: string | number }>;
  outputs: Record<string, { nodeId: string; port: string | number }>;
  executionOrder?: string[];
}

// Added for GraphDefinition
export interface NodeInstance {
  definitionId: string;
  defaultConfig?: Structor;
  executionTag?: string; // If set, this node is not part of the main execution loop
  executionOwnerId?: string; // The ID of the node that "owns" this subgraph (e.g. the thensubgraph node)
}



/* ===================================================================
 * 4. The Universal Broadcast Operation Config
 * =================================================================== */

/**
 * This is the "query" a node sends to the broadcast engine
 * to request its data in a specific shape.
 */
// Extracted for use in AutoBroadcastDef
export interface TypedBroadcastChannel {
  /** Which *named* input fields to pull from. `['*']` means all. */
  fromFields: string[];
  /**
   * How to combine all collected inputs for this channel.
   */
  combine?: 'collect' | { reduce: 'min' | 'max' | 'add' | 'first' | 'flatten' };
  /**
   * (Optional) Request that all data in this channel be coerced to a number
   * during the broadcast operation.
   */
  coerceTo?: 'number';
}

/**
 * This is the "query" a node sends to the broadcast engine
 * to request its data in a specific shape.
 */
export interface BroadcastConfig {
  /**
   * Defines the output "channels" the node's logic will receive.
   */
  outputs: Record<string, TypedBroadcastChannel>;

  /**
   * How to align the resulting channels relative to each other.
   * 'none': Pass channels as-is (e.g., { values: [...], min: 5, max: 10 }).
   * 'vector': Tensor-broadcast and "zip" all 'collect' channels
   * (e.g., { 'broadcasted': [[v1, m1], [v2, m2], ...] }).
   */
  reshape: 'none' | 'vector';
}
