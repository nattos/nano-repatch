# Node Development Guide

This guide explains how to create new primitive nodes using the `src/structor/type-helpers.ts` utilities. These helpers provide type safety, automatic data marshalling, and boilerplate reduction.

## 1. The `definePrimitiveNode` Helper

The core utility is `definePrimitiveNode`. It wraps your node logic to handle:
*   **Static Analysis:** Automatically generates `computeOutputTypes`.
*   **Data Marshalling:** Unwraps `StructorRecord` inputs into plain JavaScript objects and wraps outputs back.
*   **Broadcasting:** Optionally handles the complex "Universal Broadcast" logic for you.
*   **State Management:** Provides a type-safe way to initialize and access node state.

### Basic Usage

```typescript
import { definePrimitiveNode, NumberType } from './type-helpers';

export const myAddNode = definePrimitiveNode({
  id: 'math.add',
  inputs: { a: NumberType, b: NumberType },
  outputs: { result: NumberType },
  autoBroadcast: true, // <--- The magic switch
  execute: (inputs, config, context) => {
    // inputs is typed as { a: number, b: number }
    // This function is called for every element if inputs are arrays!
    return { result: inputs.a + inputs.b };
  }
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
