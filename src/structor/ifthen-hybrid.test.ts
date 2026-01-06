import { describe, it, expect } from 'vitest';
import { GraphExecutor } from './executor';
import { defaultNodeRepository } from './repository';
import { compileGraph } from '../builder/compiler';
import { GraphState } from '../builder/state';

// Ensure node registration
import './nodes/core_ifthen';
import './nodes/io_input';
import './nodes/io_output';
// But core.literal is usually standard. Let's check imports.
// If not available, we can fake the node definition or use a known one.
// Let's assume input/output/literal are registered or use generic mocks.

// We need to verify if core logic works. Using 'core.literal' is risky if not registered.
// using 'io.input' / 'io.output' is safer?
// Let's use 'io.input' as source.

describe('core.ifthen hybrid input', () => {
  it('should detect primitive input mode and trigger on truthy scalar', () => {
    // 1. Create a graph with input -> ifthen
    // We need to mock a graph state.
    const graphState: GraphState = {
      inner: {
        nodes: {
          'n1': { id: 'n1', x: 0, y: 0, config: { typeId: 'io.input', name: 'src', values: { value: 1 } } },
          'n2': { id: 'n2', x: 100, y: 0, config: { typeId: 'core.ifthen', width: 10, height: 10 } },
          'n3': { id: 'n3', x: 105, y: 5, config: { typeId: 'io.input', name: 'inner', values: { value: 999 } } },
          'n4': { id: 'n4', x: 200, y: 0, config: { typeId: 'io.output', name: 'result' } }
        },
        connections: {
          'c1': { id: 'c1', fromNodeId: 'n1', fromPort: 'value', toNodeId: 'n2', toPort: 'midi_in' },
          // n3 is inside n2 spatially. We don't connect n2 -> n3 explicitly.
          // But we need n3 to output something.
          // Let's connect n3 to n4.
          'c2': { id: 'c2', fromNodeId: 'n3', fromPort: 'value', toNodeId: 'n4', toPort: 'value' }
        }
      },
      auxiliary: { outgoingConnections: new Map(), incomingConnections: new Map() }
    };

    // 2. Compile
    // compileGraph requires appState? No, compileGraph(appState, ...)
    // Wait, compileGraph signature is compileGraph(appState, ...)
    // AppState = { graph: GraphState }

    const appState = { graph: graphState };

    const compiled = compileGraph(appState, new Map(), defaultNodeRepository);

    // 3. Inspect Metadata (optional, but good for debugging)
    const ifthenId = 'n2';
    const metadata = compiled.nodeMetadata?.[ifthenId];
    // Note: flattening might change IDs if nested. But these are top level.
    expect(metadata).toBeDefined();
    // If mode is inferred from 'io.input' (which has 'value' output of type 'any' or 'number'),
    // it should be primitive.
    expect(metadata.mode).toBe('primitive');

    // 4. Inspect Compiled Config
    const ifthenInstance = compiled.graph.nodes[ifthenId];
    // The compiled config should have mode: 'primitive'
    expect((ifthenInstance.defaultConfig as any).mode).toBe('primitive');

    // 5. Execute
    // We need to pass nodeMetadata to Executor now!
    const executor = new GraphExecutor(
      compiled.graph,
      defaultNodeRepository,
      undefined,
      compiled.inferredTypes,
      undefined,
      compiled.nodeMetadata
    );

    // Debug Executor State
    const n2State = (executor as any).nodeStates.get('n2');
    expect(n2State.config.mode).toBe('primitive');


    // We need to inject values for io.input 'src' and 'inner'?
    // 'io.input' reads from graphInputs AND config.values.
    // We set config.values.

    executor.update({});

    // Check output
    const output = executor.getGraphOutput('result');
    // n3 should execute ONLY if n2 triggers.
    // n1 is 1 (truthy). So n2 triggers. n3 executes. Output is 999.

    // Wait, if n3 doesn't execute, what is the output?
    // It might be undefined or stale.
    // The executor clears outputs? No.
    // io.output reads from n4. n4 reads from n3.
    // If n3 is not executed, n3 output is undefined (or initial empty).
    // n4 executes (it is in main execution order? No, n3 is inside subgraph 'onTrigger').
    // n4 is OUTSIDE.
    // n3 is INSIDE.
    // n3 is tagged 'onTrigger'.
    // n4 is tagged 'main'.
    // n4 execution depends on n3 output.
    // If n3 didn't run this frame, it has no output?
    // NodeState initializes with empty output.

    expect(output).toBe(999);
  });

  it('should NOT trigger on falsy scalar', () => {
    const graphState: GraphState = {
      inner: {
        nodes: {
          'n1': { id: 'n1', x: 0, y: 0, config: { typeId: 'io.input', name: 'src', values: { value: 0 } } }, // Falsy
          'n2': { id: 'n2', x: 100, y: 0, config: { typeId: 'core.ifthen', width: 10, height: 10 } },
          'n3': { id: 'n3', x: 105, y: 5, config: { typeId: 'io.input', name: 'inner', values: { value: 888 } } },
          'n4': { id: 'n4', x: 200, y: 0, config: { typeId: 'io.output', name: 'result' } }
        },
        connections: {
          'c1': { id: 'c1', fromNodeId: 'n1', fromPort: 'value', toNodeId: 'n2', toPort: 'midi_in' },
          'c2': { id: 'c2', fromNodeId: 'n3', fromPort: 'value', toNodeId: 'n4', toPort: 'value' }
        }
      },
      auxiliary: { outgoingConnections: new Map(), incomingConnections: new Map() }
    };
    const appState = { graph: graphState };

    const compiled = compileGraph(appState, new Map(), defaultNodeRepository);
    const executor = new GraphExecutor(
      compiled.graph,
      defaultNodeRepository,
      undefined,
      compiled.inferredTypes,
      undefined,
      compiled.nodeMetadata
    );

    executor.update({});

    // n3 should NOT execute.
    // n4 reads n3. n3 is initialized (output: {}).
    // n4 output should be undefined or empty.

    const output = executor.getGraphOutput('result');
    expect(output).toBeUndefined();
  });
});
