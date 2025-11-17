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
