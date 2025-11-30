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
