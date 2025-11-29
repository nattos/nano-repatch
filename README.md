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

The execution engine has been modernized to run off the main thread, ensuring the UI remains responsive even during heavy computation.

*   **`RuntimeManager`:** The main-thread orchestrator. It manages the lifecycle of the workers and handles communication between the UI and the execution engine.
*   **`CompilerWorker`:** A dedicated Web Worker that compiles the high-level UI graph state into an optimized, low-level `GraphDefinition`.
*   **`ExecutorWorker`:** A dedicated Web Worker that runs the `GraphExecutor`. It processes the graph in a loop (for realtime nodes) or on demand, sending updates back to the main thread.
*   **Audio Proxy:** Since Web Workers cannot access the `AudioContext` directly, the system uses a proxy pattern. The worker records audio commands, which are batched and sent to the main thread's `AudioRenderer` for execution.

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

* **Result:** The broadcast engine performs the partitioning and reduction and returns a `BroadcastResult`. The node then calls `apply` to execute its logic:
     ```typescript
     const result = context.broadcast(config, inputs);
     return result.apply((args) => {
       // args.value is a scalar here, automatically iterated over the broadcasted arrays
       return Math.max(args.min, Math.min(args.value, args.max));
     });
     ```

#### Example 2: `add` Node (`reshape: 'vector'`)

An `add` node wants to sum *everything* it's given, element-wise.

* **Config:**

  * Dynamically creates a `'collect'` channel for *every single input* (e.g., `'a'`, `'b'`, `'c'`).

  * `reshape: 'vector'`.

* **Result:** The broadcast engine handles the tensor-broadcasting and alignment. The node simply applies its logic:
     ```typescript
     return result.apply((args) => {
       // args is a dictionary of scalars { a: 1, b: 10, c: 5 }
       return args.a + args.b + args.c;
     });
     ```
     The `apply` method handles the iteration and re-assembly of the result, returning either a scalar (if all inputs were scalar) or an array (if any input was a vector).

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

It is important to distinguish between the UI-facing state and the execution-facing state. The `GridNode.config` object is a representation of a node's state designed to be easily manipulated by the UI (e.g., by inspector panels and sliders). In contrast, a `NodeInstance`'s `config` is a `Structor`-formatted value suitable for direct use by the `GraphExecutor`. The process of converting from the UI state to the execution state is handled by a compiler, and there may not be a one-to-one mapping between the two.

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

## Subgraphs and Composition

Structor supports full graph composition. A graph can be treated as a node within another graph.

*   **Graph Inputs/Outputs:** Special `input` and `output` nodes define the interface of a graph.
*   **Subgraph Nodes:** A `subgraph` node represents an instance of another graph. Its input and output ports are dynamically generated based on the `input` and `output` nodes defined in the referenced graph.
*   **Recursion:** The execution engine and static analysis can recursively process nested graphs (implementation in progress).

## UI Concept

The design pillars are clean and solid behaviours. As little menu digging as possible. "Playability" like an instrument, yet uncluttered. The editor should feel like a canvas you paint on, in broad strokes.

### The Grid Layout

The editor features a **3-column layout**:

1.  **Input Column (Left):** Pinned to the left side. Contains `input` nodes that define the graph's arguments.
2.  **Main Grid (Center):** A scrollable, infinite grid for the main logic.
3.  **Output Column (Right):** Pinned to the right side. Contains `output` nodes that define the graph's return values.

### Interaction

*   **Node Creation:**
    *   Double-click in the **Input Column** to create an `input` node.
    *   Double-click in the **Output Column** to create an `output` node.
    *   Double-click in the **Main Grid** to create a standard node (defaulting to a "hub" or generic node).
*   **Drag & Drop:** Nodes can be dragged freely within their allowed areas. Input and Output nodes are vertically scrollable but horizontally locked to their respective columns.
*   **Space Insertion:** Double-clicking on cell borders inserts space, shifting downstream nodes to maintain relative layout.

Nodes themselves will be highly rounded. In the case of the simplest node, a "hub", which simply passes on inputs, it will reduce gracefully to being a circle.

For nodes with editable values, they will be rounded rectangles. For inputs with the default data type (a scalar number), a horizontal slider like element will be displayed.

Connections between nodes will be rendered as nicely styled lines that will be algorithmically laid out.

Finally, there will be a small inspector popup in the bottom right, that allows for tweaking values that do not fit cleanly into sliders, such as the node's "type".

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

export interface BroadcastResult {
  apply(lambda: (args: any) => any): any;
}
```

## Standard Library

Structor comes with a comprehensive set of primitive nodes:

*   **Math:** Constants (`pi`, `e`), Binary (`add`, `sub`, `mul`, `div`, `pow`, `min`, `max`, `fmod`), Unary (`abs`, `neg`, `ceil`, `floor`, `round`, `sin`, `cos`, `tan`, `sqrt`), and Utility (`lerp`, `map`, `clamp`).
*   **Logic:** Binary (`and`, `or`, `xor`, `equals`, `gt`, `lt`) and Unary (`not`).
*   **Utility:** `hub`, `float`.
*   **Functional:** `apply`.
*   **IO:** `input`, `output`, `midi`.

For a full list of available nodes, see [PRIMITIVES.md](src/structor/PRIMITIVES.md).