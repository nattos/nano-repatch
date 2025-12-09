# Execution Flow Architecture

This document outlines the high-level architecture of the application's runtime execution, specifically focusing on the message passing and data flow between the Main Thread (UI), the Compiler Worker, and the Executor Worker.

## Overview

The application uses a **Multi-Worker Architecture** to offload heavy computations (compilation and graph execution) from the Main Thread, ensuring the UI remains responsive even during complex audio/visual synthesis.

### High-Level Components

*   **Main Thread (UI):** Handles user interaction, manages `AppState`, and renders visualizers. It contains the `RuntimeManager` which orchestrates communication with workers.
*   **Compiler Worker:** Compiles the high-level `AppState` (nodes, connections) into an optimized, flat `GraphDefinition`. It also pre-compiles node configurations.
*   **Executor Worker:** Runs the actual graph execution loop. It maintains the `GraphExecutor` instance, processes signals (MIDI, Audio), and computes outputs at a fixed frame rate (typically 60Hz).

## Message Flow Diagrams

### 1. Initial Load & Graph Recompilation

When the user modifies the graph structure (adding nodes, connecting wires), the graph must be recompiled.

```mermaid
sequenceDiagram
    participant UI as Main Thread (AppController)
    participant RM as RuntimeManager
    participant CW as Compiler Worker
    participant EW as Executor Worker

    UI->>RM: Graph Dirty Signal (Debounced)
    RM->>CW: postMessage({ type: 'COMPILE_GRAPH', state, subgraphs })
    Note right of CW: Flattens subgraphs, resolves types,<br/>builds execution order.
    CW->>RM: postMessage({ type: 'GRAPH_COMPILED', graph })
    RM->>EW: postMessage({ type: 'INIT_GRAPH', graph })
    Note right of EW: Instantiates GraphExecutor,<br/>restores state if recompile.
    RM->>RM: checkRealtimeStatus()
```

### 2. Configuration Updates (Realtime & Static)

When the user changes a node parameter (e.g., a slider), the system attempts to update the running graph without a full recompile.

```mermaid
sequenceDiagram
    participant UI as Main Thread
    participant RM as RuntimeManager
    participant CW as Compiler Worker
    participant EW as Executor Worker

    UI->>RM: Config Change (nodeId, values)
    RM->>CW: postMessage({ type: 'COMPILE_CONFIGS', nodes })
    Note right of CW: Compiles UI config into<br/>runtime-ready config.
    CW->>RM: postMessage({ type: 'CONFIGS_COMPILED', configs })
    RM->>EW: postMessage({ type: 'UPDATE_CONFIG', nodeId, config })
    Note right of EW: GraphExecutor updates<br/>live node instance.
```

### 3. Execution Loop (The "Heartbeat")

The Executor Worker runs a high-frequency loop (default 60Hz) to process data and generate signals.

```mermaid
sequenceDiagram
    participant EW as Executor Worker (Loop)
    participant RM as RuntimeManager
    participant UI as UI Visualizers
    participant Audio as AudioRenderer

    loop Every Tick (16ms)
        EW->>EW: Update Clock
        EW->>EW: GraphExecutor.update()
        EW->>EW: Collect Outputs & Stats
        EW->>EW: Flush Audio Commands
        EW->>RM: postMessage({ type: 'EXECUTION_UPDATE', outputs, audioCommands })
    end

    RM->>Audio: execute(audioCommands)
    RM->>UI: Update Visualizers / Debug Overlay
```

### 4. External Inputs (MIDI & Audio State)

External events like MIDI or browser Audio Context state changes are pushed to the worker immediately.

```mermaid
sequenceDiagram
    participant Ext as External (MIDI/Browser)
    participant RM as RuntimeManager
    participant EW as Executor Worker

    Ext->>RM: MIDI Event / Audio Resume
    RM->>EW: postMessage({ type: 'MIDI_UPDATE', events })
    RM->>EW: postMessage({ type: 'UPDATE_AUDIO_STATE', state })
```

## Detailed Message Types

### Compiler Worker Messages

| Message Type | Direction | Payload | Description |
| :--- | :--- | :--- | :--- |
| `COMPILE_GRAPH` | Main -> Worker | `state` (AppState), `subgraphs` | Requests a full graph compilation. |
| `GRAPH_COMPILED` | Worker -> Main | `graph` (GraphDefinition) | Returns the executable graph structure. |
| `COMPILE_CONFIGS` | Main -> Worker | `nodes` (List of configs) | Requests compilation of specific node configurations (without full graph rebuild). |
| `CONFIGS_COMPILED` | Worker -> Main | `configs` (Map) | Returns compiled config objects ready for the executor. |

### Executor Worker Messages

| Message Type | Direction | Payload | Description |
| :--- | :--- | :--- | :--- |
| `INIT_GRAPH` | Main -> Worker | `graph` | Loads a new execution graph. Supports `isRecompilation` flag to preserve state. |
| `UPDATE_CONFIG` | Main -> Worker | `nodeId`, `config` | Updates the configuration of a live node. |
| `UPDATE_INPUT` | Main -> Worker | `name`, `value` | Updates a specific input value (optimized path for simple values). |
| `CONTROL` | Main -> Worker | `action` (START/STOP/STEP) | Controls the execution loop state. |
| `MIDI_UPDATE` | Main -> Worker | `events`, `values` | Pushes new MIDI data to the worker. |
| `UPDATE_AUDIO_STATE`| Main -> Worker | `state` (running/suspended) | Syncs the browser's AudioContext state. |
| `EXECUTION_UPDATE` | Worker -> Main | `outputs`, `stats`, `audioCommands` |**The Workhorse Message.** Contains node outputs for UI, performance stats, and commands for the `AudioRenderer`. |

## Key Concepts

### 1. `GraphDefinition` vs `AppState`
`AppState` is the source of truth for the UI (positions, names, saved values). `GraphDefinition` is the compiled, flattened instructions for the runtime. Subgraphs are flattened, and virtual inputs are resolved into default values during compilation.

### 2. Auto-Flattening Arrays (Heuristic)
The `GraphExecutor` includes logic to handle strict type matching. If a node expects an **Array** input but receives a **Stream of Scalars**, the executor will automatically collect the stream values into an array before execution. This enables polyphony patterns (e.g., `NicePattern` sequences) without manual "Collect" nodes.

### 3. The "Hero Node" Pattern
To keep the `EXECUTION_UPDATE` message light, nodes that need to visualize high-frequency data (like envelopes or FFTs) use a special side-channel in their output object, often named `ui`. The `RuntimeManager` exposes this via `uiStates`, allowing custom editors to render smooth animations without transferring massive data blobs for every single node in the graph.

## Deep Dive: Node Lifecycle & Broadcast

This section details the lifecycle of a single node execution, specifically illustrating how the **System** (Compiler + Executor) handles type mismatches automatically via **Auto-Broadcast**.

### Example Scenario: Scalar * Vector Multiplication
We have a graph with three nodes:
1.  **LFO** (`math.sin`): Outputs a single scalar number (e.g., `0.5`).
2.  **Constants** (`data.literal`): Configured to output an array `[10, 20, 30]`.
3.  **Multiplier** (`math.multiply`): Input `a` from LFO, Input `b` from Constants.

### Unified Lifecycle Diagram (Compiler + Executor)

This diagram visualizes the flow from the perspective of the **Multiplier Node**. It flattens the Worker boundary to show how configuration and execution interact.

```mermaid
sequenceDiagram
    participant UI as User Interaction
    participant Sys as System (Compiler/Executor)
    participant Def as Node Definition (math.multiply)

    Note over UI, Def: PHASE 1: COMPILATION (Static Analysis)

    UI->>Sys: Connect LFO (Scalar) -> Multiplier.a
    UI->>Sys: Connect Constants (Array) -> Multiplier.b

    Sys->>Def: computeOutputTypes(inputs: { a: Scalar, b: Array })
    Note right of Sys: System detects broadcast is possible.<br/>Input 'b' is the driving Vector (size 3).

    Def->>Sys: returns { result: Array<Number> }
    Note right of Sys: System now knows Multiplier<br/>outputs a Vector of size 3.

    Note over UI, Def: PHASE 2: EXECUTION (Per Tick)

    loop Every Frame (16ms)
        Sys->>Sys: Execute Upstream (LFO -> 0.5)
        Sys->>Sys: Execute Upstream (Constants -> [10, 20, 30])

        Note right of Sys: Auto-Broadcast Logic Triggered

        Sys->>Sys: Determine Shape: Vector(3)

        rect rgb(240, 240, 240)
            Note right of Sys: Iteration 1
            Sys->>Def: execute({ a: 0.5, b: 10 })
            Def-->>Sys: { result: 5 }

            Note right of Sys: Iteration 2
            Sys->>Def: execute({ a: 0.5, b: 20 })
            Def-->>Sys: { result: 10 }

            Note right of Sys: Iteration 3
            Sys->>Def: execute({ a: 0.5, b: 30 })
            Def-->>Sys: { result: 15 }
        end

        Sys->>Sys: Re-assemble Broadcast Result
        Sys-->>Sys: Output: { result: [5, 10, 15] }
    end
```

### Auto-Broadcast Mechanics
The `math.multiply` node does **not** need to know about arrays. Its definition is simple:
```typescript
(a, b) => a * b
```
The **Executor** wraps this function. When it sees an Array on input `b` but a Scalar on `a`, and the node defines `autoBroadcast: true`:
1.  It expands `a` to infinite length (repeating `0.5`).
2.  It iterates over the length of the longest array input (`b` -> length 3).
3.  It calls the simple scalar function 3 times.
4.  It collects the results into an array.
