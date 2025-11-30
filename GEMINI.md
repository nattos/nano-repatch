# Gemini Development Log

This document tracks the active development process.
For historical logs, see **[docs/dev-log-archive.md](docs/dev-log-archive.md)**.

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

## Final Polish & Cleanup (As of 2025-11-30)

This entry documents the final steps taken to ensure the codebase is clean and all tests are passing.

### Test Fixes

1.  **Executor Tests:** Updated `src/structor/executor.test.ts` to align with the changes made to `primitive_clamp`. The test now correctly expects a named output `value` instead of an untagged array. This resolves the regression caused by the primitive library expansion.

### Code Hygiene

1.  **Cleanup:** Performed a sweep of the codebase to remove unused imports, commented-out debug logs, and legacy code artifacts. Affected files include `compiler.ts`, `graph-node.ts`, `nodes.ts`, `type-helpers.ts`, and `executor.worker.ts`.
2.  **Documentation:** Updated `GEMINI.md` (this document) and `walkthrough.md` to reflect the current state of the system and the successful resolution of all tasks.
