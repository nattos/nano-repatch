# Node Development Guide

This guide explains how to create new primitive nodes using the `src/structor/type-helpers.ts` utilities. These helpers provide type safety, automatic data marshalling, and boilerplate reduction.

## 1. The `defineNode` Helper

The core utility is `defineNode` (which wraps `definePrimitiveNode`). It handles:
*   **Static Analysis:** Automatically inferring input/output types from definitions.
*   **Type Safety:** Uses TypeScript 5.0+ `const` generics to preserve literal types for strict inference.
*   **Registration:** Automatically registers the node in the `NodeRepository`.

### Basic Usage

```typescript
import { defineNode } from './node-helpers';
import { numberType } from './std-types';

export const myAddNode = defineNode({
  id: 'math.add',
  version: '1.0.0',
  displayName: 'Add',
  inputs: {
    a: numberType,
    b: numberType
  },
  outputs: {
    result: numberType
  },
  autoBroadcast: {
    // Strict Type Inference:
    // If flattening is used, the runtime type is inferred as scalar[] instead of scalar[][].
    a: { combine: { reduce: 'flatten' } }
  },
  execute: (inputs, config, context) => {
    // 'inputs' is strictly inferred!
    // inputs.a is inferred as number[] (due to flattening)
    // inputs.b is inferred as number
    return { result: (inputs.a[0] || 0) + inputs.b };
  }
});
```

### Typed Configurations

You can enforce type safety for your `uiConfig` by defining it in the generics or letting inference handle it via `compileConfig`.

**CRITICAL: Config Schema Definition**
When defining `config` schemas for `defineNode`, you MUST use valid `StructorType` objects. **Do not wrap them** in `{ type: ... }` like you do for inputs.

**Incorrect:**
```typescript
config: {
  // WRONG: This style is for inputs only
  rootNote: { type: numberType, defaultValue: 60 }
}
```

**Correct:**
```typescript
config: {
  // CORRECT: Spread the type and add properties directly
  rootNote: { ...numberType, defaultValue: 60 }
}
```

This ensures TypeScript correctly asserts the type of `config` in `execute` and `compileConfig`.

```typescript
export const myNode = defineNode({
  // ...
  config: {
    mode: { ...stringType, defaultValue: 'fast' }
  },
  // uiConfig is strictly inferred as { mode: string }
  compileConfig: (uiConfig) => {
    return { ...uiConfig, computed: true };
  }
});
```element if inputs are arrays!
    return { result: inputs.a + inputs.b };
  }
});
```

### Typed Configurations

You can enforce type safety for your `uiConfig` and `compiledConfig` by satisfying the generic arguments:

```typescript
interface MyUIConfig { mode: string; }
interface MyCompiledConfig { mode: string; lookup: number[]; }

export const myNode = definePrimitiveNode<MyUIConfig, MyCompiledConfig>({
    // ...
    compileConfig: (uiConfig) => { ... } // strongly types uiConfig, expects return TCompiledConfig
});
```

## 2. `autoBroadcast` Explained

When `autoBroadcast: true` is set:
1.  The helper generates a `BroadcastConfig` that requests all inputs as 'collect' (if array) or 'first' (if scalar).
2.  It sets `reshape: 'vector'`.
3.  It calls `broadcastResult.apply(...)` with your `execute` function.

**Implication:** Your `execute` function is written as if it operates on **scalars**. The system automatically iterates over vectors. You do **not** need to write loops.

**Override:** You can customize specific inputs:
```typescript
autoBroadcast: {
  // Don't iterate over 'b', take the whole array
  b: { combine: 'collect' }
}
```

## 3. Manual Input Handling

If `autoBroadcast` is `false` (or omitted), your `execute` function receives the **raw, unwrapped** inputs.
*   If input `a` is connected to a vector, `inputs.a` will be an array.
*   You are responsible for iteration and handling mismatched shapes.

Use this for:
*   Reduction nodes (e.g., `sum`, `mean`).
*   Nodes that need to see the whole array (e.g., `sort`, `fft`).

## 4. State Management

Nodes can maintain state across updates (e.g., for integration, smoothing, or oscillators).

```typescript
export const integratorNode = definePrimitiveNode({
  // ...
  createState: (config, context) => {
    return { value: 0 }; // Initial state
  },
  execute: (inputs, config, context, state) => {
    state.value += inputs.delta;
    return { result: state.value };
  }
});
```
*   `createState` is called once per node instance.
*   `state` is passed as the 4th argument to `execute`.
*   The helper handles the `context.nodeState` map lookup for you.

## 5. Common Pitfalls

### 1. `autoBroadcast` vs. Manual
*   **Mistake:** Enabling `autoBroadcast: true` but trying to access `inputs.a.length` inside `execute`.
*   **Correction:** If `autoBroadcast` is on, `inputs.a` is a single element (scalar). If you need the array, use `autoBroadcast: false` or override the input config.

### 2. Missing Registration
*   **Mistake:** Defining a node but forgetting to add it to `ALL_PRIMITIVES` in `src/structor/primitives.ts`.
*   **Symptom:** The node appears in the editor but does nothing when executed (silent failure).
*   **Fix:** Always register your node!

### 3. Output Types
*   **Mistake:** Returning a raw value like `return 5;` instead of a record.
*   **Correction:** `execute` must return a record matching `outputs`: `return { result: 5 };`.

### 4. Structor Types
*   Always use the constants (`NumberType`, `AnyType`) or `defineType` helper. Do not write raw JSON objects for types if possible, to ensure consistency.

### 5. Worker Compatibility
*   **Mistake:** Importing UI libraries (like `lit`, `react`) or accessing `window`/`document` in node definitions or state classes.
*   **Symptom:** The graph executor (which runs in a Web Worker) will crash with `ReferenceError: window is not defined`.
*   **Fix:** Keep node logic pure. If you need UI-specific rendering (like inspectors), keep that code in separate files (e.g., `src/views/`) and do not import it into the node definition or state files.

### 6. Duplicate Parameters
*   **Mistake:** Defining a parameter in both `inputs` and `config` (e.g. `config.pitch` AND `inputs.pitch`).
*   **Correction:** Define it **ONLY** in `inputs`.
    *   Use `defaultValue` in the input definition for the initial value.
    *   Use `range` in the input definition constraints for UI sliders (e.g., `range: [-24, 24]`).
    *   Do NOT enable it in `config`. The system handles "virtual inputs" (values injected when nothing is connected) automatically.


## 7. Advanced Input Handling: Redirection

Sometimes you want a named input port in the UI (e.g., `seq_in`) to collect multiple connections into a single array in the `untagged` input list. This is useful for nodes that process variable numbers of inputs but want a labeled connection point.

```typescript
inputs: {
  seq_in: {
    type: sequenceStructorType,
    description: 'Input sequence(s)',
    redirect: 'untagged' // <--- The magic property
  }
}
```

*   **Effect:** Connections to `seq_in` are routed to the `untagged` array in the `inputs` record passed to `execute`.
*   **Usage:** Combine this with `autoBroadcast: { seq_in: { combine: 'collect', fromUntagged: true } }` to automatically aggregate these inputs.

## 7. Generic Inspector Fields

To simplify creating inspector panels, we provide a generic inspector factory. You can define the inspector directly in your node registration using a configuration object.

```typescript
import { registerNode, InspectorFieldDef } from '../../structor/node-helpers';

const MyFields: InspectorFieldDef[] = [
  { type: 'number', label: 'Frequency', path: 'freq', min: 20, max: 20000 },
  { type: 'slider', label: 'Gain', path: 'gain', min: 0, max: 1, step: 0.01 },
  { type: 'select', label: 'Type', path: 'type', options: [
    { label: 'Sine', value: 'sine' },
    { label: 'Square', value: 'square' }
  ]}
];

registerNode({
  ...myNodeDef,
  ui: {
    inspector: { fields: MyFields }
  }
});
```

This automatically handles:
*   Rendering the UI with correct metrics (24px row height).
*   Binding to `node.config[path]`.
*   Calling `onchange` updates.

## 8. Case Study: Developing the Curve Ease Node

This section journals the development of the `curve.ease` node to illustrate real-world challenges and solutions.

### The Goal
Create a node that applies an easing function to an input value, with a rich visual curve editor embedded directly in the node body.

### Journey & Pitfalls

#### 1. UI Integration: Inspector vs. Body
*   **Attempt 1:** We initially placed the curve editor in the Inspector panel. While functional, it felt disconnected from the node itself.
*   **Attempt 2:** We moved the UI to the node body using `renderBody`. This provided a much better UX but introduced interaction conflicts.
*   **Pitfall (Interaction):** Dragging points on the curve editor caused the entire node to drag.
*   **Solution:** We implemented `stopPropagation` on pointer events within the editor. Later, we refined this by checking for the `virtual-inputs-container` class in the `GraphNode`'s pointer handler to prevent drag initiation on interactive elements.

#### 2. Styling & CSP
*   **Attempt:** We tried adding inline `<style>` tags in the LitElement component.
*   **Pitfall:** This is bad practice and can violate Content Security Policies (CSP). It also makes reuse difficult.
*   **Solution:** We moved styles to `src/styles.ts` and imported them into the component.

#### 3. State Management & Undo/Redo
*   **Challenge:** The curve configuration (control points) needed to be part of the node's config so it would be saved and undoable.
*   **Pitfall:** Directly modifying the local component state didn't update the graph model or trigger undo history.
*   **Solution:** We used `appController.updateNodeConfig` to commit changes.
*   **Refinement (Long Edits):** Dragging a control point generates hundreds of updates. We didn't want hundreds of undo steps.
*   **Solution:** We implemented `appController.beginLongEdit()` and `longEdit.applyAgain()` to coalesce continuous updates into a single undo step.

#### 4. Default Values & Systemic Handling
*   **Challenge:** The node needed to work even if inputs were disconnected.
*   **Pitfall:** We initially tried to patch this inside the `execute` function with manual checks (`inputs.value ?? 0`). This was fragile and inconsistent with other nodes.
*   **Solution:** We implemented **Systemic Default Value Handling** in `GraphExecutor`. By defining `defaultValue` in the `PortHint` (e.g., `{ ...NumberType, defaultValue: 0 }`), the executor automatically injects this value if the input is missing. This removed the need for defensive coding inside the node itself.

#### 5. Testing & Reflection
*   **Challenge:** Unit tests for `curve.ease` started failing after we refactored the inputs.
*   **Pitfall:** The tests were manually constructing input objects that didn't match what `GraphExecutor` provides (e.g., passing config as a separate argument instead of an input).
*   **Red Herring:** We thought `GraphExecutor` was failing to map indexed ports (e.g., connecting to port 0). While this *was* an issue (which we fixed), the root cause of the test failure was that our test harness didn't accurately simulate the runtime environment.
*   **Solution:** We updated `definePrimitiveNode` to expose the `inputs` definition at runtime. This allowed our test helpers (like `compileAndRun`) to reflect on the node's structure and automatically apply default values, ensuring the test environment matches the production environment.

### Key Takeaways
1.  **Keep Logic Pure:** Isolate node logic from UI.
2.  **Use Systemic Features:** Rely on `GraphExecutor` for defaults and broadcasting; don't reinvent them.
3.  **Test the Contract:** Ensure your unit tests simulate the `GraphExecutor`'s behavior accurately, especially regarding input injection and config handling.
4.  **Handle Interactions:** When embedding complex UI in nodes, carefully manage pointer events to prevent conflicts with the graph editor's drag-and-drop system.

## 9. Advanced UI Patterns: "Hero" Nodes

For nodes that require complex, high-frequency visualizations (like `Orthomod`), standard inspector fields or simple status indicators are insufficient. We call these "Hero" nodes because they feature rich, embedded editors.

### The Challenge: High-Frequency Visualization
A typical node update cycle might process audio or logic at high rates (e.g., audio sample rate or frame rate). Sending all this data through the standard graph outputs to be React-rendered in the UI is expensive and can cause lag.

### The Solution: "UI Only" Outputs
To solve this, we introduced a side-channel for UI data. The node execution logic calculates visualization state (e.g., envelope position, generated codes, modulation values) and returns it in a special `ui` property alongside standard `outputs`.

#### 1. In the Node Definition
The `execute` function returns an extra `ui` object. This object is NOT part of the graph's data flow (downstream nodes can't see it), but it is shipped to the main thread.

```typescript
// orthomod.ts
execute: (inputs, config, context, state) => {
  // ... calculate complex logic ...

  return {
    outputs: {
      // Standard graph outputs (consumed by other nodes)
      env: currentEnv,
      gate: state.gateOpen
    },
    // Special UI-only payload (consumed by the editor)
    ui: {
      codes: state.codes,       // Heavy array
      env: currentEnv,          // Current value for visualization
      activeCodeIndex: idx,     // Computed index
      rawVec: rawChannels       // Internal state not exposed to graph
    }
  };
}
```

#### 2. In the Editor Component
The custom editor component (e.g., `OrthomodEditorRenderer`) runs on the main thread. It bypasses the standard input props and polls the `runtimeManager` directly for this high-frequency data.

```typescript
// orthomod-editor.ts
private startLoop() {
  const loop = () => {
    this.animationFrame = requestAnimationFrame(loop);

    // Poll RuntimeManager for the latest UI state packet
    const uiState = runtimeManager.uiStates.get(this.node.id);

    if (uiState) {
      // Update local LitElement state efficiently
      this.codes = uiState.codes;
      this.envelope = uiState.env;
      this.requestUpdate();
    }
  };
  loop();
}
```

### Benefits
1.  **Performance:** Heavy visualization data (like full codebooks or FFT arrays) doesn't clog the graph execution dependency chain.
2.  **Decoupling:** The UI can render at 60fps (screen refresh) while the node logic runs at its own rate or only when dirty.
3.  **Encapsulation:** Internal state (like `rawVec` before modulation) can be visualized without exposing it as a valid connection point for other nodes.

### Visual Design Guidelines for Hero Nodes
*   **Density:** Use dense, high-contrast displays.
*   **Color:** Use a "hero" accent color (e.g., yellow `#ffcc00` for Orthomod) against a dark background.
*   **Ghosting:** Show "raw" or "underlying" values (ghost bars) behind the active values to help users understand the modulation.
*   **Interactivity:** If the visualization is also an input (e.g., scrubbing), ensure pointer events use `stopPropagation()` to avoid conflicting with the graph editor's canvas panning.

## 10. Quirks & Limitations (Dynamic Ports)

### 1. Dynamic Port Visibility
*   For nodes like `core.unpack`, output ports (e.g., `x`, `y`, `z`, `w`) are generated dynamically based on the input type.
*   **Limitation:** These ports only appear *after* a valid connection is made to the input. If the input is disconnected or invalid, the node may show no outputs. The UI blindly trusts the Compiler Worker's `inferredTypes`.

### 2. Vector Unpacking
*   Named outputs (`x`, `y`, `z`, `w`) are currently supported only for vector sizes 2, 3, and 4.
*   Other array sizes use numerical indices (`0`, `1`, ...).


### 3. Pack Node
*   The `core.pack` node accepts any input type but treats its output as a generic Record containing those named fields.
*   Downstream nodes must be able to handle this Record structure.

## 12. Configuration Lifecycle: UI to Runtime

A key architectural concept is the distinction between **UI Configuration** (what the inspector sees) and **Runtime Configuration** (what the `execute` function sees).

### 1. TUIConfig vs. TCompiledConfig

*   **TUIConfig (`uiConfig`)**: The raw state of the UI inspectors. This might be a complex nested object, or raw string values from text inputs.
*   **TCompiledConfig (`compiledConfig`)**: The optimized, validated, and type-safe configuration object required by the runtime loop.

By default, they are the same. However, you can transform them using `compileConfig`.

### 2. The `compileConfig` Hook

Define this in your node to authorize and transform data before it hits the generic `GraphExecutor`.

```typescript
compileConfig: (uiConfig) => {
  // 1. Validate / Sanitize
  const mode = isValidMode(uiConfig.mode) ? uiConfig.mode : 'default';

  // 2. Pre-calculate lookup tables or optimize structures
  const lookup = generateLookupTable(mode);

  // Returns TCompiledConfig
  return { mode, lookup };
}
```

### 3. Lifecycle Methods

*   **`computeForwardPorts(inputTypes, uiConfig)`**: Receives `uiConfig`. Determines ports based on UI state (e.g. "Polyphonic" toggle adds outputs).
*   **`shouldRecompileOnConfigChange(uiConfig)`**: Receives `uiConfig`. Returns `true` if a UI change necessitates a full graph topology rebuild.
*   **`execute(inputs, compiledConfig, ...)`**: Receives the **result** of `compileConfig`.

---

## 13. Configuration Updates & Virtual Inputs

### The Challenge: Config Merging
When a node's configuration is updated (e.g., from the Inspector or a test), the `GraphExecutor` merges the new config into the existing state.
*   **Structure:** A node's config is typically a `StructorRecord` ({ kind: 'record', fields: { ... } }).
*   **Virtual Inputs:** Values for unconnected ports are stored in a special `values` property on the config object (e.g., `config.values.frequency`).

### The Pitfall: Data Loss
Earlier versions of the executor used a simple spread merge which could accidentally discard top-level properties like `values` if the new config only contained `fields`.
*   **Symptom:** Disconnecting a wire caused the node to revert to `0` or `null` instead of the last set virtual input value.
*   **Fix:** `GraphExecutor.setNodeConfig` now performs a **shallow merge** of top-level properties (preserving `values`) and a **deep merge** of the `fields` object.

### Best Practice
When manually constructing config updates (e.g., in unit tests):
1.  **Prefer Partial Updates:** You only need to provide the fields you want to change.
2.  **Respect Structure:** If you are updating a primitive value (e.g., changing a number constant), the executor handles the replacement. If updating a record, it merges fields.
3.  **Virtual Inputs:** If you need to simulate a user setting a virtual input value (without a wire connection), set it in `config.values`:
    ```typescript
    executor.setNodeConfig('myNode', { values: { frequency: 440 } });
    ```


## 14. Dynamic Ports & Configuration Pitfalls

Some nodes (like `curve.crop`) need to change their Input/Output topology based on their configuration (e.g. changing a `mode` from "Start/End" to "Start/Length"). This introduces significant complexity in the graph runtime.

### The Mechanism: `computeForwardPorts`
Use `computeForwardPorts` in your node definition to functionally determine your ports based on the current config.
```typescript
computeForwardPorts: (inputTypes, config, context) => {
  if (config.mode === 'start-length') {
    return { inputs: { start: NumberType, length: NumberType }, ... };
  }
  return { inputs: { start: NumberType, end: NumberType }, ... };
}
```

### Pitfall 1: Stale Topology
**Symptom:** You change the mode slider, but the node's ports on the graph don't update.
**Cause:** The runtime assumes connection topology is static unless told otherwise. It only re-runs type inference if connections change, not if config values change.
**Fix:** You must implement `shouldRecompileOnConfigChange` in your node options.
```typescript
shouldRecompileOnConfigChange: (config) => {
  return true; // Force full graph recompile if config changes
}
```
This tells the `RuntimeManager` that a config update for this node is structural. It triggers a full `compileGraph`, which re-runs `computeForwardPorts`.

### Pitfall 2: Stale Execution State
**Symptom:** The ports update visually, but the node continues outputting values based on the *old* configuration (e.g., using the old mode logic).
**Cause:** When the graph is recompiled, the `GraphExecutor` attempts to preserve state (like current values and dirty flags) from the previous instance. If the configuration change isn't explicitly flagged, the node might not be marked as `dirty`, so it skips execution with the fresh config.
**Fix:** The `RuntimeManager` now explicitly tracks which nodes requested a recompile and passes `dirtyNodeIds` to the new Executor. The Executor forces these nodes to be `isDirty: true`, ensuring they run immediately.

### Pitfall 3: Numeric Port Resolution (Known Issue)
**Symptom:** After a dynamic topology change (recompile), downstream nodes might read `0` or `undefined` inputs even though wires verify visually.
**Cause:** The Compiler Worker may optimize connections to use numeric indices (e.g., `fromPort: 0`) instead of names (e.g., `fromPort: 'result'`) when regenerating the graph definition. The `GraphExecutor` currently struggles to resolve these numeric indices back to named ports in some dynamic scenarios.
**Workaround:** This is an open engineering challenge. Ensure your dynamic nodes reuse the same port names/indices as consistently as possible to minimize compiler ambiguity.

## 15. Reducers & Multi-Connection Inputs

### The Concept
By default, standard ports accept only one connection. However, many node types benefits from aggregating multiple data streams (e.g., merging multiple MIDI keyboards, summing multiple audio signals).

### Configuration
To enable this, use `allowMultiConnection: true` in your input definition and configure a **Reducer** in `autoBroadcast`.

```typescript
inputs: {
  stream: { type: midiStreamType, allowMultiConnection: true }
},
autoBroadcast: {
  stream: { combine: { reduce: 'flatten' } }
}
```

### Reducer Types
*   `first` (Default): Uses only the first connected source. Ignores others.
*   `collect`: Gathers all inputs into an array `[Input1, Input2, ...]`.
*   `flatten`: Gathers inputs and flattens them one level deep `[...Input1, ...Input2]`.

### Best Practice: MIDI Inputs
**Always** use the `flatten` reducer for `midiStreamType` inputs.
*   MIDI streams are arrays of events `MidiEvent[]`.
*   If you have two keyboards connected, `collect` would give you `[[EventA], [EventB]]` (an array of streams).
*   `flatten` gives you `[EventA, EventB]` (a single merged stream), which is usually what your logic expects.

This pattern eliminates the need for users to manually place "Merge" nodes, making the graph cleaner and more intuitive.

## 11. Type Safety & Best Practices

### Avoiding `any`
Using `any` undermines the type safety guarantees that the Structor system provides. It can lead to subtle runtime errors, especially when interacting with the Compiler or Executor workers.

*   **DON'T** cast `config` or `context` to `any` to access properties.
*   **DO** define specific interfaces for your node's configuration and context extension.

```typescript
// BAD
const myNode = definePrimitiveNode({
  // ...
  execute: (inputs, config, context) => {
    const val = (config as any).myValue; // Unsafe!
    return { result: val };
  }
});

// GOOD
interface MyConfig {
  myValue: number;
}

const myNode = definePrimitiveNode<MyConfig, MyConfig>({
  // ...
  execute: (inputs, config, context) => {
    const val = config.myValue; // Safe
    return { result: val };
  }
});
```


*   **DON'T** return `any` from type computation functions like `computeForwardPorts`. Always return a strictly typed `RecordType`.

## 6. Advanced UI Customization

### Dynamic Display Labels

Nodes can define a `getDisplayLabel` function to customize the text shown in the node header (when the node name is set to `#` or empty).

```typescript
export const myNode = definePrimitiveNode({
  // ...
  getDisplayLabel: (config) => {
    // Return a string based on config
    return config.mode === 'fast' ? 'Fast Node' : 'Slow Node';
  }
});
```

This is useful for nodes where the configuration fundamentally changes the identity or function of the node (e.g., Subgraphs, generic Math nodes).
