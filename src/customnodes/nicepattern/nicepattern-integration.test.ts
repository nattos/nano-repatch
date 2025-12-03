import { describe, it, expect, vi } from 'vitest';
import { GraphExecutor } from '../../structor/executor';
import { NodeRepository, defaultNodeRepository } from '../../structor/repository';
import {
  rhythmicGenerator,
  chaosGenerator,
  pattern,
  sequenceStructorType,
  createLayerNode,
  GateLayer,
  ExponentialLayer,
  PWMLayer,
  NoiseLayer,
  toneSynthLayer,
} from './nodes';

import { numberType, midiStreamType } from '../../structor/std-types';
import { AnyType as anyType } from '../../structor/type-helpers';
import { compileGraph } from '../../builder/compiler';
import { AppState, GridNode, Connection } from '../../builder/state';

describe('NicePattern Integration', () => {
  const repository = new NodeRepository();

  // Register nodes manually for the test repository
  repository.register({
    id: 'nicepattern:rhythmic_generator',
    version: '1.0.0',
    displayName: 'Rhythmic Generator',
    definition: rhythmicGenerator,
    inputs: [],
    outputs: [{ name: 'seq_out', type: sequenceStructorType, description: 'Generated sequence' }],
    compileConfig: (uiConfig) => ({ fields: { targetNote: uiConfig?.targetNote ?? 60, density: uiConfig?.density ?? 0.5 }, untagged: [] }),
  });

  repository.register({
    id: 'nicepattern:chaos_generator',
    version: '1.0.0',
    displayName: 'Chaos Generator',
    definition: chaosGenerator,
    inputs: [],
    outputs: [{ name: 'seq_out', type: sequenceStructorType, description: 'Generated sequence' }],
    compileConfig: (uiConfig) => ({
      fields: {
        minNote: uiConfig?.minNote ?? 60,
        maxNote: uiConfig?.maxNote ?? 72,
        density: uiConfig?.density ?? 0.5,
        seed: uiConfig?.seed ?? 12345
      },
      untagged: []
    }),
  });

  repository.register({
    id: 'nicepattern:pattern',
    version: '1.0.0',
    displayName: 'Pattern',
    definition: pattern,
    inputs: [{ name: 'seq_in', type: sequenceStructorType, description: 'Input sequence(s)', redirect: 'untagged' }],
    outputs: [{ name: 'midi_out', type: midiStreamType, description: 'Real-time MIDI stream' }],
    compileConfig: (uiConfig) => ({ fields: {}, untagged: [] }),
  });

  // Register Layers
  const registerLayer = (id: string, name: string, cls: any) => {
    // createLayerNode returns EnhancedNodeDefinition which IS the definition
    const def = createLayerNode(id, name, cls);
    repository.register({
      id: def.id,
      version: def.version,
      displayName: def.displayName,
      definition: def,
      inputs: [
        { name: "midi_in", type: midiStreamType, description: "Input MIDI stream" },
        { name: "prev_layer", type: numberType, description: "Previous layer output" }
      ],
      outputs: [{ name: "out", type: numberType, description: "Layer output" }],
      compileConfig: def.compileConfig
    });
  };
  registerLayer("nicepattern:gate_layer", "Gate Layer", GateLayer);
  registerLayer("nicepattern:exp_layer", "Exponential Layer", ExponentialLayer);
  registerLayer("nicepattern:pwm_layer", "PWM Layer", PWMLayer);
  registerLayer("nicepattern:noise_layer", "Noise Layer", NoiseLayer);

  repository.register({
    id: "nicepattern:tone_synth_layer",
    version: "1.0.0",
    displayName: "Tone Synth Layer",
    definition: toneSynthLayer,
    inputs: [
      { name: "midi_in", type: midiStreamType, description: "Input MIDI stream" },
      { name: "prev_layer", type: numberType, description: "Previous layer output" }
    ],
    outputs: [{ name: "out", type: numberType, description: "Layer output" }],
    compileConfig: (uiConfig) => ({
      fields: {
        targetNote: uiConfig?.targetNote ?? 60,
      },
      untagged: [],
    }),
  });

  // Mock Output Node
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
    inputs: [{ name: 'val', type: anyType }],
    outputs: [{ name: 'val', type: anyType }],
    compileConfig: (c) => ({ fields: {}, untagged: [] })
  });

  // Mock Input Node
  repository.register({
    id: 'io.input',
    version: '1.0.0',
    displayName: 'Input',
    definition: {
      id: 'io.input',
      kind: 'primitive',
      configType: { kind: 'record', fields: {}, untagged: [] },
      computeOutputTypes: () => ({ kind: 'record', fields: { val: anyType }, untagged: [] }),
      execute: (inputs, config) => ({ fields: { val: config }, untagged: [] }),
    },
    inputs: [],
    outputs: [{ name: 'val', type: anyType }],
    compileConfig: (c) => c
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
    return { executor, getOutput: () => executor.getNodeOutput('out_node')?.fields?.val };
  };

  it('should compile and run rhythmic generator', () => {
    const executor = compileAndRun(
      {
        'gen': { typeId: 'nicepattern:rhythmic_generator', config: { targetNote: 60, density: 1.0 } }
      },
      []
    );

    executor.update({ clock: { beat: 0, dt: 0 } });
    // We can't easily check output without io.output, but it shouldn't crash
  });

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
    const noteOn = stream.find(e => e.fields.type === 'note_on');
    expect(noteOn).toBeDefined();
    expect(noteOn.fields.note).toBe(60);

    executor.update({ clock: { beat: 0.25, dt: 0.1 } });
    stream = getOutput() as any[];
    const noteOff = stream.find(e => e.fields.type === 'note_off');
    expect(noteOff).toBeDefined();
    expect(noteOff.fields.note).toBe(60);
  });

  it('should process multiple sequence inputs', () => {
    const { executor, getOutput } = compileAndRunwithOutput(
      {
        'gen1': { typeId: 'nicepattern:rhythmic_generator', config: { targetNote: 60, density: 1.0 } }, // Always note
        'gen2': { typeId: 'nicepattern:rhythmic_generator', config: { targetNote: 62, density: 1.0 } }, // Always note
        'pat': { typeId: 'nicepattern:pattern', config: {} }
      },
      [
        { from: 'gen1', port: 'seq_out', to: 'pat', portIn: 0 }, // Connect to untagged 0
        { from: 'gen2', port: 'seq_out', to: 'pat', portIn: 1 }  // Connect to untagged 1
      ],
      'pat', 'midi_out'
    );

    executor.update({ clock: { beat: 0, dt: 0.1 } });
    const stream = getOutput() as any[];

    expect(stream).toBeDefined();
    // Should have notes from both generators
    const note60 = stream.find(e => e.fields.type === 'note_on' && e.fields.note === 60);
    const note62 = stream.find(e => e.fields.type === 'note_on' && e.fields.note === 62);

    expect(note60).toBeDefined();
    expect(note62).toBeDefined();
  });

  it('should process multiple sequence inputs on named port', () => {
    const { executor, getOutput } = compileAndRunwithOutput(
      {
        'gen1': { typeId: 'nicepattern:rhythmic_generator', config: { targetNote: 60, density: 1.0 } },
        'gen2': { typeId: 'nicepattern:rhythmic_generator', config: { targetNote: 62, density: 1.0 } },
        'pat': { typeId: 'nicepattern:pattern', config: {} }
      },
      [
        { from: 'gen1', port: 'seq_out', to: 'pat', portIn: 'seq_in' },
        { from: 'gen2', port: 'seq_out', to: 'pat', portIn: 'seq_in' }
      ],
      'pat', 'midi_out'
    );

    executor.update({ clock: { beat: 0, dt: 0.1 } });
    const stream = getOutput() as any[];

    expect(stream).toBeDefined();
    // Should have notes from both generators
    const note60 = stream.find(e => e.fields.type === 'note_on' && e.fields.note === 60);
    const note62 = stream.find(e => e.fields.type === 'note_on' && e.fields.note === 62);

    expect(note60).toBeDefined();
    expect(note62).toBeDefined();
  });

  it('should generate chaos sequence', () => {
    const { executor, getOutput } = compileAndRunwithOutput(
      {
        'chaos': { typeId: 'nicepattern:chaos_generator', config: { minNote: 60, maxNote: 62, density: 1.0, seed: 123 } }
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

  it('tone_synth_layer should not trigger on Note Off', async () => {
    // Mock AudioContext
    const mockAudioContext = {
      createOscillator: vi.fn(() => ({
        connect: () => { },
        start: () => { },
        stop: () => { },
        frequency: { setValueAtTime: () => { } },
        type: 'sine'
      })),
      createGain: () => ({
        connect: () => { },
        gain: {
          setValueAtTime: () => { },
          linearRampToValueAtTime: () => { },
          exponentialRampToValueAtTime: () => { },
          cancelScheduledValues: () => { },
          setTargetAtTime: () => { },
          cancelAndHoldAtTime: () => { }
        }
      }),
      createBiquadFilter: () => ({
        connect: () => { },
        frequency: { setValueAtTime: () => { } }
      }),
      currentTime: 0,
      state: 'running',
      destination: {}
    };

    // Construct AppState for compilation
    const appState: AppState = {
      graph: {
        inner: {
          nodes: {
            'synth': {
              id: 'synth',
              x: 0, y: 0,
              config: { typeId: 'nicepattern:tone_synth_layer', targetNote: 60, values: {} }
            },
            'input': {
              id: 'input',
              x: 0, y: 0,
              config: { typeId: 'io.input', values: {}, value: [] }
            }
          },
          connections: {
            'c1': { id: 'c1', fromNodeId: 'input', fromPort: 'val', toNodeId: 'synth', toPort: 'midi_in' }
          }
        },
        auxiliary: { outgoingConnections: new Map(), incomingConnections: new Map() }
      }
    };

    const graphDef = compileGraph(appState, new Map(), repository);
    const executor = new GraphExecutor(graphDef, repository);

    // 1. Note On (60)
    // We must format this as Structor (array of records)
    const noteOn = [{ fields: { type: 'note_on', note: 60, velocity: 100, channel: 1, time: 0 }, untagged: [] }];
    executor.setNodeConfig('input', noteOn as any);
    executor.update({
      clock: { beat: 0, dt: 0.1 },
      audio: { context: mockAudioContext as any }
    });


    expect(mockAudioContext.createOscillator).toHaveBeenCalledTimes(1); // Only for the first Note On

    // 2. Note Off (60)
    const noteOff = [{ fields: { type: 'note_off', note: 60, velocity: 0, channel: 1, time: 0 }, untagged: [] }];
    executor.setNodeConfig('input', noteOff as any);
    executor.update({
      clock: { beat: 0.1, dt: 0.1 },
      audio: { context: mockAudioContext as any }
    });
    expect(mockAudioContext.createOscillator).toHaveBeenCalledTimes(1); // Should NOT have increased

    // 3. Note Off (60) again - should not trigger
    executor.setNodeConfig('input', noteOff as any);
    executor.update({
      clock: { beat: 0.2, dt: 0.1 },
      audio: { context: mockAudioContext as any }
    });
    expect(mockAudioContext.createOscillator).toHaveBeenCalledTimes(1); // Should NOT have increased

    // 4. Note On (62) - Wrong note, should be ignored
    const noteOnWrong = [{ fields: { type: 'note_on', note: 62, velocity: 100, channel: 1, time: 0 }, untagged: [] }];
    executor.setNodeConfig('input', noteOnWrong as any);
    executor.update({
      clock: { beat: 0.3, dt: 0.1 },
      audio: { context: mockAudioContext as any }
    });
    expect(mockAudioContext.createOscillator).toHaveBeenCalledTimes(1); // Should NOT have increased
  });
});
