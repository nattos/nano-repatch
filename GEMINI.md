# Gemini Development Log

This document tracks the active development process.
For historical logs, see **[docs/dev-log-archive.md](docs/dev-log-archive.md)**.

## Pattern Node Polyphony & GraphExecutor Fixes (As of 2025-12-03)

This entry documents the resolution of a critical bug where the `pattern` node failed to process multiple sequence inputs, and the underlying `GraphExecutor` issue that caused it.

### Bug Fixes

1.  **Pattern Node Polyphony:**
    *   **Issue:** The `pattern` node was not correctly aggregating multiple inputs connected to its named `seq_in` port. Only one input was being processed.
    *   **Root Cause:** The `GraphExecutor`'s input redirection logic (mapping named ports to untagged inputs via `redirect: 'untagged'`) was failing because the `redirect` metadata was being stripped during node registration in `defineNode`.
    *   **Fix:**
        *   Updated `defineNode` and `registerNode` in `src/structor/node-helpers.ts` to preserve the `redirect` property in the `inputs` definition.
        *   Updated `GraphExecutor` in `src/structor/executor.ts` to correctly look up and respect the `redirect` metadata, allowing it to collect multiple inputs into the `untagged` array as expected by the `pattern` node's `autoBroadcast` configuration.
        *   Refactored `pattern` node execution to maintain separate state for each input sequence, enabling true polyphony.

2.  **Integration Test Fixes:**
    *   **Issue:** The integration test `should process multiple sequence inputs on named port` was failing with a syntax error (`port` instead of `portIn` for destination).
    *   **Fix:** Corrected the test case in `src/customnodes/nicepattern/nicepattern-integration.test.ts` to use `portIn`.

3.  **Missing Node Registrations:**
    *   **Issue:** Custom nodes (NicePattern, MIDI, Expression, Resolume) were not being registered in the worker environment because their registration was tied to UI-specific files.
    *   **Fix:** Added explicit `registerNode` calls in the respective `nodes.ts` files for each module, ensuring they are available for execution even without the UI.

### Verification

*   **Integration Tests:** Validated that `src/customnodes/nicepattern/nicepattern-integration.test.ts` passes, confirming that the `pattern` node now correctly handles multiple inputs and generates polyphonic MIDI output.
*   **Unit Tests:** Verified that all other tests pass.

## Resolume Inspector Refactor (As of 2025-12-01)

This entry documents the refactoring of the Resolume Inspector into a dedicated LitElement component and the resolution of a critical worker crash.

### Features Implemented

1.  **Resolume Inspector Component:**
    *   Refactored the inspector UI into a reusable `<resolume-inspector>` LitElement component.
    *   Implemented rich parameter controls (sliders, toggles, dropdowns, color pickers) matching Resolume's aesthetic.
    *   Added drag-and-drop support for creating parameter nodes from the inspector.

2.  **Robust Subscription Management:**
    *   Implemented automatic subscription/unsubscription to Resolume parameters when the inspector target changes.
    *   Refactored `ResolumeManager` to require a subscriber key for subscriptions, ensuring that the inspector can cleanly unsubscribe from all its parameters without affecting other parts of the system.
    *   Updated `ResolumeManager` to use a `Map<string, Map<any, callback>>` structure to support multiple subscribers per parameter.

### Bug Fixes

1.  **Worker Crash (ReferenceError: window is not defined):**
    *   **Issue:** The `executor.worker.ts` imported `resolumeManager`, which imported `state.ts`. `state.ts` contained `lit` imports and `renderInspectorContent` methods, causing the worker to try and load DOM-related code in a non-DOM environment.
    *   **Fix:** Removed all `lit` imports and rendering logic from `src/io/resolume/state.ts`. The rendering logic is now fully encapsulated within `src/views/resolume-inspector.ts`.

2.  **Stale Config:**
    *   Confirmed that `chaos_generator` and other NicePattern nodes correctly default to Middle C (60) for their root/target notes. Previous reports of "wrong root note" were due to stale configuration in existing nodes.

3.  **ToneSynth Triggering:**
    *   **Issue:** `toneSynthPrimitive` was ignoring its `targetNote` configuration, causing it to trigger on ANY note event (behaving like an "Any Note" layer). This led to unexpected triggering when multiple notes were played or when releasing other notes.
    *   **Fix:** Updated `toneSynthPrimitive` in `src/customnodes/nicepattern/nodes.ts` to:
        *   Pass `targetNote` to the `ToneSynthLayer` constructor in `createState`.
        *   Filter incoming MIDI events in `execute` to only process events matching the `targetNote`.
    *   **Verification:** Added a regression test in `src/customnodes/nicepattern/nicepattern-integration.test.ts` ensuring it ignores Note Off events and events for non-target notes.

## Primitive Node Integration Tests (As of 2025-11-30)

This entry documents the creation of integration tests for primitive nodes and the resolution of a critical bug in node registration.

### Features Implemented

1.  **Primitives Integration Test Suite:** Created `src/structor/primitives-integration.test.ts` to verify the execution of primitive nodes within a compiled graph.
2.  **`compileAndRun` Helper:** Implemented a helper function to simplify test setup by creating a graph from a concise definition, compiling it, and running the executor.
3.  **Test Cases:** Added tests for:
    *   Chained math operations (`add`, `multiply`).
    *   Chained logic operations (`greater_than`, `less_than`, `and`).
    *   `math.clamp` (verifying named output `value`).
    *   `math.lerp` (verifying `autoBroadcast` and execution).

### Bug Fixes

1.  **Missing Node Registration:** Discovered that `primitive_lerp` (and several other nodes like `map`, `hub`, `float`) were defined but **not added** to the `ALL_PRIMITIVES` array. This caused the `GraphExecutor` to fail silently when trying to execute these nodes, as their definitions were not found in the repository. Added these nodes to `ALL_PRIMITIVES`.
2.  **`primitive_clamp` Definition:** Updated `primitive_clamp` to use a named output `value` instead of relying on default behavior, matching the test expectations.

### Debugging Insights

*   **Silent Failures:** The `GraphExecutor` silently skips nodes if their definition is missing. This made debugging difficult as the graph topology looked correct, but the node simply didn't run.
*   **Execution Order:** The `executionOrder` was correct, but the node execution itself was skipped due to the missing definition.
*   **`autoBroadcast` Verification:** Confirmed that `autoBroadcast: true` works correctly for `math.lerp` once the node is properly registered.

## Principled Layout System (As of 2025-11-30)

This entry documents the implementation of the "Perfect Alignment" grid system and the subsequent styling refinements.

### Features Implemented

1.  **Principled Grid Metrics:**
    *   Established a strict grid system based on an **80px** base unit and **16px** gap.
    *   Defined **24px** row heights, ensuring that all node sizes (Single: 80px, Double: 176px, Triple: 272px) are integer multiples of the row height + padding.
    *   See **[UI_METRICS.md](UI_METRICS.md)** for the definitive specification.

2.  **Visual Refinements:**
    *   **Architectural Draft Style:** Replaced solid grid cell backgrounds with dashed lines drawn *through* the gaps (horizontal, vertical, and cross intersections).
    *   **Dark Mode Optimization:** Reduced the brightness of selection indicators (transparent blue backgrounds with borders) to eliminate the "flashlight effect" in dark venues.
    *   **Inline Graph Creation:** Replaced the flaky `prompt()` dialog with a robust inline input field in the Workspace panel.

### Documentation

*   **[docs/UI_METRICS.md](../UI_METRICS.md)** has been updated with "Vertical Rhythm" and "Grid Fit Verification" sections to guide custom editor implementation.

## Test Fixes & Systemic Improvements (As of 2025-12-01)

This entry documents the resolution of several failing unit tests and the underlying systemic issues they revealed.

### Features Implemented

1.  **Robust Graph Execution:**
    *   **Indexed Port Mapping:** Updated `GraphExecutor` to correctly map connections to indexed ports (e.g., `toPort: 0`) to their corresponding named inputs (e.g., `value`) based on the node definition. This ensures compatibility with tests and potential user actions that rely on index-based connections.
    *   **Default Value Application:** Enhanced `GraphExecutor` to automatically apply `defaultValue` from `PortHint` (node definition) when an input is neither connected nor configured. This fixes issues where nodes like `math.clamp` would fail to use their default `min`/`max` values.

2.  **Type Reflection:**
    *   **Exposed Inputs:** Updated `definePrimitiveNode` and `PrimitiveNodeDefinition` to expose the `inputs` definition on the runtime object. This allows tests and other tools to reflect on the node's expected inputs and default values, which was critical for `virtual-inputs.test.ts`.

### Bug Fixes

1.  **Curve Node Tests:** Updated `curve.ease` tests to correctly pass the `easing` configuration as a named input, matching the node's updated `execute` signature.
2.  **Compiler Tests:** Updated `builder/compiler.test.ts` to reflect the optimized behavior where virtual inputs are injected into `node.config` rather than generating separate literal nodes.
3.  **Graph Node Tests:** Updated `views/graph-node.test.ts` to expect the correct named output port (`value`) for `math.clamp`, aligning with its definition.

### Verification

*   **All Tests Passing:** Validated that all unit tests (`npm test`) are now passing, including the previously failing `compiler`, `executor`, `virtual-inputs`, and `graph-node` tests.

## Graph Editor QoL Improvements (As of 2025-12-06)

This entry documents the implementation of several Quality-of-Life improvements for the graph editor.

### Features Implemented

1.  **Auto-Spacing Nodes ("Make Space"):**
    *   **Functionality:** recursive collision detection in `AppController.moveNodes` pushes overlapping nodes during drag operations.
    *   **Logic:** Updated `src/builder/state.ts` to propagate movement.

2.  **Group Deletion:**
    *   **Functionality:** Double-clicking any node within a multi-selection deletes the entire group.
    *   **Logic:** `GraphNode` tracks group selection context; `GraphGrid` executes batched deletion via `AppController.transaction`.

3.  **Port Drag-to-Connect:**
    *   **Functionality:** Dragging from a port creates a ghost wire and allows connection release on target ports.
    *   **Logic:** Implemented `pointerdown`/`pointerup` in `src/views/graph-port.ts` and ghost rendering in `src/views/graph-grid.ts`.

4.  **Insert Node on Wire:**
    *   **Functionality:** Selecting a wire and typing an alphanumeric key inserts a new node at that location and splits the connection.
    *   **Logic:** `GraphGrid` tracks wire clicks and handles insertion via `handlePopupCommit`.

### Verification

*   **Test Suite:** All 202 tests passed, including new logic checks and regression tests.

