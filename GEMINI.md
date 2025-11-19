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
