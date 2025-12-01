
import { describe, it, expect } from 'vitest';
import { GraphExecutor } from '../../structor/executor';
import { NodeRepository } from '../../structor/repository';
import { midiCcNode, midiNoteNode, midiToMonoNode } from './nodes';
import { GraphDefinition, StructorRecord } from '../../structor/structor';
import { midiStreamType } from '../../structor/std-types';
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
    type: { kind: 'graph', inputs: { kind: 'record', fields: {}, untagged: [] }, outputs: { kind: 'record', fields: {}, untagged: [] } },
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
    }
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

    expect(executor.getGraphOutput('gate')).toBe(0);
  });
});

