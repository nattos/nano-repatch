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

### 7. C++ Backend & Code Generation
The system now includes a robust C++ code generator (`codegen-cpp.ts`) targeting C++17.
*   **Pipeline**: `TS -> IR -> C++`.
*   **Structs**: Logic-defined interfaces (`interface Vector { x: number }`) are compiled into C++ `struct` definitions with `nlohmann/json` serialization macros.
*   **Optionals**: `T | null` / `T | undefined` in IR maps to `std::optional<T>`.
*   **Serialization**: Uses manual `from_json` implementations to safely handle missing optional fields (`if (j.contains("x")) ...`), ensuring robust Input handling.
*   **Intrinsics**: Maps `Math.sin`, `floor`, etc., to their `std::` equivalents (`<cmath>`).

### 8. Type System Extensions
*   **Structs**: Fully supported via namespaced `Scope.declareType`. Anonymous object literals `{ x: 1 }` are inferred as ad-hoc structs.
*   **Scope & Types**: The `Scope` class now maintains a Type Registry, allowing recursive resolution of named types (interfaces) across scopes.
*   **Null Safety**: `null` and `undefined` are treated as valid `PrimitiveType`s, often wrapped in `UnionType`. The compiler enforces strict checking where C++ would require it (e.g., no implicit `optional + number`).



### 9. C++ Backend & Memory Model

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


## Known Pitfalls & Limitations

1.  **Infinite Loops**: If the loop condition depends on a runtime variable (not a constant), the unroller will crash or hang (currently capped at 100 iterations).
    *   *Mitigation*: We throw if the condition is not `OpKind.Const`.
2.  **Array Mutation**: `push` is only supported on **Constant Arrays** (`const arr = []`). Pushing to a runtime array is not supported because it implies dynamic allocation.
3.  **Recursion**: No tail-call optimization. Deep recursion will blow the compiler stack.
4.  **String Support**: Extremely limited. Used mostly for keys.

## Testing Strategy
We used a "Stress Test" approach (`stress.test.ts`) focusing on:
*   **Ex 10**: Closures (captured loop vars).
*   **Ex 11**: Matrix Multiplication (nested loops + assignments).
*   **Ex 12**: Chained Generics (type propagation).

All functionality is verified to produce correct `OpKind.Const` results, proving the compiler successfully folded the complex logic.
