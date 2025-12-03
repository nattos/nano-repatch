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

## 6. Advanced Input Handling: Redirection

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

## 7. Case Study: Developing the Curve Ease Node

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
