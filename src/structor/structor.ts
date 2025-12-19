
// Based on README.md
/* ===================================================================
 * 1. Core Static Types (The "Shape")
 * =================================================================== */

export interface AtomicType {
  kind: 'atomic';
  type: 'number' | 'string' | 'boolean' | 'any';
  optional?: boolean;
  defaultValue?: any;
}

export interface FunctorType {
  kind: 'functor';
  input: StructorType;
  output: StructorType;
  optional?: boolean;
}

export interface ArrayType {
  kind: 'array';
  size: number | 'dynamic'; // 'dynamic' for runtime-sized/ragged arrays
  element: StructorType;
  optional?: boolean;
  hint?: string;
}

export interface RecordType {
  kind: 'record';
  fields: Record<string, StructorType>; // Named/tagged inputs
  optional?: boolean;
  hint?: string;
}

export interface GraphType {
  kind: 'graph';
  inputs: RecordType;
  outputs: RecordType;
  optional?: boolean;
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
    // Arbitrary data to pass to the forward pass (e.g. "I decided to be vec3")
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
  ui?: any;
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
}



/* ===================================================================
 * 4. The Universal Broadcast Operation Config
 * =================================================================== */

/**
 * This is the "query" a node sends to the broadcast engine
 * to request its data in a specific shape.
 */
export interface BroadcastConfig {
  /**
   * Defines the output "channels" the node's logic will receive.
   */
  outputs: Record<
    string,
    {
      /** Which *named* input fields to pull from. `['*']` means all. */
      fromFields: string[];
      /**
       * How to combine all collected inputs for this channel.
       */
      combine?: 'collect' | { reduce: 'min' | 'max' | 'add' | 'first' };
      /**
       * (Optional) Request that all data in this channel be coerced to a number
       * during the broadcast operation.
       */
      coerceTo?: 'number';
    }
  >;

  /**
   * How to align the resulting channels relative to each other.
   * 'none': Pass channels as-is (e.g., { values: [...], min: 5, max: 10 }).
   * 'vector': Tensor-broadcast and "zip" all 'collect' channels
   * (e.g., { 'broadcasted': [[v1, m1], [v2, m2], ...] }).
   */
  reshape: 'none' | 'vector';
}
