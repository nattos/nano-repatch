import { describe, it, expect } from 'vitest';
import { GraphExecutor } from '../../structor/executor';
import { NodeRepository } from '../../structor/repository';
import {
  rhythmicGeneratorPrimitive,
  chaosGeneratorPrimitive,
  patternPrimitive,
  sequenceStructorType,
  createLayerNode,
  GateLayer,
  ExponentialLayer,
  PWMLayer,
  NoiseLayer,
  toneSynthPrimitive
} from './nodes';
import { GraphDefinition, StructorRecord } from '../../structor/structor';
import { numberType, midiStreamType } from '../../structor/std-types';
import { compileGraph } from '../../builder/compiler';
import { AppState, GridNode, Connection, GraphState } from '../../builder/state';

describe('NicePattern Integration', () => {
  const repository = new NodeRepository();

  // Register nodes manually for the test repository
  repository.register({
    id: 'nicepattern:rhythmic_generator',
    version: '1.0.0',
    displayName: 'Rhythmic Generator',
    definition: rhythmicGeneratorPrimitive,
    inputs: [],
    outputs: [{ name: 'seq_out', type: sequenceStructorType, description: 'Generated sequence' }],
    compileConfig: (uiConfig) => ({ fields: { targetNote: uiConfig?.targetNote ?? 60, density: uiConfig?.density ?? 0.5 }, untagged: [] }),
  });

  repository.register({
    id: 'nicepattern:chaos_generator',
    version: '1.0.0',
    displayName: 'Chaos Generator',
    definition: chaosGeneratorPrimitive,
    inputs: [],
    outputs: [{ name: 'seq_out', type: sequenceStructorType, description: 'Generated sequence' }],
    compileConfig: (uiConfig) => ({
      fields: {
        minNote: uiConfig?.minNote ?? 60,
        maxNote: uiConfig?.maxNote ?? 72,
        density: uiConfig?.density ?? 0.5
      },
      untagged: []
    }),
  });

  repository.register({
    id: 'nicepattern:pattern',
    version: '1.0.0',
    displayName: 'Pattern',
    definition: patternPrimitive,
    inputs: [{ name: 'seq_in', type: sequenceStructorType, description: 'Input sequence(s)', redirect: 'untagged' }],
    outputs: [{ name: 'midi_out', type: midiStreamType, description: 'Real-time MIDI stream' }],
    compileConfig: (uiConfig) => ({ fields: {}, untagged: [] }),
  });

  // Register Layers
  const registerLayer = (id: string, name: string, cls: any) => {
    repository.register(createLayerNode(id, name, cls));
  };
  registerLayer("nicepattern:gate_layer", "Gate Layer", GateLayer);
  registerLayer("nicepattern:exp_layer", "Exponential Layer", ExponentialLayer);
  registerLayer("nicepattern:pwm_layer", "PWM Layer", PWMLayer);
  registerLayer("nicepattern:noise_layer", "Noise Layer", NoiseLayer);

  repository.register({
    id: "nicepattern:tone_synth_layer",
    version: "1.0.0",
    displayName: "Tone Synth Layer",
    definition: toneSynthPrimitive,
    inputs: [
      { name: "midi_in", type: midiStreamType, description: "Input MIDI stream" },
      { name: "prev_layer", type: numberType, description: "Previous layer output" } // Simplified type for test
    ],
    outputs: [{ name: "out", type: numberType, description: "Layer output" }],
    compileConfig: (uiConfig) => ({
      fields: {
        targetNote: uiConfig?.targetNote ?? 60,
      },
      untagged: [],
    }),
  });


  // Helper to compile GridNodes into GraphDefinition
  const compileAndRun = (
    nodes: Record<string, { typeId: string, config?: any }>,
    connections: { from: string, port: string, to: string, portIn: string }[]
  ) => {
    const gridNodes: Record<string, GridNode> = {};
    const gridConnections: Record<string, Connection> = {};

    let x = 0;
    for (const [id, def] of Object.entries(nodes)) {
      gridNodes[id] = {
        id,
        x: x++,
        y: 0,
        config: {
          typeId: def.typeId,
          values: {},
          ...def.config
        }
      };
    }

    let connId = 0;
    for (const conn of connections) {
      const id = `c${connId++}`;
      gridConnections[id] = {
        id,
        fromNodeId: conn.from,
        fromPort: conn.port,
        toNodeId: conn.to,
        toPort: conn.portIn
      };
    }

    const appState: AppState = {
      graph: {
        inner: { nodes: gridNodes, connections: gridConnections },
        auxiliary: { outgoingConnections: new Map(), incomingConnections: new Map() }
      }
    };

    const graphDef = compileGraph(appState, new Map(), repository);
    return new GraphExecutor(graphDef, repository);
  };

  it('should compile and run rhythmic generator', () => {
    const executor = compileAndRun(
      {
        'gen': { typeId: 'nicepattern:rhythmic_generator', config: { targetNote: 60, density: 1.0 } }
      },
      [] // No connections needed to check output of gen
    );

    executor.update({ clock: { beat: 0, dt: 0 } });
    const output = executor.getGraphOutput('gen.seq_out') as any[]; // Access via node.port

    // Note: GraphExecutor.getGraphOutput usually gets output of "output" nodes.
    // But here we want to inspect internal node output.
    // GraphExecutor doesn't expose internal node outputs directly via getGraphOutput unless they are connected to graph outputs.
    // However, we can inspect the runtime state if we have access, or we can add an output node.

    // Let's add an output node to the graph to be proper.
    // But compileGraph only adds graph outputs if there are 'io.output' nodes.
    // For this test, we can just inspect the node's output from the executor's internal state if possible,
    // OR we can rely on the fact that `executor.execute` returns the outputs of the last executed nodes? No.

    // Let's use a trick: The executor exposes `outputs` map? No, it's private.
    // But we can use `executor.getGraphOutput` if we define the graph to have outputs.
    // `compileGraph` creates `flatOutputs` based on `io.output` nodes.

    // So let's add an io.output node.
    // But we need to register io.output in our test repo.
  });

  // We need a way to inspect outputs.
  // Let's mock an output node.
  repository.register({
    id: 'io.output',
    version: '1.0.0',
    displayName: 'Output',
    definition: {
      id: 'io.output',
      kind: 'primitive',
      configType: { kind: 'record', fields: {}, untagged: [] },
      computeOutputTypes: () => ({ kind: 'record', fields: { val: numberType }, untagged: [] }),
      execute: (inputs) => ({ fields: { val: inputs.fields.val }, untagged: [] }),
    },
    inputs: [{ name: 'val', type: numberType }],
    outputs: [{ name: 'val', type: numberType }],
    compileConfig: (c) => ({ fields: {}, untagged: [] })
  });

  const compileAndRunwithOutput = (
    nodes: Record<string, { typeId: string, config?: any }>,
    connections: { from: string, port: string, to: string, portIn: string }[],
    monitoredNode: string,
    monitoredPort: string
  ) => {
    // Add output node
    const nodesWithOutput = { ...nodes, 'out_node': { typeId: 'io.output', config: { name: 'test_out' } } };
    const connectionsWithOutput = [
      ...connections,
      { from: monitoredNode, port: monitoredPort, to: 'out_node', portIn: 'val' }
    ];

    const executor = compileAndRun(nodesWithOutput, connectionsWithOutput);
    return { executor, getOutput: () => executor.getGraphOutput('test_out') };
  };

  it('should generate a rhythmic sequence (compiled)', () => {
    const { executor, getOutput } = compileAndRunwithOutput(
      {
        'gen': { typeId: 'nicepattern:rhythmic_generator', config: { targetNote: 60, density: 1.0 } }
      },
      [],
      'gen', 'seq_out'
    );

    executor.update({ clock: { beat: 0, dt: 0 } });
    const output = getOutput() as any[];

    expect(output).toBeDefined();
    expect(Array.isArray(output)).toBe(true);
    expect(output.length).toBe(16);
    expect(output[0].fields.noteIndex).toBe(60);
  });

  it('should process pattern events from sequence (compiled)', () => {
    const { executor, getOutput } = compileAndRunwithOutput(
      {
        'gen': { typeId: 'nicepattern:rhythmic_generator', config: { targetNote: 60, density: 0.5 } },
        'pat': { typeId: 'nicepattern:pattern', config: {} }
      },
      [
        { from: 'gen', port: 'seq_out', to: 'pat', portIn: 'seq_in' }
      ],
      'pat', 'midi_out'
    );

    executor.update({ clock: { beat: 0, dt: 0.1 } });
    let stream = getOutput() as any[];

    expect(stream).toBeDefined();
    const noteOn = stream.find(e => (e.fields.status & 0xF0) === 0x90 && e.fields.data2 > 0);
    expect(noteOn).toBeDefined();
    expect(noteOn.fields.data1).toBe(60);

    executor.update({ clock: { beat: 0.25, dt: 0.1 } });
    stream = getOutput() as any[];
    const noteOff = stream.find(e => (e.fields.status & 0xF0) === 0x80 || ((e.fields.status & 0xF0) === 0x90 && e.fields.data2 === 0));
    expect(noteOff).toBeDefined();
    expect(noteOff.fields.data1).toBe(60);
  });

  it('should generate chaos sequence', () => {
    const { executor, getOutput } = compileAndRunwithOutput(
      {
        'chaos': { typeId: 'nicepattern:chaos_generator', config: { minNote: 60, maxNote: 62, density: 1.0 } }
      },
      [],
      'chaos', 'seq_out'
    );

    executor.update({ clock: { beat: 0, dt: 0 } });
    const output = getOutput() as any[];

    expect(output.length).toBe(16);
    const note = output[0].fields.noteIndex;
    expect(note).toBeGreaterThanOrEqual(60);
    expect(note).toBeLessThanOrEqual(62);
  });

  it('should process layers', () => {
    // Gen -> Pattern -> Gate Layer
    const { executor, getOutput } = compileAndRunwithOutput(
      {
        'gen': { typeId: 'nicepattern:rhythmic_generator', config: { targetNote: 60, density: 1.0 } },
        'pat': { typeId: 'nicepattern:pattern', config: {} },
        'gate': { typeId: 'nicepattern:gate_layer', config: { targetNote: 60 } }
      },
      [
        { from: 'gen', port: 'seq_out', to: 'pat', portIn: 'seq_in' },
        { from: 'pat', port: 'midi_out', to: 'gate', portIn: 'midi_in' }
      ],
      'gate', 'out'
    );

    executor.update({ clock: { beat: 0, dt: 0.1 } });
    const output = getOutput();
    // Gate layer should be active (1.0) because note 60 is on
    expect(output).toBe(1.0);
  });
});
