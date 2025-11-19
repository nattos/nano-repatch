# Structor: A Statically Analyzable Execution Graph System

**Structor** is a high-performance, statically analyzable execution graph system written in TypeScript. It is inspired by tensor-processing frameworks but generalizes their concepts to support complex, dynamic, and heterogeneous data types.

The system is built on a few core concepts:

* **Structors:** A generalized, tensor-like data structure that supports multidimensional arrays, ragged arrays, and atomic types like `number`, `string`, and `boolean`.

* **First-Class Functors:** Lambdas (functions) are treated as first-class citizens, allowing for powerful meta-programming and deferred execution.

* **Node-Based Graph:** Operations are defined as nodes in a directed acyclic graph (DAG).

* **Static Type Analysis:** The entire graph's data flow, including dimensions and types, can be pre-computed before execution.

* **Universal Broadcast Operation:** A novel, powerful mechanism that allows nodes to declaratively reshape, reduce, and align their inputs.

## Core Concepts

### 1. Structor & StructorType

A **`Structor`** is the fundamental unit of runtime *data* in the system. It can be:

* An **atomic value** (`number`, `string`, `boolean`).

* A **`StructorArray`** (a multidimensional or ragged array of other `Structors`).

* A **`StructorRecord`** (a key-value object, used for a node's "grab bag" inputs).

* A **`Functor`** (a `(input: Structor) => Structor` function).

A **`StructorType`** is the matching, *static type* of a `Structor`. This is the cornerstone of the analysis engine. It describes the "shape" of the data without holding any.

* `AtomicType`: `{ kind: 'atomic', type: 'number' }`

* `ArrayType`: `{ kind: 'array', size: number | 'dynamic', element: StructorType }`

* `FunctorType`: `{ kind: 'functor', input: StructorType, output: StructorType }`

* `RecordType`: `{ kind: 'record', fields: {...}, untagged: [...] }`

The `size: 'dynamic'` in `ArrayType` is critical, allowing the system to handle data whose size is unknown until runtime (e.g., audio buffers, user-uploaded textures) while still analyzing the rest of the graph.

### 2. Nodes (Primitive & Graph)

An operation is defined by a `NodeDefinition`. The system is fully compositional, supporting two types of nodes:

* **`PrimitiveNodeDefinition`:** A "black box" operation implemented in native TypeScript. It provides two key functions:

  1. `computeOutputTypes(inputType, context)`: A *pure* function that runs during static analysis. It receives the *types* of its inputs and must return the *types* of its outputs.

  2. `execute(input, context)`: The runtime function. It receives the actual *data* and performs the operation.

* **`GraphDefinition`:** A composite node defined as a *nested graph* of other nodes (either primitive or graph). This allows for building complex, reusable abstractions. The system analyzes a `GraphDefinition` by recursively analyzing the `computeOutputTypes` of its internal nodes.

### 3. "Grab Bag" Inputs

Nodes do not have simple, fixed-arity inputs. Instead, each node receives a single `StructorRecord` (or `RecordType` during analysis) that acts as a "grab bag" of all its connected inputs. This record is divided into:

* `fields`: A dictionary of all named/tagged inputs (e.g., `value`, `min`, `max`).

* `untagged`: An ordered array of all unnamed inputs.

It is entirely up to the node's definition to decide how to interpret this "grab bag" of data. This is achieved via the Universal Broadcast Operation.

### 4. Runtime & Execution

The graph is brought to life by a `GraphExecutor`. This class takes a `GraphDefinition` and manages its runtime state. It's responsible for:

* **Executing nodes** in the correct topological order.
* **Storing the output** of every node.
* **Efficiently performing iterative updates.** When an input to the graph changes, the executor uses a dirty-tracking mechanism to re-calculate only the downstream nodes that are affected.

Node definitions themselves are managed by a `NodeRepository`. This allows for a pluggable system where new nodes (or sets of nodes) can be registered and made available to the graph. The executor uses this repository to look up a node's definition by its ID during execution.


## Key Feature: The Universal Broadcast Operation

The core innovation of Structor is the **Universal Broadcast Operation**. It provides a single, declarative API for a node to consume its messy "grab bag" of inputs.

Instead of writing complex imperative logic to handle every possible input combination, a node simply defines a `BroadcastConfig` (a "query") that tells the broadcast engine *how* it wishes to receive its data.

The broadcast engine then performs all the complex work of gathering, partitioning, reducing, coercing, and aligning the data before passing it to the node's core logic.

A `BroadcastConfig` consists of two main parts:

### `outputs: Record<string, ChannelConfig>`

Defines the output "channels" the node's logic will receive. A `ChannelConfig` specifies:

* `fromFields: string[]`: Which *named* inputs to pull into this channel (e.g., `['min']`).

* `fromUntagged: boolean | number[]`: Whether to pull from *all* untagged inputs (`true`) or just specific indices (`[0, 2]`).

* `combine: 'collect' | { reduce: 'min' | 'max' | 'add' ... }`:

  * `'collect'`: Gathers all found inputs into a single array (e.g., all `'value'` inputs).

  * `{ reduce: ... }`: Applies a reduction operation to all found inputs to produce a single scalar (e.g., find the `min` of all `'min'` inputs).

* `coerceTo?: 'number'`: (Optional) Requests that all data in this channel be coerced to a number (e.g., converting strings to floats).

### `reshape: 'none' | 'vector'`

Defines how the final, processed channels should be aligned *relative to each other*.

#### Example 1: `clamp` Node (`reshape: 'none'`)

A `clamp` node needs one array of *values* and two *scalars* (min and max).

* **Config:**

  * `'value'` channel: `combine: 'collect'`, from `fields: ['value']` and `untagged: true`.

  * `'min'` channel: `combine: { reduce: 'min' }`, from `fields: ['min']`.

  * `'max'` channel: `combine: { reduce: 'max' }`, from `fields: ['max']`.

  * `reshape: 'none'`.

* **Result:** The broadcast engine performs the partitioning and reduction and passes the node's `execute` function an object like:
  `{ value: [1, 50, -10], min: 0, max: 25 }`
  The node's logic is now trivial: `value.map(v => clamp(v, min, max))`.

#### Example 2: `add` Node (`reshape: 'vector'`)

An `add` node wants to sum *everything* it's given, element-wise.

* **Config:**

  * Dynamically creates a `'collect'` channel for *every single input* (e.g., `'a'`, `'b'`, `'c'`).

  * `reshape: 'vector'`.

* **Result:** The broadcast engine:

  1. Collects all channels: `{ 'a': [1, 2], 'b': 10, 'c': [5, 6, 7] }`.

  2. Finds the common broadcast shape (e.g., `[2, 3]`).

  3. Performs a tensor-broadcast on all channels to match this shape.

  4. "Zips" the broadcasted channels into a single array of tuples.

  5. Passes the node's `execute` function an object like:
     `{ 'broadcasted': [ [a[0,0], b[0,0], c[0,0]], [a[0,1], b[0,1], c[0,1]], ... ] }`
     The node's logic is now trivial: it just iterates over the list of tuples and sums them.

## Static Analysis

The entire system is designed to be statically analyzable. When a graph is loaded, the engine can trace all `StructorType` information without executing any code.

1. The engine starts at the graph's inputs.

2. It follows connections to each node.

3. For each node, it calls its `computeOutputTypes` function.

4. This function receives the *types* of its inputs (e.g., `ArrayType<number, 2>`, `AtomicType<string>`).

5. It constructs its `BroadcastConfig` and passes it to the `AnalysisContext.broadcast` helper.

6. The *static* broadcast engine analyzes the config against the input types and returns the *shape* of the data the node's logic will receive.

7. The node's `computeOutputTypes` function uses this shape to determine its own output *type*, which it returns to the engine.

8. This output type becomes the input type for the *next* node in the graph.

This process allows the system to pre-compute the *exact* type and dimensions of every connection in the graph, enabling powerful compile-time error checking and optimization.

## Application State Management

While the `GraphExecutor` runs a `GraphDefinition`, an application needs a way to build and manage the state of the visual graph editor. This is handled by the `AppController`.

The `AppController` is the central engine for the application's UI state. It manages an `AppState` object, which contains two parts:
1.  **`graph`**: The canonical, serializable `GraphState` (the nodes and connections that define the graph).
2.  **`auxiliary`**: A set of non-serializable, derived lookup maps (e.g., `nodeId -> incoming_connections`) that are kept in sync with the graph and used by the UI for efficient querying and rendering.

All modifications are handled through methods on the controller, which uses a transactional, command-based pattern with a full undo/redo stack. For UI integration, it provides a `mobx`-powered observable mirror of the `AppState`, ensuring that UI components can react efficiently to any changes.

## First-Class Strings and Functors

Operations are generalized for all types, including `string` and `Functor`.

* **Strings:** The broadcast/reduction operations are overloaded.

  * `add` on strings performs concatenation.

  * `reduce: 'min'` on strings would select the shortest string.

* **Functors (Lambdas):** Functors are first-class data and are fully analyzable via `FunctorType`. When a node receives functors as inputs, it typically chains them.

  * **Example:** An `add` node receives two functors, `f(x)` and `g(x)`.

  * Its `execute` function will not output a *value*. It will output a *new functor*:
    `h(x) = f(x) + g(x)`

  * Its `computeOutputTypes` function will also return a `FunctorType`, allowing the static analysis to continue through this new, composed function.

## Core API Definitions

*The following types define the core public-facing API of the Structor system.*

```
/* ===================================================================
 * 1. Core Static Types (The "Shape")
 * =================================================================== */

export type AtomicType =
  | { kind: 'atomic'; type: 'number' }
  | { kind: 'atomic'; type: 'string' }
  | { kind: 'atomic'; type: 'boolean' }
  | { kind: 'atomic'; type: 'any' };

export interface FunctorType {
  kind: 'functor';
  input: StructorType;
  output: StructorType;
}

export interface ArrayType {
  kind: 'array';
  size: number | 'dynamic'; // 'dynamic' for runtime-sized/ragged arrays
  element: StructorType;
}

export interface RecordType {
  kind: 'record';
  fields: Record<string, StructorType>; // Named/tagged inputs
  untagged: StructorType[];             // Ordered/untagged inputs
}

export interface GraphType {
  kind: 'graph';
  inputs: RecordType;
  outputs: RecordType;
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
export interface StructorArray extends Array<Structor> {}
export interface StructorRecord {
  fields: Record<string, Structor>;
  untagged: Structor[];
}

export type Structor =
  | number
  | string
  | boolean
  | Functor
  | StructorArray
  | StructorRecord;

/* ===================================================================
 * 3. Node Definitions
 * =================================================================== */

export type NodeDefinition = PrimitiveNodeDefinition | GraphDefinition;

/**
 * A "black box" operation implemented in native TypeScript.
 */
export interface PrimitiveNodeDefinition {
  id: string;
  kind: 'primitive';
  configType?: StructorType; // The type of config this node expects

  /** Static analysis function: computes output types from input types. */
  computeOutputTypes: (
    inputType: RecordType,
    config: StructorType,
    context: AnalysisContext,
  ) => RecordType;

  /** Runtime execution function: computes output data from input data. */
  execute: (
    input: StructorRecord,
    config: Structor,
    context: ExecutionContext,
  ) => StructorRecord;
}

/**
 * A composite node implemented as a nested graph.
 */
export interface GraphDefinition {
  id: string;
  kind: 'graph';
  type: GraphType; // The pre-computed I/O signature of this graph
  nodes: Record<string, NodeInstance>;
  connections: {
    fromNode: string;
    fromPort: string | number;
    toNode: string;
    toPort: string | number;
  }[];
  inputs: Record<string, { nodeId: string; port: string | number }>;
  outputs: Record<string, { nodeId: string; port: string | number }>;
}

/**
 * An instance of a node within a graph. It refers to a definition
 * stored in a NodeRepository.
 */
export interface NodeInstance {
    definitionId: string;
    defaultConfig?: Structor; // Default config for this instance
}

/* ===================================================================
 * 4. Execution & Management
 * =================================================================== */

/**
 * Manages a collection of available NodeDefinitions.
 */
export class NodeRepository {
  register(node: NodeType): void;
  get(id: string): NodeDefinition | undefined;
}

/**
 * Manages the runtime state and execution of a single graph instance.
 */
export class GraphExecutor {
  constructor(graph: GraphDefinition, repository: NodeRepository);

  /** Sets the value of a named graph input. */
  setInput(inputName: string, value: Structor): void;

  /** Triggers a recalculation of the graph based on dirty nodes. */
  update(): void;

  /** Retrieves the output of a named graph output port. */
  getGraphOutput(outputName: string): Structor | undefined;
}

/* ===================================================================
 * 5. Builder State
 * =================================================================== */

/**
 * The `AppController` manages a state object that represents the visual
 * graph being edited. This state is separate from the core `Structor` types.
 */

// The canonical, serializable state of the graph
export interface GraphState {
    nodes: Record<string, GridNode>;
    connections: Record<string, Connection>;
}

// The full application state, including performance-enhancing lookup maps
export interface AppState {
    graph: GraphState;
    auxiliary: {
        outgoingConnections: Map<string, string[]>;
        incomingConnections: Map<string, string[]>;
    };
}

// Represents a node in the visual editor grid
export interface GridNode {
    id: string;
    x: number;
    y: number;
    config: {
        typeId: string; // The ID of the node's type, e.g., 'add'
        [key: string]: any; // Type-specific config is stored in a sub-object
    };
}

/* ===================================================================
 * 6. The Universal Broadcast Operation Config
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
       * Which *untagged* inputs to pull from.
       * `true` (all), `false` (none), or `[0, 2]` (specific indices).
       */
      fromUntagged: boolean | number[];
      /**
       * How to combine all collected inputs for this channel.
       */
      combine: 'collect' | { reduce: 'min' | 'max' | 'add' | 'first' };
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
```
