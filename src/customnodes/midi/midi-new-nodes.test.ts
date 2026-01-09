
import { describe, it, expect } from 'vitest';
import { GraphExecutor } from '../../structor/executor';
import { NodeRepository } from '../../structor/repository';
import { midiDelayNode } from './midi-delay';
import { midiIsTriggerNode } from './midi-istrigger';
import { GraphDefinition } from '../../structor/structor';
import { midiStreamType, numberType } from '../../structor/std-types';
import { MidiEvent } from '../../io/midi/types';

describe('New MIDI Nodes', () => {
  const repository = new NodeRepository();
  repository.register({
    id: midiDelayNode.id,
    version: midiDelayNode.version,
    displayName: midiDelayNode.displayName,
    definition: midiDelayNode,
    inputs: [
      { name: 'stream', type: midiStreamType, allowMultiConnection: true },
      { name: 'duration', type: numberType, defaultValue: 0.25 }
    ],
    outputs: [{ name: 'stream', type: midiStreamType }],
    compileConfig: midiDelayNode.compileConfig
  });
  repository.register({
    id: midiIsTriggerNode.id,
    version: midiIsTriggerNode.version,
    displayName: midiIsTriggerNode.displayName,
    definition: midiIsTriggerNode,
    inputs: [{ name: 'stream', type: midiStreamType, allowMultiConnection: true }],
    outputs: [{ name: 'result', type: numberType }]
  });

  // Helper to create a simple graph
  const createGraph = (nodeId: string, definitionId: string, config: any): GraphDefinition => ({
    id: 'test-graph',
    kind: 'graph',
    type: { kind: 'graph', inputs: { kind: 'record', fields: {}, }, outputs: { kind: 'record', fields: {}, } },
    nodes: {
      [nodeId]: { definitionId, defaultConfig: config }
    },
    connections: [],
    inputs: {
      'midi_in': { nodeId, port: 'stream' },
      'duration_in': { nodeId, port: 'duration' }
    },
    outputs: {
      'stream': { nodeId, port: 'stream' },
      'result': { nodeId, port: 'result' }
    },
    executionOrder: [nodeId]
  });

  const createNoteOnEvent = (time: number): MidiEvent => ({
    deviceId: 'test',
    channel: 1,
    type: 'note_on',
    note: 60,
    velocity: 0.5,
    time
  });

  describe('midi.istrigger', () => {
    it('should output 1 when stream has note_on', () => {
      const graph = createGraph('trig', 'midi.istrigger', {});
      const executor = new GraphExecutor(graph, repository);

      executor.update({});
      expect(executor.getGraphOutput('result')).toBe(0);

      const stream = [createNoteOnEvent(0)];
      executor.setInput('midi_in', stream as any);
      executor.update({});
      expect(executor.getGraphOutput('result')).toBe(1);

      // Should reset if no inputs
      executor.setInput('midi_in', []);
      executor.update({});
      expect(executor.getGraphOutput('result')).toBe(0);
    });
  });

  describe('midi.delay', () => {
    it('should delay events by time duration', () => {
      const graph = createGraph('delay', 'midi.delay', { mode: 'time' });
      const executor = new GraphExecutor(graph, repository);

      // Set duration to 0.5s via input
      executor.setInput('duration_in', 0.5);

      // T=0: Send Event
      const context = { time: 0, clock: { beat: 0, dt: 0.1 } };
      executor.update(context);

      const stream = [createNoteOnEvent(0)];
      executor.setInput('midi_in', stream as any);
      executor.update({ ...context, time: 0 }); // Inject at T=0

      // Assume implementation queues it. Output should be empty now.
      let output = executor.getGraphOutput('stream') as any[];
      expect(output.length).toBe(0);

      // T=0.4: Still waiting
      context.time = 0.4;
      executor.setInput('midi_in', []); // Clear input
      executor.update(context);
      output = executor.getGraphOutput('stream') as any[];
      expect(output.length).toBe(0);

      // T=0.5: Should release
      context.time = 0.5;
      executor.update(context);
      output = executor.getGraphOutput('stream') as any[];
      expect(output.length).toBe(1);
      expect(output.length).toBe(1);
      // console.log('Output Event:', JSON.stringify(output[0], null, 2));
      const event = output[0];
      const note = event.note !== undefined ? event.note : (event.fields?.note);
      expect(note).toBe(60);
    });

    it('should handle multi-event sequences over time', () => {
      const graph = createGraph('delay', 'midi.delay', { mode: 'time' });
      const executor = new GraphExecutor(graph, repository);

      const DURATION = 0.5;
      executor.setInput('duration_in', DURATION);

      // Test Sequence:
      // Event A at T=0.0
      // Event B at T=0.2
      // Expect A at T=0.5, B at T=0.7

      // T=0.0: Inject A
      let context = { time: 0.0, clock: { beat: 0, dt: 0.1 } };
      let streamA = [{ ...createNoteOnEvent(0), note: 60 }]; // Note 60
      executor.setInput('midi_in', streamA as any);
      executor.update(context);

      let output = executor.getGraphOutput('stream') as any[];
      expect(output.length).toBe(0);

      // T=0.2: Inject B
      context.time = 0.2;
      let streamB = [{ ...createNoteOnEvent(0), note: 62 }]; // Note 62
      executor.setInput('midi_in', streamB as any);
      executor.update(context);

      output = executor.getGraphOutput('stream') as any[];
      expect(output.length).toBe(0);

      // T=0.4: Check (Should be empty)
      context.time = 0.4;
      executor.setInput('midi_in', []);
      executor.update(context);
      output = executor.getGraphOutput('stream') as any[];
      expect(output.length).toBe(0);

      // T=0.5: Expect A (Note 60)
      context.time = 0.5;
      executor.update(context);
      output = executor.getGraphOutput('stream') as any[];
      expect(output.length).toBe(1);
      expect(output.length).toBe(1);
      const eventA = output[0];
      expect(eventA.note !== undefined ? eventA.note : eventA.fields?.note).toBe(60); // A

      // T=0.6: Check (Should be empty, B is due at 0.7)
      context.time = 0.6;
      executor.update(context);
      output = executor.getGraphOutput('stream') as any[];
      expect(output.length).toBe(0);

      // T=0.7: Expect B (Note 62)
      context.time = 0.7;
      executor.update(context);
      output = executor.getGraphOutput('stream') as any[];
      expect(output.length).toBe(1);
      const eventB = output[0];
      expect(eventB.note !== undefined ? eventB.note : eventB.fields?.note).toBe(62); // B
    });

    it('should delay events by beats', () => {
      const graph = createGraph('delay', 'midi.delay', { mode: 'beats' });
      const executor = new GraphExecutor(graph, repository);

      executor.setInput('duration_in', 2); // 2 beats

      // Beat=0: Send Event
      const context = { time: 0, clock: { beat: 0, dt: 0.1 } };
      executor.setInput('midi_in', [createNoteOnEvent(0)] as any);
      executor.update(context);

      let output = executor.getGraphOutput('stream') as any[];
      expect(output.length).toBe(0);

      // Beat=1: Waiting
      context.clock.beat = 1;
      executor.setInput('midi_in', []);
      executor.update(context);
      output = executor.getGraphOutput('stream') as any[];
      expect(output.length).toBe(0);

      // Beat=2: Release
      context.clock.beat = 2;
      executor.update(context);
      output = executor.getGraphOutput('stream') as any[];
      expect(output.length).toBe(1);
    });
  });
});
