
import { describe, it, expect } from 'vitest';
import { GraphExecutor } from '../../structor/executor';
import { NodeRepository } from '../../structor/repository';
import { midiCcNode, midiNoteNode, midiToMonoNode } from './nodes';
import { GraphDefinition, StructorRecord } from '../../structor/structor';
import { midiStreamType } from '../../structor/std-types';

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

  const createMidiEvent = (status: number, data1: number, data2: number, time: number = 0): StructorRecord => ({
    fields: {
      status,
      data1,
      data2,
      time
    },
    untagged: []
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
    // The node implementation does `inputs.stream as unknown as Array<{ status: number... }>; `.
    // If we pass StructorRecords, `event.status` will be undefined because it's `event.fields.status`.

    // WAIT. The node implementation I wrote expects raw objects:
    // `const stream = inputs.stream as unknown as Array<{ status: number... }>; `
    // But the type system says `midiStreamType` is an array of records.
    // If I pass raw objects here, it matches what the node expects, but violates the Structor type system?
    // Actually, `Structor` includes `StructorRecord`.
    // If I pass a raw object `{ status: ... } `, it is NOT a StructorRecord.
    // However, `inputs` in `execute` is `StructorRecord`.
    // `inputs.stream` is `StructorArray` (Array<Structor>).
    // If I pass `[{ fields: { status: ... } }]`, then `inputs.stream[0]` is a StructorRecord.
    // So `event.status` would be undefined.

    // I should update the node implementation to handle StructorRecords!
    // OR I should update the test to pass what the node expects if I want to cheat.
    // But "promoting to core" means doing it right.
    // The node should expect StructorRecords.

    // Let's update the node implementation to handle StructorRecords.
    // But for now, to make the test pass with the CURRENT node implementation,
    // I should pass raw objects because that's what I cast it to.
    // BUT the linter complained.

    // Let's fix the node implementation to use Structor helpers or access fields.
    // Actually, for performance, maybe we want raw objects?
    // But `midiEventType` defines it as a record.
    // So it SHOULD be a StructorRecord.

    // I will update the test to pass StructorRecords, AND update the node implementation to read from .fields.

    const stream = [
      createMidiEvent(0xB0, 7, 64)
    ];
    executor.setInput('midi_in', stream);
    executor.update({});

    // Wait, I need to update the node implementation first or this will fail.
    // I'll update the node implementation in the next step.
    // For now, I'll write the test assuming the node will be fixed.

    const output = executor.getGraphOutput('value') as number;
    expect(output).toBeCloseTo(64 / 127.0);

    // Send CC 7 on Channel 2 (should ignore)
    const stream2 = [
      createMidiEvent(0xB1, 7, 127)
    ];
    executor.setInput('midi_in', stream2);
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
      createMidiEvent(0x90, 60, 100)
    ];
    executor.setInput('midi_in', stream);
    executor.update({});

    expect(executor.getGraphOutput('gate')).toBe(1);
    expect(executor.getGraphOutput('velocity')).toBeCloseTo(100 / 127.0);

    const streamOff = [
      createMidiEvent(0x80, 60, 0)
    ];
    executor.setInput('midi_in', streamOff);
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
      createMidiEvent(0x90, 60, 100)
    ];
    executor.setInput('midi_in', stream);
    executor.update({});

    expect(executor.getGraphOutput('gate')).toBe(1);
    expect(executor.getGraphOutput('note')).toBe(0);
    expect(executor.getGraphOutput('frequency')).toBeCloseTo(261.63, 1); // Middle C freq

    // Note On 72 (+1 octave) -> Should be 12
    const stream2 = [
      createMidiEvent(0x90, 72, 100)
    ];
    executor.setInput('midi_in', stream2);
    executor.update({});

    expect(executor.getGraphOutput('note')).toBe(12);

    // Note Off 72 -> Should go back to 60 (last note priority)
    const stream3 = [
      createMidiEvent(0x80, 72, 0)
    ];
    executor.setInput('midi_in', stream3);
    executor.update({});

    expect(executor.getGraphOutput('note')).toBe(0);
    expect(executor.getGraphOutput('gate')).toBe(1);

    // Note Off 60 -> Gate 0
    const stream4 = [
      createMidiEvent(0x80, 60, 0)
    ];
    executor.setInput('midi_in', stream4);
    executor.update({});

    expect(executor.getGraphOutput('gate')).toBe(0);
  });
});

