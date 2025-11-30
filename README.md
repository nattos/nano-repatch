# Structor: A Statically Analyzable Execution Graph System

**Structor** is a high-performance, statically analyzable execution graph system written in TypeScript. It is inspired by tensor-processing frameworks but generalizes their concepts to support complex, dynamic, and heterogeneous data types.

## Core Concepts

The system is built on a few core concepts:
*   **Structors:** Generalized tensor-like data structures (Atomic, Array, Record, Functor).
*   **Node-Based Graph:** Operations defined as nodes in a DAG.
*   **Static Type Analysis:** Pre-computed data flow validation.
*   **Universal Broadcast Operation:** Declarative data reshaping and alignment.

For a detailed deep dive, see **[Architecture Guide](docs/ARCHITECTURE.md)**.

## Documentation

*   **[Architecture Guide](docs/ARCHITECTURE.md):** Deep dive into Structor, Broadcast, Static Analysis, and Runtime.
*   **[UI Design](docs/UI_DESIGN.md):** Layout system, interaction patterns, and visual style.
*   **[UI Metrics](UI_METRICS.md):** Detailed pixel specifications for the editor.
*   **[Testing Strategy](docs/TESTING.md):** Guidelines for Unit and E2E testing.
*   **[Node Development](docs/NODE_DEVELOPMENT.md):** Guide to creating nodes using type helpers.
*   **[Development Log](GEMINI.md):** Active development tracking.

## Standard Library

Structor comes with a comprehensive set of primitive nodes:
*   **Math:** `add`, `sub`, `mul`, `div`, `pow`, `min`, `max`, `fmod`, `abs`, `neg`, `ceil`, `floor`, `round`, `sin`, `cos`, `tan`, `sqrt`, `lerp`, `map`, `clamp`, `pi`, `e`.
*   **Logic:** `and`, `or`, `xor`, `equals`, `gt`, `lt`, `not`.
*   **Utility:** `hub`, `float`.
*   **Functional:** `apply`.
*   **IO:** `input`, `output`, `midi`.

For a full list, see **[PRIMITIVES.md](src/structor/PRIMITIVES.md)**.

## Quick Start

### Running Tests
*   Unit Tests: `npm test`
*   E2E Tests: `npm run test:e2e`