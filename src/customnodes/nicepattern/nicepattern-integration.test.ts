import { describe, it, expect, vi } from 'vitest';
import { GraphExecutor } from '../../structor/executor';
import { NodeRepository, defaultNodeRepository } from '../../structor/repository';
import {
  rhythmicGenerator,
  chaosGenerator,
  sequenceStructorType,
  createLayerNode,
  GateLayer,
  ExponentialLayer,
  PWMLayer,
  NoiseLayer,
  toneSynthLayer,
} from './nodes';
import { tomidi } from '../seq/nodes';

import { numberType, midiStreamType } from '../../structor/std-types';
import { AnyType as anyType } from '../../structor/type-helpers';
import { defineType } from '../../structor/type-helpers';
const manySequencesType = defineType({
  kind: "array",
  size: "dynamic",
  element: sequenceStructorType
});
import { compileGraph } from '../../builder/compiler';
import { AppState, GridNode, Connection } from '../../builder/state';
import { compileAndRun } from '../../test/integration-utils';

function registerNicePatternNodes(repository: NodeRepository) {
  // Register nodes manually for the test repository
  repository.register({
    id: 'nicepattern.rhythmic_generator',
    version: '1.0.0',
    displayName: 'Rhythmic Generator',
    definition: rhythmicGenerator,
    inputs: [],
    outputs: [{ name: 'seq_out', type: sequenceStructorType, description: 'Generated sequence' }],
    compileConfig: rhythmicGenerator.compileConfig!,
  });

  repository.register({
    id: 'nicepattern.chaos_generator',
    version: '1.0.0',
    displayName: 'Chaos Generator',
    definition: chaosGenerator,
    inputs: [],
    outputs: [{ name: 'seq_out', type: sequenceStructorType, description: 'Generated sequence' }],
    compileConfig: chaosGenerator.compileConfig!,
  });

  repository.register({
    id: 'seq.tomidi',
    version: '1.0.0',
    displayName: 'To MIDI',
    definition: tomidi,
    inputs: [{ name: 'seq_in', type: manySequencesType, description: 'Input sequence(s)', allowMultiConnection: true }],
    outputs: [{ name: 'midi_out', type: midiStreamType, description: 'Real-time MIDI stream' }],
    compileConfig: (uiConfig) => ({ fields: {}, }),
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
  registerLayer("nicepattern.gate_layer", "Gate Layer", GateLayer);
  registerLayer("nicepattern.exp_layer", "Exponential Layer", ExponentialLayer);
  registerLayer("nicepattern.pwm_layer", "PWM Layer", PWMLayer);
  registerLayer("nicepattern.noise_layer", "Noise Layer", NoiseLayer);

  repository.register({
    id: "nicepattern.tone_synth_layer",
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
      configType: { kind: 'record', fields: {}, },
      computeOutputTypes: () => ({ kind: 'record', fields: { value: numberType }, }),
      execute: (inputs) => ({ fields: { value: inputs.fields.value }, }),
    },
    inputs: [{ name: 'value', type: anyType }],
    outputs: [{ name: 'value', type: anyType }],
    compileConfig: (c) => ({ fields: {}, })
  });

  // Mock Input Node
  repository.register({
    id: 'io.input',
    version: '1.0.0',
    displayName: 'Input',
    definition: {
      id: 'io.input',
      kind: 'primitive',
      configType: { kind: 'record', fields: {}, },
      computeOutputTypes: () => ({ kind: 'record', fields: { val: anyType }, }),
      execute: (inputs, config) => ({ fields: { val: (config && config.value !== undefined) ? config.value : config }, }),
    },
    inputs: [],
    outputs: [{ name: 'val', type: anyType }],
    compileConfig: (c) => c
  });
}

describe('NicePattern Integration', () => {
  const repository = new NodeRepository();
  registerNicePatternNodes(repository);

  it('should compile and run rhythmic generator', () => {
    const { executor } = compileAndRun(
      {
        'gen': { typeId: 'nicepattern.rhythmic_generator', config: { targetNote: 60, values: { density: 1.0 } } }
      },
      [],
      'gen', 'seq_out',
      registerNicePatternNodes
    );

    executor.update({ clock: { beat: 0, dt: 0 } });
    // We can't easily check output without io.output, but it shouldn't crash
  });

  it('should generate a rhythmic sequence (compiled)', () => {
    const { executor, getOutput } = compileAndRun(
      {
        'gen': { typeId: 'nicepattern.rhythmic_generator', config: { targetNote: 60, values: { density: 1.0 } } }
      },
      [],
      'gen', 'seq_out',
      registerNicePatternNodes
    );

    executor.update({ clock: { beat: 0, dt: 0 } });
    const output = getOutput() as any[];

    expect(output).toBeDefined();
    expect(Array.isArray(output)).toBe(true);
    expect(output.length).toBe(16);
    expect(output[0].fields.noteIndex).toBe(60);
  });

  it('should process pattern events from sequence (compiled)', () => {
    const { executor, getOutput } = compileAndRun(
      {
        'gen': { typeId: 'nicepattern.rhythmic_generator', config: { targetNote: 60, values: { density: 0.5 } } },
        'tomidi': { typeId: 'seq.tomidi' }
      },
      [
        { from: 'gen', port: 'seq_out', to: 'tomidi', portIn: 'seq_in' }
      ],
      'tomidi', 'midi_out',
      registerNicePatternNodes
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



  it('should process multiple sequence inputs on named port', () => {
    const { executor, getOutput } = compileAndRun(
      {
        'gen1': { typeId: 'nicepattern.rhythmic_generator', config: { targetNote: 60, values: { density: 1.0 } } },
        'gen2': { typeId: 'nicepattern.rhythmic_generator', config: { targetNote: 62, values: { density: 1.0 } } },
        'tomidi': { typeId: 'seq.tomidi' }
      },
      [
        { from: 'gen1', port: 'seq_out', to: 'tomidi', portIn: 'seq_in' },
        { from: 'gen2', port: 'seq_out', to: 'tomidi', portIn: 'seq_in' }
      ],
      'tomidi', 'midi_out',
      registerNicePatternNodes
    );

    executor.update({ clock: { beat: 0, dt: 0 } });

    const stream = getOutput() as any[];

    expect(stream).toBeDefined();
    // Should have notes from both generators
    const note60 = stream.find(e => e.fields.type === 'note_on' && e.fields.note === 60);
    const note62 = stream.find(e => e.fields.type === 'note_on' && e.fields.note === 62);

    expect(note60).toBeDefined();
    expect(note62).toBeDefined();
  });

  it('should generate chaos sequence', () => {
    const { executor, getOutput } = compileAndRun(
      {
        'chaos': { typeId: 'nicepattern.chaos_generator', config: { minNote: 60, maxNote: 62, seed: 123, values: { density: 1.0 } } }
      },
      [],
      'chaos', 'seq_out',
      registerNicePatternNodes
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
    const { executor, getOutput } = compileAndRun(
      {
        'gen': { typeId: 'nicepattern.rhythmic_generator', config: { targetNote: 60, values: { density: 1.0 } } },
        'tomidi': { typeId: 'seq.tomidi' },
        'gate': { typeId: 'nicepattern.gate_layer', config: {}, values: { gate: 0.5 } }
      },
      [
        { from: 'gen', port: 'seq_out', to: 'tomidi', portIn: 'seq_in' },
        { from: 'tomidi', port: 'midi_out', to: 'gate', portIn: 'midi_in' }
      ],
      'gate', 'out',
      registerNicePatternNodes
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
              config: { typeId: 'nicepattern.tone_synth_layer', targetNote: 60, values: {} }
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

    console.log('io.input def:', repository.get('io.input'));

    const { graph } = compileGraph(appState, new Map(), repository);
    const graphDef = graph;
    const executor = new GraphExecutor(graphDef, repository);

    // 1. Note On (60)
    // We must format this as Structor (array of records)
    const noteOn = [{ fields: { type: 'note_on', note: 60, velocity: 100, channel: 1, time: 0 }, }];
    executor.setNodeConfig('input', noteOn as any);
    executor.update({
      clock: { beat: 0, dt: 0.1 },
      audio: { context: mockAudioContext as any }
    });


    expect(mockAudioContext.createOscillator).toHaveBeenCalledTimes(1); // Only for the first Note On

    // 2. Note Off (60)
    const noteOff = [{ fields: { type: 'note_off', note: 60, velocity: 0, channel: 1, time: 0 }, }];
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

    // 4. Note On (62) - Should trigger (as we now trigger on ALL notes)
    const noteOnWrong = [{ fields: { type: 'note_on', note: 62, velocity: 100, channel: 1, time: 0 }, }];
    executor.setNodeConfig('input', noteOnWrong as any);
    executor.update({
      clock: { beat: 0.3, dt: 0.1 },
      audio: { context: mockAudioContext as any }
    });
    expect(mockAudioContext.createOscillator).toHaveBeenCalledTimes(2);
  });

  it('should generate Note Off when input sequence is removed (stuck note fix)', () => {
    // pattern node connected to manual input
    const { executor, getOutput } = compileAndRun(
      {
        'manual_seq': { typeId: 'io.input', config: { value: [] } },
        'tomidi': { typeId: 'seq.tomidi' }
      },
      [
        { from: 'manual_seq', port: 'val', to: 'tomidi', portIn: 'seq_in' }
      ],
      'tomidi', 'midi_out',
      registerNicePatternNodes
    );

    // 1. Input active sequence (Step 0: Note 60)
    // Construct a sequence with note 60 at step 0
    const activeSeq = new Array(16).fill(null).map((_, i) => ({
      noteIndex: i === 0 ? 60 : null,
      velocity: 1,
      hold: false
    }));

    // Inject active sequence
    executor.setNodeConfig('manual_seq', { value: activeSeq });

    // Update at time 0
    executor.update({ clock: { beat: 0, dt: 0.1 } });

    let stream = getOutput() as any[];
    let noteOn = stream.find(e => e.fields.type === 'note_on');
    expect(noteOn).toBeDefined();
    expect(noteOn.fields.note).toBe(60);

    // 2. Input EMPTY sequence (simulating disconnection or empty pattern)
    // This effectively removes the sequence from the input
    executor.setNodeConfig('manual_seq', { value: [] });

    // Update at time 0.1 (still step 0 effectively, or next step, doesn't matter much as long as we process)
    // Actually, let's advance time slightly.
    // IMPORTANT: The pattern node logic checks `currentStepIndex !== seqState.lastStepIndex`.
    // If we are at the ANY step with an empty sequence, the old state says "last step I played note 60".
    // Now I see nothing. I should generate a release.
    executor.update({ clock: { beat: 0.1, dt: 0.1 } });

    stream = getOutput() as any[];
    let noteOff = stream.find(e => e.fields.type === 'note_off');

    // This EXPECTATION will FAIL before the fix
    expect(noteOff, "Should generate Note Off for stuck note").toBeDefined();
    expect(noteOff?.fields?.note).toBe(60);
  });
});
