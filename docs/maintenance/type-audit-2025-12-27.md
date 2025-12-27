# Type Safety Audit (2025-12-27)

This document logs suspicious untyped variables and extensive `any` usage identified during the final codebase sweep.

## Critical Findings

### 1. MIDI Nodes (`src/customnodes/midi/nodes.ts`)
*   **Issues**:
    *   `execute` implementation in `midiTriggerNode` uses `(inputs: any, config: any)`.
    *   `outputs` object in `execute` is typed as `any`.
    *   `midiInputNode` and `midiCcInputNode` use `any` for `navigator.requestMIDIAccess`.
*   **Risk**: Low runtime risk (logic verified), but poor developer experience and strictness.

### 2. Sequence Nodes (`src/customnodes/seq/nodes.ts`)
*   **Issues**:
    *   `seqs: any[]` in `seq.sequencer`.
    *   `unwrapSeq` helper takes `s: any`.
    *   `fields: any` in `seq.tomidi` (formerly `nicepattern`).
    *   `const outSeq = seq.map((s: any) => ...`.
*   **Risk**: Medium. Complex transformation logic benefits from strict typing (e.g., `MidiEvent[]` vs `NoteStructor[]`).

### 3. Curve Nodes (`src/customnodes/curve/nodes.ts`)
*   **Issues**:
    *   `executeCurveEase` signature uses `(inputs: any, config: any)`.
    *   Dynamic properties access `[key: string]: any`.
    *   `nodes.ui.ts` heavily uses `any` for config updates (`c: any`) and segment mapping.
*   **Risk**: Low. Curve logic is self-contained.

### 4. Expression Parser (`src/customnodes/expr/parser.ts`)
*   **Issues**:
    *   `execute` returns `any`.
    *   `inputs` is `Record<string, any>`.
    *   `createNode` params are `any`.
*   **Risk**: High. The parser is a core component dealing with arbitrary ASTs. Use `unknown` or a discriminative union for AST nodes.

### 5. Resolume (`src/customnodes/resolume/nodes.ts`)
*   **Issues**:
    *   `value: any` in state.
    *   `callback` takes `any`.
*   **Risk**: Medium. Resolume parameters are loosely typed (JSON), but we could define a `ResolumeValue` union (number | string | boolean | Color).

### 6. Generic UI Registrations (`src/**/register-ui.ts`)
*   **Issues**:
    *   Callbacks often defined as `(node: any, handlers: any) => ...`.
    *   `onEnvelopeChange` uses `any[]`.
*   **Risk**: Low. UI code often deals with loosely typed event payloads.

## Recommendations

1.  **Strict Execute Signatures**: Update `defineNode` generic usage to strict `UIConfig` and `CompiledConfig` types (already started). Ensure `execute` arguments match these types.
2.  **Define Domain Types**:
    *   Replace `any[]` in `seq` with `SequencerStep[]` or `MidiEvent[]`.
    *   Define `ResolumeValue` union.
3.  **Refactor Parser**: Introduce strict AST node types for `expr` module.
