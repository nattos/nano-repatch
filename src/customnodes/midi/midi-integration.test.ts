
import { describe, it, expect } from 'vitest';
import { GraphExecutor } from '../../structor/executor';
import { NodeRepository } from '../../structor/repository';
import { midiCcNode, midiNoteNode, midiToMonoNode, midiPitchNode } from './nodes';
import { GraphDefinition, StructorRecord } from '../../structor/structor';
import { midiStreamType, numberType } from '../../structor/std-types';
import { MidiEvent } from '../../io/midi/types';

describe('MIDI Integration', () => {
  const repository = new NodeRepository();
  repository.register({
    id: 'midi.cc',
    version: '1.0.0',
    displayName: 'MIDI CC',
    definition: midiCcNode,
    inputs: [{ name: 'stream', type: midiStreamType, description: 'MIDI Stream' }],
    outputs: []
  });
  repository.register({
    id: 'midi.note',
    version: '1.0.0',
    displayName: 'MIDI Note',
    definition: midiNoteNode,
    inputs: [{ name: 'stream', type: midiStreamType, description: 'MIDI Stream' }],
    outputs: []
  });
  repository.register({
    id: 'midi.to_mono',
    version: '1.0.0',
    displayName: 'MIDI to Mono',
    definition: midiToMonoNode,
    inputs: [{ name: 'stream', type: midiStreamType, description: 'MIDI Stream' }],
    outputs: []
  });

  // Helper to create a simple graph with one node
  const createGraph = (nodeId: string, definitionId: string, config: any): GraphDefinition => ({
    id: 'test-graph',
    kind: 'graph',
    type: { kind: 'graph', inputs: { kind: 'record', fields: {},  }, outputs: { kind: 'record', fields: {},  } },
    nodes: {
      [nodeId]: { definitionId, defaultConfig: config }
    },
    connections: [],
    inputs: {
      'midi_in': { nodeId, port: 'stream' }
    },
    outputs: {
      'out': { nodeId, port: 'value' }, // For CC
      'gate': { nodeId, port: 'gate' }, // For Note/Mono
      'velocity': { nodeId, port: 'velocity' }, // For Note/Mono
      'note': { nodeId, port: 'note' }, // For Mono
      'frequency': { nodeId, port: 'frequency' } // For Mono
    },
    executionOrder: [nodeId]
  });

  const createCcEvent = (channel: number, cc: number, value: number): MidiEvent => ({
    deviceId: 'test',
    channel,
    type: 'cc',
    cc,
    value,
    time: 0
  });

  const createNoteOnEvent = (channel: number, note: number, velocity: number): MidiEvent => ({
    deviceId: 'test',
    channel,
    type: 'note_on',
    note,
    velocity,
    time: 0
  });

  const createNoteOffEvent = (channel: number, note: number): MidiEvent => ({
    deviceId: 'test',
    channel,
    type: 'note_off',
    note,
    velocity: 0,
    time: 0
  });

  it('should process MIDI CC messages', () => {
    const graph = createGraph('ccNode', 'midi.cc', { channel: 1, cc: 7 });
    // Add output mapping for note node test later
    graph.outputs = { 'value': { nodeId: 'ccNode', port: 'value' } };

    const executor = new GraphExecutor(graph, repository);

    // Initial state
    executor.update({});
    expect(executor.getGraphOutput('value')).toBe(0);

    // Send CC 7 on Channel 1 with value 64 (approx 0.5)
    // Note: The input to the executor for 'stream' expects an array of StructorRecords
    // BUT the node implementation casts it to Array<{ status... }>.
    // This means the node implementation expects RAW objects if coming from outside,
    // OR StructorRecords if coming from another node?
    // The executor.setInput puts the value directly into the input record.
    // If we pass StructorRecords here, the node will receive StructorRecords.
    // So `event.status` would be undefined.

    // I should update the node implementation to handle StructorRecords!
    // OR I should update the test to pass what the node expects if I want to cheat.
    // But "promoting to core" means doing it right.
    // The node should expect StructorRecords.

    // I will update the test to pass StructorRecords, AND update the node implementation to read from .fields.

    const stream = [
      createCcEvent(1, 7, 64)
    ];
    executor.setInput('midi_in', stream as any);
    executor.update({});

    // Wait, I need to update the node implementation first or this will fail.
    // I'll update the node implementation in the next step.
    // For now, I'll write the test assuming the node will be fixed.

    const output = executor.getGraphOutput('value') as number;
    expect(output).toBeCloseTo(64 / 127.0);

    // Send CC 7 on Channel 2 (should ignore)
    const stream2 = [
      createCcEvent(2, 7, 127)
    ];
    executor.setInput('midi_in', stream2 as any);
    executor.update({});

    const output2 = executor.getGraphOutput('value') as number;
    expect(output2).toBeCloseTo(64 / 127.0); // Should remain unchanged
  });

  it('should process MIDI Note messages', () => {
    const graph = createGraph('noteNode', 'midi.note', { channel: 1, note: 60 });
    graph.outputs = {
      'gate': { nodeId: 'noteNode', port: 'gate' },
      'velocity': { nodeId: 'noteNode', port: 'velocity' }
    };

    const executor = new GraphExecutor(graph, repository);

    executor.update({});
    expect(executor.getGraphOutput('gate')).toBe(0);

    const stream = [
      createNoteOnEvent(1, 60, 100)
    ];
    executor.setInput('midi_in', stream as any);
    executor.update({});

    expect(executor.getGraphOutput('gate')).toBe(1);
    expect(executor.getGraphOutput('velocity')).toBeCloseTo(100 / 127.0);

    const streamOff = [
      createNoteOffEvent(1, 60)
    ];
    executor.setInput('midi_in', streamOff as any);
    executor.update({});

    expect(executor.getGraphOutput('gate')).toBe(0);
  });

  it('should convert MIDI to Mono with Middle C anchor', () => {
    const graph = createGraph('monoNode', 'midi.to_mono', { channel: 1, rootNote: 60 });
    graph.outputs = {
      'note': { nodeId: 'monoNode', port: 'note' },
      'gate': { nodeId: 'monoNode', port: 'gate' },
      'frequency': { nodeId: 'monoNode', port: 'frequency' }
    };

    const executor = new GraphExecutor(graph, repository);

    executor.update({});
    expect(executor.getGraphOutput('gate')).toBe(0);

    // Note On 60 (Middle C) -> Should be 0
    const stream = [
      createNoteOnEvent(1, 60, 100)
    ];
    executor.setInput('midi_in', stream as any);
    executor.update({});

    expect(executor.getGraphOutput('gate')).toBe(1);
    expect(executor.getGraphOutput('note')).toBe(0);
    expect(executor.getGraphOutput('frequency')).toBeCloseTo(261.63, 1); // Middle C freq

    // Note On 72 (+1 octave) -> Should be 12
    const stream2 = [
      createNoteOnEvent(1, 72, 100)
    ];
    executor.setInput('midi_in', stream2 as any);
    executor.update({});

    expect(executor.getGraphOutput('note')).toBe(12);

    // Note Off 72 -> Should go back to 60 (last note priority)
    const stream3 = [
      createNoteOffEvent(1, 72)
    ];
    executor.setInput('midi_in', stream3 as any);
    executor.update({});

    expect(executor.getGraphOutput('note')).toBe(0);
    expect(executor.getGraphOutput('gate')).toBe(1);

    // Note Off 60 -> Gate 0
    const stream4 = [
      createNoteOffEvent(1, 60)
    ];
    executor.setInput('midi_in', stream4 as any);
    executor.update({});

  });

  it('should process MIDI Pitch messages', () => {
    // Register midi.pitch explicitly if not in base (not really needed if we trust setup, but test context might differ)
    // We'll rely on correct registration from imports if possible, or register again.
    // Since we import nodes individually, let's verify registration.

    repository.register({
      id: 'midi.pitch',
      version: '1.0.0',
      displayName: 'MIDI Pitch',
      definition: midiPitchNode,
      inputs: [
        { name: 'stream', type: midiStreamType, description: 'MIDI Stream' },
        { name: 'pitch', type: numberType, description: 'Pitch' }
      ],
      outputs: [{ name: 'stream', type: midiStreamType }]
    });

    const graph = createGraph('pitchNode', 'midi.pitch', { pitch: 0 });
    graph.outputs = {
      'stream': { nodeId: 'pitchNode', port: 'stream' }
    };
    // Configure pitch input
    graph.inputs = {
      'midi_in': { nodeId: 'pitchNode', port: 'stream' },
      'pitch_in': { nodeId: 'pitchNode', port: 'pitch' }
    };

    const executor = new GraphExecutor(graph, repository);

    // Case 1: Default pitch 0
    const noteOn = [createNoteOnEvent(1, 60, 100)];
    executor.setInput('midi_in', noteOn as any);
    executor.update({});
    let output = executor.getGraphOutput('stream') as any[]; // Cast to any to access fields
    expect(output[0].fields.note).toBe(60);

    // Case 2: Pitch +12 via input
    executor.setInput('midi_in', noteOn as any);
    // Passing scalar input (number) directly? No, executor inputs usuallyStructorRecord.
    // Logic: executor.setInput(key, value) -> inputRecord.fields[key] = value.
    // If input is numberType, value should be number.
    executor.setInput('pitch_in', 12 as any);
    executor.update({});
    output = executor.getGraphOutput('stream') as any[];
    expect(output[0].fields.note).toBe(72);

    // Case 3: Pitch -12 via input
    executor.setInput('pitch_in', -12 as any);
    executor.update({});
    output = executor.getGraphOutput('stream') as any[];
    expect(output[0].fields.note).toBe(48);

    // Case 4: Clamping
    const highNote = [createNoteOnEvent(1, 120, 100)];
    executor.setInput('midi_in', highNote as any);
    executor.setInput('pitch_in', 20 as any); // Should clamp to 127
    executor.update({});
    output = executor.getGraphOutput('stream') as any[];
    expect(output[0].fields.note).toBe(127);
  });
});


