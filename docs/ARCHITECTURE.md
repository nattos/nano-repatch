# Structor Architecture

## 1. Core Concepts

### Structor & StructorType

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

The `size: 'dynamic'` in `ArrayType` is critical, allowing the system to handle data whose size is unknown until runtime.

### Nodes (Primitive & Graph)

An operation is defined by a `NodeDefinition`. The system is fully compositional:
* **`PrimitiveNodeDefinition`:** A "black box" operation implemented in native TypeScript.
  1. `computeOutputTypes(inputType, context)`: Pure static analysis function.
  2. `execute(input, context)`: Runtime execution function.
* **`GraphDefinition`:** A composite node defined as a *nested graph*.

### "Grab Bag" Inputs

Nodes do not have simple, fixed-arity inputs. Instead, each node receives a single `StructorRecord` that acts as a "grab bag" of all its connected inputs.
* `fields`: A dictionary of all named/tagged inputs (e.g., `value`, `min`, `max`).
* `untagged`: An ordered array of all unnamed inputs.

## 2. The Universal Broadcast Operation

The core innovation of Structor is the **Universal Broadcast Operation**. It provides a single, declarative API for a node to consume its messy "grab bag" of inputs.

### The Problem
In a node-based system, handling arrays is complex. A simple `add` node should ideally work for:
* Scalar + Scalar (`1 + 2`)
* Vector + Scalar (`[1, 2] + 1`)
* Vector + Vector (`[1, 2] + [3, 4]`)

### The Solution
The `Broadcast` engine acts as a middleware. A node defines a `BroadcastConfig` (a "query") that tells the engine *how* it wishes to receive its data. The engine then gathers, partitions, reduces, coerces, and aligns the data.

### Vectorization Strategy ("Virtual Vectorization")
The system does not currently use SIMD or GPU acceleration. Instead, it abstracts the iteration logic:
*   **Reshape 'vector':** The engine identifies the common shape of all inputs and "broadcasts" scalars to match.
*   **The `apply` Pattern:** The node developer writes logic as if operating on scalars. The `apply` method iterates over the common shape, constructing a transient "args" object for each index.

```typescript
// Example: Add Node
const result = context.broadcast(config, inputs);
return result.apply((args) => {
  // args is a dictionary of scalars { a: 1, b: 10 }
  return args.a + args.b;
});
```

## 3. Static Analysis

The entire system is designed to be statically analyzable.
1. The engine traces types from graph inputs.
2. For each node, it calls `computeOutputTypes` with input types.
3. The static broadcast engine analyzes the `BroadcastConfig` against input types to determine the data shape.
4. The node returns its output type, which becomes the input for the next node.

This enables compile-time error checking and optimization.

## 4. Runtime Architecture

The execution engine runs off the main thread to ensure UI responsiveness.

### Web Worker Migration
*   **`RuntimeManager`:** Main-thread orchestrator.
*   **`CompilerWorker`:** Compiles high-level UI graph state into low-level `GraphDefinition`.
*   **`ExecutorWorker`:** Runs the `GraphExecutor` loop.
*   **Audio Proxy:** Since Web Workers cannot access `AudioContext`, the worker records commands which are batched and sent to the main thread's `AudioRenderer`.

### GraphExecutor
The executor manages the runtime state of a single graph. It uses a dirty-tracking mechanism (`markDirty`, `update`) to only re-calculate parts of the graph affected by a change.

## 5. Application State (AppController)

The `AppController` manages the visual graph editor's state, separate from the execution state.
*   **`GraphState`:** The canonical, serializable nodes and connections.
*   **`Auxiliary State`:** Derived lookup maps (e.g., `incomingConnections`) for efficient UI querying.
*   **Transactional Integrity:** Uses `immer` and a command pattern for undo/redo and atomic updates.
*   **Reactive UI:** Provides a `mobx` observable mirror for the UI components.

### UI vs. Execution State
*   **`GridNode.config` (UI):** Human-readable, editable state (e.g., for inspectors).
*   **`NodeInstance.defaultConfig` (Execution):** `Structor`-formatted value for the executor.
*   **Compiler:** Translates UI state to Execution state.
