# Expr V2: Architecture & Implementation Details

## Overview
The Expr V2 system is a **hybrid Compiler/Interpreter** that lowers TypeScript-like syntax into a static Data Flow Graph (IR) suitable for real-time audio/visual processing. Unlike standard compilers, it heavily relies on **Unrolling** and **Constant Folding** to eliminate control flow at runtime, producing a flat, allocation-free execution graph.

## Core Components

### 1. The SSA-like IR (Intermediate Representation)
The IR (`ir-types.ts`) uses an SSA (Static Single Assignment) philosophy where possible, but handles imperative mutation via **Versioned Variables** in the compiler scope.
*   **Values**: `ConstNode`, `BinaryNode`, `ArrayNode`.
*   **Control Flow**: `PhiNode` merges values from divergent branches (`If/Else`).
*   **Execution**: The graph is topological. `Phi` nodes are "virtual" selectors resolved by `condition`.

### 2. The Compiler (`compiler.ts`)
The compiler performs a single-pass AST traversal with an **Environment Stack** (`Scope`).

#### Tricky Part: Scope Management (`Scope.assign`)
Handling imperative mutation (`x = x + 1`) alongside functional branching (`if (c) x = 1 else x = 2`) was the hardest challenge.
*   **Transparent Scopes (Blocks)**: Standard `{ ... }` blocks create a scope that *allows* mutation of parent variables. Assignments propagate up the chain.
*   **Fork Scopes (Branches)**: `If/Else` branches create **Forked Scopes** (`isBranchScope = true`). Assignments here are *trapped* (shadowed) to prevent mutating the parent, so that `Phi` nodes can merge the differences later.
*   **Pitfall**: We initially forgot to distinguish these. Assignments in a `for` loop (which is a block) were shadowed, meaning the loop counter never incremented in the outer scope, leading to infinite compile-time loops.

### 3. Loop Unrolling & State
Loops are **fully unrolled** at compile time.
*   **Pre-requisite**: Loop bounds must be compile-time constants.
*   **Mechanism**: The compiler iterates `N` times, re-compiling the body.
*   **State Preservation**: Because `VariableDeclarationList` is re-evaluated, `let` variables effectively become new SSA values for each iteration.
*   **Pitfall**: `let i` must be bound *per iteration*. We implemented `PostfixUnary` (`i++`) to mutate the `ConstNode` value of `i` in the scope, ensuring the next iteration sees the incremented value.

### 4. Functions & Closures
Functions are treated as **First-Class Values** (`ConstNode<FunctionDecl>`).
*   **Inlining**: All calls are inlined. Recursion is limited by stack depth.
*   **Closures**: Attempting to use `i` inside a lambda `() => i` inside a loop failed initially. The lambda captured the *reference* to `i`, which (after the loop) was undefined or final.
*   **Solution**: **Scope Snapshotting**. When an Arrow Function is defined, we call `scope.snapshot()` to freeze the variable mapping. When the function is called later (e.g., via `funcs[0]()`), we restore this snapshot as the parent scope, ensuring `i` has the value it had *at creation time*.

### 5. Generics & Reflection
We support structural typing and generic instantiation.
*   **Pass-through**: `function box<T>(val: T)` captures `T` from the argument `val`.
*   **Chaining**: When `box<T>` calls `identity<T>`, the compiler passes the resolved type `T` down. This required a `genericMap` to track `T -> Number` mapping across call stacks.

### 6. Standard Library (`stdlib.ts`)
Method calls (`arr.map`, `Math.sin`) are handled via a plugin system:
*   **Static & Instance Methods**: Registered via `stdlib.ts`.
*   **Folding vs Intrinsic**: Methods can return a `ConstNode` (compile-time) or an `IntrinsicNode` (runtime).
*   **Array Methods**: `map` and `reduce` support unrolling over both `ConstNode` arrays (literals) and `ArrayNode` (IR inputs), generating parallel IR chains.
*   **Array Mutation**: `push` is supported in unrolled contexts for building lists found in `ForStatement` bodies, provided the target is a tracked `ConstNode` (JS Array).

### 7. C++ Backend & Memory Model

The system now lowers IR to C++ 17, with specific attention to memory management and performance.

#### Reference Tracking (Aliasing)
To bridge the gap between TS Reference Semantics and C++ Value Semantics, we implemented **Compiler-Level Aliasing**.
*   **Problem**: `let b = balls[i]` compiles to `auto b = balls[i]` (Copy) in C++. Modifying `b.x` fails to update the array.
*   **Solution**: The compiler detects L-Value initialization (`let b = balls[i]`). It registers `b` as an **Alias** in the Scope instead of emitting a variable. All subsequent usages of `b` are inlined as `balls[i]`.
*   **Propagation**: Aliases propagate across function calls. `modify(b)` becomes `modify(balls[i])`. Inlined void functions preserve side effects in place.

#### Struct Layout & Packing
We enforce **Deterministic Struct Layout** matching the TypeScript definition order.
*   **Old Behavior**: Fields were sorted alphabetically (`center, color, radius` -> `center, color, radius`).
*   **New Behavior**: Fields respect insertion order (`center, radius, color`).
*   **Why**: This matches user intent and allows careful padding/alignment for C++ interop.

#### Void Function Side Effects
Function inlining (`tryInlineFunc`) was upgraded to support imperative side effects.
*   **Issue**: Void functions returning `null` were initially treated as "no-op" expressions, dropping their body statements.
*   **Fix**: Inlined void functions now emit a `BlockNode` containing their statements, ensuring mutations (like `p.x += 20` inside a helper) are preserved in the generated C++.

### 8. JavaScript Backend (`codegen-js.ts`)
The system now supports a compliant JavaScript backend for verification and web-based execution.
*   **Parity**: The JS backend implements 100% of the IR features supported by C++, including:
    *   Structs (as Objects).
    *   Arrays (as JS Arrays).
    *   Reference Semantics (Native to JS).
    *   Math Intrinsics (`Math.sin` etc).
*   **Debug Support**: Optional `debug` flag injects `record_debug(line, val)` calls into the generated code, capturing trace values for test assertions.

### 9. Unified Test Suite (`unified-backend.test.ts`)
We migrated from scattered test files (`cpp-integration`, `codegen-js`, `raytracer`) to a central definition file (`backend-test-cases.ts`).
*   **Test Case Definition**: Tests are defined as data objects `{ name, code, input, expected, check }`.
*   **Dual Execution**: The runner executes every test against **both** JS and C++ backends (unless skipped).
*   **Skipping Logic**: `skipCPP: true` is used for cases where C++ compilation hits resource limits (e.g. Excessive Inlining in Ray Tracer), while JS handles them fine.

### 10. WebGPU Backend (`codegen-wgsl.ts`)
For GPU acceleration, we added a WGSL code generator.
*   **Pipeline**: `TS -> IR -> WGSL`.
*   **Type Mapping**:
    *   `number` -> `f32`.
    *   `Struct` -> `struct T { ... }` (Recursive generation).
    *   `Array` -> `array<T, N>` (Fixed) or `array<T>` (Runtime, handled via Storage Buffer).
*   **Buffers**:
    *   Inputs and Outputs are mapped to `storage` buffers (`@group(0) @binding(0/1)`).
    *   Inputs are flattened into a single `Input` struct.
*   **Compute Kernel**: Generates a `@compute @workgroup_size(1)` kernel for simple linear tasks.
    *   **Dead Code Stripping**: To prevent binding errors, we inject `_ = &input;` and `_ = &output;` in `main` to force bindings to remain active.
*   **Limitations**:
    *   No dynamic array resizing (append).
    *   Recursive structures must be finite (no cycles).
    *   Strings are unsupported.

## Known Pitfalls & Limitations

1.  **Infinite Loops**: If the loop condition depends on a runtime variable (not a constant), the unroller will crash or hang (currently capped at 100 iterations).
    *   *Mitigation*: We throw if the condition is not `OpKind.Const`.
2.  **Array Mutation**: `push` is only supported on **Constant Arrays** (`const arr = []`). Pushing to a runtime array is not supported because it implies dynamic allocation.
3.  **Recursion**: No tail-call optimization. Deep recursion will blow the compiler stack.
4.  **C++ Compilation Limits**: Heavily recursively inlined code (like the Ray Tracer) generates massive single-expression trees in C++. This can cause `clang++` to crash or timeout.
    *   *Workaround*: For production C++, we should prefer emitting helper functions (`TypeKind.Function`) over pure inlining, but this requires a runtime ABI change.
5.  **String Support**: Extremely limited. Used mostly for keys.

## Testing Strategy
We used a "Stress Test" approach (`stress.test.ts`) focusing on:
*   **Ex 10**: Closures (captured loop vars).
*   **Ex 11**: Matrix Multiplication (nested loops + assignments).
*   **Ex 12**: Chained Generics (type propagation).
*   **Mandelbrot**: Stress testing loops, structs, and breaks.
*   **Ray Tracer**: verifiying vector math and complex object graphs (JS Verified).

All functionality is verified to produce correct `OpKind.Const` results, proving the compiler successfully folded the complex logic.
