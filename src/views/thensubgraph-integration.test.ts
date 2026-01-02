import { describe, it, expect, beforeEach } from 'vitest';
import { GraphExecutor } from '../structor/executor';
import { NodeRepository } from '../structor/repository';
import { ALL_PRIMITIVES } from '../structor/primitives';
import { compileGraph } from '../builder/compiler';
import { GraphState } from '../builder/state';

describe('core.thensubgraph Integration', () => {
  let repository: NodeRepository;

  beforeEach(() => {
    repository = new NodeRepository();
    ALL_PRIMITIVES.forEach(def => repository.register({
      id: def.id,
      definition: def,
      inputs: [], // Simplified for test
      outputs: [],
      compileConfig: (uiConfig) => {
        if (def.id === 'io.input') {
          return {
            fields: { name: uiConfig?.name ?? 'value' },
            values: uiConfig?.values
          };
        }
        return uiConfig ?? { fields: {} };
      }
    } as any));
  });

  const createSubgraph = (id: string): GraphState => ({
    inner: {
      nodes: {
        'in1': { id: 'in1', x: 0, y: 0, config: { typeId: 'io.input', name: 'val', values: { defaultValue: 0 } } },
        'add': { id: 'add', x: 100, y: 0, config: { typeId: 'math.add' } },
        'out1': { id: 'out1', x: 200, y: 0, config: { typeId: 'io.output', name: 'result' } }
      },
      connections: {
        'c1': { id: 'c1', fromNodeId: 'in1', fromPort: 'value', toNodeId: 'add', toPort: 'a' },
        'c2': { id: 'c2', fromNodeId: 'add', fromPort: 'result', toNodeId: 'out1', toPort: 'value' }
      },
      inputs: {},
      outputs: {}
    },
    // We add 'inputs' property because GraphState usually has it, though inner handles structure
    zoom: 1,
    pan: { x: 0, y: 0 }
  } as any);

  it('should only execute subgraph when triggered', () => {
    const subgraphId = 'sub1';
    const subgraph = createSubgraph(subgraphId);

    // Main Graph
    const mainGraph: GraphState = {
      inner: {
        nodes: {
          'trigger': { id: 'trigger', x: 0, y: 0, config: { typeId: 'io.input', name: 'midi_source' } },
          'sub': { id: 'sub', x: 100, y: 0, config: { typeId: 'core.thensubgraph', subgraphId, values: { val: 10 } } },
          'out': { id: 'out', x: 200, y: 0, config: { typeId: 'io.output', name: 'final' } }
        },
        connections: {
          'c1': { id: 'c1', fromNodeId: 'trigger', fromPort: 'value', toNodeId: 'sub', toPort: 'midi_in' },
          'c2': { id: 'c2', fromNodeId: 'sub', fromPort: 'result', toNodeId: 'out', toPort: 'value' }
        },
        inputs: {},
        outputs: {
          'final': { nodeId: 'out', port: 'value' }
        }
      },
      zoom: 1,
      pan: { x: 0, y: 0 }
    } as any;

    const loadedSubgraphs = new Map<string, GraphState>();
    loadedSubgraphs.set(subgraphId, subgraph);

    // Mock AppState
    const appState = { graph: mainGraph } as any;

    const compiled = compileGraph(appState, loadedSubgraphs, repository);
    // console.error('Flat Connections:', JSON.stringify(compiled.graph.connections, null, 2));

    // Inject 'value' config into 'add' node inside subgraph via 'val' input?
    // Wait, 'val' input (in1) connects to 'add:a'.
    // 'add:b' defaults to 0.
    // So result = 10 + 0 = 10.
    // Let's make 'add' use 'b' = 5 via config to be sure it runs.
    // But 'add' primitive uses inputs.
    // We can use 'math.add' with literal 1?
    // Or just check if output is 10.

    const executor = new GraphExecutor(compiled.graph, repository);
    const context = {
      clock: { beat: 0, dt: 0.1 },
      nodeState: new Map(),
      audio: { context: {} } // Mock audio
    };

    // 1. Run without trigger
    // Trigger produces NO event by default
    executor.update(context);

    // Check output.
    // Subgraph hasn't run. Inner nodes should be uninitialized or default?
    // Wrapper.InnerOutput (sub.out1) output:
    const outputBefore = executor.getGraphOutput('final'); // Reads 'out' node. 'out' reads 'sub.out1'.

    // If 'sub.out1' never ran, its state might contain empty fields or be undefined.
    // Executor initializes empty state.
    // So 'out' gets undefined?
    // 'io.output' (out) just passes through input.
    // 'sub.out1' (inner) has empty output.
    // Check tagging
    // Check tagging
    // const subNode = compiled.graph.nodes[Object.keys(compiled.graph.nodes).find(k => k.endsWith('in1'))!];

    expect(outputBefore).toBeUndefined();

    // 2. Trigger
    // 'midi.trigger' produces event based on config?
    // Actually 'midi.trigger' usually takes a boolean input to trigger, or UI interaction.
    // It has `manualTrigger` parameter or `trigger` input.
    // Let's set `trigger` input to true.
    executor.setInput('trigger_in', 1); // We didn't expose input on Main Graph for trigger node.
    // But we can simulate `midi.trigger` output or use a simpler setup.
    // Let's just INJECT the MIDI event into `sub` input directly for testing.
    // But `executor` connectivity logic relies on nodes.

    // Better: Helper to inject value into `trigger` node?
    // Or simpler: Mock the input execution.
    // A bit complex.

    // Alternative: Use `core.thensubgraph` connected to a `data.literal` (which we can control?).
    // No `core.thensubgraph` input is `midi_in`.
    // Let's create a Mock Node "mock.midi" that outputs a Note On.

    // Or just manually set the input of the `sub` wrapper.
    // `sub` wrapper input `midi_in`.
    // `executor.setInput` sets graph inputs.
    // If I add a graph input connected to `sub:midi_in`.
    // Trigger run
    const noteOn = [{ type: 'note_on', velocity: 0.8, channel: 1, note: 60 }];
    executor.setInput('midi_source', noteOn);
    executor.update(context);

    // Check output after trigger
    // Note: If using setInput, update() should process it.
    // 'trigger' node (io.input) value will be noteOn.
    // 'sub' input midi_in will be noteOn.
    // 'sub' triggers. 'sub.in1' runs. 'out' runs.



    const outputAfter = executor.getGraphOutput('final');
    expect(outputAfter).toBe(10);
  });
});
