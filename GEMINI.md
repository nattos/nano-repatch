# Gemini Development Log

This document tracks the development process, architectural decisions, and internal reflections of the Gemini agent working on the Structor project.

## System Analysis (As of 2025-11-17)

This analysis reflects the state of the system after implementing the initial test cases, the node repository, and the first version of the `GraphExecutor`.

### Strengths

1.  **Strong, Composable Architecture:** The system is built on a solid foundation of distinct, well-defined components: `Structor` (data), `StructorType` (types), `NodeDefinition` (operations), `GraphDefinition` (composition), `NodeRepository` (discovery), and `GraphExecutor` (runtime). This separation of concerns makes the system highly modular and testable. The ability to nest graphs is a powerful feature for creating reusable abstractions.

2.  **Static Analysis by Design:** The parallel `StructorType` and `computeOutputTypes` systems are a core strength. They allow the entire graph's data flow, including data shapes and types, to be validated before any code is executed. This "compile-time" error checking is a massive advantage for building reliable, complex systems.

3.  **Efficient, Iterative Execution:** The dirty-tracking mechanism (`markDirty`, `update`) is a key feature for performance. By only re-calculating the parts of the graph affected by a change, the system can be used efficiently in interactive applications where inputs might change rapidly (e.g., UI sliders, animations).

4.  **Excellent Testability:** The architecture lends itself well to unit testing. The dependency on a `NodeRepository` that can be instantiated per-test allows for complete isolation of test suites. This makes it easy to test individual components (the executor, primitives) without needing a fully running system.

### Weaknesses

1.  **Incomplete Core Logic:** The "Universal Broadcast Operation," which is a cornerstone of the system's declarative power, is not actually implemented. The `broadcast` function in the execution contexts is currently a placeholder. Similarly, the `GraphExecutor`'s ability to handle complex graphs with nested sub-graphs is not yet built out. The system's core promises are still just stubs.

2.  **Instance Configuration is Missing:** A `NodeInstance` only contains a `definitionId`. There is no mechanism to store instance-specific configuration. For example, a `literal` node's value is currently part of its definition, which is inflexible. A proper implementation would have a single `literal` definition and store the value in the `NodeInstance`. This is also a blocker for any node that requires configuration (e.g., a "delay" node needing a `time` parameter).

3.  **No Error Handling Strategy:** The system currently has no defined way to handle runtime errors. An error thrown in a primitive's `execute` function would crash the entire `update` loop. A robust system needs a way to catch, report, and manage errors gracefully, potentially marking nodes as being in an "error state."

4.  **Synchronous-Only Execution:** The `update()` method is fully synchronous. This is a major limitation, as it means any long-running operation (like a network request or complex calculation) will block the main thread. The current architecture has no concept of asynchronous nodes.

### Future Pitfalls

1.  **Asynchronous Operations:** This is the most significant architectural hurdle ahead. Integrating asynchronous operations (e.g., `fetch`, file I/O) will require a fundamental change to the `GraphExecutor`. It may involve introducing Promises as a first-class `Structor` type, adding a secondary async update phase, or redesigning the execution loop entirely. The current simple, synchronous loop will not survive this requirement.

2.  **Debugging Complexity:** As graphs become larger, debugging them will become exponentially harder. If a final output is incorrect, tracing the data flow backward through hundreds of nodes to find the source of the error will be a nightmare. The system will be difficult to use at scale without dedicated tooling for introspection, such as visualizing the graph, inspecting arbitrary node outputs, and tracing data provenance.

3.  **The Broadcast Engine:** While a strength in theory, the `broadcast` engine is also a potential pitfall. Its implementation is complex, and its rules for reshaping and reducing data need to be both powerful and intuitive. If it's difficult for a developer to predict what shape their data will have after a broadcast, it will become a frequent source of bugs and frustration.

4.  **Performance at Scale:** The current data structures (`Structor` as plain objects/arrays) are fine for control logic and small datasets. However, the README mentions inspiration from tensor frameworks. For any serious numerical or data-processing work, these generic objects will be a performance bottleneck. A future version would need to integrate with more performant backends like TypedArrays, WebAssembly, or even GPU libraries, which would be a complex undertaking.

## App State & Controller Implementation (As of 2025-11-17)

This entry summarizes the implementation of the application state management engine (`AppController`).

### Process

The implementation followed a rigorous Test-Driven Development (TDD) approach:
1.  A detailed design for the state, mutations, and controller was written as comments.
2.  A comprehensive test suite was created, defining the full public API and behavior (including transactions and undo/redo) as failing tests.
3.  The `AppController` and its dependencies (`immer`, `mobx`) were implemented incrementally, with the goal of making the tests pass one by one.
4.  The process concluded with all 25 tests passing, including complex transaction and reactivity tests.

### Architectural Improvements

This implementation addresses several key architectural aspects and weaknesses identified earlier:

1.  **Instance Configuration:** The system now has a formal mechanism for handling instance-specific node configuration. The `AppController` manages this state, and the `GraphExecutor` uses it, resolving a key design weakness.
2.  **Builder Engine:** We now have a robust, well-tested engine for the application layer. It handles the state of the visual graph editor, including node positions, connections, and configurations.
3.  **Transactional Integrity:** The `transaction` method provides a powerful API for grouping operations. Its implementation supports atomic commits and rollbacks (via undo) and, crucially, allows for "in-transaction reads" of the draft state. This enables advanced features like speculative edits and on-the-fly validation.
4.  **Reactive UI Layer:** The integration with MobX is now tested. The `observableState` provides a reactive mirror of the application state, and the controller ensures that updates are batched efficiently within transactions, providing a solid foundation for a responsive UI.

## Final Architectural Refinements (As of 2025-11-17)

This entry covers the final refactorings of the `AppController` state.

### Changes Implemented

1.  **Auxiliary Lookup Maps:** The `AppState` was refactored to use ES6 `Map` objects for the `incomingConnections` and `outgoingConnections` lookup tables instead of plain objects. This improves performance and makes the code's intent clearer. The `immer` dependency was updated to enable its `MapSet` plugin to support this change.
2.  **Dynamic Node Types:** The `GridNode` structure was changed to make the node's type more flexible. The `typeId` was moved from a top-level property into the `config` object. This allows the node's type to be changed dynamically via the standard `setNodeConfig` mutation. The config object is now also designed to hold type-specific configuration data in separate sub-objects, which are preserved even when the `typeId` changes.

### Personal Note on Process

During the refactoring of the test suite for these changes, several existing test cases were inadvertently removed and had to be added back. This serves as an important reminder:

**Be careful to retain all existing test cases when refactoring test files.** It is better to have a temporarily failing test that needs to be updated than to lose test coverage for a scenario. The comprehensive test suite is a critical asset for ensuring the project's stability.

## Testing Strategy and Guidelines

The project utilizes two distinct testing frameworks, each serving a specific purpose:

1.  **Vitest (Unit/Component Tests):**
    *   **Purpose:** Primarily used for unit and component-level testing, focusing on individual functions, classes, and UI components in isolation.
    *   **Location:** Test files are typically co-located with their respective source files within the `src/` directory (e.g., `src/module/my-component.test.ts`).
    *   **Execution:** Executed via `npm test`. The `vite.config.ts` is configured to discover these tests.

2.  **Jest (End-to-End/E2E Tests):**
    *   **Purpose:** Used for higher-level end-to-end testing, simulating user interactions across the entire application to ensure integrated functionality. These tests often involve browser automation (e.g., using Puppeteer).
    *   **Location:** E2E test files are located in the top-level `test/` directory (e.g., `test/app.test.ts`).
    *   **Execution:** Executed via `npm run test:e2e`.

**Important Guidelines:**

*   **Framework Segregation:** Do not mix Jest-specific syntax (e.g., `jest.setTimeout`) within Vitest tests, and vice-versa.
*   **File Location:** Ensure test files are placed in their correct respective directories (`src/` for Vitest, `test/` for Jest) to be picked up by the appropriate test runner.
*   **Configuration:** Avoid configuring Vitest (`vite.config.ts`) to include the `test/` directory, as this will cause Vitest to attempt running Jest tests, leading to `ReferenceError: jest is not defined` errors.

## Graph Inputs, Outputs, and Subgraphs (As of 2025-11-23)

This entry documents the implementation of the graph composition features and the 3-column editor layout.

### Features Implemented

1.  **Graph Primitives:** Introduced `primitive_input`, `primitive_output`, and `primitive_subgraph`. These form the basis for defining graph interfaces and nesting graphs.
2.  **3-Column Layout:** The `GraphGrid` was redesigned to support a 3-column layout:
    *   **Input Column:** Pinned to the left, exclusively for `input` nodes.
    *   **Output Column:** Pinned to the right, exclusively for `output` nodes.
    *   **Main Grid:** The central area for standard nodes.
    *   **Interaction:** Implemented drag restrictions to keep input/output nodes in their columns, and double-click handlers to create the appropriate node type based on the column clicked.
3.  **Dynamic Subgraph Ports:** `GraphNode` was updated to dynamically generate input/output ports for `subgraph` nodes by looking up the referenced graph definition in `LocalState.loadedSubgraphs`.
4.  **Virtual Inputs for Testing:** Added virtual input sliders to `input` and `output` nodes to facilitate manual testing and value injection.

### Testing & Verification

*   **Integration Tests:** Created `src/views/subgraph-integration.test.ts` to verify the dynamic port generation and virtual input rendering.
*   **E2E Tests:** Created `test/double-click.test.ts` to verify the column-specific double-click behavior.
*   **Regression Fix:** Identified and fixed a regression in `GraphExecutor` where `combine: { reduce: 'first' }` was not correctly handled in the broadcast engine.

### Future Work

*   **Subgraph Execution:** The current implementation focuses on the *structure* and *editor UI*. The actual runtime execution of nested subgraphs (recursion in `GraphExecutor`) is the next major step.
## Type Safety and State Management Improvements (As of 2025-11-25)

This entry documents the enhancements to the Structor system's type safety and node state management.

### Features Implemented

1.  **Type Helpers:** Introduced `src/structor/type-helpers.ts` containing:
    *   `defineType`: Helper to define `StructorType`s with literal type preservation.
    *   `definePrimitiveNode`: Wrapper for defining primitive nodes with automatic type inference, input/output marshalling, and state management.
    *   `typedBroadcast`: Helper for type-safe broadcast operations.
    *   `InferStructorType`: Utility type to infer TypeScript types from `StructorType` definitions.
2.  **State Management:**
    *   Added `nodeState` map to `ExecutionContext` for persisting node state.
    *   Updated `definePrimitiveNode` to support `createState` factory, allowing nodes to initialize and access typed state in `execute`.
    *   Refactored `nicepattern` nodes to use this new state mechanism, removing the global state cache hack.
3.  **Shared Types:** Created `src/structor/std-types.ts` for common types (`numberType`, `booleanType`, `stringType`, `anyType`).
4.  **Audio Context:** Added `audio` property to `ExecutionContext` to provide access to the global `AudioContext`.
5.  **Refactoring:** Refactored `src/customnodes/nicepattern/nodes.ts` and `src/structor/primitives.ts` to use the new helpers and shared types.

### Testing

*   **Unit Tests:** Created `src/customnodes/nicepattern/nodes.test.ts` to verify the behavior of the refactored nodes, including state persistence and event generation.

### Future Work

*   **Instance IDs:** The current state management uses a config-based key hack (`${id}-${JSON.stringify(config)}`). A proper solution requires the executor to provide stable instance IDs for nodes.
*   **Async Nodes:** The system is still synchronous. Future work should address asynchronous execution.

## E2E Testing Standardization (As of 2025-11-24)

This entry documents the standardization of the End-to-End (E2E) test setup and critical lessons learned during the process.

### Critical Rules (DO NOT BREAK)

1.  **NO Timeout Changes:** Do NOT mess with `jest.setTimeout`. The default (or 5000ms) is sufficient for our tests. Increasing timeouts is a red herring; if a test times out, it's because the selector failed or the app is broken, not because it needs more time.
2.  **NO Port Changes:** Always use port `4173`. Do not attempt to randomize ports or change them per test.
3.  **NO Manual Server Management:** Do NOT use `child_process` to spawn the server in individual test files. The server is managed globally by `jest-puppeteer.config.js`.
4.  **Programmatic State Management:** Use `window.testing.appController.loadGraph(...)` to reset state between tests. Do NOT rely on page reloads, which are slow and flaky.

### Solutions & Best Practices

1.  **Shadow DOM Traversal:**
    *   The application is heavily nested in Shadow DOMs (`nano-repatch` -> `workspace-layout` -> `graph-editor` -> `graph-grid`).
    *   **Avoid `>>>`:** The deep selector combinator `>>>` can be flaky in some Puppeteer versions or complex structures.
    *   **Use Explicit Traversal:** The most robust way to select elements is to use `page.evaluate()` or `page.evaluateHandle()` and manually traverse the `shadowRoot` chain.
    *   **Example:**
        ```javascript
        const grid = document.querySelector('nano-repatch')
          .shadowRoot.querySelector('workspace-layout')
          .shadowRoot.querySelector('graph-editor')
          .shadowRoot.querySelector('graph-grid');
        ```

2.  **Programmatic Node Creation:**
    *   For tests that don't specifically verify the *creation UI*, use `window.testing.appController.createNode()` to set up the graph state. This is faster and less prone to UI flakiness.
    *   Ensure you create nodes with the correct type (e.g., `add` for inputs/outputs, `literal` for values) to satisfy test requirements (like connecting ports).

3.  **Debugging:**
    *   If a selector fails, use `page.evaluate()` to log the `innerHTML` or existence of intermediate elements to the console.
    *   Check for "zombie" processes on port 4173 if the server fails to start (`lsof -t -i:4173`).

## Compiler & Configuration State (As of 2025-11-23)

This entry clarifies the current state of the graph compiler and the important distinction between UI-facing configuration and execution-facing configuration.

### The Problem with `compiler.ts`

The initial version of `src/builder/compiler.ts` was implemented with a simplifying assumption: that the `GridNode.config` object from the UI state could be directly mapped to the `defaultConfig` of a `NodeInstance` for the `GraphExecutor`. This assumption is incorrect and has led to a fragile implementation.

### The Architectural Distinction

There is a fundamental architectural separation between the state used by the visual editor and the state used by the execution engine:

1.  **`GridNode.config` (UI State):** This is a simple, flat key-value object designed for ease of use by UI components like inspector panels, sliders, and text inputs. It holds "source of truth" data in a human-readable and editable format (e.g., `{ typeId: 'literal', literal: { value: 1.23 } }`). It is part of the `AppState`.

2.  **`NodeInstance.defaultConfig` (Execution State):** This is a `Structor`-formatted value that is passed directly to a node's `execute` function. It must conform to the `configType` specified in the node's `PrimitiveNodeDefinition`. For a literal node, this would be a simple `Structor` like the number `1.23`, not the complex object used by the UI.

The `compiler.ts` file's responsibility is to perform this translation. It must read the UI-friendly `GridNode.config` and produce the correct, `Structor`-formatted `defaultConfig` for the `NodeInstance`. The current implementation only performs a trivial, incorrect mapping for literal nodes and needs to be redesigned.
