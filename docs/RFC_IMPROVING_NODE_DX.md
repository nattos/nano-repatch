# RFC: Improving Node Developer Experience (DX)

Based on the development of the `curve.ease` node and the subsequent debugging of the test suite, we have identified several friction points and sources of error in the current node development workflow. This document outlines the problems and proposes solutions to reduce boilerplate, enforce consistency, and improve testability.

## 1. The Problem: "Split Brain" Definitions

### Current State
Currently, a node's definition is split across multiple files and structures:
1.  **Runtime Logic:** `src/customnodes/curve/nodes.ts` (using `definePrimitiveNode`).
2.  **Registration & Metadata:** `src/customnodes/curve/nodes.ts` (manual `repository.register` call).
3.  **UI Registration:** `src/customnodes/curve/nodes.ui.ts` (manual `GraphWidget.registerInspector` call).
4.  **Type Definitions:** `inputs` are defined in runtime logic but must be manually replicated (or mapped) for registration.

### Pain Points
*   **Redundancy:** You have to define inputs twice: once for the `execute` function's type safety and once for the `PortHint` used by the editor/compiler.
*   **Desynchronization:** It's easy to update the runtime logic (e.g., add an input) but forget to update the repository registration, leading to "ghost inputs" that exist in code but not in the UI.
*   **Boilerplate:** Every new node requires a significant amount of setup code just to be visible in the system.

### Proposal: Single Source of Truth
Extend `definePrimitiveNode` to capture **all** necessary information, including metadata and UI hints, and provide a helper to automatically register it.

```typescript
// Proposed API
export const curveEase = defineNode({
  id: 'curve.ease',
  metadata: {
    name: 'Ease',
    category: 'Math',
    description: 'Applies an easing function to the input.'
  },
  inputs: {
    value: { type: NumberType, defaultValue: 0, description: 'Input value (0-1)' },
    easing: { type: EasingType, description: 'Easing curve configuration' }
  },
  outputs: {
    result: { type: NumberType }
  },
  // UI is defined alongside logic, potentially lazy-loaded
  ui: {
    inspector: () => import('./CurveInspector'), // Lazy import
    body: () => import('./CurveBody')
  },
  execute: (inputs) => {
    // inputs is fully typed and guaranteed to have default values applied
    return { result: applyEase(inputs.value, inputs.easing) };
  }
});

// One-line registration
registerNode(curveEase);
```

## 2. The Problem: Default Value Ambiguity

### Current State
*   **Systemic Defaults:** Defined in `PortHint` (e.g., `defaultValue: 0`). Applied by `GraphExecutor` if input is missing.
*   **Runtime Defaults:** Often implemented defensively inside `execute` (e.g., `inputs.value ?? 0`).

### Pain Points
*   **Inconsistency:** Some nodes rely on systemic defaults, others implement their own.
*   **Testing Gaps:** Unit tests often fail to simulate the `GraphExecutor`'s default injection, leading to false negatives (tests failing when the node works in production) or false positives (tests passing because of manual mocks, but failing in production).

### Proposal: Strict Execution Context
*   **Enforcement:** The `execute` function should **only** receive inputs that have passed through a sanitization layer.
*   **Type Safety:** The TypeScript type for `inputs` in `execute` should make optional fields required if a `defaultValue` is provided in the definition.
*   **Test Helper:** A standardized `testNode(definition, inputs)` helper that runs the exact same injection logic as the `GraphExecutor`, ensuring tests match production behavior.

## 3. The Problem: Testing Boilerplate

### Current State
Testing a node requires manually constructing a `StructorRecord`, mocking the `ExecutionContext`, and often manually applying defaults.

```typescript
// Current Test
const result = node.execute({
  fields: { value: 0.5 }, // Manually constructed
  untagged: []
}, {}, mockContext);
```

### Pain Points
*   **Verbose:** High friction to write simple tests.
*   **Fragile:** If the internal `execute` signature changes (e.g., `StructorRecord` structure), all tests break.
*   **Inaccurate:** Doesn't test the "glue" code (default injection, type coercion).

### Proposal: `createNodeHarness`
A dedicated test harness that mimics the engine.

```typescript
// Proposed Test
const harness = createNodeHarness(curveEase);

test('applies default value', () => {
  // We don't pass 'value', harness injects default '0'
  const result = harness.execute({ easing: 'linear' });
  expect(result.result).toBe(0);
});
```

## 4. The Problem: UI/Logic Coupling

### Current State
We recently moved UI code out of the node definition (good!), but the node definition still often needs to know about the UI's configuration structure (e.g., `curve.ease` knowing about `easing` object structure).

### Pain Points
*   **Worker Crashes:** Importing UI code into worker-side logic (even accidentally) crashes the worker.

### Proposal: Strict Separation via Types
*   **Config Schemas:** Define the configuration schema using a runtime validator (like Zod or a lightweight equivalent).
*   **Validation:** The worker validates the config against the schema before passing it to `execute`.
*   **UI Contract:** The UI is just a "Config Generator". It produces a JSON object that satisfies the schema. The Node doesn't care *how* that JSON was produced.

## 5. Type Safety Utilities

### The Problem
We define TypeScript interfaces for our data (e.g., `GraphWidgetConfig`), but then manually reconstruct them as `RecordType` objects. There is no guarantee they match.

### Proposal: `defineRecordType<T>`
A utility that enforces the `RecordType` definition matches the TypeScript interface.

```typescript
interface MyConfig {
  value: number;
  tags?: string[];
}

// Compiler enforces this structure matches MyConfig
const myConfigType = defineRecordType<MyConfig>({
  kind: 'record',
  fields: {
    value: NumberType,
    tags: { kind: 'array', element: StringType, optional: true }
  },
  untagged: []
});
```

## Summary of Action Items

1.  **Refactor `definePrimitiveNode`:** Enhance it to accept metadata and full `PortHint` definitions (including descriptions and ranges).
2.  **Create `registerNode` Helper:** A function that takes the enhanced definition and registers it with the `NodeRepository`, eliminating manual duplication.
3.  **Implement `createNodeHarness`:** A test utility that wraps `GraphExecutor` logic for unit testing single nodes.
4.  **Standardize Config Types:** Move shared config types (like `EasingConfig`) to a shared, non-UI file to prevent accidental UI imports in workers.
5.  **Implement `defineRecordType`:** Add the type utility to `type-helpers.ts` (Done).
